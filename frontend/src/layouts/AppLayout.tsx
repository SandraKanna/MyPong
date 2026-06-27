import { Outlet } from 'react-router';

export default function AppLayout() {
  return (
    <>
      <nav>MyPong</nav>
      <main>
        <Outlet />
      </main>
    </>
  );
}
