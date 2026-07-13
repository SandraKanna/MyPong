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

  // ── GET /:id/stats ────────────────────────────────────────────────────────────

  describe('GET /:id/stats', () => {
    it('returns zeroed defaults and winRate 0 when no stats row exists', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));

      const res = await app.inject({
        method: 'GET',
        url: '/42/stats',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ userId: 42, gamesPlayed: 0, gamesWon: 0, highestScore: 0, winRate: 0 });
    });

    it('returns stats with correct winRate when row exists', async () => {
      mockQuery.mockResolvedValueOnce(rows([{ games_played: 3, games_won: 2, highest_score: 11 }]));

      const res = await app.inject({
        method: 'GET',
        url: '/42/stats',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ userId: 42, gamesPlayed: 3, gamesWon: 2, winRate: 0.6667 });
    });

    it('returns 400 for non-numeric id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/abc/stats',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid user id' });
    });

    it('returns 400 for id = 0', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/0/stats',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid user id' });
    });

    it('returns 401 when x-user-id is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/42/stats' });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });
  });

  // ── GET /:id/matches ──────────────────────────────────────────────────────────

  describe('GET /:id/matches', () => {
    const MOCK_MATCH = {
      match_id:    7,
      opponent_id: 17,
      result:      'win',
      my_score:    11,
      opp_score:   5,
      status:      'completed',
      played_at:   new Date('2024-01-01T00:05:00.000Z'),
    };

    it('returns match history with default pagination (limit 20, offset 0)', async () => {
      mockQuery.mockResolvedValueOnce(rows([MOCK_MATCH]));

      const res = await app.inject({
        method: 'GET',
        url: '/42/matches',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.userId).toBe(42);
      expect(body.limit).toBe(20);
      expect(body.offset).toBe(0);
      expect(body.matches).toHaveLength(1);
      expect(body.matches[0]).toMatchObject({
        matchId: 7, opponentId: 17, result: 'win', myScore: 11, oppScore: 5,
        status: 'completed', playedAt: '2024-01-01T00:05:00.000Z',
      });
      // Confirm the query was issued with correct defaults.
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT'), [42, 20, 0]);
    });

    it('returns match history with custom limit and offset', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));

      const res = await app.inject({
        method: 'GET',
        url: '/42/matches?limit=5&offset=10',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.limit).toBe(5);
      expect(body.offset).toBe(10);
      expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining('LIMIT'), [42, 5, 10]);
    });

    it('returns 400 when limit exceeds 50', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/42/matches?limit=51',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'limit must not exceed 50' });
    });

    it('returns 400 for non-numeric offset', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/42/matches?offset=abc',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'offset must be a non-negative integer' });
    });

    it('returns 400 for non-numeric id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/xyz/matches',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: 'Invalid user id' });
    });

    it('returns 401 when x-user-id is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/42/matches' });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });
  });

  // ── GET / (batch lookup) ─────────────────────────────────────────────────────

  describe('GET /', () => {
    it('returns 200 with users mapped from matching profile rows', async () => {
      mockQuery.mockResolvedValueOnce(rows([
        { user_id: 1, username: 'alice', avatar_url: null },
        { user_id: 2, username: 'bob', avatar_url: '/avatars/2.webp' },
      ]));

      const res = await app.inject({
        method: 'GET',
        url: '/?ids=1,2,3',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({
        users: [
          { userId: 1, username: 'alice', avatar_url: null },
          { userId: 2, username: 'bob', avatar_url: '/avatars/2.webp' },
        ],
      });
      // id 3 has no matching row and is silently omitted — not asserted as an
      // error, just absent from the response above.
      expect(mockQuery).toHaveBeenCalledWith(expect.any(String), [[1, 2, 3]]);
    });

    it('returns an empty users array when none of the ids match a profile', async () => {
      mockQuery.mockResolvedValueOnce(rows([]));

      const res = await app.inject({
        method: 'GET',
        url: '/?ids=99',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ users: [] });
    });

    it('returns 400 for a non-numeric id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/?ids=1,abc,2',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 400 for a negative id', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/?ids=1,-2',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 400 for id = 0', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/?ids=0',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 400 for an empty ids value', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/?ids=',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 400 when ids is missing entirely', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/',
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 400 when more than 50 ids are provided', async () => {
      const ids = Array.from({ length: 51 }, (_, i) => i + 1).join(',');

      const res = await app.inject({
        method: 'GET',
        url: `/?ids=${ids}`,
        headers: { 'x-user-id': '1' },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Invalid input');
    });

    it('returns 401 when x-user-id is missing', async () => {
      const res = await app.inject({ method: 'GET', url: '/?ids=1,2' });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
    });
  });
});
