import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueryResult } from 'pg';

// Mocks are hoisted before imports by Vitest — order here matters.

vi.mock('../src/config', () => ({
  config: {
    PORT: 4002,
    DATABASE_URL: 'postgresql://test',
  },
}));

vi.mock('../src/db', () => ({
  db: { query: vi.fn() },
}));

// Imported after mocks so they receive the mocked modules.
import { buildApp } from '../src/app';
import { db } from '../src/db';

const mockQuery = vi.mocked(db.query);

const MOCK_PROFILE = {
  user_id: 1,
  username: 'testuser',
  avatar_url: null,
};

function rows<T>(data: T[]): QueryResult<T> {
  return { rows: data, rowCount: data.length, command: '', oid: 0, fields: [] };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('user-service routes', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  // ── GET /me ──────────────────────────────────────────────────────────────────

  describe('GET /me', () => {
    it('returns 200 with profile when it exists', async () => {
      mockQuery.mockResolvedValueOnce(rows([MOCK_PROFILE]));

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ userId: 1, username: 'testuser', avatar_url: null });
    });

    it('returns 404 when profile does not exist', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));

      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ error: 'Profile not found' });
    });

    it('returns 401 when x-user-id header is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/me' });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });

    it('returns 401 when x-user-id is not a valid number', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/me',
        headers: { 'x-user-id': 'notanumber' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });
  });

  // ── PATCH /me ────────────────────────────────────────────────────────────────

  describe('PATCH /me', () => {
    it('creates profile on first PATCH (upsert when no row exists yet)', async () => {
      mockQuery.mockResolvedValueOnce(rows([MOCK_PROFILE]));

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { 'x-user-id': '1' },
        payload: { username: 'testuser' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ userId: 1, username: 'testuser', avatar_url: null });
    });

    it('updates username when profile already exists', async () => {
      const updated = { ...MOCK_PROFILE, username: 'newname' };
      mockQuery.mockResolvedValueOnce(rows([updated]));

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { 'x-user-id': '1' },
        payload: { username: 'newname' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ userId: 1, username: 'newname' });
    });

    it('returns 409 when username is already taken (PG error 23505)', async () => {
      mockQuery.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }),
      );

      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { 'x-user-id': '1' },
        payload: { username: 'taken' },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'Username already taken' });
    });

    it('returns 400 for invalid input — empty username', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { 'x-user-id': '1' },
        payload: { username: '' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid input');
      expect(body.details).toHaveProperty('username');
    });

    it('returns 400 for invalid input — username with spaces', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        headers: { 'x-user-id': '1' },
        payload: { username: 'invalid name' },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe('Invalid input');
      expect(body.details).toHaveProperty('username');
    });

    it('returns 401 when x-user-id header is missing', async () => {
      const res = await app.inject({
        method: 'PATCH',
        url: '/me',
        payload: { username: 'testuser' },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });
  });
});
