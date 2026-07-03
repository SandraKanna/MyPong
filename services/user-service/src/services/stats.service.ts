import { db } from '../db';

export interface UserStats {
  userId:       number;
  gamesPlayed:  number;
  gamesWon:     number;
  highestScore: number;
  winRate:      number;
}

export interface MatchHistoryEntry {
  matchId:    number;
  opponentId: number;
  result:     'win' | 'loss';
  myScore:    number;
  oppScore:   number;
  status:     string;
  playedAt:   string;
}

export async function getStats(userId: number): Promise<UserStats> {
  const { rows } = await db.query<{
    games_played:  number;
    games_won:     number;
    highest_score: number;
  }>(
    'SELECT games_played, games_won, highest_score FROM user_stats WHERE user_id = $1',
    [userId],
  );

  if (rows.length === 0) {
    return { userId, gamesPlayed: 0, gamesWon: 0, highestScore: 0, winRate: 0 };
  }

  const { games_played, games_won, highest_score } = rows[0];
  const winRate = games_played > 0
    ? Math.round((games_won / games_played) * 10000) / 10000
    : 0;

  return { userId, gamesPlayed: games_played, gamesWon: games_won, highestScore: highest_score, winRate };
}

export async function getMatchHistory(
  userId: number,
  limit: number,
  offset: number,
): Promise<MatchHistoryEntry[]> {
  const { rows } = await db.query<{
    match_id:    number;
    opponent_id: number;
    result:      'win' | 'loss';
    my_score:    number;
    opp_score:   number;
    status:      string;
    played_at:   Date;
  }>(
    `SELECT match_id, opponent_id, result, my_score, opp_score, status, played_at
     FROM user_match_history
     WHERE user_id = $1
     ORDER BY played_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );

  return rows.map((r) => ({
    matchId:    r.match_id,
    opponentId: r.opponent_id,
    result:     r.result,
    myScore:    r.my_score,
    oppScore:   r.opp_score,
    status:     r.status,
    playedAt:   r.played_at.toISOString(),
  }));
}
