import { describe, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import PublicOnlyRoute from '../src/shared/routes/PublicOnlyRoute';
import { useAuthStore } from '../src/features/auth/state/authState';

beforeEach(() => {
  useAuthStore.setState({ status: 'loading', accessToken: null, user: null, isGuest: false });
});

function renderPublicOnlyRoute() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<PublicOnlyRoute />}>
          <Route path="/" element={<div>Public content</div>} />
        </Route>
        <Route path="/game" element={<div>Game page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('PublicOnlyRoute', () => {
  it('renders public content while auth bootstrap is in progress', () => {
    renderPublicOnlyRoute();
    screen.getByText('Public content');
  });

  it('renders public content when unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null, isGuest: false });
    renderPublicOnlyRoute();
    screen.getByText('Public content');
  });

  it('redirects to /game when authenticated with a real account', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null, isGuest: false });
    renderPublicOnlyRoute();
    screen.getByText('Game page');
  });

  it('does not redirect a guest — stays on the public content', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'guest-tok', user: null, isGuest: true });
    renderPublicOnlyRoute();
    screen.getByText('Public content');
  });
});
