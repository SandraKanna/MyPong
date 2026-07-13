import { db } from '../db';

export interface UserProfile {
  user_id: number;
  username: string | null;
  avatar_url: string | null;
}

export async function findProfile(userId: number): Promise<UserProfile | null> {
  const { rows } = await db.query<UserProfile>(
    'SELECT * FROM user_profiles WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

// STUDY: ids with no matching row (unknown user, or a user with no profile
// row yet) are simply absent from the result — ANY($1) is a plain WHERE
// filter, not a per-id lookup, so there's nothing to "not find" and map to
// null. The caller doesn't need to reconcile the input list against the
// output; it just uses whatever rows come back.
export async function findProfilesByIds(ids: number[]): Promise<UserProfile[]> {
  const { rows } = await db.query<UserProfile>(
    'SELECT * FROM user_profiles WHERE user_id = ANY($1) AND username IS NOT NULL',
    [ids],
  );
  return rows;
}

// INSERT ... ON CONFLICT (user_id) handles both first-time creation and updates.
// If the username UNIQUE constraint fires (a different user already has it),
// Postgres throws error code 23505 — the route handler catches it and returns 409.
export async function upsertProfile(userId: number, username: string): Promise<UserProfile> {
  const { rows } = await db.query<UserProfile>(
    `INSERT INTO user_profiles (user_id, username)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET username = EXCLUDED.username
     RETURNING *`,
    [userId, username],
  );
  return rows[0];
}

// STUDY: Plain UPDATE — intentionally not an upsert. Returning null when no row
// matches lets the route map that to 422 ("set a username first"). This enforces
// the invariant that profile rows are only created by PATCH /me, never by avatar
// upload — which prevents a user from ever reaching a state where username is null
// but avatar_url is set (a state the frontend's discriminated union assumes impossible).
export async function updateAvatarUrl(userId: number, avatarUrl: string): Promise<UserProfile | null> {
  const { rows, rowCount } = await db.query<UserProfile>(
    `UPDATE user_profiles SET avatar_url = $1 WHERE user_id = $2 RETURNING *`,
    [avatarUrl, userId],
  );
  if (!rowCount) return null;
  return rows[0];
}
