import { useState, useEffect } from 'react';
import { getStats, getMatches, lookupUsernames, UserStats, MatchHistoryEntry } from '../api/profile';
import StatsSummary from './StatsSummary';
import MatchHistoryTable from './MatchHistoryTable';

const MATCHES_LIMIT = 20;

interface StatsDisclosureProps {
  userId: number;
}

export default function StatsDisclosure({ userId }: StatsDisclosureProps) {
  const [expanded, setExpanded] = useState(false); // panel visibility only
  const [hasExpandedOnce, setHasExpandedOnce] = useState(false); // one-way false→true flag; gates the fetch effects below so collapse/re-expand never refetches
  const [stats, setStats] = useState<UserStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [matches, setMatches] = useState<MatchHistoryEntry[]>([]);
  const [matchesError, setMatchesError] = useState<string | null>(null);
  const [usernameMap, setUsernameMap] = useState<Map<number, string>>(new Map());
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    // hasExpandedOnce only ever flips false→true, so this fires exactly once (the first expand).
    if (!hasExpandedOnce) return;
    setStatsError(null);
    void (async () => {
      try {
        setStats(await getStats(userId));
      } catch (e) {
        setStatsError(e instanceof Error ? e.message : 'Failed to load stats');
      }
    })();
  }, [hasExpandedOnce, userId]);

  useEffect(() => {
    // offset is a dependency (unlike the stats effect above) so Previous/Next still refetches after the first expand.
    if (!hasExpandedOnce) return;
    setMatchesError(null);
    void (async () => {
      try {
        const page = await getMatches(userId, MATCHES_LIMIT, offset);
        setMatches(page.matches);

        // One batched lookup per page, not one call per row.
        const opponentIds = [...new Set(page.matches.map((m) => m.opponentId))];
        if (opponentIds.length === 0) {
          setUsernameMap(new Map());
        } else {
          try {
            setUsernameMap(await lookupUsernames(opponentIds));
          } catch {
            setUsernameMap(new Map()); // non-fatal: the table's fallback-to-raw-id path covers this too
          }
        }
      } catch (e) {
        setMatchesError(e instanceof Error ? e.message : 'Failed to load match history');
      }
    })();
  }, [hasExpandedOnce, userId, offset]);

  return (
    <div className="flex flex-col gap-3">
      {/* A real <button>, not a clickable div, so the disclosure stays keyboard- and screen-reader-accessible. */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls="profile-stats-panel"
        onClick={() => {
          setExpanded((e) => !e);
          setHasExpandedOnce(true);
        }}
        className="flex items-center gap-2 font-display text-fg text-sm uppercase tracking-widest self-start hover:text-primary transition-colors"
      >
        <svg
          viewBox="0 0 20 20"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-transform ${expanded ? 'rotate-90' : ''}`}
          aria-hidden="true"
        >
          <path d="M7 4l6 6-6 6" />
        </svg>
        Stats
      </button>
      {expanded && (
        // bg-surface, not bg-surface-raised, so this panel reads as a distinct content block rather than a form control.
        <div id="profile-stats-panel" className="flex flex-col gap-6 bg-surface border border-border p-6">
          {statsError !== null && (
            <p className="font-sans text-danger text-sm">{statsError}</p>
          )}
          {stats !== null && <StatsSummary stats={stats} />}

          {matchesError !== null && (
            <p className="font-sans text-danger text-sm">{matchesError}</p>
          )}
          <MatchHistoryTable
            matches={matches}
            usernameMap={usernameMap}
            offset={offset}
            onPrev={() => setOffset((o) => Math.max(0, o - MATCHES_LIMIT))}
            onNext={() => setOffset((o) => o + MATCHES_LIMIT)}
            canGoNext={matches.length === MATCHES_LIMIT}
          />
        </div>
      )}
    </div>
  );
}
