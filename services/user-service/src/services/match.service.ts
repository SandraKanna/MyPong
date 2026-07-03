import { db } from '../db';

interface MatchResultPayload {
  matchId:   number;
  players:   Record<string, 'left' | 'right'>;
  winnerId:  number;
  score:     { left: number; right: number };
  status:    'completed' | 'forfeit';
  startedAt: string;
  endedAt:   string;
}

export async function recordMatchResult(payload: MatchResultPayload): Promise<void> {
  const { matchId, players, winnerId, score, status, endedAt } = payload;

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    for (const [userIdStr, side] of Object.entries(players)) {
      const userId     = Number(userIdStr);
      const result     = userId === winnerId ? 'win' : 'loss';
      const myScore    = side === 'left' ? score.left  : score.right;
      const oppScore   = side === 'left' ? score.right : score.left;
      const opponentId = Number(Object.keys(players).find((id) => id !== userIdStr)!);

      const { rowCount } = await client.query(
        `INSERT INTO user_match_history
           (user_id, match_id, opponent_id, result, my_score, opp_score, status, played_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (user_id, match_id) DO NOTHING`,
        [userId, matchId, opponentId, result, myScore, oppScore, status, endedAt],
      );

      if (rowCount === 1) {
        await client.query(
          `INSERT INTO user_stats (user_id, games_played, games_won, highest_score, updated_at)
           VALUES ($1, 1, $2, $3, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             games_played  = user_stats.games_played + 1,
             games_won     = user_stats.games_won + $2,
             highest_score = GREATEST(user_stats.highest_score, $3),
             updated_at    = NOW()`,
          [userId, result === 'win' ? 1 : 0, myScore],
        );
      }
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
