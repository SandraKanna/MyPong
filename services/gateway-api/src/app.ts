import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { authPlugin } from './plugins/auth.plugin.js';
import { authProxyRoutes } from './routes/auth.proxy.js';
import { userProxyRoutes } from './routes/user.proxy.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

// STUDY: Gateway body limit is 6 MB — slightly above user-service's 5 MB cap.
// The gateway buffers the entire raw multipart body before forwarding it, so
// it needs headroom for the multipart framing bytes (boundary, headers, CRLF)
// on top of the file payload. user-service enforces the real file size limit.
const MULTIPART_BODY_LIMIT = 6 * 1024 * 1024;

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { logger = process.env.NODE_ENV !== 'test' } = opts;
  const fastify = Fastify({ logger });

  fastify.get('/health', () => {
    return { status: 'ok' };
  });

  // STUDY: The gateway has no @fastify/multipart — it never parses form fields.
  // It only needs to buffer the raw bytes so user.proxy can forward them verbatim.
  // Without a registered parser for multipart/* Fastify v5 returns 415 before the
  // route handler runs. The custom parser is a dumb buffer: read chunks → concat →
  // done(null, buffer). The boundary and all framing bytes are preserved intact so
  // user-service can parse the form with its own @fastify/multipart instance.
  fastify.addContentTypeParser(
    /^multipart\/form-data/,
    { bodyLimit: MULTIPART_BODY_LIMIT },
    (_request, payload, done) => {
      const chunks: Buffer[] = [];
      payload.on('data', (chunk: Buffer) => { chunks.push(chunk); });
      payload.on('end', () => { done(null, Buffer.concat(chunks)); });
      payload.on('error', (err: Error) => { done(err); });
    },
  );

  // auth plugin must register before routes — decorateRequest runs at registration time
  await fastify.register(authPlugin);
  await fastify.register(authProxyRoutes);
  await fastify.register(userProxyRoutes);

  return fastify;
}
