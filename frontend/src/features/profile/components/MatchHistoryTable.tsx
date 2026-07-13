import type { MatchHistoryEntry } from '../api/profile';

interface MatchHistoryTableProps {
  matches: MatchHistoryEntry[];
  // STUDY: usernameMap is a lookup table — id in, username out — built by
  // the caller from a separate request. It's passed in instead of a plain
  // { [id]: username } value per row because the lookup can genuinely come
  // back empty for a given id (e.g. an opponent who played before the
  // username requirement existed, so no username was ever recorded for
  // them). This component checks the table for each row's id and falls
  // back to showing the raw numeric id whenever that id isn't in it.
  usernameMap: Map<number, string>;
  offset: number;
  onPrev: () => void;
  onNext: () => void;
  canGoNext: boolean;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

export default function MatchHistoryTable({
  matches,
  usernameMap,
  offset,
  onPrev,
  onNext,
  canGoNext,
}: MatchHistoryTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="font-display text-fg text-sm uppercase tracking-widest">Match history</h2>
      {matches.length === 0 ? (
        <p className="font-sans text-muted text-sm">
          {offset === 0 ? 'No matches played yet.' : 'No more matches.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-sans text-sm">
            <thead>
              <tr className="text-muted uppercase text-xs tracking-wide border-b border-border">
                <th className="py-2 pr-4">Result</th>
                <th className="py-2 pr-4">Score</th>
                <th className="py-2 pr-4">Opponent</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Played</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => (
                <tr key={m.matchId} className="border-b border-border">
                  <td className={`py-2 pr-4 ${m.result === 'win' ? 'text-success' : 'text-danger'}`}>
                    {capitalize(m.result)}
                  </td>
                  <td className="py-2 pr-4 text-fg">{m.myScore}–{m.oppScore}</td>
                  <td className="py-2 pr-4 text-fg">{usernameMap.get(m.opponentId) ?? m.opponentId}</td>
                  <td className="py-2 pr-4 text-muted">{capitalize(m.status)}</td>
                  <td className="py-2 pr-4 text-muted">{new Date(m.playedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex gap-3">
        <button
          onClick={onPrev}
          disabled={offset === 0}
          className="font-sans text-sm border border-border text-fg px-4 py-1 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          Previous
        </button>
        <button
          onClick={onNext}
          disabled={!canGoNext}
          className="font-sans text-sm border border-border text-fg px-4 py-1 hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          Next
        </button>
      </div>
    </div>
  );
}
