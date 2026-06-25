import { useState } from 'react';
import { useAuthStore } from './state/authState';
import { useBootstrapAuth } from './state/useBootstrapAuth';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';

export default function App() {
  useBootstrapAuth();
  const status = useAuthStore((s) => s.status);
  const [showRegister, setShowRegister] = useState(false);

  if (status === 'loading') {
    return <p>Cargando…</p>;
  }

  if (status === 'authenticated') {
    return (
      <>
        <h1>MyPong</h1>
        <p>Sesión activa</p>
      </>
    );
  }

  return showRegister ? (
    <RegisterPage onSwitchToLogin={() => setShowRegister(false)} />
  ) : (
    <LoginPage onSwitchToRegister={() => setShowRegister(true)} />
  );
}
