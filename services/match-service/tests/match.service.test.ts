import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMatch, closeMatch } from '../src/services/match.service';

vi.mock('../src/db', () => ({
  db: { query: vi.fn() },
}));

import { db } from '../src/db';

const mockQuery = vi.mocked(db.query);

const baseRawRow = {
  id: 1,
  player1_id: 10,
  player2_id: 20,
  player1_score: null,
  player2_score: null,
  winner_id: null,
  status: 'active',
  created_at: new Date('2024-01-01T00:00:00Z'),
  closed_at: null,
};

beforeEach(() => {
  mockQuery.mockReset();
});

describe('createMatch', () => {
  it('inserts a new match and returns the mapped row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [baseRawRow], rowCount: 1 } as never);

    const result = await createMatch(10, 20);

    expect(mockQuery).toHaveBeenCalledWith(
      'INSERT INTO match (player1_id, player2_id) VALUES ($1, $2) RETURNING *',
      [10, 20],
    );
    expect(result).toEqual({
      id: 1,
      player1Id: 10,
      player2Id: 20,
      player1Score: null,
      player2Score: null,
      winnerId: null,
      status: 'active',
      createdAt: baseRawRow.created_at,
      closedAt: null,
    });
  });
});

describe('closeMatch', () => {
  it('updates the match and returns the mapped row when found', async () => {
    const closedAt = new Date('2024-01-01T00:05:00Z');
    const rawClosed = {
      ...baseRawRow,
      player1_score: 11,
      player2_score: 7,
      winner_id: 10,
      status: 'completed',
      closed_at: closedAt,
    };
    mockQuery.mockResolvedValueOnce({ rows: [rawClosed], rowCount: 1 } as never);

    const result = await closeMatch(1, {
      player1Score: 11,
      player2Score: 7,
      winnerId: 10,
      status: 'completed',
    });

    expect(result).toEqual({
      id: 1,
      player1Id: 10,
      player2Id: 20,
      player1Score: 11,
      player2Score: 7,
      winnerId: 10,
      status: 'completed',
      createdAt: baseRawRow.created_at,
      closedAt: closedAt,
    });
  });

  it('returns null when no match row is found for the given id', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 } as never);

    const result = await closeMatch(999, {
      player1Score: 11,
      player2Score: 7,
      winnerId: 10,
      status: 'forfeit',
    });

    expect(result).toBeNull();
  });
});
