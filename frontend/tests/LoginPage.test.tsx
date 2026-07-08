import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import LoginPage from '../src/features/auth/pages/LoginPage';
import { login } from '../src/features/auth/api/auth';

vi.mock('../src/features/auth/api/auth');

beforeEach(() => {
  vi.resetAllMocks();
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
});
