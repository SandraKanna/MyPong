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
      void navigate('/profile', { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      // STUDY: finally runs whether the try block succeeded or threw. Without it,
      // a thrown error would leave `submitting` stuck at true and the button
      // permanently disabled.
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-surface border border-border p-8 w-full max-w-sm flex flex-col gap-6">
      <h2 className="font-display text-fg text-lg uppercase tracking-widest text-center">
        Log In
      </h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-sans text-muted text-sm">
          Email
        </label>
        {/* STUDY: value + onChange is the "controlled input" pattern. React owns the
            value; every keystroke fires onChange → setState → re-render → input shows
            the new value. The alternative (uncontrolled, with a ref) is harder to
            validate and reset programmatically. */}
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="bg-surface-raised border border-border text-fg px-3 py-2 font-sans focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="font-sans text-muted text-sm">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="bg-surface-raised border border-border text-fg px-3 py-2 font-sans focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      {error !== null && (
        <p className="font-sans text-danger text-sm">{error}</p>
      )}
      <button
        onClick={() => void handleSubmit()}
        disabled={submitting}
        className="bg-primary text-primary-fg font-display text-sm uppercase tracking-wide py-2 hover:bg-primary-hover disabled:opacity-50 transition-colors"
      >
        Log In
      </button>
      <p className="font-sans text-sm text-center">
        <Link to="/register" className="text-accent hover:underline">
          No account? Register
        </Link>
      </p>
    </div>
  );
}
