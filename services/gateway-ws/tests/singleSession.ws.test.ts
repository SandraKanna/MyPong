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
const CLOSE_SESSION_REPLACED = 4009;

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

function collectMessages(ws: WebSocket): unknown[] {
  const received: unknown[] = [];
  ws.on('message', (data) => { received.push(JSON.parse(data.toString())); });
  return received;
}

function onceClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once('close', (code, reasonBuf) => { resolve({ code, reason: reasonBuf.toString() }); });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
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

describe('gateway-ws — single-session replacement', () => {
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

  it('closes the previous connection with 4009 when a second one authenticates as the same userId', async () => {
    const first = await connectBrowser(port, 42);
    const firstClosed = onceClose(first);

    await connectBrowser(port, 42);

    const { code, reason } = await firstClosed;
    expect(code).toBe(CLOSE_SESSION_REPLACED);
    expect(reason).toBe('Session replaced by a newer connection');
  });

  it('does not close anything on a first-time login for a userId with no prior connection', async () => {
    const browser = await connectBrowser(port, 42);
    await sleep(20);
    expect(browser.readyState).toBe(WebSocket.OPEN);
  });

  it('routes messages through the new connection after replacement', async () => {
    const serviceWs = await registerService(port, 'match-service');
    await connectBrowser(port, 42); // first session
    await onceMessage(serviceWs); // drain player:connect for the first session

    // Attach the collector before triggering the replacement — sequential
    // onceMessage() calls made after the fact can miss messages that were
    // already delivered (and thus lost, for a listener not yet attached)
    // while awaiting the second connectBrowser() call below.
    const received = collectMessages(serviceWs);
    const second = await connectBrowser(port, 42); // replaces the first
    await sleep(20); // let the disconnect/connect broadcasts settle

    expect(received).toEqual([
      { type: 'player:disconnect', userId: 42 },
      { type: 'player:connect', userId: 42 },
    ]);

    const routed = onceMessage(serviceWs);
    second.send(JSON.stringify({ type: 'match:join' }));

    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });
  });

  it('broadcasts player:disconnect for the replaced session before player:connect for the new one', async () => {
    const serviceWs = await registerService(port, 'game-service');
    await connectBrowser(port, 42); // first session
    await onceMessage(serviceWs); // drain player:connect for the first session

    const received = collectMessages(serviceWs);
    await connectBrowser(port, 42); // replaces the first
    await sleep(20);

    expect(received).toEqual([
      { type: 'player:disconnect', userId: 42 },
      { type: 'player:connect', userId: 42 },
    ]);
  });

  it('does not re-broadcast player:disconnect when the replaced socket later fires its own close event', async () => {
    const serviceWs = await registerService(port, 'game-service');
    const first = await connectBrowser(port, 42);
    await onceMessage(serviceWs); // drain player:connect for the first session

    const received = collectMessages(serviceWs);
    await connectBrowser(port, 42); // replaces the first — closes it with 4009
    await sleep(20); // let the first socket's real close event (async) fire and be processed

    // Only the single disconnect broadcast made at replacement time, plus the
    // new session's connect — not a second disconnect from the delayed close.
    expect(received).toEqual([
      { type: 'player:disconnect', userId: 42 },
      { type: 'player:connect', userId: 42 },
    ]);
    expect(first.readyState).not.toBe(WebSocket.OPEN);
  });

  it('does not delete the newer session when the replaced socket later fires its own close event', async () => {
    const serviceWs = await registerService(port, 'match-service');
    await connectBrowser(port, 42); // first session
    await onceMessage(serviceWs); // drain player:connect for the first session

    // Attach before triggering the replacement — see the note in the
    // "routes messages through the new connection" test above.
    const received = collectMessages(serviceWs);
    const second = await connectBrowser(port, 42); // replaces the first
    await sleep(20); // let the disconnect/connect broadcasts and the first socket's real close event settle
    expect(received).toEqual([
      { type: 'player:disconnect', userId: 42 },
      { type: 'player:connect', userId: 42 },
    ]);

    // The second (current) session must still be routable.
    const routed = onceMessage(serviceWs);
    second.send(JSON.stringify({ type: 'match:join' }));
    expect(await routed).toMatchObject({ type: 'match:join', userId: 42 });

    // And closing the second (current) session must still broadcast its own disconnect.
    const disconnectMsg = onceMessage(serviceWs);
    second.close(1000);
    expect(await disconnectMsg).toEqual({ type: 'player:disconnect', userId: 42 });
  });

  it('does not affect a different userId\'s session', async () => {
    const bystander = await connectBrowser(port, 99);
    const bystanderMessages = collectMessages(bystander);

    await connectBrowser(port, 42);
    await connectBrowser(port, 42); // replaces the userId-42 session, not userId-99's

    await sleep(20);
    expect(bystander.readyState).toBe(WebSocket.OPEN);
    expect(bystanderMessages).toHaveLength(0);
  });
});
