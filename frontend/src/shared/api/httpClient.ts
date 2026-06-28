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
];

async function refreshAccessToken(): Promise<boolean> {
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

// STUDY: sharedRefresh deduplicates concurrent refresh calls. If two components
// both get a 401 at the same time, the second call sees the in-flight promise
// and joins it rather than firing a second /refresh request. This prevents the
// refresh token from being consumed and rotated twice (which would invalidate
// the first caller's new token).
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
