import { create } from 'zustand';

// STUDY: Zustand is a global state store — the frontend equivalent of a module-level
// singleton. Any component can read or write it without prop drilling. Unlike React
// context, it doesn't re-render the whole tree on every change — only components
// that subscribe to the specific slice they use.

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface User {
  userId: number;
  email: string;
}

interface AuthSlice {
  status: AuthStatus;
  accessToken: string | null;
  user: User | null;
  setAuth: (accessToken: string, user?: User) => void;
  clearAuth: () => void;
}

// STUDY: The access token lives here — in JavaScript memory only. It is never
// written to localStorage or a cookie. A page refresh wipes it, which is why
// useBootstrapAuth calls /refresh on every mount to recover it from the httpOnly
// cookie. This limits XSS exposure: a script can't read a cookie it can't see.
export const useAuthStore = create<AuthSlice>()((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,

  // STUDY: user is optional so the same action works for both login (which
  // provides a user object) and token refresh (which only provides a new token).
  // If user is omitted, the existing value in state is preserved — not overwritten.
  setAuth: (accessToken, user) =>
    set((state) => ({
      accessToken,
      status: 'authenticated',
      user: user !== undefined ? user : state.user,
    })),

  clearAuth: () =>
    set({ accessToken: null, user: null, status: 'unauthenticated' }),
}));
