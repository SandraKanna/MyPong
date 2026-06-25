import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:4010',
        changeOrigin: true,
        // Set-Cookie passthrough is default Vite behaviour — no extra config needed.
      },
    },
  },
});
