import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { userRoutes } from './routes/user.routes';

// STUDY: 5 MB cap set here at the multipart layer, not inside the route handler.
// @fastify/multipart throws before any route code runs if the stream exceeds fileSize,
// so the handler never receives the bytes — single-request DoS is cut off at the
// earliest point. Exported so tests can construct payloads at exactly this boundary
// without hardcoding a magic number.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  await fastify.register(multipart, {
    limits: {
      // STUDY: files: 1 rejects multi-file requests immediately — a client can't
      // force the server to buffer many large parts by sending a malformed multipart.
      files: 1,
      fileSize: AVATAR_MAX_BYTES,
    },
  });

  await fastify.register(userRoutes);

  return fastify;
}
