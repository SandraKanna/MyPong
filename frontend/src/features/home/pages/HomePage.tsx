// Placeholder feature: today shows email + logout only.
// Will be reshaped in Phase 2 when user-service provides real profile data.
import { useNavigate } from 'react-router';
import { logout } from '../../auth/api/auth';

export default function HomePage() {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    void navigate('/login', { replace: true });
  }

  return (
    <>
      <h1>MyPong</h1>
      <p>Home</p>
      <button onClick={() => void handleLogout()}>Cerrar sesión</button>
    </>
  );
}
