import { FastifyPluginCallback } from 'fastify';
import { config } from '../config.js';
import { proxyRequest } from '../lib/proxyRequest.js';

export const userProxyRoutes: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.all('/api/users/*', async (request, reply) => {
    const upstreamPath = request.url.replace('/api/users', '');
    const upstreamUrl = config.USER_SERVICE_URL + upstreamPath;

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
