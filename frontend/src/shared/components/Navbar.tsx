import { Link, useNavigate } from 'react-router';
import { logout } from '../../features/auth/api/auth';

export default function Navbar() {
  // STUDY: useNavigate returns an imperative navigate function. It's a hook,
  // so it must be called at the top level of the component — not inside a
  // callback. The function it returns is what you call inside callbacks.
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    // STUDY: void discards the Promise from navigate(). React Router v7's
    // navigate() returns Promise<void>; not voiding it would trigger the
    // no-floating-promises ESLint rule. The navigation still happens — void
    // just tells the linter "I'm intentionally not awaiting this".
    void navigate('/login', { replace: true });
  }

  return (
    <nav className="bg-surface border-b border-border text-fg px-6 py-4 flex items-center gap-8">
      {/* STUDY: <Link> renders an <a> tag but intercepts the click to do a
          client-side route change instead of a full page reload. This is what
          makes React apps feel fast — the browser never re-fetches the HTML. */}
      <Link
        to="/"
        className="font-display text-primary text-sm tracking-widest uppercase"
      >
        MyPong
      </Link>
      <Link
        to="/game"
        className="font-sans text-muted hover:text-primary transition-colors text-sm"
      >
        Play
      </Link>
      <Link
        to="/profile"
        className="font-sans text-muted hover:text-primary transition-colors text-sm"
      >
        Profile
      </Link>
      <div className="ml-auto">
        <button
          onClick={() => void handleLogout()}
          className="font-sans text-sm border border-accent text-accent px-4 py-1 hover:bg-accent hover:text-bg transition-colors"
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
