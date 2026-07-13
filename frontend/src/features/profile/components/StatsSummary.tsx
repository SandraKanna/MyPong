import type { UserStats } from '../api/profile';

interface StatsSummaryProps {
  stats: UserStats;
}

export default function StatsSummary({ stats }: StatsSummaryProps) {
  // STUDY: winRate arrives as a raw 0-1 ratio (e.g. 0.6667) — the backend
  // deliberately leaves percentage formatting to the frontend.
  const winRatePercent = Math.round(stats.winRate * 100);

  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-fg text-sm uppercase tracking-widest">Overview</h2>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="flex flex-col gap-1">
          <dt className="font-sans text-muted text-xs uppercase tracking-wide">Games played</dt>
          <dd className="font-display text-fg text-xl">{stats.gamesPlayed}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-sans text-muted text-xs uppercase tracking-wide">Games won</dt>
          <dd className="font-display text-fg text-xl">{stats.gamesWon}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-sans text-muted text-xs uppercase tracking-wide">Win rate</dt>
          <dd className="font-display text-fg text-xl">{winRatePercent}%</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="font-sans text-muted text-xs uppercase tracking-wide">Highest score</dt>
          <dd className="font-display text-fg text-xl">{stats.highestScore}</dd>
        </div>
      </dl>
    </div>
  );
}
