import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import jwt from 'jsonwebtoken';

// Hoisted before any module import — config.ts calls process.exit(1) on invalid env.
vi.mock('../src/config', () => ({
  config: {
    PORT: 4000,
    JWT_SECRET: 'a'.repeat(64),
    AUTH_SERVICE_URL: 'http://auth-service:4001',
  },
}));

import { authPlugin } from '../src/plugins/auth.plugin';

const JWT_SECRET = 'a'.repeat(64);

describe('authPlugin — JWT middleware', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    // Minimal app: only the plugin under test + hand-wired routes.
    // No proxy registered → fetch is never called in these tests.
    app = Fastify({ logger: false });
    await app.register(authPlugin);

    // Public routes (must match PUBLIC_ROUTES exactly)
    app.get('/health', async () => ({ status: 'ok' }));
    app.post('/api/auth/login', async () => ({ ok: true }));

    // Public auth routes
    app.post('/api/auth/guest', async () => ({ ok: true }));

    // Protected route — preHandler hook applies because it is NOT in PUBLIC_ROUTES
    app.get('/api/users/me', async (request) => ({ userId: request.userId }));
  });

  afterEach(async () => {
    await app.close();
  });

  // ── Public routes bypass JWT check ─────────────────────────────────────────

  it('passes /health without Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
  });

  it('passes /api/auth/login without Authorization header', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login' });
    expect(res.statusCode).toBe(200);
  });

  // ── Protected route — missing / malformed token ─────────────────────────────

  it('returns 401 for protected route with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/users/me' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when Authorization header lacks "Bearer " prefix', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: 'Basic abc123' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a malformed token string', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for a token signed with a different secret', async () => {
    const token = jwt.sign({ sub: '1', type: 'access' }, 'b'.repeat(64), {
      algorithm: 'HS256',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 for an already-expired token', async () => {
    // Set exp explicitly to 1 second in the past — avoids relying on negative expiresIn behaviour.
    const token = jwt.sign(
      { sub: '1', type: 'access', exp: Math.floor(Date.now() / 1000) - 1 },
      JWT_SECRET,
      { algorithm: 'HS256' },
    );
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when a refresh token is used in place of an access token', async () => {
    const token = jwt.sign({ sub: '1', type: 'refresh' }, JWT_SECRET, {
      algorithm: 'HS256',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when a guest token is used on a protected route', async () => {
    const token = jwt.sign({ sub: '-42', type: 'guest' }, JWT_SECRET, {
      algorithm: 'HS256',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it('passes POST /api/auth/guest without Authorization header', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/guest' });
    expect(res.statusCode).toBe(200);
  });

  // ── Valid token ─────────────────────────────────────────────────────────────

  it('passes with a valid access token and sets request.userId to the sub claim', async () => {
    const token = jwt.sign({ sub: '42', type: 'access' }, JWT_SECRET, {
      algorithm: 'HS256',
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ userId: '42' });
  });
});
