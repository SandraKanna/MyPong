import { Outlet } from 'react-router';

export default function AppLayout() {
  return (
    <>
      <nav className="bg-bg text-fg px-4 py-3">MyPong</nav>
      <main className="bg-bg text-fg p-4">
        <Outlet />
      </main>
    </>
  );
}
