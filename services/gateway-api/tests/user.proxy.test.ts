import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

vi.mock('../src/config', () => ({
  config: {
    PORT: 4000,
    JWT_SECRET: 'a'.repeat(64),
    AUTH_SERVICE_URL: 'http://auth-service:4001',
    USER_SERVICE_URL: 'http://user-service:4002',
  },
}));

const JWT_SECRET = 'a'.repeat(64);

import { buildApp } from '../src/app';

function validToken(userId: number): string {
  return jwt.sign({ sub: String(userId), type: 'access' }, JWT_SECRET, { algorithm: 'HS256' });
}

describe('userProxyRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  // ── URL rewriting ───────────────────────────────────────────────────────────

  it('strips /api/users prefix before forwarding to user-service', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"user_id":42}', { status: 200 }));

    await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://user-service:4002/me');
  });

  // ── Method and body forwarding ──────────────────────────────────────────────

  it('forwards PATCH method and JSON-serialised body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"user_id":42,"username":"alice"}', { status: 200 }));

    const payload = { username: 'alice' };
    await app.inject({
      method: 'PATCH',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
      payload,
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify(payload));
  });

  // ── Status-code propagation ─────────────────────────────────────────────────

  it('propagates upstream 200 to the client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"user_id":42,"username":"alice"}', { status: 200 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user_id: 42, username: 'alice' });
  });

  it('propagates upstream 404 (profile not found) to the client unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"Profile not found"}', { status: 404 }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: 'Profile not found' });
  });

  // ── x-user-id injection ─────────────────────────────────────────────────────

  it('injects x-user-id header from validated JWT sub claim', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"user_id":42}', { status: 200 }));

    await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-user-id']).toBe('42');
  });

  // ── Multipart passthrough ───────────────────────────────────────────────────

  it('forwards multipart body as raw bytes with original content-type (boundary preserved)', async () => {
    const boundary = 'test-boundary-xyz';
    const multipartBody = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="avatar.jpg"\r\n` +
      `Content-Type: application/octet-stream\r\n` +
      `\r\n` +
      `fake-image-bytes\r\n` +
      `--${boundary}--\r\n`,
    );
    const incomingContentType = `multipart/form-data; boundary=${boundary}`;

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"userId":42,"username":"alice","avatar_url":"/avatars/42.webp"}', { status: 200 }),
    );

    await app.inject({
      method: 'POST',
      url: '/api/users/me/avatar',
      headers: {
        authorization: `Bearer ${validToken(42)}`,
        'content-type': incomingContentType,
      },
      payload: multipartBody,
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    // URL stripped correctly
    expect(calledUrl).toBe('http://user-service:4002/me/avatar');
    // Content-type must travel verbatim so user-service can find the boundary
    expect((init.headers as Record<string, string>)['content-type']).toBe(incomingContentType);
    // Body must be the raw Buffer, not JSON.stringify'd
    expect(Buffer.isBuffer(init.body)).toBe(true);
    expect(init.body as Buffer).toEqual(multipartBody);
    // x-user-id still injected
    expect((init.headers as Record<string, string>)['x-user-id']).toBe('42');
  });

  // ── Upstream failure → 502 ──────────────────────────────────────────────────

  it('returns 502 with generic body and logs service/url/error when fetch throws', async () => {
    const logError = vi.fn();
    const mockChild = {
      level: 'error',
      trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
      warn: vi.fn(), error: logError, fatal: vi.fn(), silent: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    vi.spyOn(app.log, 'child').mockReturnValue(mockChild as never);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:4002'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${validToken(42)}` },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'User service unavailable' });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'user-service',
        url: 'http://user-service:4002/me',
        err: expect.any(Error),
      }),
      'Upstream request failed',
    );
  });
});
