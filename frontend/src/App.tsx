import { useAuthStore } from './state/authState';
import { useBootstrapAuth } from './state/useBootstrapAuth';

export default function App() {
  useBootstrapAuth();
  const status = useAuthStore((s) => s.status);

  if (status === 'loading') {
    return <p>Cargando…</p>;
  }

  return (
    <>
      <h1>MyPong</h1>
      <p>
        {status === 'authenticated'
          ? 'Sesión activa'
          : 'No hay sesión — login pendiente'}
      </p>
    </>
  );
}
