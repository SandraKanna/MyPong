import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import LoginPage from '../src/pages/LoginPage';
import { login } from '../src/api/auth';

vi.mock('../src/api/auth');

beforeEach(() => {
  vi.resetAllMocks();
});

function renderLoginPage() {
  render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<div>Home</div>} />
        <Route path="/register" element={<div>Register page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('LoginPage', () => {
  it('renders email and password fields and the submit button', () => {
    renderLoginPage();
    screen.getByRole('textbox', { name: /email/i });
    screen.getByLabelText(/contraseña/i);
    screen.getByRole('button', { name: /entrar/i });
  });

  it('calls login with form values and navigates to / on success', async () => {
    vi.mocked(login).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'test@example.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'password123');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    expect(vi.mocked(login)).toHaveBeenCalledWith('test@example.com', 'password123');
    await screen.findByText('Home');
  });

  it('displays the error message when login fails', async () => {
    vi.mocked(login).mockRejectedValue(new Error('Credenciales inválidas'));
    const user = userEvent.setup();
    renderLoginPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'x@x.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'wrongpass');
    await user.click(screen.getByRole('button', { name: /entrar/i }));

    await screen.findByText(/credenciales inválidas/i);
  });
});
