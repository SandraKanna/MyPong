import { create } from 'zustand';
import { useAuthStore } from '../../auth/state/authState';
import { getProfile } from '../api/profile';

// STUDY: This store answers one narrow question for route guarding — "does the
// current user have a username yet?" — without duplicating the full profile
// fetch/display logic that already lives in ProfilePage. ProfilePage keeps its
// own local fetch for the full profile (avatar, etc.); this store only tracks
// the boolean-ish status ProtectedRoute needs. The two fetches overlapping on
// the first /profile visit is accepted (see profileState duplicate-fetch note
// below) rather than refactoring ProfilePage to consume this store.
export type UsernameStatus = 'unknown' | 'checking' | 'set' | 'unset';

interface ProfileSlice {
  usernameStatus: UsernameStatus;
  // The actual username string, not just whether one is set — free to keep
  // alongside usernameStatus since checkUsername() already fetches the full
  // profile. This is the source of truth for "my own name" during a match.
  username: string | null;
  checkUsername: () => Promise<void>;
  markUsernameSet: (username: string) => void;
}

export const useProfileStore = create<ProfileSlice>()((set, get) => ({
  usernameStatus: 'unknown',
  username: null,

  // STUDY: Guards against re-entrancy — if ProtectedRoute re-renders while a
  // check is already in flight, don't fire a second GET /api/users/me.
  checkUsername: async () => {
    if (get().usernameStatus === 'checking')
      return;
    set({ usernameStatus: 'checking' });
    try {
      const profile = await getProfile();
      // 404 (no profile row) and a present-but-empty username are both "unset" —
      // in practice user-service never returns the latter (PATCH /me requires
      // a non-empty username to create a row at all), but treating both the
      // same keeps this check honest about what "unset" means.
      set({
        usernameStatus: profile !== null && profile.username ? 'set' : 'unset',
        username: profile?.username ?? null,
      });
    } catch {
      // Network/server error: treat as unset rather than silently letting the
      // gate pass — the next mount will retry since status isn't 'set'.
      set({ usernameStatus: 'unset', username: null });
    }
  },

  markUsernameSet: (username) => set({ usernameStatus: 'set', username }),
}));

// STUDY: Composes this store's username with authStore's isGuest — guests
// never have a profile row (ephemeral session, no account), so there's
// nothing to look up: 'You' is a fixed label, not a fallback for a failed
// fetch. The `?? 'You'` on the non-guest branch only covers the narrow
// window before checkUsername() resolves; ProtectedRoute's username gate
// means a real account should already have `username` populated by the
// time any game screen using this hook can mount.
export function useMyDisplayName(): string {
  const isGuest = useAuthStore((s) => s.isGuest);
  const username = useProfileStore((s) => s.username);
  return isGuest ? 'You' : (username ?? 'You');
}

// Accepted duplicate fetch: on the first visit to /profile after login, both
// this store's checkUsername() (triggered by ProtectedRoute) and ProfilePage's
// own effect independently call GET /api/users/me. Left unresolved rather than
// threading ProfilePage's fetch through this store — cheap read, low traffic,
// consistent with this project's portfolio-scale risk-acceptance elsewhere.

// Same lifetime/pattern as gameStore's authStore subscription: resets on logout
// (or any other transition away from 'authenticated') so a new login re-checks
// instead of reusing a stale status from the previous session.
useAuthStore.subscribe((state, prevState) => {
  if (prevState.status === 'authenticated' && state.status !== 'authenticated') {
    useProfileStore.setState({ usernameStatus: 'unknown', username: null });
  }
});
