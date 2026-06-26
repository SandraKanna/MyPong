import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { register } from '../api/auth';

export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await register(email, password);
      navigate('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Crear cuenta</h2>
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
      <div>
        <Link to="/login">¿Ya tenés cuenta? Iniciá sesión</Link>
      </div>
    </div>
  );
}
