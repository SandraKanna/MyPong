import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSessionManager } from '../src/session/GameSessionManager';
import { Game } from '../src/physics/game';
import { AI_BOT_USER_ID } from '../src/session/constants';
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

  it('game:resumed payload includes the players map as a plain string-keyed object', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerDisconnect(42);
    manager.handlePlayerConnect(42);

    const resumedMsg = sent.find((m) => m.type === 'game:resumed');
    expect(resumedMsg).toBeDefined();
    const p = resumedMsg!.payload as { players: Record<string, string> };
    expect(p.players).toEqual({ '42': 'left', '17': 'right' });
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

  it('pending-session reconnect re-sends match:matched to the reconnecting player only with correct payload', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString(); // '2025-01-01T00:00:03.000Z'

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerDisconnect(42);
    sent.length = 0; // clear game:paused so the assertion below is unambiguous

    manager.handlePlayerConnect(42);

    const redelivered = sent.find((m) => m.type === 'match:matched');
    expect(redelivered).toBeDefined();
    expect(redelivered!.to).toEqual([42]); // only to the reconnecting player, not both
    const p = redelivered!.payload as { matchId: number; players: Record<string, string>; startsAt: string };
    expect(p.matchId).toBe(1);
    expect(p.players).toEqual({ '42': 'left', '17': 'right' });
    expect(p.startsAt).toBe(startsAt); // real remaining deadline, not a dummy value
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

  // ─── handlePlayerLeave ───────────────────────────────────────────────────────

  it('handlePlayerLeave on an active session forfeits immediately with no grace window', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerLeave(42); // 42 leaves — 17 should win

    expect(manager.sessionCount()).toBe(0);
    expect(manager.getSession(1)).toBeUndefined();
    expect(sent.find((m) => m.type === 'game:paused')).toBeUndefined();

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.to).toBeUndefined();
    const rp = resultMsg!.payload as { winnerId: number; status: string };
    expect(rp.winnerId).toBe(17);
    expect(rp.status).toBe('forfeit');

    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    const ep = endMsg!.payload as { winnerId: number; reason: string };
    expect(ep.winnerId).toBe(17);
    expect(ep.reason).toBe('forfeit');
  });

  it('handlePlayerLeave emits forfeit with the real score at the time of leave, not 0-0', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 10 }) },
    );
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    // Ball positioned to score on the next tick (right wall exit → left scores).
    manager.getSession(1)!.game.ball.reset(795, 50, 10, 0);
    vi.advanceTimersByTime(16); // score is now { left: 1, right: 0 }
    sent.length = 0; // clear game:state messages

    manager.handlePlayerLeave(42);

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    const rp = resultMsg!.payload as { score: { left: number; right: number } };
    expect(rp.score).toEqual({ left: 1, right: 0 }); // real score, not 0-0
  });

  it('handlePlayerLeave during countdown delegates to handlePlayerDisconnect — fires forfeit at startsAt', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();

    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    manager.handlePlayerLeave(42);

    // Same as a passive disconnect: game:paused sent to opponent immediately.
    const pausedMsg = sent.find((m) => m.type === 'game:paused');
    expect(pausedMsg).toBeDefined();
    expect(pausedMsg!.to).toEqual([17]);

    // Forfeit does not fire immediately — it fires when the countdown completes.
    expect(sent.find((m) => m.type === 'match:result')).toBeUndefined();

    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(0);
    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    const rp = resultMsg!.payload as { winnerId: number; status: string; score: { left: number; right: number } };
    expect(rp.winnerId).toBe(17);
    expect(rp.status).toBe('forfeit');
    expect(rp.score).toEqual({ left: 0, right: 0 }); // nothing was played
  });

  it('handlePlayerLeave with userId not in any session or pending match is a no-op', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    expect(() => manager.handlePlayerLeave(99)).not.toThrow();
    expect(sent.filter((m) => m.type === 'match:result' || m.type === 'game:paused')).toHaveLength(0);
    expect(manager.sessionCount()).toBe(1);
  });

  it('player:disconnect after handlePlayerLeave for the same active session is a no-op', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerLeave(42);
    const countAfterLeave = sent.length;

    // Socket closes right after — gateway-ws fires player:disconnect for the same user.
    manager.handlePlayerDisconnect(42);

    expect(sent.length).toBe(countAfterLeave); // no additional messages
    expect(manager.sessionCount()).toBe(0);
  });

  it('handlePlayerLeave cancels the opponent grace timer and emits a single forfeit', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    // Opponent disconnects — grace timer is now armed.
    manager.handlePlayerDisconnect(42);
    sent.length = 0;

    // Remaining player explicitly leaves.
    manager.handlePlayerLeave(17);

    // Forfeit sent immediately; remaining player (17) is the loser.
    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    const rp = resultMsg!.payload as { winnerId: number };
    expect(rp.winnerId).toBe(42); // disconnected opponent wins because the remaining player left

    // Grace timer must have been cancelled — no second forfeit after the deadline.
    const countNow = sent.length;
    vi.advanceTimersByTime(6_000);
    expect(sent.length).toBe(countNow);
  });

  // ─── PvE mode (handleStartAI) ────────────────────────────────────────────────

  function makeStartAI(userId: number, difficulty: string): WsEnvelope {
    return { type: 'game:startAI', userId, payload: { difficulty } };
  }

  it('handleStartAI creates a pending PvE session with human on left and bot on right', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    manager.handleStartAI(makeStartAI(42, 'medium'));

    // Session is pending (3s countdown) — not active yet.
    expect(manager.sessionCount()).toBe(0);

    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(1);
    const session = [...(manager as unknown as { sessions: Map<number, { players: Map<number, string>; mode: string }> }).sessions.values()][0];
    expect(session).toBeDefined();
    expect(session.players.get(42)).toBe('left');
    expect(session.players.get(AI_BOT_USER_ID)).toBe('right');
    expect(session.mode).toBe('pve');
  });

  it('handleStartAI ignores unknown difficulty values', () => {
    manager.handleStartAI(makeStartAI(42, 'nightmare'));
    expect(manager.sessionCount()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('handleStartAI ignores envelope with missing userId', () => {
    manager.handleStartAI({ type: 'game:startAI', payload: { difficulty: 'easy' } });
    expect(manager.sessionCount()).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('handleStartAI sends match:matched to the human (not the bot) and ai-bot:sessionStart', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    manager.handleStartAI(makeStartAI(42, 'hard'));

    const matched = sent.find((m) => m.type === 'match:matched');
    expect(matched).toBeDefined();
    expect(matched!.to).toEqual([42]); // human only — bot has no socket
    const mp = matched!.payload as { players: Record<string, string>; startsAt: string };
    expect(mp.players[String(42)]).toBe('left');
    expect(mp.players[String(AI_BOT_USER_ID)]).toBe('right');

    const botStart = sent.find((m) => m.type === 'ai-bot:sessionStart');
    expect(botStart).toBeDefined();
    const bp = botStart!.payload as { difficulty: string; botSide: string };
    expect(bp.difficulty).toBe('hard');
    expect(bp.botSide).toBe('right');
  });

  it('handleStartAI rejects if user already has an active PvP session', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    sent.length = 0;

    manager.handleStartAI(makeStartAI(42, 'easy'));

    const rejection = sent.find((m) => m.type === 'match:rejected');
    expect(rejection).toBeDefined();
    expect(rejection!.to).toEqual([42]);
    expect(manager.sessionCount()).toBe(1); // original PvP session unchanged
  });

  it('handleStartAI rejects if user already has a pending PvP session', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    const startsAt = new Date(Date.now() + 3_000).toISOString();
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }, startsAt));
    sent.length = 0;

    manager.handleStartAI(makeStartAI(42, 'easy'));

    const rejection = sent.find((m) => m.type === 'match:rejected');
    expect(rejection).toBeDefined();
    expect(rejection!.to).toEqual([42]);
  });

  it('handleStartAI rejects if user already has an active PvE session', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    vi.advanceTimersByTime(3_000); // session becomes active
    sent.length = 0;

    manager.handleStartAI(makeStartAI(42, 'hard'));

    const rejection = sent.find((m) => m.type === 'match:rejected');
    expect(rejection).toBeDefined();
    expect(rejection!.to).toEqual([42]);
    expect(manager.sessionCount()).toBe(1); // original PvE session unchanged
  });

  it('PvE tick sends game:state to human only and ai-bot:state (no `to`) per tick', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'medium'));
    vi.advanceTimersByTime(3_000); // session starts
    sent.length = 0;

    vi.advanceTimersByTime(16); // one tick

    const gameState = sent.find((m) => m.type === 'game:state');
    expect(gameState).toBeDefined();
    expect(gameState!.to).toEqual([42]); // human only, not AI_BOT_USER_ID

    const botState = sent.find((m) => m.type === 'ai-bot:state');
    expect(botState).toBeDefined();
    expect(botState!.to).toBeUndefined(); // routed to ai-bot-service by type prefix
    const bs = botState!.payload as { ball: { x: number; y: number; vx: number; vy: number } };
    expect(typeof bs.ball.vx).toBe('number'); // velocity exposed for prediction
    expect(typeof bs.ball.vy).toBe('number');
  });

  it('PvE game over sends ai-bot:sessionEnd and game:end to human; never sends match:result', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    vi.advanceTimersByTime(3_000);

    // Position ball to score on next tick (right wall exit → left scores → human wins).
    const session = [...(manager as unknown as { sessions: Map<number, { game: Game }> }).sessions.values()][0]!;
    session.game.ball.reset(795, 50, 10, 0);

    vi.advanceTimersByTime(16);

    expect(sent.find((m) => m.type === 'match:result')).toBeUndefined();

    const botEnd = sent.find((m) => m.type === 'ai-bot:sessionEnd');
    expect(botEnd).toBeDefined();

    const gameEnd = sent.find((m) => m.type === 'game:end');
    expect(gameEnd).toBeDefined();
    expect(gameEnd!.to).toEqual([42]); // human only
    const ep = gameEnd!.payload as { winnerId: number; reason: string };
    expect(ep.winnerId).toBe(42); // human won
    expect(ep.reason).toBe('completed');

    expect(manager.sessionCount()).toBe(0);
  });

  it('PvE game over assigns winnerId=AI_BOT_USER_ID when bot side scores enough', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    vi.advanceTimersByTime(3_000);

    // Ball moves left → exits left wall → right (bot) scores.
    // y=50 is above the left paddle (which sits at y=260–340) so no bounce occurs.
    const session = [...(manager as unknown as { sessions: Map<number, { game: Game }> }).sessions.values()][0]!;
    session.game.ball.reset(5, 50, -10, 0);

    vi.advanceTimersByTime(16);

    const gameEnd = sent.find((m) => m.type === 'game:end');
    expect(gameEnd).toBeDefined();
    const ep = gameEnd!.payload as { winnerId: number };
    expect(ep.winnerId).toBe(AI_BOT_USER_ID);
  });

  it('PvE involuntary disconnect: immediate teardown, ai-bot:sessionEnd, no game:end, no match:result', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    vi.advanceTimersByTime(3_000); // session active
    sent.length = 0;

    manager.handlePlayerDisconnect(42);

    expect(manager.sessionCount()).toBe(0);
    expect(sent.find((m) => m.type === 'ai-bot:sessionEnd')).toBeDefined();
    expect(sent.find((m) => m.type === 'game:end')).toBeUndefined(); // browser gone
    expect(sent.find((m) => m.type === 'match:result')).toBeUndefined();
    expect(sent.find((m) => m.type === 'game:paused')).toBeUndefined();
  });

  it('PvE voluntary leave: game:end to human with AI winnerId, ai-bot:sessionEnd, no match:result', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    vi.advanceTimersByTime(3_000);
    sent.length = 0;

    manager.handlePlayerLeave(42);

    expect(manager.sessionCount()).toBe(0);
    expect(sent.find((m) => m.type === 'match:result')).toBeUndefined();

    const gameEnd = sent.find((m) => m.type === 'game:end');
    expect(gameEnd).toBeDefined();
    expect(gameEnd!.to).toEqual([42]);
    const ep = gameEnd!.payload as { winnerId: number; reason: string };
    expect(ep.winnerId).toBe(AI_BOT_USER_ID);
    expect(ep.reason).toBe('forfeit');

    expect(sent.find((m) => m.type === 'ai-bot:sessionEnd')).toBeDefined();
  });

  it('PvE disconnect during countdown: no game:paused; ai-bot:sessionEnd at startsAt, no forfeit', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    sent.length = 0;

    manager.handlePlayerDisconnect(42);

    expect(sent.find((m) => m.type === 'game:paused')).toBeUndefined(); // no human opponent

    vi.advanceTimersByTime(3_000);

    expect(manager.sessionCount()).toBe(0);
    expect(sent.find((m) => m.type === 'ai-bot:sessionEnd')).toBeDefined();
    expect(sent.find((m) => m.type === 'match:result')).toBeUndefined();
    expect(sent.find((m) => m.type === 'game:end')).toBeUndefined();
  });

  it('PvE pending reconnect re-sends match:matched to human', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'easy'));
    manager.handlePlayerDisconnect(42);
    sent.length = 0;

    manager.handlePlayerConnect(42);

    const redelivered = sent.find((m) => m.type === 'match:matched');
    expect(redelivered).toBeDefined();
    expect(redelivered!.to).toEqual([42]);
  });

  it('handleBotInput routes direction to the right paddle of a PvE session', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));
    manager.handleStartAI(makeStartAI(42, 'hard'));
    vi.advanceTimersByTime(3_000);

    const session = [...(manager as unknown as { sessions: Map<number, { game: Game; matchId?: number }> }).sessions.entries()][0]!;
    const [matchId, sess] = session;
    const spy = vi.spyOn(sess.game, 'setPaddleDirection');

    manager.handleBotInput({ type: 'game:botInput', payload: { matchId, direction: 'up' } });

    expect(spy).toHaveBeenCalledWith('right', 'up');
  });

  it('handleBotInput is a no-op on a PvP session', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const spy = vi.spyOn(manager.getSession(1)!.game, 'setPaddleDirection');

    manager.handleBotInput({ type: 'game:botInput', payload: { matchId: 1, direction: 'up' } });

    expect(spy).not.toHaveBeenCalled();
  });
});
