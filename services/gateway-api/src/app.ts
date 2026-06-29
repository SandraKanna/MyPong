import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import { authPlugin } from './plugins/auth.plugin.js';
import { authProxyRoutes } from './routes/auth.proxy.js';
import { userProxyRoutes } from './routes/user.proxy.js';

interface BuildAppOptions {
  logger?: FastifyServerOptions['logger'];
}

// Avatar uploads are 5 MB max at user-service. The gateway buffers the raw
// multipart body to forward it, so its limit must be slightly larger.
const MULTIPART_BODY_LIMIT = 6 * 1024 * 1024;

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const { logger = process.env.NODE_ENV !== 'test' } = opts;
  const fastify = Fastify({ logger });

  fastify.get('/health', () => {
    return { status: 'ok' };
  });

  // Buffer multipart bodies as raw bytes so user.proxy can forward them unchanged.
  // The gateway has no @fastify/multipart — it never parses the form fields; it just
  // passes the opaque byte sequence (boundary and all) straight to user-service.
  // Without this parser Fastify v5 would return 415 Unsupported Media Type.
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
