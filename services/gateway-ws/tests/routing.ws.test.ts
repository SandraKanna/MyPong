import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { buildServer, type ServerInstance } from '../src/app';

// Inline literals required — vi.mock factory is hoisted before variable initialisation.
vi.mock('../src/config', () => ({
  config: {
    PORT: 0,
    JWT_SECRET: 'a'.repeat(32),
    INTERNAL_SERVICE_SECRET: 's'.repeat(32),
  },
}));

const TEST_JWT_SECRET     = 'a'.repeat(32);
const TEST_SERVICE_SECRET = 's'.repeat(32);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUserToken(userId: number): string {
  return jwt.sign(
    { sub: String(userId), type: 'access' },
    TEST_JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '15m' },
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

function onceMessage(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once('message', (data) => { resolve(JSON.parse(data.toString())); });
  });
}

function onceClose(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    ws.once('close', (code) => { resolve(code); });
  });
}

// Register a service and wait for the 'registered' confirmation.
async function registerService(port: number, serviceName: string): Promise<WebSocket> {
  const ws = connect(port);
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: 'service:register', service: serviceName, token: TEST_SERVICE_SECRET }));
  await onceMessage(ws); // 'registered'
  return ws;
}

// Connect a browser, authenticate, and wait for 'connected'.
async function connectBrowser(port: number, userId: number): Promise<WebSocket> {
  const ws = connect(port);
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: 'auth', payload: { token: makeUserToken(userId) } }));
  await onceMessage(ws); // 'connected'
  return ws;
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('gateway-ws — service registration', () => {
  let instance: ServerInstance;
  let port: number;

  beforeEach(async () => {
    instance = buildServer({ authTimeoutMs: 100 });
    await new Promise<void>((resolve) => { instance.httpServer.listen(0, resolve); });
    port = (instance.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const client of instance.wss.clients) { client.terminate(); }
    await new Promise<void>((resolve) => {
      instance.wss.close(() => { instance.httpServer.close(() => { resolve(); }); });
    });
  });

  it('accepts a valid service:register and sends registered', async () => {
    const ws = connect(port);
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: 'service:register', service: 'game-service', token: TEST_SERVICE_SECRET }));
    const msg = await onceMessage(ws);
    expect(msg).toEqual({ type: 'registered' });
  });

  it('closes with 4001 when the service token is wrong', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: 'service:register', service: 'game-service', token: 'wrong'.repeat(10) }));
    expect(await closePromise).toBe(4001);
  });

  it('closes with 4001 when the service name is unknown', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: 'service:register', service: 'unknown-service', token: TEST_SERVICE_SECRET }));
    expect(await closePromise).toBe(4001);
  });

  it('closes with 4003 when service:register is missing required fields', async () => {
    const ws = connect(port);
    const closePromise = onceClose(ws);
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: 'service:register' })); // no service or token
    expect(await closePromise).toBe(4003);
  });
});

describe('gateway-ws — browser→service routing', () => {
  let instance: ServerInstance;
  let port: number;

  beforeEach(async () => {
    instance = buildServer({ authTimeoutMs: 100 });
    await new Promise<void>((resolve) => { instance.httpServer.listen(0, resolve); });
    port = (instance.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const client of instance.wss.clients) { client.terminate(); }
    await new Promise<void>((resolve) => {
      instance.wss.close(() => { instance.httpServer.close(() => { resolve(); }); });
    });
  });

  it('routes a browser message to the registered service with userId injected', async () => {
    const serviceWs = await registerService(port, 'match-service');
    const browserWs = await connectBrowser(port, 42);

    const routed = onceMessage(serviceWs);
    browserWs.send(JSON.stringify({ type: 'match:join' }));

    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });
  });

  it('overwrites any userId the browser sent with the one from the JWT', async () => {
    const serviceWs = await registerService(port, 'match-service');
    const browserWs = await connectBrowser(port, 42);

    const routed = onceMessage(serviceWs);
    // Client tries to spoof userId 999 — gateway-ws must replace it with 42.
    browserWs.send(JSON.stringify({ type: 'match:join', userId: 999 }));

    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });
  });

  it('drops browser messages silently when the target service is not registered', async () => {
    const browserWs = await connectBrowser(port, 42);

    // No service registered for 'game' prefix — message should be dropped with no error.
    browserWs.send(JSON.stringify({ type: 'game:input', payload: { direction: 'up' } }));

    // Give gateway-ws time to process, then verify browser is still connected.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(browserWs.readyState).toBe(WebSocket.OPEN);
  });
});

describe('gateway-ws — service→browser fan-out', () => {
  let instance: ServerInstance;
  let port: number;

  beforeEach(async () => {
    instance = buildServer({ authTimeoutMs: 100 });
    await new Promise<void>((resolve) => { instance.httpServer.listen(0, resolve); });
    port = (instance.httpServer.address() as { port: number }).port;
  });

  afterEach(async () => {
    for (const client of instance.wss.clients) { client.terminate(); }
    await new Promise<void>((resolve) => {
      instance.wss.close(() => { instance.httpServer.close(() => { resolve(); }); });
    });
  });

  it('fans out to all listed browser userIds and strips the to field', async () => {
    const serviceWs = await registerService(port, 'game-service');
    const browser42 = await connectBrowser(port, 42);
    const browser17 = await connectBrowser(port, 17);

    const msg42 = onceMessage(browser42);
    const msg17 = onceMessage(browser17);

    serviceWs.send(JSON.stringify({
      type: 'game:state',
      to: [42, 17],
      payload: { ball: { x: 0, y: 0 } },
    }));

    const [received42, received17] = await Promise.all([msg42, msg17]);
    const expected = { type: 'game:state', payload: { ball: { x: 0, y: 0 } } };
    expect(received42).toEqual(expected);
    expect(received17).toEqual(expected);
  });

  it('skips missing browser connections in fan-out without error', async () => {
    const serviceWs = await registerService(port, 'game-service');
    const browser42 = await connectBrowser(port, 42);
    // userId 999 is not connected

    const msg42 = onceMessage(browser42);

    serviceWs.send(JSON.stringify({
      type: 'game:state',
      to: [42, 999],
      payload: { score: { left: 3, right: 1 } },
    }));

    // browser42 receives its message; no error thrown for missing 999.
    expect(await msg42).toMatchObject({ type: 'game:state' });
    // Give gateway-ws time to process, then verify it's still running cleanly.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(instance.wss.clients.size).toBeGreaterThan(0);
  });
});
