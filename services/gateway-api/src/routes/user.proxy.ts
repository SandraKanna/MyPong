import { FastifyPluginCallback } from 'fastify';
import { config } from '../config.js';
import { proxyRequest } from '../lib/proxyRequest.js';

export const userProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.all('/api/users/*', async (request, reply) => {
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
    return reply.code(upstreamResponse.status).send(text);
  });

  done();
};
