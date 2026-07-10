import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import { WebSocket, WebSocketServer } from 'ws';

// Hoisted before imports — sets config.JWT_SECRET for the test run.
vi.mock('../src/config', () => ({
  config: {
    PORT: 0,
    JWT_SECRET: 'a'.repeat(32),
  },
}));

import { buildServer, type ServerInstance } from '../src/app';

const TEST_SECRET = 'a'.repeat(32);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { sub: '42', type: 'access', ...overrides },
    TEST_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
  );
}

function makeExpiredToken(): string {
  return jwt.sign(
    { sub: '42', type: 'access', exp: Math.floor(Date.now() / 1000) - 60 },
    TEST_SECRET,
    { algorithm: 'HS256' },
  );
}

function connect(port: number): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}`);
}

function onceOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

function onceMessage(ws: WebSocket): Promise<string> {
  return new Promise((resolve) => {
    ws.once('message', (data) => { resolve(data.toString()); });
  });
}

function onceClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => { resolve(code); });
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('gateway-ws — WebSocket auth', () => {
  let instance: ServerInstance;
  let port: number;

  beforeEach(async () => {
    // Short auth timeout so the "no message sent" test completes in <200 ms.
    instance = buildServer({ authTimeoutMs: 100 });
    await new Promise<void>((resolve) => {
      instance.httpServer.listen(0, resolve);
    });
    const addr = instance.httpServer.address() as { port: number };
    port = addr.port;
  });

  afterEach(async () => {
    for (const client of instance.wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => {
      instance.wss.close(() => {
        instance.httpServer.close(() => { resolve(); });
      });
    });
  });

  it('accepts a valid access token and sends a connected message', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: 'auth', payload: { token: makeToken() } }));

    const raw = await onceMessage(ws);
    ws.close();
    await closePromise;

    expect(JSON.parse(raw)).toMatchObject({
      type: 'connected',
      payload: { userId: '42' },
    });
  });

  it('accepts a guest token and sends a connected message with the negative userId', async () => {
    const guestToken = jwt.sign(
      { sub: '-12345', type: 'guest' },
      TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: 'auth', payload: { token: guestToken } }));

    const raw = await onceMessage(ws);
    ws.close();
    await closePromise;

    expect(JSON.parse(raw)).toMatchObject({
      type: 'connected',
      payload: { userId: '-12345' },
    });
  });

  it('rejects a refresh token used in place of an access token (close 4001)', async () => {
    const refreshToken = jwt.sign(
      { sub: '42', type: 'refresh' },
      TEST_SECRET,
      { algorithm: 'HS256', expiresIn: '7d' },
    );

    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: 'auth', payload: { token: refreshToken } }));

    expect(await closePromise).toBe(4001);
  });

  it('rejects a token signed with the wrong secret (close 4001)', async () => {
    const forgedToken = jwt.sign(
      { sub: '42', type: 'access' },
      'wrong_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      { algorithm: 'HS256', expiresIn: '15m' },
    );

    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: 'auth', payload: { token: forgedToken } }));

    expect(await closePromise).toBe(4001);
  });

  it('rejects an expired token (close 4001)', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: 'auth', payload: { token: makeExpiredToken() } }));

    expect(await closePromise).toBe(4001);
  });

  it('closes with 4001 when no auth message is sent within the timeout', async () => {
    const ws = connect(port);
    // Do not send anything — just wait for the server to time out.
    const code = await onceClose(ws);
    expect(code).toBe(4001);
  });

  it('closes with 4003 when the first message is not valid JSON', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    ws.send('this is not json');

    expect(await closePromise).toBe(4003);
  });

  it('closes with 4003 when the first message has the wrong structure', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);

    // Valid JSON but not an auth message.
    ws.send(JSON.stringify({ type: 'game:input', payload: { direction: 'up' } }));

    expect(await closePromise).toBe(4003);
  });
});

describe('gateway-ws — HTTP health endpoint', () => {
  let instance: ServerInstance;
  let port: number;

  beforeEach(async () => {
    instance = buildServer();
    await new Promise<void>((resolve) => {
      instance.httpServer.listen(0, resolve);
    });
    const addr = instance.httpServer.address() as { port: number };
    port = addr.port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      instance.wss.close(() => {
        instance.httpServer.close(() => { resolve(); });
      });
    });
  });

  it('responds 200 { status: ok } on GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port.toString()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });
});
