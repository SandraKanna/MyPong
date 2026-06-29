import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { userRoutes } from './routes/user.routes';

// Maximum avatar upload size enforced at the multipart layer before any disk I/O.
// 5 MB gives plenty of headroom for large source images while making single-request
// DoS implausible. Imported by tests to construct boundary payloads.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

export async function buildApp(): Promise<FastifyInstance> {
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  fastify.get('/health', async (_request, reply) => {
    return reply.status(200).send({ status: 'ok' });
  });

  await fastify.register(multipart, {
    limits: {
      files: 1,                    // reject requests with more than one file part
      fileSize: AVATAR_MAX_BYTES,
    },
  });

  await fastify.register(userRoutes);

  return fastify;
}
