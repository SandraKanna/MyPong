import Fastify, { FastifyInstance } from 'fastify';
import { userRoutes } from './routes/user.routes';

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  await fastify.register(userRoutes);

  return fastify;
}
