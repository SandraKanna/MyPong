import { apiClient } from '../../../shared/api/httpClient';
import { useAuthStore, User } from '../state/authState';

// STUDY: Private helper that tries to extract a human-readable message from any
// error response. The backend can send errors in three different shapes:
//   { details: { field: ['msg', ...] } }  — Zod validation errors (field-keyed)
//   { error: 'something' }                — most auth errors
//   { message: 'something' }              — fallback convention
// We check `details` first because it carries the most specific information.
// The outer try/catch handles responses that aren't JSON at all (e.g., nginx 502).
async function readErrorMessage(res: Response, defaultMessage: string): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: string;
      details?: Record<string, string[]>;
      message?: string;
    };

    if (body.details) {
      // STUDY: Object.values → flat() collapses { email: ['too short'], password: ['required'] }
      // into a single array ['too short', 'required'], then join puts them on separate lines.
      const messages = Object.values(body.details).flat();
      if (messages.length > 0) return messages.join('\n');
    }

    return body.error ?? body.message ?? defaultMessage;
  } catch {
    return defaultMessage;
  }
}

// STUDY: Shared by login() and register() — both endpoints return the exact
// same body shape ({ accessToken }, `user` currently always undefined at
// runtime) and both should leave the caller authenticated the same way.
// setAuth handles a missing `user` gracefully (preserves existing user state),
// so the type cast here is optimistic but not a bug.
function applyAuthResponse(body: { accessToken: string; user?: User }): void {
  useAuthStore.getState().setAuth(body.accessToken, body.user);
}

// STUDY: login() calls the API, then writes the result into Zustand immediately —
// no return value, no prop callbacks. Any component that reads useAuthStore will
// re-render automatically once status flips to 'authenticated'.
export async function login(email: string, password: string): Promise<void> {
  const res = await apiClient('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, 'Invalid credentials');
    throw new Error(message);
  }

  applyAuthResponse(await res.json() as { accessToken: string; user: User });
}

// STUDY: logout() clears local auth state unconditionally, even if the DELETE
// request fails. The important thing is that the user leaves the authenticated
// state on THIS device — the server-side token revocation is best-effort.
// If the server is unreachable the refresh token will just expire on its own.
export async function logout(): Promise<void> {
  try {
    await apiClient('/api/auth/session', { method: 'DELETE' });
  } catch (e) {
    console.error('logout request failed:', e);
  }
  useAuthStore.getState().clearAuth();
}

export async function loginAsGuest(): Promise<void> {
  const res = await apiClient('/api/auth/guest', { method: 'POST' });
  if (!res.ok) throw new Error('Could not start guest session');
  const { accessToken } = (await res.json()) as { accessToken: string };
  useAuthStore.getState().setGuestAuth(accessToken);
}

// STUDY: register() logs the user in immediately — the backend returns the same
// { accessToken } shape as /login and sets the same refresh cookie, so this
// reuses applyAuthResponse() rather than sending the user back to /login to
// authenticate a second time right after creating the account.
export async function register(email: string, password: string): Promise<void> {
  const res = await apiClient('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, 'Could not register');
    throw new Error(message);
  }

  applyAuthResponse(await res.json() as { accessToken: string; user: User });
}
