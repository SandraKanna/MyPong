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
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: 'Find Match button' })).toBeDefined();
  });

  it('does not render the Cancel button in idle', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.queryByRole('button', { name: 'Cancel button' })).toBeNull();
  });

  it('calls onFindMatch when Find Match is clicked', async () => {
    const onFindMatch = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={onFindMatch} onCancel={noop} />);
    await user.click(screen.getByRole('button', { name: 'Find Match button' }));
    expect(onFindMatch).toHaveBeenCalledOnce();
  });

  it('shows the rejectedMessage when provided', () => {
    render(<LobbyView phase="idle" rejectedMessage="You are already in an active match." onFindMatch={noop} onCancel={noop} />);
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('You are already in an active match.')).toBeDefined();
  });

  it('does not render an alert when rejectedMessage is null', () => {
    render(<LobbyView phase="idle" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LobbyView — queued phase', () => {
  it('renders the Cancel button', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.getByRole('button', { name: 'Cancel button' })).toBeDefined();
  });

  it('does not render the Find Match button in queued', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.queryByRole('button', { name: 'Find Match button' })).toBeNull();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={onCancel} />);
    await user.click(screen.getByRole('button', { name: 'Cancel button' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows waiting text in queued', () => {
    render(<LobbyView phase="queued" rejectedMessage={null} onFindMatch={noop} onCancel={noop} />);
    expect(screen.getByText('Looking for an opponent…')).toBeDefined();
  });
});
