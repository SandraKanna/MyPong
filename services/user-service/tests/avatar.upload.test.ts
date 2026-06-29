import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { QueryResult } from 'pg';

// Mocks are hoisted before imports by Vitest.

vi.mock('../src/config', () => ({
  config: {
    PORT: 4002,
    DATABASE_URL: 'postgresql://test',
    AVATARS_DIR: '/tmp/test-avatars',
  },
}));

vi.mock('../src/db', () => ({
  db: { query: vi.fn() },
}));

vi.mock('sharp', () => ({
  default: vi.fn(() => ({
    resize: vi.fn().mockReturnThis(),
    webp: vi.fn().mockReturnThis(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-webp-output')),
  })),
}));

vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

import { buildApp, AVATAR_MAX_BYTES } from '../src/app';
import { db } from '../src/db';

const mockQuery = vi.mocked(db.query);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Magic bytes for each supported format, padded to >= 12 bytes (the minimum
// length detectImageType requires before attempting any magic byte checks).
const MAGIC = {
  jpeg: Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]), Buffer.alloc(6)]),
  png:  Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(4)]),
  webp: Buffer.concat([
    Buffer.from('RIFF', 'ascii'),
    Buffer.alloc(4),              // file size (unused in detection)
    Buffer.from('WEBP', 'ascii'), // total = 12 bytes, exactly at the minimum
  ]),
  gif: Buffer.concat([Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), Buffer.alloc(6)]), // GIF89a
};

function makeMultipartBody(data: Buffer, filename: string, boundary: string): Buffer {
  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n` +
    `\r\n`,
  );
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
  return Buffer.concat([header, data, footer]);
}

function rows<T>(data: T[]): QueryResult<T> {
  return { rows: data, rowCount: data.length, command: '', oid: 0, fields: [] };
}

const MOCK_PROFILE = {
  user_id: 1,
  username: 'testuser',
  avatar_url: '/avatars/1.webp',
};

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('POST /me/avatar', () => {
  let app: FastifyInstance;
  const boundary = 'test-boundary-abc123';

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('returns 200 with updated profile on a valid JPEG upload', async () => {
    mockQuery.mockResolvedValueOnce(rows([MOCK_PROFILE]));

    const body = makeMultipartBody(MAGIC.jpeg, 'avatar.jpg', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      userId: 1,
      username: 'testuser',
      avatar_url: '/avatars/1.webp',
    });
  });

  it('returns 200 with valid PNG upload', async () => {
    mockQuery.mockResolvedValueOnce(rows([MOCK_PROFILE]));

    const body = makeMultipartBody(MAGIC.png, 'avatar.png', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for unsupported image type (random bytes)', async () => {
    // Random bytes that don't match any magic signature.
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
                                  0x08, 0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F]);
    const body = makeMultipartBody(garbage, 'not-an-image.bin', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Unsupported image type — accepted: JPEG, PNG, WebP, GIF' });
  });

  it('returns 413 when file exceeds size limit', async () => {
    // One byte over the limit triggers @fastify/multipart's fileSize guard.
    const oversized = Buffer.concat([MAGIC.jpeg, Buffer.alloc(AVATAR_MAX_BYTES)]);
    const body = makeMultipartBody(oversized, 'big.jpg', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: 'File too large (max 5 MB)' });
  });

  it('returns 422 when no profile row exists yet', async () => {
    // updateAvatarUrl (plain UPDATE) returns null when rowCount === 0.
    mockQuery.mockResolvedValueOnce(rows([]));

    const body = makeMultipartBody(MAGIC.jpeg, 'avatar.jpg', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: 'Profile not found — set a username first' });
  });

  it('returns 400 when no file part is included', async () => {
    // A multipart body with only a text field, no file.
    const textOnly = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="not-a-file"\r\n` +
      `\r\n` +
      `hello\r\n` +
      `--${boundary}--\r\n`,
    );
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: {
        'x-user-id': '1',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: textOnly,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'No file provided' });
  });

  it('returns 401 when x-user-id header is missing', async () => {
    const body = makeMultipartBody(MAGIC.jpeg, 'avatar.jpg', boundary);
    const res = await app.inject({
      method: 'POST',
      url: '/me/avatar',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: 'Missing or invalid user identity' });
  });
});
