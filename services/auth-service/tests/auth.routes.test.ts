import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueryResult } from 'pg';

// Mocks are hoisted before imports by Vitest — order here matters.

vi.mock('../src/config', () => ({
  config: {
    PORT: 4001,
    DATABASE_URL: 'postgresql://test',
    JWT_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
  },
}));

vi.mock('../src/db', () => ({
  db: { query: vi.fn() },
}));

vi.mock('argon2', () => ({
  default: {
    hash: vi.fn().mockResolvedValue('$argon2id$mock_hash'),
    verify: vi.fn().mockResolvedValue(true),
  },
}));

// Imported after mocks so they receive the mocked modules.
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/app';
import { db } from '../src/db';
import { generateRefreshToken } from '../src/services/auth.service';
import argon2 from 'argon2';

const mockQuery = vi.mocked(db.query);
const mockVerify = vi.mocked(argon2.verify);

const MOCK_USER = {
  id: 1,
  email: 'test@example.com',
  password_hash: '$argon2id$mock_hash',
  created_at: new Date(),
};

function makeTokenRow(jti: string, revoked = false) {
  return {
    id: 1,
    user_id: 1,
    jti,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    revoked_at: revoked ? new Date() : null,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function rows<T>(data: T[]): QueryResult<T> {
  return { rows: data, rowCount: data.length, command: '', oid: 0, fields: [] };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('auth-service routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  // ── POST /guest ─────────────────────────────────────────────────────────────

  describe('POST /guest', () => {
    it('case 10 — returns 200 with accessToken, no cookie, no DB access', async () => {
      const res = await app.inject({ method: 'POST', url: '/guest' });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.accessToken).toBe('string');
      expect(body).not.toHaveProperty('refreshToken');
      expect(mockQuery).not.toHaveBeenCalled();

      const setCookie = res.headers['set-cookie'];
      expect(setCookie).toBeUndefined();
    });

    it('case 11 — token sub is a negative integer and type is guest', () => {
      const JWT_SECRET = 'a'.repeat(64);

      const res = app.inject({ method: 'POST', url: '/guest' });
      // Run synchronously by re-invoking inject in a way we can immediately decode
      // the token. We use a promise chain rather than awaiting twice in one test.
      return res.then((r) => {
        const { accessToken } = r.json() as { accessToken: string };
        const decoded = jwt.verify(accessToken, JWT_SECRET) as { sub: string; type: string };
        expect(decoded.type).toBe('guest');
        const userId = Number(decoded.sub);
        expect(Number.isInteger(userId)).toBe(true);
        expect(userId).toBeLessThan(0);
      });
    });
  });

  // ── POST /register ──────────────────────────────────────────────────────────

  describe('POST /register', () => {
    it('case 1 — returns 201 and userId for a new user', async () => {
      mockQuery
        .mockResolvedValueOnce(rows([]))           // findUserByEmail → not found
        .mockResolvedValueOnce(rows([MOCK_USER])); // createUser → new row

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'test@example.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ userId: 1, email: 'test@example.com' });
    });

    it('case 2 — returns 409 when email is already registered', async () => {
      mockQuery.mockResolvedValueOnce(rows([MOCK_USER])); // findUserByEmail → found

      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'test@example.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Email already registered' });
    });

    it('case 3 — returns 400 for invalid input', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/register',
        payload: { email: 'notanemail', password: '123' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid input');
      expect(body.details).toHaveProperty('email');
      expect(body.details).toHaveProperty('password');
    });
  });

  // ── POST /login ─────────────────────────────────────────────────────────────

  describe('POST /login', () => {
    it('case 4 — returns 200 with accessToken in body and refreshToken in Set-Cookie', async () => {
      mockQuery
        .mockResolvedValueOnce(rows([MOCK_USER])) // findUserByEmail → found
        .mockResolvedValueOnce(rows([]));          // saveRefreshToken → ok
      mockVerify.mockResolvedValueOnce(true);

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'test@example.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('accessToken');
      expect(typeof body.accessToken).toBe('string');
      expect(body).not.toHaveProperty('refreshToken');

      const cookie = res.cookies.find(c => c.name === 'refreshToken');
      expect(cookie).toBeDefined();
      expect(typeof cookie!.value).toBe('string');
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe('Strict');
      expect(cookie!.path).toBe('/api/auth');
    });

    it('case 5 — returns 401 with same message for wrong password (no user enumeration)', async () => {
      mockQuery.mockResolvedValueOnce(rows([MOCK_USER])); // findUserByEmail → found
      mockVerify.mockResolvedValueOnce(false);            // wrong password

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'test@example.com', password: 'wrongpassword' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid credentials' });
    });

    it('returns 401 with same message for unknown email (no user enumeration)', async () => {
      mockQuery.mockResolvedValueOnce(rows([])); // findUserByEmail → not found

      const res = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: 'nobody@example.com', password: 'password123' },
      });

      expect(res.statusCode).toBe(401);
      // Identical message to wrong-password — client cannot distinguish
      expect(res.json()).toMatchObject({ error: 'Invalid credentials' });
    });
  });

  // ── POST /refresh ───────────────────────────────────────────────────────────

  describe('POST /refresh', () => {
    it('case 6 — returns 200 with new accessToken in body and rotated refreshToken in Set-Cookie', async () => {
      const { token, jti } = generateRefreshToken(1);

      mockQuery
        .mockResolvedValueOnce(rows([makeTokenRow(jti)]))  // findRefreshToken → active
        .mockResolvedValueOnce(rows([]))                    // revokeRefreshToken → ok
        .mockResolvedValueOnce(rows([]));                   // saveRefreshToken (new) → ok

      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        cookies: { refreshToken: token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('accessToken');
      expect(body).not.toHaveProperty('refreshToken');

      const cookie = res.cookies.find(c => c.name === 'refreshToken');
      expect(cookie).toBeDefined();
      // New refresh token must differ from the one used
      expect(cookie!.value).not.toBe(token);
      expect(cookie!.httpOnly).toBe(true);
      expect(cookie!.sameSite).toBe('Strict');
      expect(cookie!.path).toBe('/api/auth');
    });

    it('case 7 — returns 401 for an already-rotated refresh token', async () => {
      const { token, jti } = generateRefreshToken(1);

      mockQuery.mockResolvedValueOnce(rows([makeTokenRow(jti, true)])); // revoked_at set

      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        cookies: { refreshToken: token },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Refresh token already revoked' });
    });

    it('returns 401 for a token with invalid signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        cookies: { refreshToken: 'not.a.valid.jwt' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired refresh token' });
    });

    it('returns 401 when no cookie is present', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing refresh token' });
    });
  });

  // ── DELETE /session ─────────────────────────────────────────────────────────

  describe('DELETE /session', () => {
    it('case 8 — returns 204 and clears cookie on logout with a valid refresh token', async () => {
      const { token } = generateRefreshToken(1);

      mockQuery.mockResolvedValueOnce(rows([])); // revokeRefreshToken → ok

      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        cookies: { refreshToken: token },
      });

      expect(res.statusCode).toBe(204);
      const cookie = res.cookies.find(c => c.name === 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie!.maxAge).toBe(0);
    });

    it('case 9 — returns 204 and clears cookie for an invalid token (idempotent)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        cookies: { refreshToken: 'invalid.token.here' },
      });

      expect(res.statusCode).toBe(204);
      // DB must NOT have been called — no revokeRefreshToken on a bad token
      expect(mockQuery).not.toHaveBeenCalled();
      const cookie = res.cookies.find(c => c.name === 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie!.maxAge).toBe(0);
    });

    it('returns 204 and clears cookie when no cookie is present (idempotent)', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
      });

      expect(res.statusCode).toBe(204);
      expect(mockQuery).not.toHaveBeenCalled();
      const cookie = res.cookies.find(c => c.name === 'refreshToken');
      expect(cookie).toBeDefined();
      expect(cookie!.maxAge).toBe(0);
    });

    it('returns 500 when DB fails during revocation (token is valid)', async () => {
      const { token } = generateRefreshToken(1);

      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        cookies: { refreshToken: token },
      });

      // DB error must NOT be swallowed silently
      expect(res.statusCode).toBe(500);
      // revokeRefreshToken was called — the error came from infrastructure, not JWT validation
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });
});
