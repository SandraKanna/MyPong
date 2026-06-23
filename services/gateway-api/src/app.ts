import Fastify, { FastifyInstance } from 'fastify';
import { authPlugin } from './plugins/auth.plugin.js';
import { authProxyRoutes } from './routes/auth.proxy.js';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  fastify.get('/health', async () => {
    return { status: 'ok' };
  });

  // auth plugin must register before routes — decorateRequest runs at registration time
  await fastify.register(authPlugin);
  await fastify.register(authProxyRoutes);

  return fastify;
}
