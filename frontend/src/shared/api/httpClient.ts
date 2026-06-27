import { useAuthStore } from '../../features/auth/state/authState';

let refreshPromise: Promise<boolean> | null = null;

const AUTH_SKIP_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
];

async function refreshAccessToken(): Promise<boolean> {
  try {
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
  const { accessToken } = useAuthStore.getState();

  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status !== 401) {
    return res;
  }

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
