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

  it('stale close of an overwritten service socket does not remove the newer registration', async () => {
    const svc1 = await registerService(port, 'match-service');
    const svc2 = await registerService(port, 'match-service');

    // Close svc1 (the overwritten socket) and let gateway-ws process the event.
    const svc1Closed = onceClose(svc1);
    svc1.close(1000);
    await svc1Closed;
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });

    // svc2 must still be routable.
    const browser = await connectBrowser(port, 42);
    await onceMessage(svc2); // drain player:connect

    const routed = onceMessage(svc2);
    browser.send(JSON.stringify({ type: 'match:join' }));
    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });
  });

  it('sole service registration is removed when its socket closes', async () => {
    const svc = await registerService(port, 'match-service');
    const browser = await connectBrowser(port, 42);
    await onceMessage(svc); // drain player:connect

    // Close the only registered socket and wait for the event to process.
    const svcClosed = onceClose(svc);
    svc.close(1000);
    await svcClosed;
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });

    // Routing to 'match' prefix is gone — message is silently dropped, browser stays connected.
    browser.send(JSON.stringify({ type: 'match:join' }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(browser.readyState).toBe(WebSocket.OPEN);
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
    await onceMessage(serviceWs); // drain player:connect broadcast

    const routed = onceMessage(serviceWs);
    browserWs.send(JSON.stringify({ type: 'match:join' }));

    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });
  });

  it('overwrites any userId the browser sent with the one from the JWT', async () => {
    const serviceWs = await registerService(port, 'match-service');
    const browserWs = await connectBrowser(port, 42);
    await onceMessage(serviceWs); // drain player:connect broadcast

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

describe('gateway-ws — service→service routing', () => {
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

  it('routes a no-to message to the target service with type and payload unchanged', async () => {
    const matchSvc  = await registerService(port, 'match-service');
    const gameSvc   = await registerService(port, 'game-service');

    const received = onceMessage(gameSvc);
    matchSvc.send(JSON.stringify({ type: 'game:assign', payload: { matchId: 99 } }));

    expect(await received).toEqual({ type: 'game:assign', payload: { matchId: 99 } });
  });

  it('drops a no-to message silently when the target service is not registered', async () => {
    const matchSvc = await registerService(port, 'match-service');
    // game-service is NOT registered

    matchSvc.send(JSON.stringify({ type: 'game:assign', payload: { matchId: 99 } }));

    // No error thrown; sending service stays connected.
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    expect(matchSvc.readyState).toBe(WebSocket.OPEN);
  });

  it('regression: to-array fan-out to browsers is unaffected', async () => {
    const gameSvc  = await registerService(port, 'game-service');
    const browser42 = await connectBrowser(port, 42);
    const browser17 = await connectBrowser(port, 17);

    const msg42 = onceMessage(browser42);
    const msg17 = onceMessage(browser17);

    gameSvc.send(JSON.stringify({ type: 'game:state', to: [42, 17], payload: { x: 1 } }));

    const expected = { type: 'game:state', payload: { x: 1 } };
    expect(await msg42).toEqual(expected);
    expect(await msg17).toEqual(expected);
  });
});

describe('gateway-ws — presence broadcast', () => {
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

  it('broadcasts player:connect to all registered services when a browser authenticates', async () => {
    const svc1 = await registerService(port, 'game-service');
    const svc2 = await registerService(port, 'match-service');

    const msg1 = onceMessage(svc1);
    const msg2 = onceMessage(svc2);

    await connectBrowser(port, 42);

    expect(await msg1).toEqual({ type: 'player:connect', userId: 42 });
    expect(await msg2).toEqual({ type: 'player:connect', userId: 42 });
  });

  it('broadcasts player:disconnect to all registered services when a browser closes', async () => {
    const svc = await registerService(port, 'game-service');
    const browser = await connectBrowser(port, 42);

    // Consume the player:connect so the next message from svc is player:disconnect.
    await onceMessage(svc);

    const disconnectMsg = onceMessage(svc);
    browser.close(1000);

    expect(await disconnectMsg).toEqual({ type: 'player:disconnect', userId: 42 });
  });

  it('does not throw when no services are registered and a browser connects or disconnects', async () => {
    const browser = await connectBrowser(port, 42);
    // Allow any microtasks triggered by the connect broadcast to settle.
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    expect(browser.readyState).toBe(WebSocket.OPEN);

    browser.close(1000);
    await new Promise<void>((resolve) => { setTimeout(resolve, 20); });
    // Server is still running cleanly.
    expect(instance.wss.clients.size).toBe(0);
  });

  it('does not send presence messages to other browser connections', async () => {
    const bystander = await connectBrowser(port, 99);

    // Collect any message that arrives at the bystander within 100ms after
    // a second browser connects and then disconnects.
    const unexpected: unknown[] = [];
    bystander.on('message', (data) => { unexpected.push(JSON.parse(data.toString())); });

    const newcomer = await connectBrowser(port, 42);
    newcomer.close(1000);

    await new Promise<void>((resolve) => { setTimeout(resolve, 100); });
    expect(unexpected).toHaveLength(0);
  });
});
