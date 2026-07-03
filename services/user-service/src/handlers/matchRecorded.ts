interface MatchResultPayload {
  matchId:   number;
  players:   Record<string, 'left' | 'right'>;
  winnerId:  number;
  score:     { left: number; right: number };
  status:    'completed' | 'forfeit';
  startedAt: string;
  endedAt:   string;
}

type RecordFn = (payload: MatchResultPayload) => Promise<void>;

export async function handleMatchRecorded(
  payload: unknown,
  recordFn: RecordFn,
): Promise<void> {
  const p = payload as MatchResultPayload | undefined;
  if (
    !p ||
    typeof p.matchId  !== 'number' ||
    typeof p.winnerId !== 'number' ||
    !p.score ||
    !p.status
  ) return;

  try {
    await recordFn(p);
  } catch (err) {
    console.error(`[user-service] recordMatchResult failed for matchId=${p.matchId}:`, err);
  }
}
