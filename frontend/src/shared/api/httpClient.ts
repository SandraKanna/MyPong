import { useAuthStore } from '../../features/auth/state/authState';

// STUDY: This module is the single point of contact between the frontend and
// the backend API. All authenticated fetch calls go through apiClient — never
// raw fetch() directly. This is where the access token is attached and where
// the 401→refresh→retry cycle is handled transparently for every caller.

let refreshPromise: Promise<boolean> | null = null;

// STUDY: Routes the frontend calls directly without a JWT (they are the routes
// that produce or restore a token, so they can't require one).
const AUTH_SKIP_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/guest',
];

async function refreshAccessToken(): Promise<boolean> {
  // Guest tokens are ephemeral and have no refresh cookie — skip entirely.
  // Guards both the race condition (loginAsGuest() resolves before the
  // bootstrap 401 arrives) and any future REST 401 during a guest session.
  if (useAuthStore.getState().isGuest) return false;
  try {
    // STUDY: credentials:'include' tells fetch to send the httpOnly cookie.
    // Without it, same-origin cookies are still sent in most browsers, but
    // being explicit is safer and documents the intent.
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      const { accessToken } = (await res.json()) as { accessToken: string };
      useAuthStore.getState().setAuth(accessToken);
      return true;
    }
    useAuthStore.getState().clearAuth();
    return false;
  } catch {
    useAuthStore.getState().clearAuth();
    return false;
  }
}

// STUDY: "single-flight" — only ONE real /refresh runs even if many calls hit
// a 401 at once. The first caller finds refreshPromise === null, kicks off the
// refresh, and stores that promise. Everyone after (2, 3, 50 callers) sees it's
// not null and just awaits the SAME promise — no extra requests. Once it's done,
// the variable resets to null so a later call can refresh again.
// Why it's safe without a lock: JS is single-threaded and only pauses at `await`.
// The null-check and the assignment run back-to-back with nothing slipping
// between them, so two callers can't both start a refresh. (In a multi-threaded
// language you'd need a real mutex here.) Without this, two refreshes would
// rotate the token twice and leave one caller holding a dead token.
export async function sharedRefresh(): Promise<boolean> {
  if (refreshPromise !== null) {
    return refreshPromise;
  }
  refreshPromise = refreshAccessToken();
  try {
    return await refreshPromise;
  } finally {
    refreshPromise = null;
  }
}

export async function apiClient(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  // STUDY: getState() reads the Zustand store outside of a React component.
  // Inside a component you'd use the useAuthStore hook; outside (in plain async
  // functions) you call getState() directly. Same store, different access pattern.
  const { accessToken } = useAuthStore.getState();

  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const res = await fetch(path, { ...options, headers });

  // STUDY: Only 401 triggers the refresh+retry cycle. Every other status (200,
  // 404, 409, 500…) is returned as-is to the caller, which decides what to do.
  // This keeps apiClient free of business logic.
  if (res.status !== 401) {
    return res;
  }

  // STUDY: Auth endpoints that return 401 for wrong credentials must not trigger
  // a refresh — a bad password is not a session expiry. The skip list prevents
  // an infinite loop: /refresh returning 401 would otherwise retry /refresh.
  if (AUTH_SKIP_PATHS.some((p) => path.startsWith(p))) {
    return res;
  }

  const refreshed = await sharedRefresh();

  if (!refreshed) {
    return res;
  }

  // Retry once with the new token
  const newToken = useAuthStore.getState().accessToken;
  const retryHeaders = new Headers(options?.headers);
  if (newToken) {
    retryHeaders.set('Authorization', `Bearer ${newToken}`);
  }

  return fetch(path, { ...options, headers: retryHeaders });
}
