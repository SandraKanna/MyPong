import WebSocket, { type RawData } from 'ws';
import type { WsEnvelope } from '@mypong/types';

export interface InternalClient {
  send(msg: object): void;
  onMessage(type: string, handler: (msg: WsEnvelope) => void): void;
  // Stop reconnecting and close the current connection (e.g. on SIGTERM).
  close(): void;
}

interface CreateInternalClientOpts {
  url: string;
  secret: string;
  serviceName: string;
  // Initial retry delay in ms. Doubles on each failure, caps at BACKOFF_CAP_MS.
  // Override in tests to avoid waiting the default 1 s between retries.
  initialRetryDelayMs?: number;
}

// Exponential backoff strategy: delay starts at initialRetryDelayMs (default 1 s),
// doubles on each failed attempt, and is capped at 30 s. Resets to the initial
// value after a successful connection. Avoids hammering a restarting gateway-ws.
const BACKOFF_FACTOR  = 2;
const BACKOFF_CAP_MS  = 30_000;
const BACKOFF_INIT_MS = 1_000;

export function createInternalClient(opts: CreateInternalClientOpts): InternalClient {
  const handlers  = new Map<string, (msg: WsEnvelope) => void>();
  let delay   = opts.initialRetryDelayMs ?? BACKOFF_INIT_MS;
  let stopped = false;
  let ws!: WebSocket; // assigned synchronously by connect() before any method is callable

  function connect(): void {
    ws = new WebSocket(opts.url);

    ws.on('open', () => {
      delay = opts.initialRetryDelayMs ?? BACKOFF_INIT_MS; // reset on successful connect
      ws.send(JSON.stringify({
        type:    'service:register',
        service: opts.serviceName,
        token:   opts.secret,
      }));
    });

    ws.on('message', (data: RawData) => {
      const raw = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data).toString('utf8');

      let msg: unknown;
      try { msg = JSON.parse(raw) as unknown; } catch { return; }

      const envelope = msg as WsEnvelope;
      if (typeof envelope.type !== 'string') return;

      handlers.get(envelope.type)?.(envelope);
    });

    ws.on('close', () => {
      if (stopped) return;
      // Increase delay before scheduling retry so the next failure waits longer.
      const retryAfter = delay;
      delay = Math.min(delay * BACKOFF_FACTOR, BACKOFF_CAP_MS);
      setTimeout(connect, retryAfter);
    });

    ws.on('error', (err) => {
      // Log the error; 'close' fires after 'error' and handles the retry.
      console.error(`[${opts.serviceName}] gateway-ws connection error: ${err.message}`);
    });
  }

  connect();

  return {
    send(msg: object): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },

    onMessage(type: string, handler: (msg: WsEnvelope) => void): void {
      handlers.set(type, handler);
    },

    close(): void {
      stopped = true;
      ws.close();
    },
  };
}
