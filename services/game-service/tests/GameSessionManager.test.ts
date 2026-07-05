import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSessionManager } from '../src/session/GameSessionManager';
import { Game } from '../src/physics/game';
import type { WsEnvelope } from '@mypong/types';

function makeAssign(
  matchId:  number,
  players:  Record<string, 'left' | 'right'>,
  startsAt?: string,
): WsEnvelope {
  return { type: 'game:assign', payload: { matchId, players, ...(startsAt !== undefined ? { startsAt } : {}) } };
}

function makeInput(
  matchId:   number,
  userId:    number,
  direction: 'up' | 'down' | 'stop',
): WsEnvelope {
  return { type: 'game:input', userId, payload: { matchId, direction } };
}

describe('GameSessionManager', () => {
  let sent:    WsEnvelope[];
  let manager: GameSessionManager;

  beforeEach(() => {
    vi.useFakeTimers();
    sent    = [];
    manager = new GameSessionManager((msg) => sent.push(msg));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ─── session creation ────────────────────────────────────────────────────────

  it('handleAssign creates a session with the correct players map', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const session = manager.getSession(1);
    expect(session).toBeDefined();
    expect(session!.players.get(42)).toBe('left');
    expect(session!.players.get(17)).toBe('right');
  });

  it('handleAssign ignores a duplicate game:assign for an active matchId', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const originalGame = manager.getSession(1)!.game;

    // Second assign for the same matchId with different players must be ignored.
    manager.handleAssign(makeAssign(1, { '99': 'left', '88': 'right' }));

    // Same Game instance proves the second call was a no-op (no overwrite, no new interval).
    expect(manager.getSession(1)!.game).toBe(originalGame);
  });

  it('handleAssign ignores malformed payload (missing matchId)', () => {
    manager.handleAssign({
      type:    'game:assign',
      payload: { players: { '1': 'left', '2': 'right' } },
    });
    expect(manager.sessionCount()).toBe(0);
  });

  it('handleAssign ignores a payload where both players share the same side', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'left' }));
    expect(manager.sessionCount()).toBe(0);
  });

  // ─── input routing ───────────────────────────────────────────────────────────

  it('handleInput routes direction to the correct side for each player', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const spy = vi.spyOn(manager.getSession(1)!.game, 'setPaddleDirection');

    manager.handleInput(makeInput(1, 42, 'up'));
    expect(spy).toHaveBeenCalledWith('left', 'up');

    manager.handleInput(makeInput(1, 17, 'down'));
    expect(spy).toHaveBeenCalledWith('right', 'down');
  });

  it('handleInput ignores a userId not in the session', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const spy = vi.spyOn(manager.getSession(1)!.game, 'setPaddleDirection');

    manager.handleInput(makeInput(1, 99, 'up'));
    expect(spy).not.toHaveBeenCalled();
  });

  it('handleInput ignores a matchId not in sessions', () => {
    expect(() => manager.handleInput(makeInput(999, 42, 'up'))).not.toThrow();
  });

  // ─── game:state broadcast ────────────────────────────────────────────────────

  it('broadcasts game:state to both players with the correct matchId on each tick', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    vi.advanceTimersByTime(16);

    const stateMsg = sent.find((m) => m.type === 'game:state');
    expect(stateMsg).toBeDefined();
    expect(stateMsg!.to).toEqual(expect.arrayContaining([42, 17]));
    expect((stateMsg!.payload as { matchId: number }).matchId).toBe(1);
  });

  // ─── game-over flow ──────────────────────────────────────────────────────────

  // Tests use maxScore=1 so one point ends the game.
  // Ball at x=795, vx=10 → after one update x=805; 805+10=815 ≥ 800 (fieldWidth)
  // → right wall exit → score.left++ → winnerId = player on 'left' = 42.

  it('sends match:result with correct matchId, winnerId, score, players, status, timestamps — no `to` field', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    manager.getSession(1)!.game.ball.reset(795, 50, 10, 0);

    vi.advanceTimersByTime(16);

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();

    const p = resultMsg!.payload as {
      matchId:   number;
      players:   Record<string, string>;
      winnerId:  number;
      score:     { left: number; right: number };
      status:    string;
      startedAt: string;
      endedAt:   string;
    };
    expect(p.matchId).toBe(1);
    expect(p.winnerId).toBe(42);
    expect(p.score).toEqual({ left: 1, right: 0 });
    expect(p.players).toEqual({ 42: 'left', 17: 'right' });
    expect(p.status).toBe('completed');
    expect(typeof p.startedAt).toBe('string');
    expect(typeof p.endedAt).toBe('string');
    // match:result routes to match-service by type prefix, not fanned out to players
    expect(resultMsg!.to).toBeUndefined();
  });

  it('sends game:end to both players with matchId, winnerId, reason:completed after game ends', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    manager.getSession(1)!.game.ball.reset(795, 50, 10, 0);

    vi.advanceTimersByTime(16);

    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    expect(endMsg!.to).toEqual(expect.arrayContaining([42, 17]));

    const p = endMsg!.payload as { matchId: number; winnerId: number; reason: string };
    expect(p.matchId).toBe(1);
    expect(p.winnerId).toBe(42);
    expect(p.reason).toBe('completed');
  });

  it('removes the session after game ends', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    manager.getSession(1)!.game.ball.reset(795, 50, 10, 0);

    vi.advanceTimersByTime(16);

    expect(manager.sessionCount()).toBe(0);
    expect(manager.getSession(1)).toBeUndefined();
  });

  // ─── forfeit by disconnect (active session) ──────────────────────────────────

  it('handlePlayerDisconnect pauses the game', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const spy = vi.spyOn(manager.getSession(1)!.game, 'pause');

    manager.handlePlayerDisconnect(42);

    expect(spy).toHaveBeenCalledOnce();
  });

  it('handlePlayerDisconnect sends game:paused to the opponent only', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerDisconnect(42);

    const pausedMsg = sent.find((m) => m.type === 'game:paused');
    expect(pausedMsg).toBeDefined();
    expect(pausedMsg!.to).toEqual([17]); // opponent only, not the disconnected player
    const p = pausedMsg!.payload as { matchId: number; disconnectedUserId: number; graceEndsAt: string };
    expect(p.matchId).toBe(1);
    expect(p.disconnectedUserId).toBe(42);
    expect(p.graceEndsAt).toBe('2025-01-01T00:00:05.000Z');
  });

  it('handlePlayerConnect within grace period resumes the game, sends game:resumed, and cancels the forfeit', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const resumeSpy = vi.spyOn(manager.getSession(1)!.game, 'resume');

    manager.handlePlayerDisconnect(42);
    vi.advanceTimersByTime(2_000); // inside grace period

    manager.handlePlayerConnect(42);

    expect(resumeSpy).toHaveBeenCalledOnce();

    const resumedMsg = sent.find((m) => m.type === 'game:resumed');
    expect(resumedMsg).toBeDefined();
    expect(resumedMsg!.to).toEqual(expect.arrayContaining([42, 17]));
    const p = resumedMsg!.payload as { matchId: number; ball: unknown; paddles: unknown; score: unknown };
    expect(p.matchId).toBe(1);
    expect(p.ball).toBeDefined();
    expect(p.paddles).toBeDefined();
    expect(p.score).toBeDefined();

    // Advancing past the original deadline must NOT emit a forfeit.
    const countBefore = sent.length;
    vi.advanceTimersByTime(4_000);
    const newMsgs = sent.slice(countBefore);
    expect(newMsgs.some((m) => m.type === 'match:result' || m.type === 'game:end')).toBe(false);
  });

  it('timer expiry emits match:result and game:end with correct forfeit winner and reason', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerDisconnect(42); // 42 disconnects → 17 should win
    vi.advanceTimersByTime(5_000);

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.to).toBeUndefined();
    const rp = resultMsg!.payload as {
      matchId:   number;
      players:   Record<string, string>;
      winnerId:  number;
      score:     unknown;
      status:    string;
      startedAt: string;
      endedAt:   string;
    };
    expect(rp.matchId).toBe(1);
    expect(rp.winnerId).toBe(17);
    expect(rp.players).toEqual({ 42: 'left', 17: 'right' });
    expect(rp.status).toBe('forfeit');
    expect(typeof rp.startedAt).toBe('string');
    expect(typeof rp.endedAt).toBe('string');

    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    expect(endMsg!.to).toEqual(expect.arrayContaining([42, 17]));
    const ep = endMsg!.payload as { matchId: number; winnerId: number; reason: string };
    expect(ep.matchId).toBe(1);
    expect(ep.winnerId).toBe(17);
    expect(ep.reason).toBe('forfeit');
  });

  it('timer expiry removes the session', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerDisconnect(42);
    vi.advanceTimersByTime(5_000);

    expect(manager.sessionCount()).toBe(0);
    expect(manager.getSession(1)).toBeUndefined();
  });

  it('handlePlayerDisconnect is a no-op when the userId is not in any session', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    expect(() => manager.handlePlayerDisconnect(99)).not.toThrow();
    expect(manager.getSession(1)!.disconnectedUserId).toBeUndefined();
  });

  it('second disconnect while grace timer is running is a no-op', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const pauseSpy = vi.spyOn(manager.getSession(1)!.game, 'pause');

    manager.handlePlayerDisconnect(42);
    manager.handlePlayerDisconnect(17); // second disconnect while timer is running

    expect(pauseSpy).toHaveBeenCalledOnce(); // only the first disconnect paused
    expect(manager.getSession(1)!.disconnectedUserId).toBe(42); // timer is still for 42
    // Only one game:paused emitted (for the first disconnect)
    expect(sent.filter((m) => m.type === 'game:paused')).toHaveLength(1);
  });

  // ─── startsAt gating ─────────────────────────────────────────────────────────

  it('session is not created before startsAt fires', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));

    expect(manager.sessionCount()).toBe(0);
    expect(manager.getSession(1)).toBeUndefined();
  });

  it('game:input before startsAt is a safe no-op (session not in Map yet)', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    expect(() => manager.handleInput(makeInput(1, 42, 'up'))).not.toThrow();
    expect(manager.sessionCount()).toBe(0);
  });

  it('session is created after startsAt fires', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(1);
    expect(manager.getSession(1)).toBeDefined();
  });

  it('duplicate game:assign while session is pending is ignored', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handleAssign(makeAssign(1, { '99': 'left', '88': 'right' }, startsAt)); // duplicate

    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(1);
    // Original players, not the duplicate's players
    expect(manager.getSession(1)!.players.get(42)).toBe('left');
    expect(manager.getSession(1)!.players.get(99)).toBeUndefined();
  });

  it('no startsAt (backward compat) creates the session synchronously', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    // No vi.advanceTimersByTime needed — session must exist immediately.
    expect(manager.sessionCount()).toBe(1);
    expect(manager.getSession(1)).toBeDefined();
  });

  // ─── countdown-window disconnect ─────────────────────────────────────────────

  it('disconnect during countdown sends game:paused to opponent with graceEndsAt === startsAt', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString(); // '2025-01-01T00:00:03.000Z'

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerDisconnect(42);

    const pausedMsg = sent.find((m) => m.type === 'game:paused');
    expect(pausedMsg).toBeDefined();
    expect(pausedMsg!.to).toEqual([17]); // opponent only
    const p = pausedMsg!.payload as { matchId: number; disconnectedUserId: number; graceEndsAt: string };
    expect(p.matchId).toBe(1);
    expect(p.disconnectedUserId).toBe(42);
    expect(p.graceEndsAt).toBe(startsAt); // startsAt is the grace deadline
  });

  it('disconnect during countdown, no reconnect → forfeit at startsAt with score 0-0, no session created', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerDisconnect(42);
    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(0); // no session was ever created

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.to).toBeUndefined();
    const rp = resultMsg!.payload as {
      matchId:  number;
      winnerId: number;
      score:    { left: number; right: number };
      status:   string;
    };
    expect(rp.matchId).toBe(1);
    expect(rp.winnerId).toBe(17); // opponent wins
    expect(rp.score).toEqual({ left: 0, right: 0 }); // nothing was played
    expect(rp.status).toBe('forfeit');

    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    expect(endMsg!.to).toEqual(expect.arrayContaining([42, 17]));
    const ep = endMsg!.payload as { matchId: number; winnerId: number; reason: string };
    expect(ep.matchId).toBe(1);
    expect(ep.winnerId).toBe(17);
    expect(ep.reason).toBe('forfeit');
  });

  it('disconnect during countdown + reconnect before startsAt → session created normally, no forfeit', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerDisconnect(42);
    manager.handlePlayerConnect(42); // reconnects before startsAt

    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(1); // session was created normally
    const forfeitMsgs = sent.filter((m) => m.type === 'match:result' || m.type === 'game:end');
    expect(forfeitMsgs).toHaveLength(0);
  });

  it('double-disconnect during countdown: second is a no-op, first disconnector stays recorded', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerDisconnect(42);
    manager.handlePlayerDisconnect(17); // second disconnect — must be ignored

    expect(sent.filter((m) => m.type === 'game:paused')).toHaveLength(1);

    // First disconnector still recorded; timer fires and 42 loses.
    vi.advanceTimersByTime(3_000);
    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    const ep = endMsg!.payload as { winnerId: number };
    expect(ep.winnerId).toBe(17); // opponent of first disconnector wins
  });
});
