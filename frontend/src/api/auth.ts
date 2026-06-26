import { apiClient } from './httpClient';
import { useAuthStore, User } from '../state/authState';

async function readErrorMessage(res: Response, defaultMessage: string): Promise<string> {
  try {
    const body = (await res.json()) as {
      error?: string;
      details?: Record<string, string[]>;
      message?: string;
    };

    if (body.details) {
      const messages = Object.values(body.details).flat();
      if (messages.length > 0) return messages.join('\n');
    }

    return body.error ?? body.message ?? defaultMessage;
  } catch {
    return defaultMessage;
  }
}

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

  const { accessToken, user } = (await res.json()) as { accessToken: string; user: User };
  useAuthStore.getState().setAuth(accessToken, user);
}

export async function logout(): Promise<void> {
  try {
    await apiClient('/api/auth/session', { method: 'DELETE' });
  } catch (e) {
    console.error('logout request failed:', e);
  }
  useAuthStore.getState().clearAuth();
}

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
