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
    const message = await readErrorMessage(res, 'Credenciales inválidas');
    throw new Error(message);
  }

  // STUDY: The server currently only sends { accessToken } — the `user` field is
  // undefined at runtime. setAuth handles undefined gracefully (preserves existing
  // user state), so this is not a bug, but the type cast is optimistic.
  const { accessToken, user } = (await res.json()) as { accessToken: string; user: User };
  useAuthStore.getState().setAuth(accessToken, user);
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

// STUDY: register() intentionally does NOT log the user in. After a successful
// registration the caller navigates to /login — the user must authenticate
// explicitly. This keeps the flow simple and avoids a second round-trip for a
// token immediately after creating the account.
export async function register(email: string, password: string): Promise<void> {
  const res = await apiClient('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    const message = await readErrorMessage(res, 'No se pudo registrar');
    throw new Error(message);
  }
}
