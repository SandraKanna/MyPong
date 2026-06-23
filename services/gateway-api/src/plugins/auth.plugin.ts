import { FastifyPluginCallback } from 'fastify';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

declare module 'fastify' {
  interface FastifyRequest {
    userId: string | null;
  }
}

const PUBLIC_ROUTES: ReadonlyArray<string> = [
  '/health',
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/refresh',
];

export const authPlugin: FastifyPluginCallback = (fastify, _opts, done) => {
  fastify.decorateRequest('userId', null);

  fastify.addHook('preHandler', (request, reply, next) => {
    if (PUBLIC_ROUTES.includes(request.routeOptions.url ?? '')) {
      next();
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);

    let payload: jwt.JwtPayload;
    try {
      const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
      if (typeof decoded === 'string' || decoded.type !== 'access') {
        return reply.code(401).send({ error: 'Invalid token' });
      }
      payload = decoded;
    } catch {
      return reply.code(401).send({ error: 'Invalid or expired token' });
    }

    request.userId = payload.sub ?? null;
    next();
  });

  done();
};
