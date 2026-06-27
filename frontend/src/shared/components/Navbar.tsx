import { Link, useNavigate } from 'react-router';
import { logout } from '../../features/auth/api/auth';

export default function Navbar() {
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    void navigate('/login', { replace: true });
  }

  return (
    <nav className="bg-bg text-fg px-4 py-3 flex items-center gap-6">
      <Link to="/">MyPong</Link>
      <Link to="/">Profile</Link>
      <button onClick={() => void handleLogout()}>Logout</button>
    </nav>
  );
}
