import { describe, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import RegisterPage from '../src/features/auth/pages/RegisterPage';
import { register } from '../src/features/auth/api/auth';

vi.mock('../src/features/auth/api/auth');

beforeEach(() => {
  vi.resetAllMocks();
});

function renderRegisterPage() {
  render(
    <MemoryRouter initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<div>Login</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RegisterPage', () => {
  it('renders email and password fields and the submit button', () => {
    renderRegisterPage();
    screen.getByRole('textbox', { name: /email/i });
    screen.getByLabelText(/contraseña/i);
    screen.getByRole('button', { name: /registrarse/i });
  });

  it('calls register with form values and navigates to /login on success', async () => {
    vi.mocked(register).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'new@example.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'securepass');
    await user.click(screen.getByRole('button', { name: /registrarse/i }));

    expect(vi.mocked(register)).toHaveBeenCalledWith('new@example.com', 'securepass');
    await screen.findByText('Login');
  });

  it('displays the error message when registration fails', async () => {
    vi.mocked(register).mockRejectedValue(new Error('No se pudo registrar'));
    const user = userEvent.setup();
    renderRegisterPage();

    await user.type(screen.getByRole('textbox', { name: /email/i }), 'x@x.com');
    await user.type(screen.getByLabelText(/contraseña/i), 'short');
    await user.click(screen.getByRole('button', { name: /registrarse/i }));

    await screen.findByText(/no se pudo registrar/i);
  });
});
