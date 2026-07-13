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
  isGuest: boolean;
  // Set when this session was ended by the server, not by the user choosing to
  // log out (e.g. a login elsewhere revoked this session's refresh token and
  // closed its WebSocket connection). Read once by LoginPage, then cleared —
  // see wsClient.ts and LoginPage.tsx.
  sessionEndedMessage: string | null;
  setAuth: (accessToken: string, user?: User) => void;
  setGuestAuth: (accessToken: string) => void;
  clearAuth: () => void;
  setSessionEndedMessage: (message: string | null) => void;
}

// STUDY: The access token lives here — in JavaScript memory only. It is never
// written to localStorage or a cookie. A page refresh wipes it, which is why
// useBootstrapAuth calls /refresh on every mount to recover it from the httpOnly
// cookie. This limits XSS exposure: a script can't read a cookie it can't see.
export const useAuthStore = create<AuthSlice>()((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,
  isGuest: false,
  sessionEndedMessage: null,

  // STUDY: user is optional so the same action works for both login (which
  // provides a user object) and token refresh (which only provides a new token).
  // If user is omitted, the existing value in state is preserved — not overwritten.
  setAuth: (accessToken, user) =>
    set((state) => ({
      accessToken,
      status: 'authenticated',
      user: user !== undefined ? user : state.user,
    })),

  setGuestAuth: (accessToken) =>
    set({ accessToken, status: 'authenticated', isGuest: true }),

  clearAuth: () =>
    set({ accessToken: null, user: null, status: 'unauthenticated', isGuest: false }),

  setSessionEndedMessage: (message) => set({ sessionEndedMessage: message }),
}));
