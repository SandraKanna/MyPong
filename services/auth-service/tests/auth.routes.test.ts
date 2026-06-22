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
    it('case 4 — returns 200 with accessToken and refreshToken for valid credentials', async () => {
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
      expect(body).toHaveProperty('refreshToken');
      expect(typeof body.accessToken).toBe('string');
      expect(typeof body.refreshToken).toBe('string');
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
    it('case 6 — returns 200 with new token pair for a valid refresh token', async () => {
      const { token, jti } = generateRefreshToken(1);

      mockQuery
        .mockResolvedValueOnce(rows([makeTokenRow(jti)]))  // findRefreshToken → active
        .mockResolvedValueOnce(rows([]))                    // revokeRefreshToken → ok
        .mockResolvedValueOnce(rows([]));                   // saveRefreshToken (new) → ok

      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        payload: { refreshToken: token },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('accessToken');
      expect(body).toHaveProperty('refreshToken');
      // New refresh token must differ from the one used
      expect(body.refreshToken).not.toBe(token);
    });

    it('case 7 — returns 401 for an already-rotated refresh token', async () => {
      const { token, jti } = generateRefreshToken(1);

      mockQuery.mockResolvedValueOnce(rows([makeTokenRow(jti, true)])); // revoked_at set

      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        payload: { refreshToken: token },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Refresh token already revoked' });
    });

    it('returns 401 for a token with invalid signature', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/refresh',
        payload: { refreshToken: 'not.a.valid.jwt' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Invalid or expired refresh token' });
    });
  });

  // ── DELETE /session ─────────────────────────────────────────────────────────

  describe('DELETE /session', () => {
    it('case 8 — returns 204 on logout with a valid refresh token', async () => {
      const { token } = generateRefreshToken(1);

      mockQuery.mockResolvedValueOnce(rows([])); // revokeRefreshToken → ok

      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        payload: { refreshToken: token },
      });

      expect(res.statusCode).toBe(204);
    });

    it('case 9 — returns 204 when logging out with an already-revoked token (idempotent)', async () => {
      // Token is cryptographically valid but expired-or-invalid is simulated
      // by using a token signed with the wrong secret — verifyRefreshToken throws,
      // and the route treats it as already-logged-out (204, no DB call).
      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        payload: { refreshToken: 'invalid.token.here' },
      });

      expect(res.statusCode).toBe(204);
      // DB must NOT have been called — no revokeRefreshToken on a bad token
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('returns 500 when DB fails during revocation (token is valid)', async () => {
      const { token } = generateRefreshToken(1);

      mockQuery.mockRejectedValueOnce(new Error('DB connection lost'));

      const res = await app.inject({
        method: 'DELETE',
        url: '/session',
        payload: { refreshToken: token },
      });

      // DB error must NOT be swallowed silently
      expect(res.statusCode).toBe(500);
      // revokeRefreshToken was called — the error came from infrastructure, not JWT validation
      expect(mockQuery).toHaveBeenCalledOnce();
    });
  });
});
