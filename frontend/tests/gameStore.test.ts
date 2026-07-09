import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameStore } from '../src/features/game/state/gameStore';
import type { GameStatePayload, GameResumedPayload } from '../src/shared/ws/wsMessages';

// gameStore imports disconnectWs — mock it so auth-subscription tests can
// verify it was called without opening a real WebSocket.
vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  onWsMessage:  vi.fn(() => vi.fn()),
}));

import { disconnectWs, sendWs } from '../src/shared/ws/wsClient';
import { useAuthStore } from '../src/features/auth/state/authState';

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLAYERS: Record<string, 'left' | 'right'> = { '42': 'left', '17': 'right' };

function snapshot(matchId = 1): GameStatePayload {
  return {
    matchId,
    ball:    { x: 50, y: 50 },
    paddles: { leftY: 50, rightY: 50 },
    score:   { left: 0, right: 0 },
  };
}

function resumedPayload(matchId = 1, players = PLAYERS): GameResumedPayload {
  return {
    matchId,
    ball:    { x: 50, y: 50 },
    paddles: { leftY: 50, rightY: 50 },
    score:   { left: 0, right: 0 },
    players,
  };
}

// Each test gets a clean store — Zustand stores are module-level singletons,
// so reset() before every test rather than re-importing.
beforeEach(() => {
  vi.resetAllMocks();
  useGameStore.getState().reset();
  // reset() preserves myUserId; wipe it too for a truly clean slate
  useGameStore.setState({ phase: 'idle', myUserId: null });
  // Restore authStore to authenticated so subscription tests start from a known state.
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
});

// ── setConnected ──────────────────────────────────────────────────────────────

describe('setConnected', () => {
  it('stores myUserId in idle phase', () => {
    useGameStore.getState().setConnected(42);
    const state = useGameStore.getState();
    expect(state.myUserId).toBe(42);
    expect(state.phase).toBe('idle');
  });

  it('updates myUserId in any phase without changing phase', () => {
    // Drive store to 'playing' then call setConnected (simulates reconnect)
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
    expect(useGameStore.getState().phase).toBe('playing');

    useGameStore.getState().setConnected(42); // reconnect-triggered 'connected' message
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    expect(state.myUserId).toBe(42);
  });
});

// ── setQueued / cancelQueued ──────────────────────────────────────────────────

describe('setQueued', () => {
  it('transitions idle → queued', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    expect(useGameStore.getState().phase).toBe('queued');
  });

  it('is a no-op when not in idle', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().setQueued(); // second call while queued
    expect(useGameStore.getState().phase).toBe('queued');
  });

  it('is a no-op when myUserId is null (connected message not yet received)', () => {
    // setQueued() before setConnected() must not fabricate a placeholder userId
    useGameStore.getState().setQueued();
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

describe('cancelQueued', () => {
  it('transitions queued → idle', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().cancelQueued();
    expect(useGameStore.getState().phase).toBe('idle');
  });

  it('is a no-op when not queued', () => {
    useGameStore.getState().cancelQueued(); // called from idle
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── handleMatchMatched ────────────────────────────────────────────────────────

describe('handleMatchMatched', () => {
  it('transitions queued → matched with correct payload', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(7, PLAYERS, '2025-01-01T00:00:03Z');

    const state = useGameStore.getState();
    expect(state.phase).toBe('matched');
    if (state.phase !== 'matched') return; // narrow
    expect(state.matchId).toBe(7);
    expect(state.players).toEqual(PLAYERS);
    expect(state.startsAt).toBe('2025-01-01T00:00:03Z');
  });

  it('is a no-op in idle when myUserId is null (connected not yet received)', () => {
    // beforeEach leaves myUserId: null — the sub-guard must block the transition even
    // though idle is now an accepted source phase when myUserId is set.
    useGameStore.getState().handleMatchMatched(7, PLAYERS, '2025-01-01T00:00:03Z');
    expect(useGameStore.getState().phase).toBe('idle');
  });

  it('idle → matched when myUserId is set (cold-start rehydration re-delivery from game-service)', () => {
    // Simulates: player reloads during 3-second countdown, WS reconnects,
    // game-service re-sends match:matched to the single reconnecting player.
    useGameStore.getState().setConnected(42); // 'connected' arrives first, sets myUserId
    useGameStore.getState().handleMatchMatched(7, PLAYERS, '2025-01-01T00:00:03Z');

    const state = useGameStore.getState();
    expect(state.phase).toBe('matched');
    if (state.phase !== 'matched') return;
    expect(state.matchId).toBe(7);
    expect(state.myUserId).toBe(42);
    expect(state.players).toEqual(PLAYERS);
    expect(state.startsAt).toBe('2025-01-01T00:00:03Z');
  });
});

// ── handleMatchRejected ───────────────────────────────────────────────────────

describe('handleMatchRejected', () => {
  it('transitions queued → idle', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchRejected('You are already in an active match.');
    expect(useGameStore.getState().phase).toBe('idle');
  });

  it('is a no-op when not queued', () => {
    useGameStore.getState().handleMatchRejected('nope');
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── handleGameState ───────────────────────────────────────────────────────────

describe('handleGameState', () => {
  function reachMatched(userId = 42, players = PLAYERS) {
    useGameStore.getState().setConnected(userId);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, players, '2025-01-01T00:00:03Z');
  }

  function reachPlaying() {
    reachMatched();
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first frame
  }

  it('transitions matched → playing with correct mySide (left) and the incoming snapshot', () => {
    reachMatched(42);
    const s = snapshot(1);
    useGameStore.getState().handleGameState(s);
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.mySide).toBe('left');
    expect(state.snapshot).toEqual(s); // snapshot from server, not null
  });

  it('transitions matched → playing with mySide right for the right player', () => {
    reachMatched(17);
    useGameStore.getState().handleGameState(snapshot(1));
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.mySide).toBe('right');
  });

  it('stays in matched and does not throw when myUserId is not in players map', () => {
    reachMatched(99); // userId 99 not in PLAYERS
    expect(() => useGameStore.getState().handleGameState(snapshot(1))).not.toThrow();
    expect(useGameStore.getState().phase).toBe('matched');
  });

  it('updates snapshot in playing phase', () => {
    reachPlaying();
    const s = snapshot(1);
    useGameStore.getState().handleGameState(s);
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.snapshot).toEqual(s);
  });

  it('is a no-op when in idle', () => {
    useGameStore.getState().handleGameState(snapshot());
    expect(useGameStore.getState().phase).toBe('idle');
  });

  it('is a no-op when paused — frozen frames from the tick loop do not evict PauseOverlay', () => {
    reachPlaying();
    const originalSnapshot = snapshot(1);
    useGameStore.getState().handleGameState(originalSnapshot);
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
    expect(useGameStore.getState().phase).toBe('paused');

    // Simulate several frozen game:state frames arriving during the grace window.
    const frozenFrame = { matchId: 1, ball: { x: 99, y: 99 }, paddles: { leftY: 99, rightY: 99 }, score: { left: 0, right: 0 } };
    useGameStore.getState().handleGameState(frozenFrame);
    useGameStore.getState().handleGameState(frozenFrame);
    useGameStore.getState().handleGameState(frozenFrame);

    const state = useGameStore.getState();
    expect(state.phase).toBe('paused');
    // Snapshot must not have been updated by the frozen frames.
    if (state.phase !== 'paused') return;
    expect(state.snapshot).toEqual(originalSnapshot);
  });
});

// ── handleGamePaused ──────────────────────────────────────────────────────────

describe('handleGamePaused', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
  }

  it('transitions playing → paused with correct fields', () => {
    reachPlaying();
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
    const state = useGameStore.getState();
    expect(state.phase).toBe('paused');
    if (state.phase !== 'paused') return;
    expect(state.disconnectedUserId).toBe(17);
    expect(state.graceEndsAt).toBe('2025-01-01T00:00:08Z');
    expect(state.mySide).toBe('left'); // preserved
  });

  it('is a no-op when not playing', () => {
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── handleGameResumed ─────────────────────────────────────────────────────────

describe('handleGameResumed', () => {
  function reachPaused() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
  }

  it('transitions paused → playing with new snapshot', () => {
    reachPaused();
    const p = resumedPayload(1);
    useGameStore.getState().handleGameResumed(p);
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.snapshot).toEqual(p);
    expect(state.mySide).toBe('left');
  });

  it('is a no-op when in idle with myUserId null (connected not yet received)', () => {
    // myUserId is null in beforeEach — store is idle and has not received 'connected' yet.
    useGameStore.getState().handleGameResumed(resumedPayload());
    expect(useGameStore.getState().phase).toBe('idle');
  });

  it('is a no-op when in queued phase', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleGameResumed(resumedPayload());
    expect(useGameStore.getState().phase).toBe('queued');
  });

  // ── cold-start rehydration (idle → playing) ──────────────────────────────────

  it('idle → playing when myUserId is set and players contains it (left side)', () => {
    useGameStore.getState().setConnected(42); // simulates 'connected' arriving after reload
    useGameStore.getState().handleGameResumed(resumedPayload(1, { '42': 'left', '17': 'right' }));

    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.matchId).toBe(1);
    expect(state.myUserId).toBe(42);
    expect(state.mySide).toBe('left');
    expect(state.players).toEqual({ '42': 'left', '17': 'right' });
    expect(state.snapshot).toBeDefined();
  });

  it('idle → playing derives mySide correctly for the right-side player', () => {
    useGameStore.getState().setConnected(17);
    useGameStore.getState().handleGameResumed(resumedPayload(1, { '42': 'left', '17': 'right' }));

    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.mySide).toBe('right');
  });

  it('idle → playing is a no-op and warns when myUserId is not in players', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    useGameStore.getState().setConnected(99); // userId 99 not in players map
    useGameStore.getState().handleGameResumed(resumedPayload(1, { '42': 'left', '17': 'right' }));

    expect(useGameStore.getState().phase).toBe('idle');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('myUserId not found in players'),
    );
    warnSpy.mockRestore();
  });
});

// ── handleGameEnd ─────────────────────────────────────────────────────────────

describe('handleGameEnd', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
  }

  it('transitions playing → ended with correct fields', () => {
    reachPlaying();
    useGameStore.getState().handleGameEnd(42, 'completed', { left: 11, right: 3 });
    const state = useGameStore.getState();
    expect(state.phase).toBe('ended');
    if (state.phase !== 'ended') return;
    expect(state.winnerId).toBe(42);
    expect(state.reason).toBe('completed');
    expect(state.score).toEqual({ left: 11, right: 3 });
    expect(state.players).toEqual(PLAYERS);
  });

  it('transitions paused → ended (e.g. forfeit during pause)', () => {
    reachPlaying();
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
    useGameStore.getState().handleGameEnd(42, 'forfeit', { left: 0, right: 0 });
    const state = useGameStore.getState();
    expect(state.phase).toBe('ended');
    if (state.phase !== 'ended') return;
    expect(state.reason).toBe('forfeit');
  });

  it('transitions matched → ended (forfeit during countdown window)', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    // No game:state arrives — match ends before the countdown completes (e.g. opponent forfeits)
    useGameStore.getState().handleGameEnd(42, 'forfeit', { left: 0, right: 0 });
    const state = useGameStore.getState();
    expect(state.phase).toBe('ended');
    if (state.phase !== 'ended') return;
    expect(state.winnerId).toBe(42);
    expect(state.reason).toBe('forfeit');
    expect(state.score).toEqual({ left: 0, right: 0 });
    expect(state.players).toEqual(PLAYERS);
  });

  it('is a no-op when in idle (invalid transition guard)', () => {
    useGameStore.getState().handleGameEnd(42, 'completed', { left: 11, right: 3 });
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── reset ─────────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('returns any phase to idle and preserves myUserId', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
    expect(useGameStore.getState().phase).toBe('playing');

    useGameStore.getState().reset();
    const state = useGameStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.myUserId).toBe(42);
  });

  it('can be called from idle without throwing', () => {
    expect(() => useGameStore.getState().reset()).not.toThrow();
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── authStore subscription ────────────────────────────────────────────────────

describe('gameStore — authStore logout subscription', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().handleGameState(snapshot(1)); // matched → playing via first game:state frame
  }

  it('resets game store, sends game:leave, and calls disconnectWs on logout while playing', () => {
    reachPlaying();
    expect(useGameStore.getState().phase).toBe('playing');

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    const state = useGameStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.myUserId).toBeNull();
    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
    expect(vi.mocked(disconnectWs)).toHaveBeenCalledOnce();
  });

  it('sends match:cancel on logout when phase is queued', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'match:cancel' });
    expect(vi.mocked(sendWs)).not.toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends game:leave on logout when phase is matched', () => {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends game:leave on logout when phase is paused', () => {
    reachPlaying();
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends nothing on logout when phase is idle', () => {
    expect(useGameStore.getState().phase).toBe('idle');

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });

  it('sends nothing on logout when phase is ended', () => {
    reachPlaying();
    useGameStore.getState().handleGameEnd(42, 'completed', { left: 11, right: 3 });

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });

  it('calls sendWs before disconnectWs on logout', () => {
    reachPlaying();
    const callOrder: string[] = [];
    vi.mocked(sendWs).mockImplementation(() => { callOrder.push('sendWs'); });
    vi.mocked(disconnectWs).mockImplementation(() => { callOrder.push('disconnectWs'); });

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    expect(callOrder).toEqual(['sendWs', 'disconnectWs']);
  });

  it('does not reset the game store or call disconnectWs on a token refresh (status stays authenticated)', () => {
    reachPlaying();

    // Simulate a silent token refresh: accessToken changes, status stays 'authenticated'.
    useAuthStore.setState({ status: 'authenticated', accessToken: 'new-token', user: null });

    expect(useGameStore.getState().phase).toBe('playing');
    expect(vi.mocked(disconnectWs)).not.toHaveBeenCalled();
  });
});
