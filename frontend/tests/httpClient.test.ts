import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.resetModules() between tests resets the module-level refreshPromise in httpClient.
// All imports inside each test pick up fresh module instances.
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function makeResponse(status: number, body: unknown, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('apiClient — single-flight refresh', () => {
  it('two concurrent 401s trigger only one refresh call', async () => {
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { apiClient } = await import('../src/shared/api/httpClient');

    useAuthStore.setState({ accessToken: 'old-token', status: 'authenticated', user: null });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse(401, {}))                              // /api/data → 401
      .mockResolvedValueOnce(makeResponse(401, {}))                              // /api/other → 401
      .mockResolvedValueOnce(makeResponse(200, { accessToken: 'new-token' }))   // refresh
      .mockResolvedValue(makeResponse(200, {}));                                 // retries

    await Promise.all([
      apiClient('/api/data'),
      apiClient('/api/other'),
    ]);

    const refreshCalls = fetchMock.mock.calls.filter(
      ([url]) => url === '/api/auth/refresh',
    );
    expect(refreshCalls).toHaveLength(1);
  });
});

describe('apiClient — retry with new token', () => {
  it('retries with new Authorization header after successful refresh', async () => {
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { apiClient } = await import('../src/shared/api/httpClient');

    useAuthStore.setState({ accessToken: 'old-token', status: 'authenticated', user: null });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockImplementationOnce(() => Promise.resolve(makeResponse(401, {})))       // initial → 401
      .mockImplementationOnce(() => {                                              // refresh
        useAuthStore.getState().setAuth('new-token');
        return Promise.resolve(makeResponse(200, { accessToken: 'new-token' }));
      })
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));                    // retry

    const res = await apiClient('/api/protected');

    expect(res.status).toBe(200);
    const retryHeaders = fetchMock.mock.calls[2][1]?.headers as Headers;
    expect(retryHeaders.get('Authorization')).toBe('Bearer new-token');
  });
});

describe('apiClient — skip auth paths', () => {
  it('does not attempt refresh on 401 from /api/auth/login', async () => {
    const { apiClient } = await import('../src/shared/api/httpClient');

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(makeResponse(401, { error: 'invalid credentials' }));

    const res = await apiClient('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'wrong' }),
    });

    expect(res.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('apiClient — refresh failure', () => {
  it('returns the original 401 and calls clearAuth when refresh fails', async () => {
    const { useAuthStore } = await import('../src/features/auth/state/authState');
    const { apiClient } = await import('../src/shared/api/httpClient');

    useAuthStore.setState({ accessToken: 'expired-token', status: 'authenticated', user: null });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(makeResponse(401, {}))   // initial → 401
      .mockResolvedValueOnce(makeResponse(401, {}));  // refresh → 401

    const res = await apiClient('/api/protected');

    expect(res.status).toBe(401);
    expect(useAuthStore.getState().status).toBe('unauthenticated');
    expect(useAuthStore.getState().accessToken).toBeNull();
  });
});
