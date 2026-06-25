import { useState } from 'react';
import { login } from '../api/auth';

interface Props {
  onSwitchToRegister: () => void;
}

export default function LoginPage({ onSwitchToRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Iniciar sesión</h2>
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
          Entrar
        </button>
      </div>
      <div>
        <button onClick={onSwitchToRegister}>
          ¿No tenés cuenta? Registrate
        </button>
      </div>
    </div>
  );
}
