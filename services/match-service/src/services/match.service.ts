import { db } from '../db';

// Raw row as returned by Postgres — snake_case column names, private to this module.
interface MatchRowSql {
  id: number;
  player1_id: number;
  player2_id: number;
  player1_score: number | null;
  player2_score: number | null;
  winner_id: number | null;
  status: string;
  created_at: Date;
  closed_at: Date | null;
}

// Mapped form consumed by the rest of the application — camelCase, exported.
export interface MatchRowTs {
  id: number;
  player1Id: number;
  player2Id: number;
  player1Score: number | null;
  player2Score: number | null;
  winnerId: number | null;
  status: MatchStatus;
  createdAt: Date;
  closedAt: Date | null;
}

export type MatchStatus = 'active' | 'completed' | 'forfeit';

function toMatchRowTs(raw: MatchRowSql): MatchRowTs {
  return {
    id:           raw.id,
    player1Id:    raw.player1_id,
    player2Id:    raw.player2_id,
    player1Score: raw.player1_score,
    player2Score: raw.player2_score,
    winnerId:     raw.winner_id,
    status:       raw.status as MatchStatus,
    createdAt:    raw.created_at,
    closedAt:     raw.closed_at,
  };
}

export async function createMatch(
  player1Id: number,
  player2Id: number,
): Promise<MatchRowTs> {
  const { rows } = await db.query<MatchRowSql>(
    'INSERT INTO match (player1_id, player2_id) VALUES ($1, $2) RETURNING *',
    [player1Id, player2Id],
  );
  return toMatchRowTs(rows[0]);
}

export async function findActiveMatchForUser(userId: number): Promise<MatchRowTs | null> {
  const { rows } = await db.query<MatchRowSql>(
    `SELECT * FROM match WHERE status = 'active' AND (player1_id = $1 OR player2_id = $1) LIMIT 1`,
    [userId],
  );
  return rows.length > 0 ? toMatchRowTs(rows[0]) : null;
}

export async function closeMatch(
  id: number,
  update: {
    player1Score: number;
    player2Score: number;
    winnerId: number;
    status: Exclude<MatchStatus, 'active'>;
  },
): Promise<MatchRowTs | null> {
  const { rows, rowCount } = await db.query<MatchRowSql>(
    `UPDATE match
     SET player1_score = $2,
         player2_score = $3,
         winner_id     = $4,
         status        = $5,
         closed_at     = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, update.player1Score, update.player2Score, update.winnerId, update.status],
  );
  if (!rowCount) return null;
  return toMatchRowTs(rows[0]);
}
