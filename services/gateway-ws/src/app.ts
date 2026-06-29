import http from 'node:http';
import jwt from 'jsonwebtoken';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config';

// 4000-4999 are application-reserved close codes per RFC 6455.
// 4001 = Unauthorized (bad/missing/wrong-type token, or auth timeout).
// 4003 = Bad Request (first message is not valid JSON or missing required fields).
const CLOSE_UNAUTHORIZED = 4001;
const CLOSE_BAD_REQUEST  = 4003;

interface AuthMessage {
  type: 'auth';
  payload: { token: string };
}

function isAuthMessage(value: unknown): value is AuthMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['type'] !== 'auth') return false;
  if (typeof v['payload'] !== 'object' || v['payload'] === null) return false;
  const p = v['payload'] as Record<string, unknown>;
  return typeof p['token'] === 'string';
}

export interface ServerInstance {
  httpServer: http.Server;
  wss: WebSocketServer;
}

export interface BuildServerOptions {
  // Milliseconds before an unauthenticated connection is dropped.
  // Override in tests to avoid waiting 5 seconds.
  authTimeoutMs?: number;
}

export function buildServer(opts: BuildServerOptions = {}): ServerInstance {
  const authTimeoutMs = opts.authTimeoutMs ?? 5_000;

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
    // Start auth clock. If the client doesn't send a valid auth message in
    // time, close the connection. A connected-but-unauthenticated socket
    // consumes memory and a file descriptor.
    const timer = setTimeout(() => {
      socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
    }, authTimeoutMs);

    socket.once('message', (data) => {
      clearTimeout(timer);

      // RawData = Buffer | ArrayBuffer | Buffer[]. Normalize to a string before
      // parsing. Text WebSocket frames from browsers always arrive as Buffer,
      // but the type covers all three variants.
      const raw = Buffer.isBuffer(data)
        ? data.toString('utf8')
        : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data).toString('utf8');

      let msg: unknown;
      try {
        msg = JSON.parse(raw) as unknown;
      } catch {
        socket.close(CLOSE_BAD_REQUEST, 'Bad Request');
        return;
      }

      if (!isAuthMessage(msg)) {
        socket.close(CLOSE_BAD_REQUEST, 'Bad Request');
        return;
      }

      let decoded: jwt.JwtPayload;
      try {
        const result = jwt.verify(msg.payload.token, config.JWT_SECRET, {
          algorithms: ['HS256'],
        });
        // Defense-in-depth: verify `type` claim even after signature check.
        // Guards against refresh tokens being used in place of access tokens
        // if both secrets ever coincide by misconfiguration.
        if (typeof result === 'string' || result['type'] !== 'access') {
          socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
          return;
        }
        decoded = result;
      } catch {
        socket.close(CLOSE_UNAUTHORIZED, 'Unauthorized');
        return;
      }

      socket.send(
        JSON.stringify({ type: 'connected', payload: { userId: decoded['sub'] } }),
      );
    });
  });

  return { httpServer, wss };
}
