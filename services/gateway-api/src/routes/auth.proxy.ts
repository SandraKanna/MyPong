import { FastifyPluginCallback } from 'fastify';
import { config } from '../config.js';
import { proxyRequest } from '../lib/proxyRequest.js';

export const authProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.all('/api/auth/*', async (request, reply) => {
    const upstreamPath = request.url.replace('/api/auth', '');
    const upstreamUrl = config.AUTH_SERVICE_URL + upstreamPath;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await proxyRequest(upstreamUrl, {
        method: request.method,
        body: request.body,
        cookie: request.headers.cookie,
        userId: request.userId,
      });
    } catch (err) {
      request.log.error(
        { service: 'auth-service', url: upstreamUrl, err },
        'Upstream request failed',
      );
      return reply.code(502).send({ error: 'Auth service unavailable' });
    }

    const text = await upstreamResponse.text();
    reply.header('content-type', 'application/json');
    for (const cookie of upstreamResponse.headers.getSetCookie()) {
      reply.header('set-cookie', cookie);
    }
    return reply.code(upstreamResponse.status).send(text);
  });

  done();
};
