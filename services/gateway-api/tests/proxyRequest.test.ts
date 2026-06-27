import { describe, it, expect, vi, beforeEach } from 'vitest';
import { proxyRequest } from '../src/lib/proxyRequest';

const UPSTREAM_URL = 'http://upstream:4001/resource';

function mockFetch(status = 200, body = '{}') {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
    new Response(body, { status }),
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

function headers(spy: ReturnType<typeof vi.spyOn>): Record<string, string> {
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

// ── x-user-id injection ───────────────────────────────────────────────────────

describe('proxyRequest — x-user-id header', () => {
  it('includes x-user-id when userId is a non-null string', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'GET', body: null, cookie: undefined, userId: '42' });
    expect(headers(spy)['x-user-id']).toBe('42');
  });

  it('omits x-user-id when userId is null', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'GET', body: null, cookie: undefined, userId: null });
    expect(headers(spy)['x-user-id']).toBeUndefined();
  });
});

// ── content-type and body ─────────────────────────────────────────────────────

describe('proxyRequest — content-type and body', () => {
  it('sets content-type and serialises body when body is non-null', async () => {
    const spy = mockFetch(201, '{"id":1}');
    const body = { email: 'a@b.com', password: 'pass' };
    await proxyRequest(UPSTREAM_URL, { method: 'POST', body, cookie: undefined, userId: null });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(headers(spy)['content-type']).toBe('application/json');
    expect(init.body).toBe(JSON.stringify(body));
  });

  it('omits content-type and body when body is null', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'DELETE', body: null, cookie: undefined, userId: null });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(headers(spy)['content-type']).toBeUndefined();
    expect(init.body).toBeUndefined();
  });
});

// ── cookie forwarding ─────────────────────────────────────────────────────────

describe('proxyRequest — cookie forwarding', () => {
  it('forwards cookie header when present', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'POST', body: null, cookie: 'refreshToken=abc', userId: null });
    expect(headers(spy).cookie).toBe('refreshToken=abc');
  });

  it('omits cookie header when undefined', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'GET', body: null, cookie: undefined, userId: null });
    expect(headers(spy).cookie).toBeUndefined();
  });
});

// ── URL and method ────────────────────────────────────────────────────────────

describe('proxyRequest — URL and method', () => {
  it('calls fetch with the exact URL and method provided', async () => {
    const spy = mockFetch();
    await proxyRequest(UPSTREAM_URL, { method: 'PATCH', body: null, cookie: undefined, userId: null });
    const [calledUrl, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(UPSTREAM_URL);
    expect(init.method).toBe('PATCH');
  });
});
