import { apiClient } from '../../../shared/api/httpClient';

export interface UserProfile {
  userId: number;
  username: string;
  avatar_url: string | null;
}

// STUDY: winRate is a raw ratio (0-1, 4 decimals) — the backend explicitly
// leaves percentage formatting to the frontend. Left as-is here; the display
// component decides how to present it.
export interface UserStats {
  userId: number;
  gamesPlayed: number;
  gamesWon: number;
  highestScore: number;
  winRate: number;
}

// STUDY: status stays a plain string, not 'completed' | 'forfeit' — that
// union would be a promise this code can't back up. The DB column is plain
// text with no CHECK constraint, and nothing here validates it on read.
// A narrower type would make TypeScript wrongly assume only two values
// are possible (e.g. an exhaustive switch with just two branches) — if
// a third value ever landed in that column, the type system would hide
// it instead of catching it.
export interface MatchHistoryEntry {
  matchId: number;
  opponentId: number;
  result: 'win' | 'loss';
  myScore: number;
  oppScore: number;
  status: string;
  playedAt: string;
}

export interface MatchHistoryPage {
  userId: number;
  matches: MatchHistoryEntry[];
  limit: number;
  offset: number;
}

// STUDY: getProfile returns null (not throws) for 404. The caller treats "no
// profile yet" as a valid state (first-time setup), not an error. Any other
// non-OK status IS an error, so it throws. The return type is written as
// "UserProfile or null", and TypeScript enforces that everywhere this
// function is called: code that tries to read e.g. `.username` off the
// result won't compile unless it first checks the value isn't null. That
// makes the "no profile yet" case impossible to forget by accident — the
// compiler blocks it, rather than the mistake only surfacing later as a
// runtime crash on a missing field.
export async function getProfile(): Promise<UserProfile | null> {
  const res = await apiClient('/api/users/me');
  if (res.status === 404) return null;
  if (!res.ok) {
    // STUDY: .catch(() => ({})) makes the JSON parse safe — if the error body
    // is not valid JSON (e.g., an nginx HTML error page) we still get an object
    // we can safely destructure. Without it, a malformed body would throw and
    // obscure the original error with a JSON parse error.
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to load profile');
  }
  return res.json() as Promise<UserProfile>;
}

// STUDY: patchProfile returns the server's version of the saved profile, not
// the input. The caller uses the response to update state — the server is the
// source of truth (it may normalize the username or fill in defaults).
export async function patchProfile(username: string): Promise<UserProfile> {
  const res = await apiClient('/api/users/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to save profile');
  }
  return res.json() as Promise<UserProfile>;
}

// STUDY: FormData + fetch (via apiClient) — do NOT set Content-Type manually.
// When you pass FormData as the body, the browser automatically sets
// Content-Type: multipart/form-data; boundary=<generated-boundary>.
// If you set it manually you omit the boundary, and the server can't parse
// the body (it won't know where one part ends and the next begins).
export async function uploadAvatar(file: File): Promise<UserProfile> {
  const form = new FormData();
  form.append('file', file);
  const res = await apiClient('/api/users/me/avatar', {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to upload avatar');
  }
  return res.json() as Promise<UserProfile>;
}

export async function getStats(userId: number): Promise<UserStats> {
  const res = await apiClient(`/api/users/${userId.toString()}/stats`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to load stats');
  }
  return res.json() as Promise<UserStats>;
}

export async function getMatches(
  userId: number,
  limit = 20,
  offset = 0,
): Promise<MatchHistoryPage> {
  const res = await apiClient(
    `/api/users/${userId.toString()}/matches?limit=${limit.toString()}&offset=${offset.toString()}`,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to load match history');
  }
  return res.json() as Promise<MatchHistoryPage>;
}

// STUDY: Returns a Map — think of it like a two-column lookup table, id in
// one column and username in the other, built once here so callers don't
// have to. Without it, every caller wanting a username for a given id would
// have to loop over the raw { users: [...] } array checking each entry's id
// — call that N times for N lookups and it's an O(N²) linear scan repeated
// per row. A Map instead does the lookup in one step (`map.get(id)`), and an
// id the backend silently omitted (no profile row, not an error) just isn't
// present as a key — callers check for that with `?? fallback`, no special
// "not found" error handling required.
export async function lookupUsernames(ids: number[]): Promise<Map<number, string>> {
  const res = await apiClient(`/api/users?ids=${ids.join(',')}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? 'Failed to look up usernames');
  }
  const { users } = (await res.json()) as { users: UserProfile[] };
  return new Map(users.map((u) => [u.userId, u.username]));
}
