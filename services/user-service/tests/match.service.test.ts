import { describe, it, expect, vi, beforeEach } from 'vitest';
import { db } from '../src/db';
import { recordMatchResult } from '../src/services/match.service';

vi.mock('../src/db', () => ({
  db: { connect: vi.fn() },
}));

const mockConnect = vi.mocked(db.connect);

const basePayload = {
  matchId:   7,
  players:   { '42': 'left', '17': 'right' } as Record<string, 'left' | 'right'>,
  winnerId:  42,
  score:     { left: 11, right: 5 },
  status:    'completed' as const,
  startedAt: '2024-01-01T00:00:00.000Z',
  endedAt:   '2024-01-01T00:05:00.000Z',
};

function makeMockClient(historyRowCount = 1) {
  return {
    query:   vi.fn().mockResolvedValue({ rows: [], rowCount: historyRowCount }),
    release: vi.fn(),
  };
}

describe('recordMatchResult', () => {
  let client: ReturnType<typeof makeMockClient>;

  beforeEach(() => {
    client = makeMockClient();
    mockConnect.mockResolvedValue(client as never);
  });

  // ─── happy path ──────────────────────────────────────────────────────────────

  it('issues BEGIN, one history+stats pair per player, then COMMIT', async () => {
    await recordMatchResult(basePayload);

    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toContain('BEGIN');
    expect(calls[1]).toContain('user_match_history');
    expect(calls[2]).toContain('user_stats');
    expect(calls[3]).toContain('user_match_history');
    expect(calls[4]).toContain('user_stats');
    expect(calls[5]).toContain('COMMIT');
    expect(client.query).toHaveBeenCalledTimes(6);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it('inserts correct data for the winning player (left side)', async () => {
    await recordMatchResult(basePayload);

    // find by userId in args — Object.entries sorts integer-like keys numerically
    const historyCalls = client.query.mock.calls.filter(
      (c) => String(c[0]).includes('user_match_history'),
    );
    const winnerCall = historyCalls.find((c) => (c[1] as unknown[])[0] === 42);
    expect(winnerCall![1]).toEqual([42, 7, 17, 'win', 11, 5, 'completed', basePayload.endedAt]);
  });

  it('inserts correct data for the losing player (right side)', async () => {
    await recordMatchResult(basePayload);

    const historyCalls = client.query.mock.calls.filter(
      (c) => String(c[0]).includes('user_match_history'),
    );
    const loserCall = historyCalls.find((c) => (c[1] as unknown[])[0] === 17);
    expect(loserCall![1]).toEqual([17, 7, 42, 'loss', 5, 11, 'completed', basePayload.endedAt]);
  });

  it('passes games_won=1 to stats for winner and games_won=0 for loser', async () => {
    await recordMatchResult(basePayload);

    const statsCalls = client.query.mock.calls.filter(
      (c) => String(c[0]).includes('user_stats'),
    );
    const statsWinner = statsCalls.find((c) => (c[1] as unknown[])[0] === 42);
    const statsLoser  = statsCalls.find((c) => (c[1] as unknown[])[0] === 17);
    expect(statsWinner![1][1]).toBe(1); // games_won increment for player 42
    expect(statsLoser![1][1]).toBe(0);  // games_won increment for player 17
  });

  it('passes status: forfeit through to user_match_history', async () => {
    await recordMatchResult({ ...basePayload, status: 'forfeit' });

    const historyArgs = client.query.mock.calls[1][1] as unknown[];
    expect(historyArgs[6]).toBe('forfeit');
  });

  // ─── idempotency ─────────────────────────────────────────────────────────────

  it('skips user_stats upsert when history row already exists (rowCount=0)', async () => {
    client = makeMockClient(0); // history INSERT returns DO NOTHING → rowCount=0
    mockConnect.mockResolvedValue(client as never);

    await recordMatchResult(basePayload);

    const calls = client.query.mock.calls.map((c) => String(c[0]));
    const statsQueries = calls.filter((q) => q.includes('user_stats'));
    expect(statsQueries).toHaveLength(0);
    // BEGIN + 2 history inserts + COMMIT only
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  // ─── error handling ───────────────────────────────────────────────────────────

  it('rolls back and rethrows when a mid-transaction query fails', async () => {
    const dbError = new Error('DB down');
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // BEGIN
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })  // history insert player 42
      .mockRejectedValueOnce(dbError)                    // stats upsert player 42
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await expect(recordMatchResult(basePayload)).rejects.toThrow('DB down');

    const calls = client.query.mock.calls.map((c) => String(c[0]));
    expect(calls.some((q) => q.includes('ROLLBACK'))).toBe(true);
    expect(calls.some((q) => q.includes('COMMIT'))).toBe(false);
  });

  it('always calls client.release() even when a query throws', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // BEGIN
      .mockRejectedValueOnce(new Error('timeout'))      // history insert player 42
      .mockResolvedValueOnce({ rows: [], rowCount: 0 }); // ROLLBACK

    await expect(recordMatchResult(basePayload)).rejects.toThrow();
    expect(client.release).toHaveBeenCalledOnce();
  });
});
