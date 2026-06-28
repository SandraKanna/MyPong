import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import App from './App';

// STUDY: StrictMode is dev-only. It deliberately mounts every component twice
// to expose side effects that run more than once (e.g. a fetch that fires twice).
// In production the double-mount doesn't happen. This is why GET /me fires twice
// when you first load ProfilePage in development — it's StrictMode, not a bug.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
