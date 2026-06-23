import { FastifyPluginCallback } from 'fastify';
import { config } from '../config.js';

export const authProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.all('/api/auth/*', async (request, reply) => {
    const upstreamPath = request.url.replace('/api/auth', '');
    const upstreamUrl = config.AUTH_SERVICE_URL + upstreamPath;

    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
        },
        body: request.body != null ? JSON.stringify(request.body) : undefined,
      });
    } catch (err) {
      request.log.error(
        { service: 'auth-service', url: upstreamUrl, err },
        'Upstream request failed',
      );
      return reply.code(502).send({ error: 'Auth service unavailable' });
    }

    const text = await upstreamResponse.text();
    return reply
      .code(upstreamResponse.status)
      .header('content-type', 'application/json')
      .send(text);
  });

  done();
};
