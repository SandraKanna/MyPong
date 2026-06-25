import { useState } from 'react';
import { register } from '../api/auth';

interface Props {
  onSwitchToLogin: () => void;
}

export default function RegisterPage({ onSwitchToLogin }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await register(email, password);
      setSuccess(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Crear cuenta</h2>
      {success ? (
        <p>Cuenta creada. Ya podés iniciar sesión.</p>
      ) : (
        <>
          <div>
            <input
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <input
              type="password"
              placeholder="Contraseña"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error !== null && <p style={{ color: 'red' }}>{error}</p>}
          <div>
            <button onClick={handleSubmit} disabled={submitting}>
              Registrarse
            </button>
          </div>
        </>
      )}
      <div>
        <button onClick={onSwitchToLogin}>
          ¿Ya tenés cuenta? Iniciá sesión
        </button>
      </div>
    </div>
  );
}
