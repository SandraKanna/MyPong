import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FastifyPluginCallback } from 'fastify';
import '@fastify/multipart'; // pulls in type augmentation for request.file()
import sharp from 'sharp';
import * as userService from '../services/user.service';
import { patchMeSchema } from '../schemas/user.schemas';
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

    // Buffer the upload. @fastify/multipart throws an error with statusCode 413
    // if the stream exceeds limits.fileSize before toBuffer() completes.
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

    // Re-encode to WebP via sharp. This also sanitises the file: the output is
    // generated from the decoded pixel bitmap, discarding any embedded metadata
    // or steganographic payloads in the original.
    const webpBuffer = await sharp(raw)
      .resize(512, 512, {
        fit: 'inside',          // preserve aspect ratio, neither side exceeds 512
        withoutEnlargement: true, // skip resize if both sides are already <= 512
      })
      .webp({ quality: 80 })
      .toBuffer();

    // Check profile exists BEFORE writing to disk. updateAvatarUrl is a plain UPDATE
    // that returns null when no row matches — we map that to 422 to enforce "set a
    // username first". Doing the DB write before the file write means a missing profile
    // never produces a dangling file on disk.
    const avatarUrl = `/avatars/${userId}.webp`;
    const profile = await userService.updateAvatarUrl(userId, avatarUrl);
    if (!profile) {
      return reply.status(422).send({ error: 'Profile not found — set a username first' });
    }

    // Filename is derived from the validated userId, never from the client-supplied
    // filename — this closes path traversal. Same name overwrites the previous avatar,
    // so cleanup is free by construction.
    const filePath = path.join(config.AVATARS_DIR, `${userId}.webp`);
    await fs.writeFile(filePath, webpBuffer);

    return reply.status(200).send({
      userId: profile.user_id,
      username: profile.username,
      avatar_url: profile.avatar_url,
    });
  });

  done();
};
