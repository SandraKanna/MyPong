import Fastify, { FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import { authRoutes } from './routes/auth.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  await fastify.register(cookie);

  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  await fastify.register(authRoutes);

  return fastify;
}
