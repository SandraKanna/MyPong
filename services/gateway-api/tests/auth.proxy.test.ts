import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';

vi.mock('../src/config', () => ({
  config: {
    PORT: 4000,
    JWT_SECRET: 'a'.repeat(64),
    AUTH_SERVICE_URL: 'http://auth-service:4001',
  },
}));

import { buildApp } from '../src/app';

describe('authProxyRoutes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  // ── URL rewriting ───────────────────────────────────────────────────────────

  it('strips /api/auth prefix before forwarding to auth-service', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"userId":1}', { status: 201 }));

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [calledUrl] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://auth-service:4001/register');
  });

  // ── Method and body forwarding ──────────────────────────────────────────────

  it('forwards POST method and JSON-serialised body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"userId":1}', { status: 201 }));

    const payload = { email: 'x@x.com', password: 'password123' };
    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload,
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify(payload));
  });

  it('forwards DELETE /api/auth/session with no body when request has no payload', async () => {
    // 204 is a null-body status per WHATWG spec — body must be null, not an empty string.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await app.inject({ method: 'DELETE', url: '/api/auth/session' });

    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe('http://auth-service:4001/session');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  // ── Status-code propagation ─────────────────────────────────────────────────

  it('propagates upstream 201 to the client', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"userId":1}', { status: 201 }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@x.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('propagates upstream 401 (invalid credentials) to the client unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"Invalid credentials"}', { status: 401 }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@x.com', password: 'wrong' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Invalid credentials' });
  });

  it('propagates upstream 409 (duplicate email) to the client unchanged', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"error":"Email already registered"}', { status: 409 }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'existing@x.com', password: 'password123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'Email already registered' });
  });

  // ── Body propagation ────────────────────────────────────────────────────────

  it('propagates upstream response body verbatim to the client', async () => {
    const upstreamBody = { userId: 42, email: 'x@x.com' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify(upstreamBody), { status: 201 }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@x.com', password: 'password123' },
    });
    expect(res.json()).toEqual(upstreamBody);
  });

  // ── Cookie relay ───────────────────────────────────────────────────────────

  it('forwards Cookie header from client to upstream', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"accessToken":"tok"}', { status: 200 }));

    await app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      cookies: { refreshToken: 'some.refresh.token' },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toContain('refreshToken=some.refresh.token');
  });

  it('does not forward cookie header when client sends none', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"userId":1}', { status: 201 }));

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>).cookie).toBeUndefined();
  });

  it('propagates a single Set-Cookie from upstream to the client', async () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append('set-cookie', 'refreshToken=newtoken; HttpOnly; Path=/api/auth; SameSite=Strict');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"accessToken":"tok"}', { status: 200, headers: upstreamHeaders }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    const cookie = res.cookies.find(c => c.name === 'refreshToken');
    expect(cookie).toBeDefined();
    expect(cookie!.value).toBe('newtoken');
  });

  it('propagates multiple Set-Cookie from upstream as separate cookies (not collapsed)', async () => {
    const upstreamHeaders = new Headers();
    upstreamHeaders.append('set-cookie', 'refreshToken=newtoken; HttpOnly; Path=/api/auth');
    upstreamHeaders.append('set-cookie', 'secondCookie=abc; Path=/');
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response('{"accessToken":"tok"}', { status: 200, headers: upstreamHeaders }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    expect(res.cookies).toHaveLength(2);
    expect(res.cookies.find(c => c.name === 'refreshToken')).toBeDefined();
    expect(res.cookies.find(c => c.name === 'secondCookie')).toBeDefined();
  });

  it('does not send content-type to upstream when request has no body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await app.inject({
      method: 'DELETE',
      url: '/api/auth/session',
      cookies: { refreshToken: 'some.refresh.token' },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('sends content-type: application/json to upstream when request has a body', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{"userId":1}', { status: 201 }));

    await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  // ── Upstream failure → 502 ──────────────────────────────────────────────────

  it('returns 502 with generic body and logs service/url/error when fetch throws', async () => {
    // request.log is created via app.log.child({ reqId }) per request.
    // Spying on child() lets us intercept the request logger and assert on its error().
    const logError = vi.fn();
    const mockChild = {
      level: 'error',
      trace: vi.fn(), debug: vi.fn(), info: vi.fn(),
      warn: vi.fn(), error: logError, fatal: vi.fn(), silent: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    vi.spyOn(app.log, 'child').mockReturnValue(mockChild as never);

    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
      new Error('connect ECONNREFUSED 127.0.0.1:4001'),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'x@x.com', password: 'password123' },
    });

    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: 'Auth service unavailable' });
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'auth-service',
        url: 'http://auth-service:4001/login',
        err: expect.any(Error),
      }),
      'Upstream request failed',
    );
  });
});
