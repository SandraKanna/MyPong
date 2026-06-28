import { Outlet } from 'react-router';
import Navbar from '../shared/components/Navbar';

// STUDY: AppLayout is a "layout route" — a component that provides shared
// chrome (Navbar, main wrapper) for all authenticated pages. It renders no
// content of its own; <Outlet /> is the placeholder where the matched child
// route renders. Every route nested inside this in App.tsx gets the Navbar
// for free without repeating it in each page component.
// bg-surface (slightly lighter) vs Navbar's bg-bg creates visual separation.
export default function AppLayout() {
  return (
    <>
      <Navbar />
      <main className="bg-surface text-fg p-4">
        <Outlet />
      </main>
    </>
  );
}
