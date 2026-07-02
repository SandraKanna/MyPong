import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GameSessionManager } from '../src/session/GameSessionManager';
import { Game } from '../src/physics/game';
import type { WsEnvelope } from '@mypong/types';

// matchId=1, player 42 on the left, player 17 on the right.
function makeAssign(
  matchId: number,
  players: Record<string, 'left' | 'right'>,
): WsEnvelope {
  return { type: 'game:assign', payload: { matchId, players } };
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

  // Tests 8–10 use maxScore=1 so one point ends the game.
  // Ball at x=795, vx=10 → after one update x=805; 805+10=815 ≥ 800 (fieldWidth)
  // → right wall exit → score.left++ → winnerId = player on 'left' = 42.

  it('sends match:result with correct matchId, winnerId, and score — no `to` field', () => {
    manager = new GameSessionManager(
      (msg) => sent.push(msg),
      { gameFactory: () => new Game({ maxScore: 1 }) },
    );
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    manager.getSession(1)!.game.ball.reset(795, 50, 10, 0);

    vi.advanceTimersByTime(16);

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();

    const p = resultMsg!.payload as { matchId: number; winnerId: number; score: { left: number; right: number } };
    expect(p.matchId).toBe(1);
    expect(p.winnerId).toBe(42);
    expect(p.score).toEqual({ left: 1, right: 0 });
    // match:result routes to match-service by type prefix, not fanned out to players
    expect(resultMsg!.to).toBeUndefined();
  });

  it('sends game:end to both players with matchId, winnerId after game ends', () => {
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

    const p = endMsg!.payload as { matchId: number; winnerId: number };
    expect(p.matchId).toBe(1);
    expect(p.winnerId).toBe(42);
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

  // ─── forfeit by disconnect ───────────────────────────────────────────────────

  it('handlePlayerDisconnect pauses the game', () => {
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const spy = vi.spyOn(manager.getSession(1)!.game, 'pause');

    manager.handlePlayerDisconnect(42);

    expect(spy).toHaveBeenCalledOnce();
  });

  it('handlePlayerConnect within grace period resumes the game and cancels the forfeit', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));
    const resumeSpy = vi.spyOn(manager.getSession(1)!.game, 'resume');

    manager.handlePlayerDisconnect(42);
    vi.advanceTimersByTime(2_000); // inside grace period

    manager.handlePlayerConnect(42);

    expect(resumeSpy).toHaveBeenCalledOnce();

    // Advancing past the original deadline must NOT emit a forfeit.
    const countBefore = sent.length;
    vi.advanceTimersByTime(4_000);
    const newMsgs = sent.slice(countBefore);
    expect(newMsgs.some((m) => m.type === 'match:result' || m.type === 'game:end')).toBe(false);
  });

  it('timer expiry emits match:result and game:end with correct forfeit winner', () => {
    manager = new GameSessionManager((msg) => sent.push(msg), { gracePeriodMs: 5_000 });
    manager.handleAssign(makeAssign(1, { '42': 'left', '17': 'right' }));

    manager.handlePlayerDisconnect(42); // 42 disconnects → 17 should win
    vi.advanceTimersByTime(5_000);

    const resultMsg = sent.find((m) => m.type === 'match:result');
    expect(resultMsg).toBeDefined();
    expect(resultMsg!.to).toBeUndefined();
    const rp = resultMsg!.payload as { matchId: number; winnerId: number; score: unknown };
    expect(rp.matchId).toBe(1);
    expect(rp.winnerId).toBe(17);

    const endMsg = sent.find((m) => m.type === 'game:end');
    expect(endMsg).toBeDefined();
    expect(endMsg!.to).toEqual(expect.arrayContaining([42, 17]));
    const ep = endMsg!.payload as { matchId: number; winnerId: number };
    expect(ep.matchId).toBe(1);
    expect(ep.winnerId).toBe(17);
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
  });
});
