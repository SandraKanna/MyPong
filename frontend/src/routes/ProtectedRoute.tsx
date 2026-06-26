import { Navigate, Outlet } from 'react-router';
import { useAuthStore } from '../state/authState';

export default function ProtectedRoute() {
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return <p>Cargando…</p>;
  }

  if (status === 'authenticated') {
    return <Outlet />;
  }

  return <Navigate to="/login" replace />;
}
