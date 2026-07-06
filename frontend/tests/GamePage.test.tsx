import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useGameStore } from '../src/features/game/state/gameStore';

// Mock the entire wsClient module so no real WebSocket is created.
// connectWs, disconnectWs, and onWsMessage are all replaced with vi.fn().
vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  // onWsMessage must return an unsubscribe function — the component stores
  // these in an array and calls them all on unmount.
  onWsMessage:  vi.fn(() => vi.fn()),
}));

// Import after vi.mock so the module sees the mocked version.
import { connectWs, disconnectWs, onWsMessage } from '../src/shared/ws/wsClient';
import GamePage from '../src/features/game/pages/GamePage';

beforeEach(() => {
  vi.resetAllMocks();
  // Reset to a clean idle state before each test.
  useGameStore.setState({ phase: 'idle', myUserId: null });
  // onWsMessage must always return an unsubscribe fn, even after resetAllMocks.
  vi.mocked(onWsMessage).mockReturnValue(vi.fn());
});

describe('GamePage — mount-time stale phase guard (queued/ended)', () => {
  it('calls reset() before connectWs() when phase is already ended', () => {
    // Drive the store to 'ended' to simulate a leftover result from a previous match.
    useGameStore.setState({
      phase: 'ended',
      myUserId: 42,
      winnerId: 42,
      reason: 'completed',
      score: { left: 11, right: 3 },
      players: { '42': 'left', '17': 'right' },
    });

    const callOrder: string[] = [];
    // Spy on reset() to record when it's called relative to connectWs().
    const resetSpy = vi.spyOn(useGameStore.getState(), 'reset').mockImplementation(() => {
      callOrder.push('reset');
      useGameStore.setState({ phase: 'idle', myUserId: 42 });
    });
    vi.mocked(connectWs).mockImplementation(() => { callOrder.push('connectWs'); });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(callOrder).toEqual(['reset', 'connectWs']);
    resetSpy.mockRestore();
  });

  it('does not call reset() when phase is idle on mount', () => {
    const resetSpy = vi.spyOn(useGameStore.getState(), 'reset');

    const { unmount } = render(<GamePage />);
    unmount();

    expect(resetSpy).not.toHaveBeenCalled();
    resetSpy.mockRestore();
  });

  it('calls reset() when phase is queued on mount (stale queue entry cleared)', () => {
    useGameStore.setState({ phase: 'queued', myUserId: 42 });
    const resetSpy = vi.spyOn(useGameStore.getState(), 'reset');

    const { unmount } = render(<GamePage />);
    unmount();

    expect(resetSpy).toHaveBeenCalledOnce();
    resetSpy.mockRestore();
  });
});

describe('GamePage — unmount cleanup', () => {
  it('calls disconnectWs() exactly once on unmount', () => {
    const { unmount } = render(<GamePage />);
    expect(vi.mocked(disconnectWs)).not.toHaveBeenCalled();

    unmount();

    expect(vi.mocked(disconnectWs)).toHaveBeenCalledOnce();
  });

  it('calls all onWsMessage unsubscribes on unmount', () => {
    // Each call to onWsMessage returns a unique unsubscribe spy.
    const unsubs = Array.from({ length: 7 }, () => vi.fn());
    let callIdx = 0;
    vi.mocked(onWsMessage).mockImplementation(() => unsubs[callIdx++] ?? vi.fn());

    const { unmount } = render(<GamePage />);
    unmount();

    // All 7 subscriptions (connected, match:matched, match:rejected,
    // game:state, game:paused, game:resumed, game:end) must be unsubscribed.
    for (const unsub of unsubs) {
      expect(unsub).toHaveBeenCalledOnce();
    }
  });
});
