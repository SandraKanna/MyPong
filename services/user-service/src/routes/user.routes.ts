import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyPluginCallback } from 'fastify';
import '@fastify/multipart'; // pulls in type augmentation for request.file()
import sharp from 'sharp';
import * as userService from '../services/user.service';
import * as statsService from '../services/stats.service';
import { patchMeSchema, userLookupQuerySchema } from '../schemas/user.schemas';
import { getUserId } from '../lib/getUserId';
import { detectImageType } from '../lib/detectImageType';
import { config } from '../config';

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

  // STUDY: Registered at the root ('/'), the same no-prefix style as every
  // other route in this plugin — gateway-api strips '/api/users' before
  // proxying. No conflict with '/:id/stats' or '/:id/matches' below: those
  // require a literal segment after the id, this route has zero segments.
  fastify.get('/', async (request, reply) => {
    const callerId = getUserId(request);
    if (callerId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const result = userLookupQuerySchema.safeParse(request.query);
    if (!result.success) {
      return reply.status(400).send({ error: 'Invalid input', details: fieldErrors(result.error) });
    }

    const profiles = await userService.findProfilesByIds(result.data.ids);
    return reply.status(200).send({
      users: profiles.map((profile) => ({
        userId: profile.user_id,
        username: profile.username,
        avatar_url: profile.avatar_url,
      })),
    });
  });

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

  fastify.post('/me/avatar', async (request, reply) => {
    const userId = getUserId(request);
    if (userId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const data = await request.file();
    if (!data) {
      return reply.status(400).send({ error: 'No file provided' });
    }

    // STUDY: @fastify/multipart signals a size limit breach by throwing an error
    // with a statusCode property (not an instanceof a named class). We cast to
    // { statusCode?: number } instead of checking instanceof so we don't depend
    // on the library's internal error class — a structural check is more robust.
    let raw: Buffer;
    try {
      raw = await data.toBuffer();
    } catch (err) {
      if ((err as { statusCode?: number }).statusCode === 413) {
        return reply.status(413).send({ error: 'File too large (max 5 MB)' });
      }
      throw err;
    }

    // Validate by magic bytes — client-supplied MIME type and filename are ignored.
    const imageType = detectImageType(raw);
    if (imageType === null) {
      return reply.status(400).send({ error: 'Unsupported image type — accepted: JPEG, PNG, WebP, GIF' });
    }

    // STUDY: Re-encoding via sharp is security sanitization, not just format
    // conversion. sharp decodes the input to a raw pixel bitmap, then encodes
    // a fresh WebP from those pixels. The output contains nothing from the
    // original file except color data — EXIF, ICC profiles, XMP, comment blocks,
    // and any steganographic payloads are discarded by construction.
    const webpBuffer = await sharp(raw)
      .resize(512, 512, {
        fit: 'inside',          // preserve aspect ratio, neither side exceeds 512
        withoutEnlargement: true, // skip resize if both sides are already <= 512
      })
      .webp({ quality: 80 })
      .toBuffer();

    // STUDY: DB write before file write — not the other way around. If we wrote the
    // file first and then found no profile row, we'd have a file on disk with no DB
    // record pointing to it (a dangling file). Checking the DB first means that on
    // any early return (422 or upstream error) the disk is untouched.
    const avatarUrl = `/avatars/${userId}.webp`;
    const profile = await userService.updateAvatarUrl(userId, avatarUrl);
    if (!profile) {
      return reply.status(422).send({ error: 'Profile not found — set a username first' });
    }

    // STUDY: Filename derived from userId (server-controlled), never from the
    // client-supplied filename — this closes path traversal. A client can't send
    // filename="../../etc/passwd" and expect the server to honor it. The fixed
    // pattern ({userId}.webp) also makes cleanup free: uploading a new avatar
    // overwrites the old file by construction, no orphan cleanup needed.
    const filePath = path.join(config.AVATARS_DIR, `${userId}.webp`);
    await fs.writeFile(filePath, webpBuffer);

    return reply.status(200).send({
      userId: profile.user_id,
      username: profile.username,
      avatar_url: profile.avatar_url,
    });
  });

  fastify.get('/:id/stats', async (request, reply) => {
    const callerId = getUserId(request);
    if (callerId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const { id: rawId } = request.params as { id: string };
    const targetId = Number(rawId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return reply.status(400).send({ error: 'Invalid user id' });
    }

    const stats = await statsService.getStats(targetId);
    return reply.status(200).send(stats);
  });

  fastify.get('/:id/matches', async (request, reply) => {
    const callerId = getUserId(request);
    if (callerId === null) {
      return reply.status(401).send({ error: 'Missing or invalid user identity' });
    }

    const { id: rawId } = request.params as { id: string };
    const targetId = Number(rawId);
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return reply.status(400).send({ error: 'Invalid user id' });
    }

    const rawQuery = request.query as Record<string, string | undefined>;
    const limit  = Number(rawQuery.limit  ?? '20');
    const offset = Number(rawQuery.offset ?? '0');

    if (!Number.isInteger(limit)  || limit  < 1) return reply.status(400).send({ error: 'limit must be a positive integer' });
    if (!Number.isInteger(offset) || offset < 0)  return reply.status(400).send({ error: 'offset must be a non-negative integer' });
    if (limit > 50) return reply.status(400).send({ error: 'limit must not exceed 50' });

    const matches = await statsService.getMatchHistory(targetId, limit, offset);
    return reply.status(200).send({ userId: targetId, matches, limit, offset });
  });

  done();
};
