import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LobbyView from '../src/features/game/components/LobbyView';

const noop = () => {};

type Difficulty = 'easy' | 'normal' | 'hard';
interface RenderOverrides {
  phase?: 'idle' | 'queued';
  rejectedMessage?: string | null;
  myName?: string;
  onFindMatch?: () => void;
  onCancel?: () => void;
  onStartAI?: (difficulty: Difficulty) => void;
}

// Default props cover the common case; each test only overrides what it cares about.
function renderLobby(overrides: RenderOverrides = {}) {
  return render(
    <LobbyView
      phase={overrides.phase ?? 'idle'}
      rejectedMessage={overrides.rejectedMessage ?? null}
      myName={overrides.myName ?? 'alice'}
      onFindMatch={overrides.onFindMatch ?? noop}
      onCancel={overrides.onCancel ?? noop}
      onStartAI={overrides.onStartAI ?? noop}
    />,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('LobbyView — idle phase', () => {
  it('renders the Find Match button', () => {
    renderLobby();
    expect(screen.getByRole('button', { name: 'Find Match' })).toBeDefined();
  });

  it('does not render the Cancel button in idle', () => {
    renderLobby();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('calls onFindMatch when Find Match is clicked', async () => {
    const onFindMatch = vi.fn();
    const user = userEvent.setup();
    renderLobby({ onFindMatch });
    await user.click(screen.getByRole('button', { name: 'Find Match' }));
    expect(onFindMatch).toHaveBeenCalledOnce();
  });

  it('shows the rejectedMessage when provided', () => {
    renderLobby({ rejectedMessage: 'You are already in an active match.' });
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('You are already in an active match.')).toBeDefined();
  });

  it('does not render an alert when rejectedMessage is null', () => {
    renderLobby();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows "Playing as {myName}"', () => {
    renderLobby({ myName: 'alice' });
    expect(screen.getByText('Playing as alice')).toBeDefined();
  });

  it('reflects a different myName value', () => {
    renderLobby({ myName: 'You' });
    expect(screen.getByText('Playing as You')).toBeDefined();
  });
});

describe('LobbyView — queued phase', () => {
  it('renders the Cancel button', () => {
    renderLobby({ phase: 'queued' });
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('does not render the Find Match button in queued', () => {
    renderLobby({ phase: 'queued' });
    expect(screen.queryByRole('button', { name: 'Find Match' })).toBeNull();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    renderLobby({ phase: 'queued', onCancel });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows waiting text in queued', () => {
    renderLobby({ phase: 'queued' });
    expect(screen.getByText('Looking for an opponent…')).toBeDefined();
  });
});

describe('LobbyView — vs AI section', () => {
  it('renders the Play vs AI button in idle', () => {
    renderLobby();
    expect(screen.getByRole('button', { name: 'Play vs AI' })).toBeDefined();
  });

  it('does not render Play vs AI button in queued', () => {
    renderLobby({ phase: 'queued' });
    expect(screen.queryByRole('button', { name: 'Play vs AI' })).toBeNull();
  });

  it('renders all three difficulty buttons', () => {
    renderLobby();
    expect(screen.getByRole('button', { name: 'easy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'normal' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'hard' })).toBeDefined();
  });

  it('calls onStartAI with default difficulty (normal) when Play vs AI is clicked without changing difficulty', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    renderLobby({ onStartAI });
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('normal');
  });

  it('calls onStartAI with easy when easy is selected and Play vs AI is clicked', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    renderLobby({ onStartAI });
    await user.click(screen.getByRole('button', { name: 'easy' }));
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('easy');
  });

  it('calls onStartAI with hard when hard is selected and Play vs AI is clicked', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    renderLobby({ onStartAI });
    await user.click(screen.getByRole('button', { name: 'hard' }));
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('hard');
  });

  it('selecting a difficulty does not call onStartAI — only Play vs AI button does', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    renderLobby({ onStartAI });
    await user.click(screen.getByRole('button', { name: 'hard' }));
    expect(onStartAI).not.toHaveBeenCalled();
  });
});
