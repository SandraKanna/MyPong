import { create } from 'zustand';

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

export const useAuthStore = create<AuthSlice>()((set) => ({
  status: 'loading',
  accessToken: null,
  user: null,

  setAuth: (accessToken, user) =>
    set((state) => ({
      accessToken,
      status: 'authenticated',
      user: user !== undefined ? user : state.user,
    })),

  clearAuth: () =>
    set({ accessToken: null, user: null, status: 'unauthenticated' }),
}));
