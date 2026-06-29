export interface ProxyOptions {
  method: string;
  // For JSON bodies (most routes): set body, leave rawBody/rawContentType unset.
  body: unknown;
  // For multipart bodies: set rawBody + rawContentType, leave body null/undefined.
  // rawContentType must include the boundary parameter so the upstream can parse it.
  rawBody?: Buffer;
  rawContentType?: string;
  cookie: string | undefined;
  userId: string | null;
}

export async function proxyRequest(url: string, opts: ProxyOptions): Promise<Response> {
  const isRaw = opts.rawBody !== undefined;
  return fetch(url, {
    method: opts.method,
    headers: {
      // Raw path: forward original content-type verbatim (boundary included).
      // JSON path: set application/json only when there is a body to stringify.
      ...(isRaw
        ? { 'content-type': opts.rawContentType! }
        : opts.body != null
          ? { 'content-type': 'application/json' }
          : {}),
      ...(opts.cookie          ? { cookie: opts.cookie }       : {}),
      ...(opts.userId !== null ? { 'x-user-id': opts.userId }  : {}),
    },
    body: isRaw ? opts.rawBody : opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
}
