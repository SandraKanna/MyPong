import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MatchmakingQueue } from '../src/matchmaking/MatchmakingQueue';
import type { MatchRowTs } from '../src/services/match.service';

function makeMatch(id: number, p1: number, p2: number): MatchRowTs {
  return {
    id,
    player1Id:    p1,
    player2Id:    p2,
    player1Score: null,
    player2Score: null,
    winnerId:     null,
    status:       'active',
    createdAt:    new Date('2024-01-01T00:00:00Z'),
    closedAt:     null,
  };
}

describe('MatchmakingQueue', () => {
  let sent:            object[];
  let createMatchFn:   ReturnType<typeof vi.fn>;
  let findActiveMatch: ReturnType<typeof vi.fn>;
  let queue:           MatchmakingQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    sent            = [];
    createMatchFn   = vi.fn();
    findActiveMatch = vi.fn().mockResolvedValue(null); // default: no active match
    queue = new MatchmakingQueue(
      (msg) => sent.push(msg),
      createMatchFn,
      findActiveMatch,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── successful match ────────────────────────────────────────────────────────

  it('pairs two players and sends match:matched then game:assign with correct shape', async () => {
    createMatchFn.mockResolvedValueOnce(makeMatch(7, 42, 17));

    await queue.handleJoin(42);
    await queue.handleJoin(17);

    expect(sent).toHaveLength(2);

    const matched = sent[0] as {
      type:    string;
      to:      number[];
      payload: { matchId: number; players: Record<number, string>; startsAt: string };
    };
    expect(matched.type).toBe('match:matched');
    expect(matched.to).toEqual(expect.arrayContaining([42, 17]));
    expect(matched.payload.matchId).toBe(7);
    expect(matched.payload.players).toEqual({ 42: 'left', 17: 'right' });
    expect(typeof matched.payload.startsAt).toBe('string');

    const assign = sent[1] as {
      type:    string;
      to?:     unknown;
      payload: { matchId: number; players: Record<number, string>; startsAt: string };
    };
    expect(assign.type).toBe('game:assign');
    expect(assign.to).toBeUndefined();
    expect(assign.payload.matchId).toBe(7);
    expect(assign.payload.players).toEqual({ 42: 'left', 17: 'right' });
    expect(typeof assign.payload.startsAt).toBe('string');
  });

  it('startsAt is the same value in both messages and is exactly 3 seconds ahead', async () => {
    createMatchFn.mockResolvedValueOnce(makeMatch(7, 42, 17));

    await queue.handleJoin(42);
    await queue.handleJoin(17);

    const matched = sent[0] as { payload: { startsAt: string } };
    const assign  = sent[1] as { payload: { startsAt: string } };

    // Same reference value — computed once, not independently.
    expect(matched.payload.startsAt).toBe(assign.payload.startsAt);

    // Exactly 3000ms after the pinned system time.
    const expectedStartsAt = new Date(Date.now() + 3_000).toISOString();
    expect(matched.payload.startsAt).toBe(expectedStartsAt);
  });

  it('assigns left to first-queued, right to second-queued', async () => {
    createMatchFn.mockResolvedValueOnce(makeMatch(1, 99, 55));

    await queue.handleJoin(99);
    await queue.handleJoin(55);

    expect(createMatchFn).toHaveBeenCalledWith(99, 55);
    const matched = sent[0] as { payload: { players: Record<number, string> } };
    expect(matched.payload.players[99]).toBe('left');
    expect(matched.payload.players[55]).toBe('right');
  });

  it('removes both players from the queue after matching', async () => {
    createMatchFn.mockResolvedValueOnce(makeMatch(1, 42, 17));
    await queue.handleJoin(42);
    await queue.handleJoin(17);
    expect(queue.queueLength()).toBe(0);
  });

  // ─── match:rejected ──────────────────────────────────────────────────────────

  it('rejects a guest (negative userId) with guest_not_allowed before any DB lookup', async () => {
    await queue.handleJoin(-42);

    expect(sent).toHaveLength(1);
    const rejected = sent[0] as { type: string; to: number[]; payload: { reason: string } };
    expect(rejected.type).toBe('match:rejected');
    expect(rejected.to).toEqual([-42]);
    expect(rejected.payload.reason).toBe('guest_not_allowed');
    expect(queue.queueLength()).toBe(0);
    expect(findActiveMatch).not.toHaveBeenCalled();
  });

  it('sends match:rejected and does not enqueue when an active match exists for the userId', async () => {
    findActiveMatch.mockResolvedValueOnce(makeMatch(5, 42, 99));

    await queue.handleJoin(42);

    expect(sent).toHaveLength(1);
    const rejected = sent[0] as { type: string; to: number[]; payload: { reason: string; message: string } };
    expect(rejected.type).toBe('match:rejected');
    expect(rejected.to).toEqual([42]);
    expect(rejected.payload.reason).toBe('already_in_match');
    expect(rejected.payload.message).toBe('You are already in a match.');
    expect(queue.queueLength()).toBe(0);
  });

  // ─── duplicate join ──────────────────────────────────────────────────────────

  it('silently ignores a duplicate match:join from a userId already queued', async () => {
    await queue.handleJoin(42);
    await queue.handleJoin(42);

    expect(queue.queueLength()).toBe(1);
    expect(sent).toHaveLength(0);
    expect(createMatchFn).not.toHaveBeenCalled();
  });

  // ─── cancel / disconnect ─────────────────────────────────────────────────────

  it('handleCancel removes the userId from the queue', async () => {
    await queue.handleJoin(42);
    queue.handleCancel(42);
    expect(queue.queueLength()).toBe(0);
  });

  it('handleCancel is a no-op when the userId is not queued', () => {
    expect(() => queue.handleCancel(99)).not.toThrow();
    expect(queue.queueLength()).toBe(0);
  });

  it('handleDisconnect removes the userId from the queue', async () => {
    await queue.handleJoin(42);
    queue.handleDisconnect(42);
    expect(queue.queueLength()).toBe(0);
  });

  it('handleDisconnect is a no-op when the userId is not queued', () => {
    expect(() => queue.handleDisconnect(99)).not.toThrow();
    expect(queue.queueLength()).toBe(0);
  });

  // ─── createMatch failure ─────────────────────────────────────────────────────

  it('catches createMatch failure, logs it, and sends neither match:matched nor game:assign', async () => {
    createMatchFn.mockRejectedValueOnce(new Error('DB connection lost'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await queue.handleJoin(42);
    await queue.handleJoin(17);

    expect(sent).toHaveLength(0);
    expect(errorSpy).toHaveBeenCalledOnce();
    errorSpy.mockRestore();
  });

  it('does not crash the process on createMatch failure', async () => {
    createMatchFn.mockRejectedValueOnce(new Error('timeout'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      Promise.all([queue.handleJoin(42), queue.handleJoin(17)]),
    ).resolves.not.toThrow();

    errorSpy.mockRestore();
  });
});
