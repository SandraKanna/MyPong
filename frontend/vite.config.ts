import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4010',
        changeOrigin: true,
        // Set-Cookie passthrough is default Vite behaviour — no extra config needed.
      },
      // /avatars/* is served by nginx from the avatars_data Docker volume.
      // The Vite dev server has no equivalent route, so without this proxy
      // unmatched paths fall through to the SPA fallback and return HTML with
      // a 200 — which looks like a broken image, not an obvious 404.
      // Target is nginx HTTPS; secure:false accepts the self-signed dev cert.
      '/avatars': {
        target: 'https://localhost',
        changeOrigin: true,
        secure: false,
      },
      // /ws is handled by gateway-ws in prod (via nginx) and by this proxy in dev.
      // ws:true tells Vite to forward the HTTP→WS Upgrade handshake; without it
      // the entry is treated as HTTP-only and the connection silently fails.
      '/ws': {
        target: 'ws://localhost:4500',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    include: ['tests/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
    globals: true,
  },
});
