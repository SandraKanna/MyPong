import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSocketServer, WebSocket } from 'ws';
import { createInternalClient, type InternalClient } from '../src/ws/internalClient';

// Spin up a real local WS server for each test — no mocking needed since
// internalClient takes url/secret/serviceName as plain opts, not from config.

describe('internalClient — sends service:register on connect', () => {
  let server: WebSocketServer;
  let port: number;
  let client: InternalClient;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client.close();
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  });

  it('sends service:register with correct fields immediately on open', async () => {
    const firstMessage = new Promise<unknown>((resolve) => {
      server.once('connection', (ws) => {
        ws.once('message', (data) => { resolve(JSON.parse(data.toString())); });
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50,
    });

    expect(await firstMessage).toEqual({
      type:    'service:register',
      service: 'game-service',
      token:   'x'.repeat(32),
    });
  });
});

describe('internalClient — dispatches incoming messages to handlers', () => {
  let server: WebSocketServer;
  let port: number;
  let client: InternalClient;
  let serverSocket: WebSocket;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    port = (server.address() as { port: number }).port;

    const connected = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        serverSocket = ws;
        // Consume the service:register message so it doesn't interfere with test sends.
        ws.once('message', () => { resolve(); });
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50,
    });

    await connected;
  });

  afterEach(async () => {
    client.close();
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  });

  it('calls the registered handler when a matching type arrives', async () => {
    const received = new Promise<unknown>((resolve) => {
      client.onMessage('game:assign', (msg) => { resolve(msg); });
    });

    serverSocket.send(JSON.stringify({ type: 'game:assign', payload: { matchId: 7 } }));

    expect(await received).toMatchObject({ type: 'game:assign', payload: { matchId: 7 } });
  });

  it('ignores messages with no registered handler', async () => {
    // Send a message with an unregistered type; no handler registered → no error.
    serverSocket.send(JSON.stringify({ type: 'unknown:event' }));
    await new Promise<void>((resolve) => { setTimeout(resolve, 50); });
    // If we reach here without throwing, the test passes.
  });
});

describe('internalClient — reconnects after disconnect', () => {
  let server: WebSocketServer;
  let port: number;
  let client: InternalClient;

  beforeEach(async () => {
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client.close();
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  });

  it('reconnects and re-sends service:register after the connection drops', async () => {
    let registrations = 0;

    const firstReg = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'service:register') { registrations++; resolve(); }
        });
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50, // fast retry so the test completes quickly
    });

    await firstReg;
    expect(registrations).toBe(1);

    // Set up second-connection listener before closing to avoid missing the event.
    const secondReg = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        ws.once('message', (data) => {
          const msg = JSON.parse(data.toString()) as { type: string };
          if (msg.type === 'service:register') { registrations++; resolve(); }
        });
      });
    });

    // Close all server-side connections to trigger the client's 'close' event.
    for (const c of server.clients) { c.close(); }

    await secondReg;
    expect(registrations).toBe(2);
  });
});

describe('internalClient — health file management', () => {
  let server: WebSocketServer;
  let port: number;
  let client: InternalClient;
  let serverSocket: WebSocket;
  let filePath: string;

  beforeEach(async () => {
    filePath = path.join(os.tmpdir(), `test-healthy-${Math.random().toString(36).slice(2)}`);
    server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => { server.once('listening', resolve); });
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    client.close();
    try { fs.unlinkSync(filePath); } catch { /* already removed */ }
    await new Promise<void>((resolve) => { server.close(() => { resolve(); }); });
  });

  it('writes the health file when the connection opens', async () => {
    const connected = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        serverSocket = ws;
        ws.once('message', () => { resolve(); }); // consume service:register
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50,
      healthFilePath: filePath,
    });

    await connected;
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('removes the health file when the connection drops', async () => {
    const connected = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        serverSocket = ws;
        ws.once('message', () => { resolve(); });
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50,
      healthFilePath: filePath,
    });

    await connected;
    expect(fs.existsSync(filePath)).toBe(true);

    serverSocket.close();
    await vi.waitFor(() => {
      expect(fs.existsSync(filePath)).toBe(false);
    }, { timeout: 1000, interval: 10 });
  });

  it('recreates the health file after reconnecting', async () => {
    const firstConnected = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        serverSocket = ws;
        ws.once('message', () => { resolve(); });
      });
    });

    client = createInternalClient({
      url: `ws://127.0.0.1:${port}`,
      secret: 'x'.repeat(32),
      serviceName: 'game-service',
      initialRetryDelayMs: 50,
      healthFilePath: filePath,
    });

    await firstConnected;
    expect(fs.existsSync(filePath)).toBe(true);

    // Set up second-connection listener before closing to avoid missing the event.
    const secondConnected = new Promise<void>((resolve) => {
      server.once('connection', (ws) => {
        ws.once('message', () => { resolve(); });
      });
    });
    serverSocket.close();
    await secondConnected;

    expect(fs.existsSync(filePath)).toBe(true);
  });
});
