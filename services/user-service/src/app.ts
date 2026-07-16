import Fastify, { FastifyInstance } from 'fastify';
import multipart from '@fastify/multipart';
import { userRoutes } from './routes/user.routes';

// STUDY: 5 MB cap set here at the multipart layer, not inside the route handler.
// @fastify/multipart throws before any route code runs if the stream exceeds fileSize,
// so the handler never receives the bytes — single-request DoS is cut off at the
// earliest point. Exported so tests can construct payloads at exactly this boundary
// without hardcoding a magic number.
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;

interface BuildAppOptions {
  // Reports the internalClient's live WS connection to gateway-ws. A
  // container that can serve HTTP but has lost that connection can't
  // receive user:matchRecorded — /health folds both signals into one
  // check rather than reporting HTTP liveness alone. Defaults to always
  // connected so tests and any other caller without a real WS client
  // get plain HTTP-liveness behavior, unchanged from before this option existed.
  getWsConnected?: () => boolean;
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { getWsConnected = () => true } = opts;
  const fastify = Fastify({ logger: process.env.NODE_ENV !== 'test' });

  fastify.get('/health', async (_request, reply) => {
    const wsConnected = getWsConnected();
    return reply
      .status(wsConnected ? 200 : 503)
      .send({ status: wsConnected ? 'ok' : 'degraded', wsConnected });
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
