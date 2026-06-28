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
    <nav className="bg-bg text-fg px-4 py-3 flex items-center gap-6">
      {/* STUDY: <Link> renders an <a> tag but intercepts the click to do a
          client-side route change instead of a full page reload. This is what
          makes React apps feel fast — the browser never re-fetches the HTML. */}
      <Link to="/">MyPong</Link>
      <Link to="/profile">Profile</Link>
      <button onClick={() => void handleLogout()}>Logout</button>
    </nav>
  );
}
