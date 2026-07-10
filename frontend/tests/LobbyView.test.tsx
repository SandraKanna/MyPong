import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LobbyView from '../src/features/game/components/LobbyView';

const noop = () => {};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('LobbyView — idle phase', () => {
  it('renders the Find Match button', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByRole('button', { name: 'Find Match' })).toBeDefined();
  });

  it('does not render the Cancel button in idle', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('calls onFindMatch when Find Match is clicked', async () => {
    const onFindMatch = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={onFindMatch} onCancel={noop} onStartAI={noop} />);
    await user.click(screen.getByRole('button', { name: 'Find Match' }));
    expect(onFindMatch).toHaveBeenCalledOnce();
  });

  it('shows the rejectedMessage when provided', () => {
    render(<LobbyView phase="idle" rejectedMessage="You are already in an active match." onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('You are already in an active match.')).toBeDefined();
  });

  it('does not render an alert when rejectedMessage is null', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LobbyView — queued phase', () => {
  it('renders the Cancel button', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('does not render the Find Match button in queued', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.queryByRole('button', { name: 'Find Match' })).toBeNull();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={onCancel} onStartAI={noop} />);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows waiting text in queued', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByText('Looking for an opponent…')).toBeDefined();
  });
});

describe('LobbyView — vs AI section', () => {
  it('renders the Play vs AI button in idle', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByRole('button', { name: 'Play vs AI' })).toBeDefined();
  });

  it('does not render Play vs AI button in queued', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.queryByRole('button', { name: 'Play vs AI' })).toBeNull();
  });

  it('renders all three difficulty buttons', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={noop} />);
    expect(screen.getByRole('button', { name: 'easy' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'medium' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'hard' })).toBeDefined();
  });

  it('calls onStartAI with default difficulty (medium) when Play vs AI is clicked without changing difficulty', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={onStartAI} />);
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('medium');
  });

  it('calls onStartAI with easy when easy is selected and Play vs AI is clicked', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={onStartAI} />);
    await user.click(screen.getByRole('button', { name: 'easy' }));
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('easy');
  });

  it('calls onStartAI with hard when hard is selected and Play vs AI is clicked', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={onStartAI} />);
    await user.click(screen.getByRole('button', { name: 'hard' }));
    await user.click(screen.getByRole('button', { name: 'Play vs AI' }));
    expect(onStartAI).toHaveBeenCalledWith('hard');
  });

  it('selecting a difficulty does not call onStartAI — only Play vs AI button does', async () => {
    const onStartAI = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} onStartAI={onStartAI} />);
    await user.click(screen.getByRole('button', { name: 'hard' }));
    expect(onStartAI).not.toHaveBeenCalled();
  });
});
