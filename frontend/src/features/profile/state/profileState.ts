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
  checkUsername: () => Promise<void>;
  markUsernameSet: () => void;
}

export const useProfileStore = create<ProfileSlice>()((set, get) => ({
  usernameStatus: 'unknown',

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
      set({ usernameStatus: profile !== null && profile.username ? 'set' : 'unset' });
    } catch {
      // Network/server error: treat as unset rather than silently letting the
      // gate pass — the next mount will retry since status isn't 'set'.
      set({ usernameStatus: 'unset' });
    }
  },

  markUsernameSet: () => set({ usernameStatus: 'set' }),
}));

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
    useProfileStore.setState({ usernameStatus: 'unknown' });
  }
});
