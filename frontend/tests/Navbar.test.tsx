import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import Navbar from '../src/shared/components/Navbar';
import { logout } from '../src/features/auth/api/auth';

vi.mock('../src/features/auth/api/auth');

beforeEach(() => {
  vi.resetAllMocks();
});

function renderNavbar() {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={
            <>
              <Navbar />
              <div>Home</div>
            </>
          }
        />
        <Route path="/login" element={<div>Login page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Navbar', () => {
  it('renders the brand link with text "MyPong" pointing to /', () => {
    renderNavbar();
    const brand = screen.getByRole('link', { name: 'MyPong' });
    expect(brand.getAttribute('href')).toBe('/');
  });

  it('renders the Profile link pointing to /', () => {
    renderNavbar();
    const profile = screen.getByRole('link', { name: 'Profile' });
    expect(profile.getAttribute('href')).toBe('/');
  });

  it('calls logout() when Logout button is clicked', async () => {
    vi.mocked(logout).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    expect(vi.mocked(logout)).toHaveBeenCalledOnce();
  });

  it('navigates to /login after logout', async () => {
    vi.mocked(logout).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderNavbar();

    await user.click(screen.getByRole('button', { name: 'Logout' }));

    await screen.findByText('Login page');
  });
});
