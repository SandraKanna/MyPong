import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '../../features/auth/state/authState';

// STUDY: The mirror image of ProtectedRoute — bounces a real (non-guest)
// authenticated user away from the guest-facing public pages (/, /login,
// /register), so navigating there directly (URL bar, back button, the
// Navbar's "MyPong" link) can't strand them on a logged-out-looking screen.
export default function PublicOnlyRoute() {
  const status = useAuthStore((s) => s.status);
  const isGuest = useAuthStore((s) => s.isGuest);

  // STUDY: Guests ARE authenticated (status: 'authenticated', ephemeral JWT)
  // but must stay on these public routes — the inline "play vs AI" flow on
  // the homepage depends on a guest never being redirected off of it.
  if (status === 'authenticated' && !isGuest) {
    // STUDY: Redirects to /game, not /profile — ProtectedRoute already owns
    // the username-gate redirect to /profile from there, so this guard
    // doesn't duplicate that check; it only decides "should this user be
    // looking at the public pages at all."
    return <Navigate to="/game" replace />;
  }

  return <Outlet />;
}
