import { z } from 'zod';
import { FastifyPluginAsync } from 'fastify';
import * as authService from '../services/auth.service';
import {
  registerSchema,
  loginSchema,
  refreshSchema,
  logoutSchema,
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

export const authRoutes: FastifyPluginAsync = async (fastify) => {

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

    return reply.status(201).send({ userId: user.id, email: user.email });
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

    const accessToken = authService.generateAccessToken(user.id);
    const { token: refreshToken, jti } = authService.generateRefreshToken(user.id);
    await authService.saveRefreshToken(user.id, jti, new Date(Date.now() + REFRESH_TOKEN_TTL_MS));

    return reply.send({ accessToken, refreshToken });
  });


  fastify.post('/refresh', async (request, reply) => {
    const result = refreshSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    let payload: { userId: number; jti: string };
    try {
      payload = authService.verifyRefreshToken(result.data.refreshToken);
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

    return reply.send({ accessToken, refreshToken });
  });


  fastify.delete('/session', async (request, reply) => {
    const result = logoutSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    let jti: string;
    try {
      ({ jti } = authService.verifyRefreshToken(result.data.refreshToken));
    } catch {
      // Token already expired or invalid — it can't be used anyway, treat as logged out
      return reply.status(204).send();
    }

    // Outside the catch: DB errors propagate and Fastify returns 500
    await authService.revokeRefreshToken(jti);
    return reply.status(204).send();
  });

};
