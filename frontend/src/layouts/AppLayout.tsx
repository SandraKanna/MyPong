import { Outlet } from 'react-router';
import Navbar from '../shared/components/Navbar';

export default function AppLayout() {
  return (
    <>
      <Navbar />
      <main className="bg-bg text-fg p-4">
        <Outlet />
      </main>
    </>
  );
}
