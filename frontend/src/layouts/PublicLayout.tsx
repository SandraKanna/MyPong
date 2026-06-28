import { Outlet } from 'react-router';

// STUDY: PublicLayout is a no-op layout used for unauthenticated pages (login,
// register). It exists so every route in the tree sits under SOME layout —
// a consistent structural convention. It also provides a natural extension
// point: if public pages ever need shared chrome (a footer, a landing header)
// it goes here without touching individual pages.
export default function PublicLayout() {
  return <Outlet />;
}
