import { apiClient } from '../../../shared/api/httpClient';

export interface UserProfile {
  userId: number;
  username: string;
  avatar_url: string | null;
}

// STUDY: getProfile returns null (not throws) for 404. The caller treats "no
// profile yet" as a valid state (first-time setup), not an error. Any other
// non-OK status IS an error, so it throws. This two-value return type forces
// the caller to handle both cases explicitly — a discriminated null.
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
