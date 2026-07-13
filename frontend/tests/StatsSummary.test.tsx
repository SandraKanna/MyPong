import { describe, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatsSummary from '../src/features/profile/components/StatsSummary';

describe('StatsSummary', () => {
  it('renders games played, games won, and highest score as-is', () => {
    render(
      <StatsSummary stats={{ userId: 1, gamesPlayed: 5, gamesWon: 3, highestScore: 11, winRate: 0.6 }} />,
    );

    screen.getByText('5');
    screen.getByText('3');
    screen.getByText('11');
  });

  it('formats winRate as a rounded percentage', () => {
    render(
      <StatsSummary stats={{ userId: 1, gamesPlayed: 3, gamesWon: 2, highestScore: 11, winRate: 0.6667 }} />,
    );

    screen.getByText('67%');
  });

  it('renders 0% when winRate is 0', () => {
    render(
      <StatsSummary stats={{ userId: 1, gamesPlayed: 0, gamesWon: 0, highestScore: 0, winRate: 0 }} />,
    );

    screen.getByText('0%');
  });
});
