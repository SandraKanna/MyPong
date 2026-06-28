import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '../../features/auth/state/authState';

// STUDY: This is a layout route used as a security gate. It renders no UI of its
// own — it just decides whether to show its children (via <Outlet />) or redirect.
// Every protected page in the app is nested inside this component in App.tsx.
export default function ProtectedRoute() {
  // STUDY: useAuthStore with a selector function — the component only re-renders
  // when `status` changes, not when any other store field (accessToken, user) changes.
  // This is Zustand's granular subscription model: subscribe to exactly what you need.
  const status = useAuthStore((s) => s.status);

  // STUDY: 'loading' is the initial state while useBootstrapAuth is in flight.
  // Without this guard, every page load would flash the login redirect before
  // the /refresh call completes and status becomes 'authenticated'.
  if (status === 'loading') {
    return <p>Cargando…</p>;
  }

  if (status === 'authenticated') {
    return <Outlet />;
  }

  // STUDY: replace:true replaces the current history entry so the user can't
  // press Back to return to a protected page they're no longer authorised to see.
  return <Navigate to="/login" replace />;
}
