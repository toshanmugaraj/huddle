import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required so this can be embedded as a widget iframe inside
// Element Web (https://) without hitting mixed-content blocking — see
// ../spike-webgpu for the background on why this was needed, and its
// README for the one-time "accept the cert" step this still requires.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
});
