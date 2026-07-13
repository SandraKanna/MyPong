import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MatchHistoryTable from '../src/features/profile/components/MatchHistoryTable';

const MOCK_MATCH = {
  matchId: 7,
  opponentId: 42,
  result: 'win' as const,
  myScore: 11,
  oppScore: 5,
  status: 'completed',
  playedAt: '2024-01-01T00:05:00.000Z',
};

describe('MatchHistoryTable', () => {
  it('shows "No matches played yet" on an empty first page (offset 0)', () => {
    render(
      <MatchHistoryTable
        matches={[]}
        usernameMap={new Map()}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );

    screen.getByText('No matches played yet.');
  });

  it('shows "No more matches" on an empty page past offset 0', () => {
    render(
      <MatchHistoryTable
        matches={[]}
        usernameMap={new Map()}
        offset={20}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );

    screen.getByText('No more matches.');
  });

  it('renders a row with the resolved opponent username', () => {
    render(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map([[42, 'bob']])}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );

    screen.getByText('bob');
    screen.getByText('11–5');
    screen.getByText('Win');
    screen.getByText('Completed');
  });

  it('falls back to the raw opponentId when it is not in the username map', () => {
    render(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );

    screen.getByText('42');
  });

  it('disables Previous at offset 0 and enables it otherwise', () => {
    const { rerender } = render(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );
    expect(screen.getByRole('button', { name: /previous/i }).hasAttribute('disabled')).toBe(true);

    rerender(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={20}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );
    expect(screen.getByRole('button', { name: /previous/i }).hasAttribute('disabled')).toBe(false);
  });

  it('disables Next when canGoNext is false and enables it when true', () => {
    const { rerender } = render(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={false}
      />,
    );
    expect(screen.getByRole('button', { name: /next/i }).hasAttribute('disabled')).toBe(true);

    rerender(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={0}
        onPrev={() => {}}
        onNext={() => {}}
        canGoNext={true}
      />,
    );
    expect(screen.getByRole('button', { name: /next/i }).hasAttribute('disabled')).toBe(false);
  });

  it('calls onNext/onPrev when their buttons are clicked', async () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const user = userEvent.setup();

    render(
      <MatchHistoryTable
        matches={[MOCK_MATCH]}
        usernameMap={new Map()}
        offset={20}
        onPrev={onPrev}
        onNext={onNext}
        canGoNext={true}
      />,
    );

    await user.click(screen.getByRole('button', { name: /previous/i }));
    await user.click(screen.getByRole('button', { name: /next/i }));

    expect(onPrev).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
