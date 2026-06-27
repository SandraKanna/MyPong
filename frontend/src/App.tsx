import { BrowserRouter, Routes, Route } from 'react-router';
import { useBootstrapAuth } from './features/auth/state/useBootstrapAuth';
import AppLayout from './layouts/AppLayout';
import PublicLayout from './layouts/PublicLayout';
import LoginPage from './features/auth/pages/LoginPage';
import RegisterPage from './features/auth/pages/RegisterPage';
import HomePage from './features/home/pages/HomePage';
import ProfilePage from './features/profile/pages/ProfilePage';
import ProtectedRoute from './shared/routes/ProtectedRoute';

export default function App() {
  useBootstrapAuth();

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<PublicLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
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
