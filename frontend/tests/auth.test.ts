import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthStore } from '../src/features/auth/state/authState';
import { login, register } from '../src/features/auth/api/auth';

beforeEach(() => {
  vi.restoreAllMocks();
  useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null, isGuest: false });
});

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('login', () => {
  it('sets accessToken and status "authenticated" from the response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(200, { accessToken: 'tok-123' }));

    await login('test@example.com', 'password123');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('tok-123');
    expect(state.status).toBe('authenticated');
  });

  it('throws with the server error message and leaves the store unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(401, { error: 'Invalid credentials' }));

    await expect(login('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});

describe('register', () => {
  // Backend now returns the same { accessToken } shape as /login and sets the
  // same refresh cookie — registering should log the user in immediately,
  // exactly like login() does, instead of requiring a follow-up /login.
  it('sets accessToken and status "authenticated" from the response, same as login', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(201, { accessToken: 'tok-456' }));

    await register('new@example.com', 'password123');

    const state = useAuthStore.getState();
    expect(state.accessToken).toBe('tok-456');
    expect(state.status).toBe('authenticated');
  });

  it('throws with the server error message and leaves the store unauthenticated', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(409, { error: 'Email already registered' }));

    await expect(register('dup@example.com', 'password123')).rejects.toThrow('Email already registered');
    expect(useAuthStore.getState().status).toBe('unauthenticated');
  });
});
