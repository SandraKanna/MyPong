import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatsDisclosure from '../src/features/profile/components/StatsDisclosure';
import { getStats, getMatches, lookupUsernames } from '../src/features/profile/api/profile';

vi.mock('../src/features/profile/api/profile');

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getStats).mockResolvedValue({
    userId: 1, gamesPlayed: 0, gamesWon: 0, highestScore: 0, winRate: 0,
  });
  vi.mocked(getMatches).mockResolvedValue({ userId: 1, matches: [], limit: 20, offset: 0 });
  vi.mocked(lookupUsernames).mockResolvedValue(new Map());
});

const MOCK_MATCH = {
  matchId: 7,
  opponentId: 42,
  result: 'win' as const,
  myScore: 11,
  oppScore: 5,
  status: 'completed',
  playedAt: '2024-01-01T00:05:00.000Z',
};

// Shared by every test below that needs the panel open — returns the userEvent
// instance so callers can keep interacting (e.g. clicking Previous/Next).
async function expand() {
  const user = userEvent.setup();
  const toggle = screen.getByRole('button', { name: /stats/i });
  await user.click(toggle);
  return { user, toggle };
}

describe('StatsDisclosure', () => {
  describe('disclosure', () => {
    it('is collapsed by default and does not fetch stats/matches on mount', () => {
      render(<StatsDisclosure userId={1} />);

      const toggle = screen.getByRole('button', { name: /stats/i });
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(vi.mocked(getStats)).not.toHaveBeenCalled();
      expect(vi.mocked(getMatches)).not.toHaveBeenCalled();
    });

    it('fetches stats and matches the first time it is expanded', async () => {
      render(<StatsDisclosure userId={1} />);
      const { toggle } = await expand();

      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(vi.mocked(getStats)).toHaveBeenCalledOnce();
      expect(vi.mocked(getMatches)).toHaveBeenCalledOnce();
    });

    it('does not refetch on collapse + re-expand within the same visit', async () => {
      render(<StatsDisclosure userId={1} />);
      const { user, toggle } = await expand();
      expect(vi.mocked(getStats)).toHaveBeenCalledOnce();
      expect(vi.mocked(getMatches)).toHaveBeenCalledOnce();

      await user.click(toggle); // collapse
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      await user.click(toggle); // re-expand
      expect(toggle.getAttribute('aria-expanded')).toBe('true');

      expect(vi.mocked(getStats)).toHaveBeenCalledOnce();
      expect(vi.mocked(getMatches)).toHaveBeenCalledOnce();
    });
  });

  describe('stats summary integration', () => {
    it('renders games played, games won, win rate as a percentage, and highest score', async () => {
      vi.mocked(getStats).mockResolvedValue({
        userId: 1, gamesPlayed: 3, gamesWon: 2, highestScore: 11, winRate: 0.6667,
      });

      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findByText('67%');
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.getByText('2')).toBeTruthy();
      expect(screen.getByText('11')).toBeTruthy();
    });

    it('surfaces a stats error without blanking the match history', async () => {
      vi.mocked(getStats).mockRejectedValue(new Error('Failed to load stats'));

      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findByText('Failed to load stats');
      await screen.findByText('No matches played yet.');
    });
  });

  describe('match history integration', () => {
    it('shows "No matches played yet" when the first page is empty', async () => {
      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findByText('No matches played yet.');
    });

    it('resolves the opponent username with a single batched lookup call', async () => {
      vi.mocked(getMatches).mockResolvedValue({ userId: 1, matches: [MOCK_MATCH], limit: 20, offset: 0 });
      vi.mocked(lookupUsernames).mockResolvedValue(new Map([[42, 'bob']]));

      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findByText('bob');
      expect(vi.mocked(lookupUsernames)).toHaveBeenCalledOnce();
      expect(vi.mocked(lookupUsernames)).toHaveBeenCalledWith([42]);
    });

    it('falls back to the raw opponentId when the lookup omits it', async () => {
      vi.mocked(getMatches).mockResolvedValue({ userId: 1, matches: [MOCK_MATCH], limit: 20, offset: 0 });
      // Unknown/profile-less opponent — silently omitted by the backend, same
      // as the real GET /api/users?ids= contract.
      vi.mocked(lookupUsernames).mockResolvedValue(new Map());

      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findByText('42');
    });

    it('dedupes opponentIds across rows before the batched lookup', async () => {
      vi.mocked(getMatches).mockResolvedValue({
        userId: 1,
        matches: [MOCK_MATCH, { ...MOCK_MATCH, matchId: 8, result: 'loss' }],
        limit: 20,
        offset: 0,
      });
      vi.mocked(lookupUsernames).mockResolvedValue(new Map([[42, 'bob']]));

      render(<StatsDisclosure userId={1} />);
      await expand();

      await screen.findAllByText('bob');
      expect(vi.mocked(lookupUsernames)).toHaveBeenCalledWith([42]);
    });

    it('paginates with Previous/Next using limit and offset, refetching on each click', async () => {
      // A full page (20 rows) signals there may be a next page.
      const fullPage = Array.from({ length: 20 }, (_, i) => ({ ...MOCK_MATCH, matchId: i + 1 }));
      vi.mocked(getMatches).mockResolvedValue({ userId: 1, matches: fullPage, limit: 20, offset: 0 });

      render(<StatsDisclosure userId={1} />);
      const { user } = await expand();

      const prevButton = await screen.findByRole('button', { name: /previous/i });
      expect(prevButton.hasAttribute('disabled')).toBe(true);
      expect(vi.mocked(getMatches)).toHaveBeenCalledOnce();

      await user.click(screen.getByRole('button', { name: /next/i }));
      expect(vi.mocked(getMatches)).toHaveBeenCalledWith(1, 20, 20);
      expect(vi.mocked(getMatches)).toHaveBeenCalledTimes(2);
    });
  });
});
