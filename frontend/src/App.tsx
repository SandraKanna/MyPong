import { BrowserRouter, Routes, Route } from 'react-router';
import { useBootstrapAuth } from './features/auth/state/useBootstrapAuth';
import AppLayout from './layouts/AppLayout';
import PublicLayout from './layouts/PublicLayout';
import LoginPage from './features/auth/pages/LoginPage';
import RegisterPage from './features/auth/pages/RegisterPage';
import HomePage from './features/home/pages/HomePage';
import ProfilePage from './features/profile/pages/ProfilePage';
import ProtectedRoute from './shared/routes/ProtectedRoute';

// STUDY: useBootstrapAuth fires a /refresh call on every page load. If the
// httpOnly cookie is valid, it restores the access token silently. If not,
// status goes to 'unauthenticated' and ProtectedRoute redirects to /login.
// This is how the app survives a browser reload without re-entering credentials.
export default function App() {
  useBootstrapAuth();

  return (
    <BrowserRouter>
      <Routes>
        {/* STUDY: PublicLayout and ProtectedRoute are "layout routes" — they
            wrap child routes without having a path themselves. React Router
            renders the matching child into their <Outlet />. */}
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>

        {/* STUDY: ProtectedRoute is the security boundary. Every route nested
            inside it checks auth status before rendering. "Protected by default"
            means new routes go inside this block unless explicitly public. */}
        <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<HomePage />} />
            <Route path="/profile" element={<ProfilePage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
