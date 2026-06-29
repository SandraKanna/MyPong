import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildServer, type ServerInstance } from '../src/app';

// app.ts has no external dependencies in this PR — no mocks needed.

describe('game-service — health endpoint', () => {
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
      instance.httpServer.close(() => { resolve(); });
    });
  });

  it('responds 200 { status: ok } on GET /health', async () => {
    const res = await fetch(`http://127.0.0.1:${port.toString()}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  it('responds 404 on any other path', async () => {
    const res = await fetch(`http://127.0.0.1:${port.toString()}/unknown`);
    expect(res.status).toBe(404);
  });
});
