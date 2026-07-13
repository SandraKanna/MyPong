import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import LoginPage from '../src/features/auth/pages/LoginPage';
import { login } from '../src/features/auth/api/auth';
import { useAuthStore } from '../src/features/auth/state/authState';

vi.mock('../src/features/auth/api/auth');

beforeEach(() => {
  vi.resetAllMocks();
  useAuthStore.setState({
    status: 'unauthenticated',
    accessToken: null,
    user: null,
    isGuest: false,
    sessionEndedMessage: null,
  });
});

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/profile" element={<div>Profile</div>} />
        <Route path="/register" element={<div>Register page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('renders email and password fields and the submit button', () => {
    renderLoginPage();
    screen.getByRole('textbox', { name: /email/i });
    screen.getByLabelText(/password/i);
    screen.getByRole('button', { name: /log in/i });
  });

  it('calls login with form values and navigates to / on success', async () => {
    vi.mocked(login).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.type(screen.getByLabelText(/password/i), 'password123');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    expect(vi.mocked(login)).toHaveBeenCalledWith('test@example.com', 'password123');
    await screen.findByText('Profile');
  });

  it('displays the error message when login fails', async () => {
    vi.mocked(login).mockRejectedValue(new Error('Invalid credentials'));
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'x@x.com');
    await user.type(screen.getByLabelText(/password/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /log in/i }));

    await screen.findByText(/invalid credentials/i);
  });

  it('shows sessionEndedMessage when set (e.g. session replaced elsewhere) and clears it from the store', async () => {
    useAuthStore.setState({ sessionEndedMessage: 'You were signed in elsewhere.' });
    renderLoginPage();

    screen.getByText('You were signed in elsewhere.');
    // Consumed once on mount — a later, unrelated visit to /login must not show it again.
    await vi.waitFor(() => {
      expect(useAuthStore.getState().sessionEndedMessage).toBeNull();
    });
  });

  it('does not show any message when sessionEndedMessage is null', () => {
    renderLoginPage();
    expect(screen.queryByText(/signed in elsewhere/i)).toBeNull();
  });
});
