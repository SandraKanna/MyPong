import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useGameStore } from '../src/features/game/state/gameStore';
import { useAuthStore } from '../src/features/auth/state/authState';
import { useProfileStore } from '../src/features/profile/state/profileState';
import ResultScreen from '../src/features/game/components/ResultScreen';

vi.mock('../src/shared/ws/wsClient', () => ({
  connectWs:    vi.fn(),
  disconnectWs: vi.fn(),
  sendWs:       vi.fn(),
  onWsMessage:  vi.fn(() => vi.fn()),
}));

const PLAYERS = { '42': 'left' as const, '17': 'right' as const };

function setEndedState(
  winnerId: number,
  reason: 'completed' | 'forfeit',
  score = { left: 3, right: 5 },
  opponentUsername: string | null = null,
) {
  useGameStore.setState({
    phase:    'ended',
    myUserId: 42,
    winnerId,
    reason,
    score,
    players:  PLAYERS,
    opponentUsername,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  useGameStore.setState({ phase: 'idle', myUserId: null, opponentUsername: null });
  useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, isGuest: false });
  useProfileStore.setState({ usernameStatus: 'set', username: 'alice' });
});

describe('ResultScreen — headings', () => {
  it('shows "You win!" on completed win', () => {
    setEndedState(42, 'completed');
    render(<ResultScreen />);
    expect(screen.getByRole('heading').textContent).toBe('You win!');
  });

  it('shows "You lose." on completed loss', () => {
    setEndedState(17, 'completed');
    render(<ResultScreen />);
    expect(screen.getByRole('heading').textContent).toBe('You lose.');
  });

  it('shows "Forfeit — you win." on forfeit win', () => {
    setEndedState(42, 'forfeit');
    render(<ResultScreen />);
    expect(screen.getByRole('heading').textContent).toBe('Forfeit — you win.');
  });

  it('shows "Forfeit — you lose." on forfeit loss', () => {
    setEndedState(17, 'forfeit');
    render(<ResultScreen />);
    expect(screen.getByRole('heading').textContent).toBe('Forfeit — you lose.');
  });
});

describe('ResultScreen — score', () => {
  it('shows the score in all four cases', () => {
    const cases: Array<[number, 'completed' | 'forfeit', { left: number; right: number }]> = [
      [42, 'completed', { left: 11, right: 3  }],
      [17, 'completed', { left: 3,  right: 11 }],
      [42, 'forfeit',   { left: 0,  right: 0  }],
      [17, 'forfeit',   { left: 0,  right: 0  }],
    ];
    for (const [winnerId, reason, score] of cases) {
      useGameStore.setState({ phase: 'idle', myUserId: null });
      setEndedState(winnerId, reason, score);
      const { unmount } = render(<ResultScreen />);
      expect(screen.getByText(`${score.left} – ${score.right}`)).toBeDefined();
      unmount();
    }
  });

  it('shows 0 – 0 for a forfeit before any point is scored', () => {
    setEndedState(42, 'forfeit', { left: 0, right: 0 });
    render(<ResultScreen />);
    expect(screen.getByText('0 – 0')).toBeDefined();
  });
});

describe('ResultScreen — player names', () => {
  it('labels the score line as "{leftName} vs {rightName}" when I am on the left', () => {
    setEndedState(42, 'completed', { left: 11, right: 3 }, 'bob');
    render(<ResultScreen />);
    expect(screen.getByText('alice vs bob')).toBeDefined();
  });

  it('swaps the label order when I am on the right', () => {
    useGameStore.setState({
      phase: 'ended',
      myUserId: 17,
      winnerId: 17,
      reason: 'completed',
      score: { left: 3, right: 11 },
      players: PLAYERS,
      opponentUsername: 'bob',
    });
    render(<ResultScreen />);
    expect(screen.getByText('bob vs alice')).toBeDefined();
  });

  it('falls back to "Opponent" when the name was never resolved', () => {
    setEndedState(42, 'completed', { left: 11, right: 3 }, null);
    render(<ResultScreen />);
    expect(screen.getByText('alice vs Opponent')).toBeDefined();
  });

  it('shows "Computer" for a PvE match', () => {
    setEndedState(42, 'completed', { left: 11, right: 3 }, 'Computer');
    render(<ResultScreen />);
    expect(screen.getByText('alice vs Computer')).toBeDefined();
  });

  it('shows "You" as my label for a guest session', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'guest-tok', user: null, isGuest: true });
    setEndedState(42, 'completed', { left: 11, right: 3 }, 'Computer');
    render(<ResultScreen />);
    expect(screen.getByText('You vs Computer')).toBeDefined();
  });
});

describe('ResultScreen — Play again', () => {
  it('calls reset() when "Play again" is clicked', () => {
    setEndedState(42, 'completed');
    const resetSpy = vi.spyOn(useGameStore.getState(), 'reset');
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(resetSpy).toHaveBeenCalledOnce();
  });

  it('transitions store to idle after "Play again"', () => {
    setEndedState(42, 'completed');
    render(<ResultScreen />);
    fireEvent.click(screen.getByRole('button', { name: /play again/i }));
    expect(useGameStore.getState().phase).toBe('idle');
  });
});
