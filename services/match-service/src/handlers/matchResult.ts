import type { MatchStatus } from '../services/match.service';

interface MatchResultPayload {
  matchId:   number;
  players:   Record<string, 'left' | 'right'>;
  winnerId:  number;
  score:     { left: number; right: number };
  status:    Exclude<MatchStatus, 'active'>;
  startedAt: string;
  endedAt:   string;
}

type CloseMatchFn = (
  id: number,
  update: {
    player1Score: number;
    player2Score: number;
    winnerId:     number;
    status:       Exclude<MatchStatus, 'active'>;
  },
) => Promise<unknown>;

type SendFn = (msg: object) => void;

export async function handleMatchResult(
  payload: unknown,
  closeMatchFn: CloseMatchFn,
  sendFn: SendFn,
): Promise<void> {
  const p = payload as MatchResultPayload | undefined;
  if (
    !p ||
    typeof p.matchId  !== 'number' ||
    typeof p.winnerId !== 'number' ||
    !p.score ||
    !p.status
  ) return;

  // player1 is always the left side: MatchmakingQueue enqueues first-queued as 'left'
  // and calls createMatch(leftUserId, rightUserId), so player1_id === left player.
  try {
    await closeMatchFn(p.matchId, {
      player1Score: p.score.left,
      player2Score: p.score.right,
      winnerId:     p.winnerId,
      status:       p.status,
    });
    sendFn({ type: 'user:matchRecorded', payload: p });
  } catch (err) {
    console.error('[match-service] closeMatch failed:', err);
  }
}
