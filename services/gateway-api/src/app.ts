import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { authPlugin } from './plugins/auth.plugin.js';
import { authProxyRoutes } from './routes/auth.proxy.js';
import { userProxyRoutes } from './routes/user.proxy.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { logger = process.env.NODE_ENV !== 'test' } = opts;
  const fastify = Fastify({ logger });

  fastify.get('/health', () => {
    return { status: 'ok' };
  });

  // auth plugin must register before routes — decorateRequest runs at registration time
  await fastify.register(authPlugin);
  await fastify.register(authProxyRoutes);
  await fastify.register(userProxyRoutes);

  return fastify;
}
