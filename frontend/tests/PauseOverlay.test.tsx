import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useGameStore } from '../src/features/game/state/gameStore';
import type { GameStatePayload } from '../src/shared/ws/wsMessages';

vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  onWsMessage:  vi.fn(() => vi.fn()),
}));

import PauseOverlay from '../src/features/game/components/PauseOverlay';

const PLAYERS = { '42': 'left' as const, '17': 'right' as const };

function makeSnapshot(overrides?: Partial<GameStatePayload>): GameStatePayload {
  return {
    matchId: 1,
    ball:    { x: 400, y: 300 },
    paddles: { leftY: 260, rightY: 260 },
    score:   { left: 0, right: 0 },
    ...overrides,
  };
}

// opponentUsername defaults to null (unresolved) — matches GameBoard.test.tsx's
// setPlayingState() convention. disconnectedUserId is still part of PausedPhase's
// shape (gameStore stores it regardless), but PauseOverlay itself no longer reads
// it for display — it reads opponentUsername instead, since game:paused is only
// ever sent to the still-connected opponent, so the two always name the same person.
function setPausedState(graceEndsAt: string, opponentUsername: string | null = null) {
  useGameStore.setState({
    phase: 'paused',
    myUserId: 42,
    matchId: 1,
    players: PLAYERS,
    mySide: 'left',
    snapshot: makeSnapshot(),
    disconnectedUserId: 17,
    graceEndsAt,
    opponentUsername,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  useGameStore.setState({ phase: 'idle', myUserId: null });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('PauseOverlay — rendering', () => {
  it('renders the resolved opponent name', () => {
    const graceEndsAt = new Date(Date.now() + 5000).toISOString();
    setPausedState(graceEndsAt, 'bob');
    render(<PauseOverlay />);
    expect(screen.getByText(/Player bob disconnected/)).toBeDefined();
  });

  it('falls back to "Opponent" while the name is still unresolved', () => {
    const graceEndsAt = new Date(Date.now() + 5000).toISOString();
    setPausedState(graceEndsAt, null);
    render(<PauseOverlay />);
    expect(screen.getByText(/Player Opponent disconnected/)).toBeDefined();
  });

  it('renders "Computer" for a PvE match', () => {
    const graceEndsAt = new Date(Date.now() + 5000).toISOString();
    setPausedState(graceEndsAt, 'Computer');
    render(<PauseOverlay />);
    expect(screen.getByText(/Player Computer disconnected/)).toBeDefined();
  });

  it('renders the initial countdown from graceEndsAt', () => {
    const graceEndsAt = new Date(Date.now() + 5000).toISOString();
    setPausedState(graceEndsAt);
    render(<PauseOverlay />);
    // Math.ceil(5000ms / 1000) = 5
    expect(screen.getByText(/5s/)).toBeDefined();
  });

  it('shows 0s when graceEndsAt is in the past', () => {
    const graceEndsAt = new Date(Date.now() - 1000).toISOString();
    setPausedState(graceEndsAt);
    render(<PauseOverlay />);
    expect(screen.getByText(/0s/)).toBeDefined();
  });
});

describe('PauseOverlay — countdown tick', () => {
  it('decrements every second', () => {
    const graceEndsAt = new Date(Date.now() + 5000).toISOString();
    setPausedState(graceEndsAt);
    render(<PauseOverlay />);

    expect(screen.getByText(/5s/)).toBeDefined();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/4s/)).toBeDefined();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/3s/)).toBeDefined();
  });

  it('stops ticking after reaching 0', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
    const graceEndsAt = new Date(Date.now() + 2000).toISOString();
    setPausedState(graceEndsAt);
    render(<PauseOverlay />);

    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText(/0s/)).toBeDefined();
    // clearInterval is called once when next <= 0 stops the interval
    expect(clearIntervalSpy).toHaveBeenCalled();
  });

  it('does not dispatch any store action when reaching 0', () => {
    const graceEndsAt = new Date(Date.now() + 1000).toISOString();
    setPausedState(graceEndsAt);
    render(<PauseOverlay />);

    // Capture phase before the timer fires
    const phaseBefore = useGameStore.getState().phase;

    act(() => { vi.advanceTimersByTime(2000); });

    // Phase must still be 'paused' — overlay is purely visual, no store dispatch
    expect(useGameStore.getState().phase).toBe(phaseBefore);
    expect(useGameStore.getState().phase).toBe('paused');
  });
});
