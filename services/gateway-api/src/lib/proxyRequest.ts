export interface ProxyOptions {
  method: string;
  body: unknown;
  cookie: string | undefined;
  // x-user-id has no downstream consumer yet — will be read by user-service in Phase 2 PR 3.
  userId: string | null;
}

export async function proxyRequest(url: string, opts: ProxyOptions): Promise<Response> {
  return fetch(url, {
    method: opts.method,
    headers: {
      ...(opts.body != null    ? { 'content-type': 'application/json' } : {}),
      ...(opts.cookie          ? { cookie: opts.cookie }                 : {}),
      ...(opts.userId !== null ? { 'x-user-id': opts.userId }           : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
}
