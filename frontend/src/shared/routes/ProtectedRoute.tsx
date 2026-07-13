import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuthStore } from '../../features/auth/state/authState';
import { useProfileStore } from '../../features/profile/state/profileState';

// STUDY: This is a layout route used as a security gate. It renders no UI of its
// own — it just decides whether to show its children (via <Outlet />) or redirect.
// Every protected page in the app is nested inside this component in App.tsx.
export default function ProtectedRoute() {
  // STUDY: useAuthStore with a selector function — the component only re-renders
  // when `status` changes, not when any other store field (accessToken, user) changes.
  // This is Zustand's granular subscription model: subscribe to exactly what you need.
  const status = useAuthStore((s) => s.status);
  const usernameStatus = useProfileStore((s) => s.usernameStatus);
  const checkUsername = useProfileStore((s) => s.checkUsername);
  const location = useLocation();

  // STUDY: Runs the username check once per authenticated session — 'unknown'
  // only happens right after login/register/bootstrap or right after a logout
  // reset it (see profileState's authStore subscription). Guests never reach
  // this component (guest PvE stays inline on the public home page), so no
  // isGuest check is needed here.
  useEffect(() => {
    if (status === 'authenticated' && usernameStatus === 'unknown') {
      void checkUsername();
    }
  }, [status, usernameStatus, checkUsername]);

  // STUDY: 'loading' is the initial state while useBootstrapAuth is in flight.
  // Without this guard, every page load would flash the login redirect before
  // the /refresh call completes and status becomes 'authenticated'.
  if (status === 'loading') {
    return <p>Loading…</p>;
  }

  if (status !== 'authenticated') {
    // STUDY: replace:true replaces the current history entry so the user can't
    // press Back to return to a protected page they're no longer authorised to see.
    return <Navigate to="/login" replace />;
  }

  // STUDY: Waiting on the username check blocks rendering the same way the
  // 'loading' auth status does above — without this, a route could flash its
  // real content for one frame before the redirect below fires.
  if (usernameStatus === 'unknown' || usernameStatus === 'checking') {
    return <p>Loading…</p>;
  }

  // STUDY: Any authenticated route other than /profile requires a username —
  // gameplay assumes one exists (e.g. for future display during a match).
  // /profile itself is exempt so the user can actually reach the form that
  // fixes this.
  if (usernameStatus === 'unset' && location.pathname !== '/profile') {
    return <Navigate to="/profile" replace />;
  }

  return <Outlet />;
}
