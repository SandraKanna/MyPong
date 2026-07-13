import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProfileStore } from '../src/features/profile/state/profileState';
import { useAuthStore } from '../src/features/auth/state/authState';
import { getProfile } from '../src/features/profile/api/profile';

vi.mock('../src/features/profile/api/profile');

beforeEach(() => {
  vi.resetAllMocks();
  useProfileStore.setState({ usernameStatus: 'unknown' });
  useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });
});

describe('profileState — checkUsername', () => {
  it('sets usernameStatus to "set" when GET /me returns a profile with a username', async () => {
    vi.mocked(getProfile).mockResolvedValue({ userId: 1, username: 'alice', avatar_url: null });

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('set');
  });

  it('sets usernameStatus to "unset" when GET /me returns null (404 — no profile row)', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('unset');
  });

  it('sets usernameStatus to "unset" when getProfile rejects', async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error('network error'));

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('unset');
  });

  it('does not call getProfile again while a check is already in flight', async () => {
    let resolveProfile: (value: { userId: number; username: string; avatar_url: string | null }) => void;
    vi.mocked(getProfile).mockReturnValue(
      new Promise((resolve) => { resolveProfile = resolve; }),
    );

    const first = useProfileStore.getState().checkUsername();
    const second = useProfileStore.getState().checkUsername();

    resolveProfile!({ userId: 1, username: 'alice', avatar_url: null });
    await Promise.all([first, second]);

    expect(vi.mocked(getProfile)).toHaveBeenCalledOnce();
  });
});

describe('profileState — markUsernameSet', () => {
  it('sets usernameStatus to "set" directly, without calling getProfile', () => {
    useProfileStore.getState().markUsernameSet();

    expect(useProfileStore.getState().usernameStatus).toBe('set');
    expect(vi.mocked(getProfile)).not.toHaveBeenCalled();
  });
});

describe('profileState — resets on logout', () => {
  it('resets usernameStatus to "unknown" when authStore transitions away from authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    useProfileStore.setState({ usernameStatus: 'set' });

    useAuthStore.getState().clearAuth();

    expect(useProfileStore.getState().usernameStatus).toBe('unknown');
  });
});
