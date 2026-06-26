import { useNavigate } from 'react-router';
import { logout } from '../api/auth';

export default function HomePage() {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <>
      <h1>MyPong</h1>
      <p>Home</p>
      <button onClick={handleLogout}>Cerrar sesión</button>
    </>
  );
}
