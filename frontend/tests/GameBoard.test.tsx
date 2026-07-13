import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '../src/features/game/state/gameStore';
import { useAuthStore } from '../src/features/auth/state/authState';
import { useProfileStore } from '../src/features/profile/state/profileState';
import type { GameStatePayload } from '../src/shared/ws/wsMessages';

vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  onWsMessage:  vi.fn(() => vi.fn()),
}));

import { sendWs } from '../src/shared/ws/wsClient';
import GameBoard from '../src/features/game/components/GameBoard';

const PLAYERS = { '42': 'left' as const, '17': 'right' as const };

function makeSnapshot(overrides?: Partial<GameStatePayload>): GameStatePayload {
  return {
    matchId: 1,
    ball:    { x: 400, y: 300 },
    paddles: { leftY: 260, rightY: 260 },
    score:   { left: 3, right: 5 },
    ...overrides,
  };
}

// Drive the store to 'playing' with a given snapshot. mySide defaults to
// 'left' (myUserId 42) and opponentUsername defaults to null (unresolved) —
// tests that care about name labels override either explicitly.
function setPlayingState(
  snap: GameStatePayload,
  overrides?: { mySide?: 'left' | 'right'; opponentUsername?: string | null },
) {
  useGameStore.setState({
    phase: 'playing',
    myUserId: 42,
    matchId: 1,
    players: PLAYERS,
    mySide: overrides?.mySide ?? 'left',
    snapshot: snap,
    opponentUsername: overrides?.opponentUsername ?? null,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useGameStore.setState({ phase: 'idle', myUserId: null, opponentUsername: null });
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, isGuest: false });
  useProfileStore.setState({ usernameStatus: 'set', username: 'alice' });
});

describe('GameBoard — rendering', () => {
  it('renders the ball at the correct center position', () => {
    setPlayingState(makeSnapshot({ ball: { x: 123, y: 456 } }));
    const { container } = render(<GameBoard />);
    const circle = container.querySelector('circle');
    expect(circle?.getAttribute('cx')).toBe('123');
    expect(circle?.getAttribute('cy')).toBe('456');
    expect(circle?.getAttribute('r')).toBe('10');
  });

  it('renders the left paddle at the correct position', () => {
    setPlayingState(makeSnapshot({ paddles: { leftY: 100, rightY: 200 } }));
    const { container } = render(<GameBoard />);
    const rects = container.querySelectorAll('rect');
    // First rect is the left paddle (x=20)
    const left = Array.from(rects).find((r) => r.getAttribute('x') === '20');
    expect(left?.getAttribute('y')).toBe('100');
    expect(left?.getAttribute('width')).toBe('12');
    expect(left?.getAttribute('height')).toBe('80');
  });

  it('renders the right paddle at the correct position', () => {
    setPlayingState(makeSnapshot({ paddles: { leftY: 100, rightY: 200 } }));
    const { container } = render(<GameBoard />);
    const rects = container.querySelectorAll('rect');
    const right = Array.from(rects).find((r) => r.getAttribute('x') === '768');
    expect(right?.getAttribute('y')).toBe('200');
    expect(right?.getAttribute('width')).toBe('12');
    expect(right?.getAttribute('height')).toBe('80');
  });

  it('renders both scores', () => {
    setPlayingState(makeSnapshot({ score: { left: 3, right: 5 } }));
    render(<GameBoard />);
    expect(screen.getByText('3')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});

describe('GameBoard — player names', () => {
  it('labels my side with myName and the other side with the resolved opponent name', () => {
    setPlayingState(makeSnapshot(), { mySide: 'left', opponentUsername: 'bob' });
    render(<GameBoard />);
    expect(screen.getByText('alice')).toBeDefined();
    expect(screen.getByText('bob')).toBeDefined();
  });

  it('swaps sides correctly when mySide is right', () => {
    setPlayingState(makeSnapshot(), { mySide: 'right', opponentUsername: 'bob' });
    const { container } = render(<GameBoard />);
    const texts = Array.from(container.querySelectorAll('text'));
    const myLabel = texts.find((t) => t.textContent === 'alice');
    const oppLabel = texts.find((t) => t.textContent === 'bob');
    // Left slot is at x = FIELD_W/4 = 200, right slot at x = FIELD_W*3/4 = 600.
    expect(myLabel?.getAttribute('x')).toBe('600');
    expect(oppLabel?.getAttribute('x')).toBe('200');
  });

  it('falls back to "Opponent" while the opponent name is still unresolved', () => {
    setPlayingState(makeSnapshot(), { opponentUsername: null });
    render(<GameBoard />);
    expect(screen.getByText('Opponent')).toBeDefined();
  });

  it('shows "Computer" for a PvE match', () => {
    setPlayingState(makeSnapshot(), { opponentUsername: 'Computer' });
    render(<GameBoard />);
    expect(screen.getByText('Computer')).toBeDefined();
  });

  it('shows "You" as my label for a guest session', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'guest-tok', user: null, isGuest: true });
    setPlayingState(makeSnapshot(), { opponentUsername: 'Computer' });
    render(<GameBoard />);
    expect(screen.getByText('You')).toBeDefined();
  });
});

describe('GameBoard — keyboard input', () => {
  it('sends game:input direction:up on ArrowUp keydown', () => {
    setPlayingState(makeSnapshot());
    render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(vi.mocked(sendWs)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({
      type: 'game:input',
      payload: { matchId: 1, direction: 'up' },
    });
  });

  it('sends game:input direction:down on ArrowDown keydown', () => {
    setPlayingState(makeSnapshot());
    render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'ArrowDown' });

    expect(vi.mocked(sendWs)).toHaveBeenCalledOnce();
    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({
      type: 'game:input',
      payload: { matchId: 1, direction: 'down' },
    });
  });

  it('does not send a second message on repeated ArrowUp keydown (key-repeat guard)', () => {
    setPlayingState(makeSnapshot());
    render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'ArrowUp' }); // first press
    fireEvent.keyDown(window, { key: 'ArrowUp' }); // repeat — browser fires this continuously
    fireEvent.keyDown(window, { key: 'ArrowUp' }); // repeat again

    expect(vi.mocked(sendWs)).toHaveBeenCalledOnce(); // only the first press
  });

  it('sends direction:stop on ArrowUp keyup after a held key', () => {
    setPlayingState(makeSnapshot());
    render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyUp(window,   { key: 'ArrowUp' });

    expect(vi.mocked(sendWs)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(sendWs)).toHaveBeenLastCalledWith({
      type: 'game:input',
      payload: { matchId: 1, direction: 'stop' },
    });
  });

  it('ignores unrelated keys', () => {
    setPlayingState(makeSnapshot());
    render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'Space' });
    fireEvent.keyDown(window, { key: 'Enter' });

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });

  it('sends stop on cleanup (playing→paused) if a key is held', () => {
    setPlayingState(makeSnapshot());
    const { unmount } = render(<GameBoard />);

    fireEvent.keyDown(window, { key: 'ArrowUp' });
    vi.mocked(sendWs).mockClear();

    // Simulate playing→paused by changing phase — GameBoard will re-render
    // and the effect cleanup fires before the new effect (which returns early
    // for 'paused') runs.
    useGameStore.setState({
      phase: 'paused',
      myUserId: 42,
      matchId: 1,
      players: PLAYERS,
      mySide: 'left',
      snapshot: makeSnapshot(),
      disconnectedUserId: 17,
      graceEndsAt: new Date(Date.now() + 5000).toISOString(),
    });

    unmount();

    expect(vi.mocked(sendWs)).toHaveBeenCalledWith({
      type: 'game:input',
      payload: { matchId: 1, direction: 'stop' },
    });
  });

  it('does not send after unmount', () => {
    setPlayingState(makeSnapshot());
    const { unmount } = render(<GameBoard />);
    unmount();
    vi.mocked(sendWs).mockClear();

    fireEvent.keyDown(window, { key: 'ArrowUp' });

    expect(vi.mocked(sendWs)).not.toHaveBeenCalled();
  });
});
