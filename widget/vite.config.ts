import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required so this can be embedded as a widget iframe inside
// Element Web (https://) without hitting mixed-content blocking. The dev
// cert is self-signed, so visit the dev URL directly and click through the
// browser's cert warning once before adding it as a custom widget — see
// "Running it" in this file's README.
export default defineConfig({
  plugins: [react(), basicSsl()],
  server: {
    host: true,
  },
});
