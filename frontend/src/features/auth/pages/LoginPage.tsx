import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { login } from '../api/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  // STUDY: Four independent pieces of local state — each owns one concern.
  // React re-renders this component whenever any of them changes. Because they
  // are independent (no derived relationship between them) there is no benefit
  // to grouping them into a single object.
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // STUDY: `submitting` disables the button while the request is in flight,
  // preventing a double-submit if the user clicks twice before the response arrives.
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setSubmitting(true);
    // STUDY: Clear the previous error before each new attempt so stale messages
    // don't survive into a fresh request cycle.
    setError(null);
    try {
      await login(email, password);
      // STUDY: replace:true so the browser's back button won't return the user to
      // /login after a successful authentication. The login page is a dead-end
      // once the user is in — they should press Logout to leave.
      void navigate('/', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error inesperado');
    } finally {
      // STUDY: finally runs whether the try block succeeded or threw. Without it,
      // a thrown error would leave `submitting` stuck at true and the button
      // permanently disabled.
      setSubmitting(false);
    }
  }

  return (
    <div>
      <h2>Iniciar sesión</h2>
      <div>
        {/* accessible name for screen readers; also enables role/label-based test queries */}
        {/* TODO: replace with a visible associated <label> during the CSS redesign */}
        {/* STUDY: value + onChange is the "controlled input" pattern. React owns the
            value; every keystroke fires onChange → setState → re-render → input shows
            the new value. The alternative (uncontrolled, with a ref) is harder to
            validate and reset programmatically. */}
        <input
          type="email"
          aria-label="Email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div>
        {/* accessible name for screen readers; also enables role/label-based test queries */}
        {/* TODO: replace with a visible associated <label> during the CSS redesign */}
        <input
          type="password"
          aria-label="Contraseña"
          placeholder="Contraseña"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error !== null && <p style={{ color: 'red' }}>{error}</p>}
      <div>
        <button onClick={() => void handleSubmit()} disabled={submitting}>
          Entrar
        </button>
      </div>
      <div>
        <Link to="/register">¿No tenés cuenta? Registrate</Link>
      </div>
    </div>
  );
}
