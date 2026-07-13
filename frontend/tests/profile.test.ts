import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getProfile,
  patchProfile,
  uploadAvatar,
  getStats,
  getMatches,
  lookupUsernames,
} from '../src/features/profile/api/profile';

beforeEach(() => {
  vi.restoreAllMocks();
});

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The concrete bug this suite fixes: a PATCH /me username validation failure
// carries the specific reason in `details`, but every function in this module
// used to read only the generic top-level `error` field, so the user always
// saw "Invalid input" and never the actual reason.
describe('patchProfile', () => {
  it('surfaces the field-level validation message from details, not the generic error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { username: ['Only alphanumeric characters, hyphens, and underscores are allowed'] },
    }));

    await expect(patchProfile('bad name')).rejects.toThrow(
      'Only alphanumeric characters, hyphens, and underscores are allowed',
    );
  });

  it('joins multiple field-level messages on separate lines', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: {
        username: ['too short', 'must not start with a number'],
      },
    }));

    await expect(patchProfile('1')).rejects.toThrow('too short\nmust not start with a number');
  });

  it('falls back to the top-level error when there is no details field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(409, { error: 'Username already taken' }));

    await expect(patchProfile('taken')).rejects.toThrow('Username already taken');
  });

  it('falls back to the default message when the body has neither details nor error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(500, {}));

    await expect(patchProfile('alice')).rejects.toThrow('Failed to save profile');
  });

  it('returns the saved profile on success', async () => {
    const profile = { userId: 1, username: 'alice', avatar_url: null };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(200, profile));

    await expect(patchProfile('alice')).resolves.toEqual(profile);
  });
});

describe('getProfile', () => {
  it('returns null on 404 without throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(404, { error: 'Profile not found' }));

    await expect(getProfile()).resolves.toBeNull();
  });

  it('surfaces a details message on other failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { id: ['must be a positive integer'] },
    }));

    await expect(getProfile()).rejects.toThrow('must be a positive integer');
  });

  it('falls back to the default message when the body is unparseable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 500 }));

    await expect(getProfile()).rejects.toThrow('Failed to load profile');
  });
});

describe('uploadAvatar', () => {
  it('surfaces a details message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { file: ['must be JPEG, PNG, WebP, or GIF'] },
    }));

    await expect(uploadAvatar(new File(['x'], 'a.png'))).rejects.toThrow('must be JPEG, PNG, WebP, or GIF');
  });
});

describe('getStats', () => {
  it('surfaces a details message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { id: ['must be a positive integer'] },
    }));

    await expect(getStats(-1)).rejects.toThrow('must be a positive integer');
  });
});

describe('getMatches', () => {
  it('surfaces a details message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { limit: ['must not exceed 50'] },
    }));

    await expect(getMatches(1, 999)).rejects.toThrow('must not exceed 50');
  });
});

describe('lookupUsernames', () => {
  it('surfaces a details message on failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(400, {
      error: 'Invalid input',
      details: { ids: ['ids must not exceed 50'] },
    }));

    await expect(lookupUsernames([1, 2, 3])).rejects.toThrow('ids must not exceed 50');
  });

  it('resolves a Map of userId to username on success', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(makeResponse(200, {
      users: [{ userId: 1, username: 'alice', avatar_url: null }],
    }));

    const result = await lookupUsernames([1, 2]);
    expect(result.get(1)).toBe('alice');
    expect(result.get(2)).toBeUndefined(); // silently omitted by the backend, not an error
  });
});
