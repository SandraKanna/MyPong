import http from 'node:http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket, type RawData } from 'ws';
import { config } from './config';
import type { WsEnvelope } from '@mypong/types';

// 4000-4999 are application-reserved close codes per RFC 6455.
// 4001 = Unauthorized (bad/missing/wrong-type token, or auth timeout).
// 4003 = Bad Request (first message is not valid JSON or missing required fields).
// 4009 = Session Replaced (a newer browser connection authenticated with the
// same userId — see the single-session replacement logic below). Duplicated
// as a matching constant in frontend/src/shared/ws/wsClient.ts since there is
// no shared runtime package between the two — @mypong/types is type-only.
const CLOSE_UNAUTHORIZED     = 4001;
const CLOSE_BAD_REQUEST      = 4003;
const CLOSE_SESSION_REPLACED = 4009;

// Service names allowed to register. Extend when new WS-client services land.
const KNOWN_SERVICES = new Set(['game-service', 'match-service', 'user-service', 'ai-bot-service', 'test-service']); // 'test-service' is reserved for smoke tests — never a real container; registration still requires INTERNAL_SERVICE_SECRET
// ── Message types ─────────────────────────────────────────────────────────────

interface AuthMessage {
  type: 'auth';
  payload: { token: string };
}

interface ServiceRegisterMessage {
  type: 'service:register';
  service: string;
  token: string;
}

function rawDataToString(data: RawData): string {
  return Buffer.isBuffer(data)
    ? data.toString('utf8')
    : Array.isArray(data)
      ? Buffer.concat(data).toString('utf8')
      : Buffer.from(data).toString('utf8');
}

function isAuthMessage(value: unknown): value is AuthMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['type'] !== 'auth') return false;
  if (typeof v['payload'] !== 'object' || v['payload'] === null) return false;
  const p = v['payload'] as Record<string, unknown>;
  return typeof p['token'] === 'string';
}

function isServiceRegisterMessage(value: unknown): value is ServiceRegisterMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v['type'] === 'service:register'
    && typeof v['service'] === 'string'
    && typeof v['token'] === 'string';
}

// ── Exported types ────────────────────────────────────────────────────────────

export interface ServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
}

export interface BuildServerOptions {
  // Milliseconds before an unauthenticated connection is dropped.
  // Override in tests to avoid waiting 5 seconds.
  authTimeoutMs?: number;
}

// ── Server ────────────────────────────────────────────────────────────────────

export function buildServer(opts: BuildServerOptions = {}): ServerInstance {
  const authTimeoutMs = opts.authTimeoutMs ?? 5_000;

  // Scoped to this buildServer() call so test runs are isolated.
  const services = new Map<string, WebSocket>(); // serviceName → socket
  const browsers = new Map<number, WebSocket>(); // userId → socket

  const httpServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    res.writeHead(404);
    res.end();
  });

  const wss = new WebSocketServer({ server: httpServer });

  wss.on('connection', (socket: WebSocket) => {
    // Start auth clock. If the client doesn't identify itself in time, drop it.
    // A connected-but-unauthenticated socket consumes memory and a file descriptor.
    const timer = setTimeout(() => {
      socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
    }, authTimeoutMs);

    socket.once('message', (data: RawData) => {
      clearTimeout(timer);

      const raw = rawDataToString(data);
      let msg: unknown;
      try {
        msg = JSON.parse(raw) as unknown;
      } catch {
        socket.close(CLOSE_BAD_REQUEST, 'Bad Request');
        return;
      }

      if (isServiceRegisterMessage(msg)) {
        // Internal service connection: validate pre-shared secret and service name.
        if (msg.token !== config.INTERNAL_SERVICE_SECRET || !KNOWN_SERVICES.has(msg.service)) {
          socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
          return;
        }
        const serviceName = msg.service;
        services.set(serviceName, socket);
        socket.send(JSON.stringify({ type: 'registered' }));

        // Service → browser fan-out (`to: number[]`): strip `to`, deliver to each userId.
        // Service → service routing (no `to`): route by type prefix, no mutation.
        socket.on('message', (svcData: RawData) => {
          let svcMsg: unknown;
          try { svcMsg = JSON.parse(rawDataToString(svcData)) as unknown; } catch { return; }
          const envelope = svcMsg as WsEnvelope;
          if (Array.isArray(envelope.to)) {
            const { to, ...rest } = envelope;
            const outgoing = JSON.stringify(rest);
            for (const uid of to) {
              browsers.get(uid)?.send(outgoing);
            }
            return;
          }
          if (typeof envelope.type !== 'string') return;
          const prefix = envelope.type.split(':')[0];
          services.get(`${prefix}-service`)?.send(JSON.stringify(envelope));
        });

        socket.on('close', () => { if (services.get(serviceName) === socket) services.delete(serviceName); });
        return;
      }

      if (isAuthMessage(msg)) {
        // Browser connection: validate access JWT.
        let decoded: jwt.JwtPayload;
        try {
          const result = jwt.verify(msg.payload.token, config.JWT_SECRET, {
            algorithms: ['HS256'],
          });
          // Defense-in-depth: only 'access' and 'guest' tokens open a WS connection.
          if (typeof result === 'string' || (result['type'] !== 'access' && result['type'] !== 'guest')) {
            socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
            return;
          }
          decoded = result;
        } catch {
          socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
          return;
        }

        const userId = Number(decoded['sub']);

        // Single-session enforcement: a second browser authenticating with the
        // same userId (e.g. the same account logged in in two tabs) replaces
        // the previous connection rather than silently overwriting the Map
        // entry and leaving the old socket open but unrouted forever.
        const previous = browsers.get(userId);
        if (previous) {
          previous.close(CLOSE_SESSION_REPLACED, 'Session replaced by a newer connection');
          // Broadcast the disconnect now, synchronously, instead of waiting for
          // the old socket's own 'close' event — that event fires asynchronously
          // and could otherwise arrive after the player:connect broadcast below,
          // so services would see a connect before the matching disconnect. For
          // an in-progress match, game-service's handlePlayerConnect only acts
          // when a session is already marked disconnected for that userId; if
          // connect arrives first it's a no-op, and the later disconnect then
          // pauses (or, in PvE, silently tears down) a session that actually has
          // a live browser attached, with no further event to ever resume it.
          // The old socket's real close handler below (identity-checked) will
          // see this userId's Map entry already points elsewhere and skip
          // re-announcing the disconnect.
          for (const svc of services.values()) {
            svc.send(JSON.stringify({ type: 'player:disconnect', userId }));
          }
        }

        browsers.set(userId, socket);
        socket.send(JSON.stringify({ type: 'connected', payload: { userId: decoded['sub'] } }));

        for (const svc of services.values()) {
          svc.send(JSON.stringify({ type: 'player:connect', userId }));
        }

        // Browser → service routing: extract prefix from type before ':', look up
        // the registered service by `${prefix}-service`, inject userId.
        // gateway-ws overwrites any userId the client may have included — it is
        // the sole authority on identity.
        socket.on('message', (brData: RawData) => {
          let brMsg: unknown;
          try { brMsg = JSON.parse(rawDataToString(brData)) as unknown; } catch { return; }
          const envelope = brMsg as WsEnvelope;
          if (typeof envelope.type !== 'string') return;
          const prefix = envelope.type.split(':')[0];
          const target = services.get(`${prefix}-service`);
          if (!target) return;
          target.send(JSON.stringify({ ...envelope, userId }));
        });

        socket.on('close', () => {
          // If this userId's Map entry no longer points at this socket, a newer
          // connection already replaced it (and already broadcast the disconnect
          // for this one above) — deleting here would erase the newer session's
          // entry, and re-broadcasting would send a redundant disconnect.
          if (browsers.get(userId) !== socket) return;
          browsers.delete(userId);
          for (const svc of services.values()) {
            svc.send(JSON.stringify({ type: 'player:disconnect', userId }));
          }
        });
        return;
      }

      socket.close(CLOSE_BAD_REQUEST, 'Bad Request');
    });
  });

  return { httpServer, wss };
}
