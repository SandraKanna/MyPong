import fs from 'node:fs';
import WebSocket, { type RawData } from 'ws';
import type { WsEnvelope } from '@mypong/types';

export interface InternalClient {
  send(msg: object): void;
  onMessage(type: string, handler: (msg: WsEnvelope) => void): void;
  // Stop reconnecting and close the current connection (e.g. on SIGTERM).
  close(): void;
  // Same readyState check send() already uses to decide OPEN vs. queue —
  // exposed so callers (e.g. /health) can report the live connection state.
  isConnected(): boolean;
}

interface CreateInternalClientOpts {
  url: string;
  secret: string;
  serviceName: string;
  // Initial retry delay in ms. Doubles on each failure, caps at BACKOFF_CAP_MS.
  // Override in tests to avoid waiting the default 1 s between retries.
  initialRetryDelayMs?: number;
  // When provided, this file is written on connect and removed on disconnect.
  // Docker's healthcheck uses `test -f <path>` to reflect the connection state.
  healthFilePath?: string;
}

// Exponential backoff strategy: delay starts at initialRetryDelayMs (default 1 s),
// doubles on each failed attempt, and is capped at 30 s. Resets to the initial
// value after a successful connection. Avoids hammering a restarting gateway-ws.
const BACKOFF_FACTOR  = 2;
const BACKOFF_CAP_MS  = 30_000;
const BACKOFF_INIT_MS = 1_000;

// Skipped: superseded every tick anyway, so queuing them would waste capacity.
const SKIP_QUEUE_TYPES = new Set(['game:state', 'ai-bot:state']);

// In-memory queue for sends while disconnected; flushed in order on reconnect.
// Capped so a long outage can't grow it unbounded. Not persisted — a crash or
// restart drops anything still queued.
const PENDING_QUEUE_CAP = 50;

export function createInternalClient(opts: CreateInternalClientOpts): InternalClient {
  const handlers  = new Map<string, (msg: WsEnvelope) => void>();
  const pendingQueue: object[] = [];
  let delay   = opts.initialRetryDelayMs ?? BACKOFF_INIT_MS;
  let stopped = false;
  let ws!: WebSocket; // assigned synchronously by connect() before any method is callable

  function connect(): void {
    ws = new WebSocket(opts.url);

    ws.on('open', () => {
      delay = opts.initialRetryDelayMs ?? BACKOFF_INIT_MS; // reset on successful connect
      if (opts.healthFilePath) {
        fs.writeFileSync(opts.healthFilePath, '');
      }
      ws.send(JSON.stringify({
        type:    'service:register',
        service: opts.serviceName,
        token:   opts.secret,
      }));
      while (pendingQueue.length > 0) {
        ws.send(JSON.stringify(pendingQueue.shift()));
      }
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
      if (opts.healthFilePath) {
        try { fs.unlinkSync(opts.healthFilePath); } catch { /* already removed */ }
      }
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
        return;
      }
      const type = (msg as { type?: unknown }).type;
      if (SKIP_QUEUE_TYPES.has(type as string)) return;
      if (pendingQueue.length >= PENDING_QUEUE_CAP) {
        const dropped = pendingQueue.shift() as { type?: unknown } | undefined;
        console.warn(`[${opts.serviceName}] queue full (${PENDING_QUEUE_CAP}) — dropped oldest queued message: ${String(dropped?.type)}`);
      }
      pendingQueue.push(msg);
    },

    onMessage(type: string, handler: (msg: WsEnvelope) => void): void {
      handlers.set(type, handler);
    },

    close(): void {
      stopped = true;
      ws.close();
    },

    isConnected(): boolean {
      return ws.readyState === WebSocket.OPEN;
    },
  };
}
