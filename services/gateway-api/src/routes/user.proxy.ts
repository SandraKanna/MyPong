import { FastifyPluginCallback, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';
import { proxyRequest } from '../lib/proxyRequest.js';

// STUDY: Fastify's wildcard ('/api/users/*') only matches paths with at least
// one segment after the trailing slash — a bare '/api/users?ids=1,2,3' (no
// trailing slash, no extra segment) 404s before ever reaching this handler.
// Registered on both the exact path and the wildcard so collection-level
// endpoints (no path segment beyond the base) work the same as per-resource
// ones. USER_SERVICE_URL has no trailing slash, so on the exact-path route
// upstreamPath is just the query string (or ''); concatenating that directly
// still produces a valid URL — new URL() normalises the empty path to '/'.
async function proxyToUserService(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const upstreamPath = request.url.replace('/api/users', '');
  const upstreamUrl = config.USER_SERVICE_URL + upstreamPath;

  // STUDY: request.body is typed as unknown and can be either a Buffer (multipart,
  // buffered by the custom parser in app.ts) or a parsed object (JSON, handled by
  // Fastify's built-in parser). We detect which by checking the Content-Type header
  // and route to the appropriate proxyRequest code path. Checking the header rather
  // than instanceof Buffer keeps the type narrowing explicit and avoids relying on
  // Buffer being the only non-object body shape that could appear here.
  const contentType = request.headers['content-type'] ?? '';
  const isMultipart = contentType.startsWith('multipart/form-data');

  let upstreamResponse: Response;
  try {
    upstreamResponse = await proxyRequest(upstreamUrl, {
      method: request.method,
      body: isMultipart ? null : request.body,
      rawBody: isMultipart ? (request.body as Buffer) : undefined,
      rawContentType: isMultipart ? contentType : undefined,
      cookie: request.headers.cookie,
      userId: request.userId,
    });
  } catch (err) {
    request.log.error(
      { service: 'user-service', url: upstreamUrl, err },
      'Upstream request failed',
    );
    return reply.code(502).send({ error: 'User service unavailable' });
  }

  const text = await upstreamResponse.text();
  reply.header('content-type', 'application/json');
  await reply.code(upstreamResponse.status).send(text);
}

export const userProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.all('/api/users', proxyToUserService);
  fastify.all('/api/users/*', proxyToUserService);

  done();
};
