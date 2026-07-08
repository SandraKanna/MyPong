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
import { connectWs, disconnectWs, onWsMessage, sendWs } from '../src/shared/ws/wsClient';
import GamePage from '../src/features/game/pages/GamePage';

beforeEach(() => {
  vi.resetAllMocks();
  // Reset to a clean idle state before each test.
  useGameStore.setState({ phase: 'idle', myUserId: null });
  // onWsMessage must always return an unsubscribe fn, even after resetAllMocks.
  vi.mocked(onWsMessage).mockReturnValue(vi.fn());
});

describe('GamePage — unmount sends phase-aware WS message', () => {
  it('sends match:cancel on unmount when phase is queued', () => {
    useGameStore.setState({ phase: 'queued', myUserId: 42 });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'match:cancel' });
    expect(vi.mocked(sendWs)).not.toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends game:leave on unmount when phase is matched', () => {
    useGameStore.setState({
      phase: 'matched', myUserId: 42, matchId: 1,
      players: { '42': 'left', '17': 'right' },
      startsAt: new Date(Date.now() + 3000).toISOString(),
    });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends game:leave on unmount when phase is playing', () => {
    useGameStore.setState({
      phase: 'playing', myUserId: 42, matchId: 1,
      players: { '42': 'left', '17': 'right' }, mySide: 'left', snapshot: null,
    });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends game:leave on unmount when phase is paused', () => {
    useGameStore.setState({
      phase: 'paused', myUserId: 42, matchId: 1,
      players: { '42': 'left', '17': 'right' }, mySide: 'left', snapshot: null,
      disconnectedUserId: 17, graceEndsAt: new Date(Date.now() + 5000).toISOString(),
    });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({ type: 'game:leave' });
  });

  it('sends no WS message on unmount when phase is idle', () => {
    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });

  it('sends no WS message on unmount when phase is ended', () => {
    useGameStore.setState({
      phase: 'ended', myUserId: 42, winnerId: 42,
      reason: 'completed', score: { left: 11, right: 3 },
      players: { '42': 'left', '17': 'right' },
    });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });

  it('calls sendWs before disconnectWs on unmount', () => {
    useGameStore.setState({ phase: 'queued', myUserId: 42 });

    const callOrder: string[] = [];
    vi.mocked(sendWs).mockImplementation(() => { callOrder.push('sendWs'); });
    vi.mocked(disconnectWs).mockImplementation(() => { callOrder.push('disconnectWs'); });

    const { unmount } = render(<GamePage />);
    unmount();

    expect(callOrder).toEqual(['sendWs', 'disconnectWs']);
  });
});

describe('GamePage — unmount cleanup', () => {
  it('calls reset() on every unmount regardless of phase', () => {
    const resetSpy = vi.spyOn(useGameStore.getState(), 'reset');

    const { unmount } = render(<GamePage />);
    unmount();

    expect(resetSpy).toHaveBeenCalledOnce();
    resetSpy.mockRestore();
  });

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
