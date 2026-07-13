import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProfileStore, useMyDisplayName } from '../src/features/profile/state/profileState';
import { useAuthStore } from '../src/features/auth/state/authState';
import { getProfile } from '../src/features/profile/api/profile';

vi.mock('../src/features/profile/api/profile');

beforeEach(() => {
  vi.resetAllMocks();
  useProfileStore.setState({ usernameStatus: 'unknown', username: null });
  useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null, isGuest: false });
});

describe('profileState — checkUsername', () => {
  it('sets usernameStatus to "set" and stores the username when GET /me returns a profile', async () => {
    vi.mocked(getProfile).mockResolvedValue({ userId: 1, username: 'alice', avatar_url: null });

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('set');
    expect(useProfileStore.getState().username).toBe('alice');
  });

  it('sets usernameStatus to "unset" and username to null when GET /me returns null (404 — no profile row)', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('unset');
    expect(useProfileStore.getState().username).toBeNull();
  });

  it('sets usernameStatus to "unset" and username to null when getProfile rejects', async () => {
    vi.mocked(getProfile).mockRejectedValue(new Error('network error'));

    await useProfileStore.getState().checkUsername();

    expect(useProfileStore.getState().usernameStatus).toBe('unset');
    expect(useProfileStore.getState().username).toBeNull();
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
  it('sets usernameStatus to "set" and stores the username directly, without calling getProfile', () => {
    useProfileStore.getState().markUsernameSet('alice');

    expect(useProfileStore.getState().usernameStatus).toBe('set');
    expect(useProfileStore.getState().username).toBe('alice');
    expect(vi.mocked(getProfile)).not.toHaveBeenCalled();
  });
});

describe('profileState — resets on logout', () => {
  it('resets usernameStatus to "unknown" and username to null when authStore transitions away from authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    useProfileStore.setState({ usernameStatus: 'set', username: 'alice' });

    useAuthStore.getState().clearAuth();

    expect(useProfileStore.getState().usernameStatus).toBe('unknown');
    expect(useProfileStore.getState().username).toBeNull();
  });
});

describe('useMyDisplayName', () => {
  it('returns "You" for a guest, regardless of any stored username', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'guest-tok', user: null, isGuest: true });
    useProfileStore.setState({ usernameStatus: 'set', username: 'alice' });

    const { result } = renderHook(() => useMyDisplayName());

    expect(result.current).toBe('You');
  });

  it('returns the stored username for a real account', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, isGuest: false });
    useProfileStore.setState({ usernameStatus: 'set', username: 'alice' });

    const { result } = renderHook(() => useMyDisplayName());

    expect(result.current).toBe('alice');
  });

  it('falls back to "You" for a real account with no username loaded yet', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, isGuest: false });
    useProfileStore.setState({ usernameStatus: 'unknown', username: null });

    const { result } = renderHook(() => useMyDisplayName());

    expect(result.current).toBe('You');
  });
});
