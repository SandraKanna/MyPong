import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useGameStore } from '../src/features/game/state/gameStore';
import type { GameStatePayload } from '../src/shared/ws/wsMessages';

// gameStore imports disconnectWs — mock it so auth-subscription tests can
// verify it was called without opening a real WebSocket.
vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  onWsMessage:  vi.fn(() => vi.fn()),
}));

import { disconnectWs } from '../src/shared/ws/wsClient';
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
    useGameStore.getState().startPlaying();
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

  it('is a no-op when not queued (invalid transition guard)', () => {
    useGameStore.getState().handleMatchMatched(7, PLAYERS, '2025-01-01T00:00:03Z');
    expect(useGameStore.getState().phase).toBe('idle');
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

// ── startPlaying ──────────────────────────────────────────────────────────────

describe('startPlaying', () => {
  function reachMatched(userId = 42, players = PLAYERS) {
    useGameStore.getState().setConnected(userId);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, players, '2025-01-01T00:00:03Z');
  }

  it('transitions matched → playing and resolves mySide correctly for left player', () => {
    reachMatched(42);
    useGameStore.getState().startPlaying();
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.mySide).toBe('left');
    expect(state.snapshot).toBeNull();
  });

  it('resolves mySide as right for the right player', () => {
    reachMatched(17);
    useGameStore.getState().startPlaying();
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.mySide).toBe('right');
  });

  it('stays in matched and does not throw when myUserId is not in players map', () => {
    reachMatched(99); // userId 99 not in PLAYERS
    expect(() => useGameStore.getState().startPlaying()).not.toThrow();
    expect(useGameStore.getState().phase).toBe('matched');
  });

  it('is a no-op when not in matched', () => {
    useGameStore.getState().startPlaying();
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── handleGameState ───────────────────────────────────────────────────────────

describe('handleGameState', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().startPlaying();
  }

  it('updates snapshot in playing phase', () => {
    reachPlaying();
    const s = snapshot(1);
    useGameStore.getState().handleGameState(s);
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.snapshot).toEqual(s);
  });

  it('transitions paused → playing (countdown-window reconnect case)', () => {
    reachPlaying();
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
    expect(useGameStore.getState().phase).toBe('paused');

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
});

// ── handleGamePaused ──────────────────────────────────────────────────────────

describe('handleGamePaused', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().startPlaying();
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
    useGameStore.getState().startPlaying();
    useGameStore.getState().handleGamePaused(17, '2025-01-01T00:00:08Z');
  }

  it('transitions paused → playing with new snapshot', () => {
    reachPaused();
    const s = snapshot(1);
    useGameStore.getState().handleGameResumed(s);
    const state = useGameStore.getState();
    expect(state.phase).toBe('playing');
    if (state.phase !== 'playing') return;
    expect(state.snapshot).toEqual(s);
    expect(state.mySide).toBe('left');
  });

  it('is a no-op when not paused', () => {
    useGameStore.getState().handleGameResumed(snapshot());
    expect(useGameStore.getState().phase).toBe('idle');
  });
});

// ── handleGameEnd ─────────────────────────────────────────────────────────────

describe('handleGameEnd', () => {
  function reachPlaying() {
    useGameStore.getState().setConnected(42);
    useGameStore.getState().setQueued();
    useGameStore.getState().handleMatchMatched(1, PLAYERS, '2025-01-01T00:00:03Z');
    useGameStore.getState().startPlaying();
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
    useGameStore.getState().startPlaying();
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
    useGameStore.getState().startPlaying();
  }

  it('resets game store and calls disconnectWs when status transitions from authenticated to unauthenticated', () => {
    reachPlaying();
    expect(useGameStore.getState().phase).toBe('playing');

    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });

    const state = useGameStore.getState();
    expect(state.phase).toBe('idle');
    expect(state.myUserId).toBeNull();
    expect(vi.mocked(disconnectWs)).toHaveBeenCalledOnce();
  });

  it('does not reset the game store or call disconnectWs on a token refresh (status stays authenticated)', () => {
    reachPlaying();

    // Simulate a silent token refresh: accessToken changes, status stays 'authenticated'.
    useAuthStore.setState({ status: 'authenticated', accessToken: 'new-token', user: null });

    expect(useGameStore.getState().phase).toBe('playing');
    expect(vi.mocked(disconnectWs)).not.toHaveBeenCalled();
  });
});
