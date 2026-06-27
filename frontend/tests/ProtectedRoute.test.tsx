import { describe, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import ProtectedRoute from '../src/shared/routes/ProtectedRoute';
import { useAuthStore } from '../src/features/auth/state/authState';

beforeEach(() => {
  useAuthStore.setState({ status: 'loading', accessToken: null, user: null });
});

function renderProtectedRoute() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<div>Protected content</div>} />
        </Route>
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ProtectedRoute', () => {
  it('shows loading indicator while auth bootstrap is in progress', () => {
    renderProtectedRoute();
    screen.getByText(/cargando/i);
  });

  it('renders protected content when user is authenticated', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'tok', user: null });
    renderProtectedRoute();
    screen.getByText('Protected content');
  });

  it('redirects to /login when user is unauthenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated', accessToken: null, user: null });
    renderProtectedRoute();
    screen.getByText('Login page');
  });
});
