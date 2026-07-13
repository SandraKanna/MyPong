import { z } from 'zod';
import { FastifyPluginCallback, FastifyReply } from 'fastify';
import * as authService from '../services/auth.service';
import {
  registerSchema,
  loginSchema,
} from '../schemas/auth.schemas';

// Actual runtime shape of z.treeifyError — Zod 4.4.3 types don't reflect this.
interface ZodTreeNode {
  errors: string[];
  properties?: Record<string, ZodTreeNode>;
}

// Adapts z.treeifyError (Zod v4) to the flat { field: string[] } shape
// that clients receive, so the API contract stays stable as Zod evolves.
function fieldErrors(error: z.ZodError): Record<string, string[]> {
  const tree = z.treeifyError(error) as unknown as ZodTreeNode;
  return Object.fromEntries(
    Object.entries(tree.properties ?? {}).map(([k, v]) => [k, v.errors ?? []])
  );
}

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Shared by /register and /login: both hand back a fresh access token in the
// body and a rotated refresh cookie — issuing an account should leave the
// caller logged in exactly the same way as authenticating into one.
async function issueSession(reply: FastifyReply, userId: number): Promise<{ accessToken: string }> {
  const accessToken = authService.generateAccessToken(userId);
  const { token: refreshToken, jti } = authService.generateRefreshToken(userId);
  await authService.saveRefreshToken(userId, jti, new Date(Date.now() + REFRESH_TOKEN_TTL_MS));

  reply.setCookie('refreshToken', refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge: 7 * 24 * 60 * 60,
  });

  return { accessToken };
}

export const authRoutes: FastifyPluginCallback = (fastify, _opts, done) => {

  fastify.post('/register', async (request, reply) => {
    const result = registerSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    const { email, password } = result.data;

    const existing = await authService.findUserByEmail(email);
    if (existing) {
      return reply.status(409).send({ error: 'Email already registered' });
    }

    const passwordHash = await authService.hashPassword(password);
    const user = await authService.createUser(email, passwordHash);

    const session = await issueSession(reply, user.id);
    return reply.status(201).send(session);
  });


  fastify.post('/login', async (request, reply) => {
    const result = loginSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    const { email, password } = result.data;

    const user = await authService.findUserByEmail(email);
    // Same message for "not found" and "wrong password" — prevents user enumeration
    if (!user || !(await authService.verifyPassword(user.password_hash, password))) {
      return reply.status(401).send({ error: 'Invalid credentials' });
    }

    // Enforces a single active session per account: any refresh token issued
    // by a previous login is revoked here, before the new one is issued below.
    // Only /login does this — /register has no prior session to revoke, and
    // /guest never issues a refresh token in the first place.
    await authService.revokeAllRefreshTokensForUser(user.id);

    const session = await issueSession(reply, user.id);
    return reply.send(session);
  });


  fastify.post('/refresh', async (request, reply) => {
    const token = request.cookies.refreshToken;
    if (!token) {
      return reply.status(401).send({ error: 'Missing refresh token' });
    }

    let payload: { userId: number; jti: string };
    try {
      payload = authService.verifyRefreshToken(token);
    } catch {
      return reply.status(401).send({ error: 'Invalid or expired refresh token' });
    }

    const tokenRow = await authService.findRefreshToken(payload.jti);
    if (!tokenRow || tokenRow.revoked_at !== null) {
      return reply.status(401).send({ error: 'Refresh token already revoked' });
    }

    // Rotate: revoke old token, issue new pair
    await authService.revokeRefreshToken(payload.jti);

    const accessToken = authService.generateAccessToken(payload.userId);
    const { token: refreshToken, jti: newJti } = authService.generateRefreshToken(payload.userId);
    await authService.saveRefreshToken(payload.userId, newJti, new Date(Date.now() + REFRESH_TOKEN_TTL_MS));

    reply.setCookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/api/auth',
      maxAge: 7 * 24 * 60 * 60,
    });
    return reply.send({ accessToken });
  });


  fastify.post('/guest', async (_request, reply) => {
    // No rate limiting: guest tokens are stateless and cheap to issue — same risk
    // posture as other unauthenticated endpoints in this portfolio-scale project.
    const accessToken = authService.generateGuestToken();
    return reply.send({ accessToken });
  });


  fastify.delete('/session', async (request, reply) => {
    const token = request.cookies.refreshToken;
    if (!token) {
      reply.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
      return reply.status(204).send();
    }

    let jti: string;
    try {
      ({ jti } = authService.verifyRefreshToken(token));
    } catch {
      // Token already expired or invalid — it can't be used anyway, treat as logged out
      reply.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
      return reply.status(204).send();
    }

    // Outside the catch: DB errors propagate and Fastify returns 500
    await authService.revokeRefreshToken(jti);
    reply.clearCookie('refreshToken', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/api/auth' });
    return reply.status(204).send();
  });

  done();
};
