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
      // STUDY: No replace:true here — unlike login, pressing back after registering
      // is reasonable (maybe the user wants to fix a typo in their email).
      void navigate('/login');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'An unexpected error occurred');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-surface border border-border p-8 w-full max-w-sm flex flex-col gap-6">
      <h2 className="font-display text-fg text-lg uppercase tracking-widest text-center">
        Create Account
      </h2>
      <div className="flex flex-col gap-2">
        <label htmlFor="email" className="font-sans text-muted text-sm">
          Email
        </label>
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
        Register
      </button>
      <p className="font-sans text-sm text-center">
        <Link to="/login" className="text-accent hover:underline">
          Have an account? Log in
        </Link>
      </p>
    </div>
  );
}
