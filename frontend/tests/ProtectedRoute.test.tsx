import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProtectedRoute from '../src/shared/routes/ProtectedRoute';
import { useAuthStore } from '../src/features/auth/state/authState';
import { useProfileStore } from '../src/features/profile/state/profileState';
import { getProfile } from '../src/features/profile/api/profile';

vi.mock('../src/features/profile/api/profile');

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({ status: 'loading', accessToken: null, user: null });
  useProfileStore.setState({ usernameStatus: 'unknown' });
});

function renderProtectedRoute(initialPath = '/') {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Protected content</div>} />
          <Route path="/profile" element={<div>Profile page</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows loading indicator while auth bootstrap is in progress', () => {
    renderProtectedRoute();
    screen.getByText(/loading/i);
  });

  it('renders protected content when authenticated and username is set', async () => {
    vi.mocked(getProfile).mockResolvedValue({ userId: 1, username: 'alice', avatar_url: null });
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    renderProtectedRoute();
    await screen.findByText('Protected content');
  });

  it('redirects to /login when user is unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });
    renderProtectedRoute();
    screen.getByText('Login page');
  });

  it('redirects to /profile when authenticated but username is unset (GET /me 404)', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    renderProtectedRoute('/');
    await screen.findByText('Profile page');
  });

  it('does not redirect away from /profile itself when username is unset', async () => {
    vi.mocked(getProfile).mockResolvedValue(null);
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    renderProtectedRoute('/profile');
    await screen.findByText('Profile page');
  });
});
