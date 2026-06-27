import { z } from 'zod';
import { FastifyPluginCallback } from 'fastify';
import * as userService from '../services/user.service';
import { patchMeSchema } from '../schemas/user.schemas';
import { getUserId } from '../lib/getUserId';

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
    Object.entries(tree.properties ?? {}).map(([k, v]) => [k, v.errors ?? []]),
  );
}

export const userRoutes: FastifyPluginCallback = (fastify, _opts, done) => {

  fastify.get('/me', async (request, reply) => {
    const userId = getUserId(request);
    if (userId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const profile = await userService.findProfile(userId);
    if (!profile) {
      return reply.status(404).send({ error: 'Profile not found' });
    }

    return reply.status(200).send({
      userId: profile.user_id,
      username: profile.username,
      avatar_url: profile.avatar_url,
    });
  });

  fastify.patch('/me', async (request, reply) => {
    const userId = getUserId(request);
    if (userId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const result = patchMeSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    const { username } = result.data;

    try {
      const profile = await userService.upsertProfile(userId, username);
      return reply.status(200).send({
        userId: profile.user_id,
        username: profile.username,
        avatar_url: profile.avatar_url,
      });
    } catch (err) {
      // Unlike auth-service's find-then-check pattern for email uniqueness,
      // here we let Postgres enforce the constraint atomically. The race window
      // in find-then-check is small but real; for usernames, capturing 23505
      // is the correct approach.
      if ((err as { code?: string }).code === '23505') {
        return reply.status(409).send({ error: 'Username already taken' });
      }
      throw err;
    }
  });

  done();
};
