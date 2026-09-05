import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // BASE_PATH lets us deploy under a subpath (e.g. GitHub Pages /repo/customer/).
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: {
    // host: true binds 0.0.0.0 so the dev server is reachable from other devices.
    host: true,
    port: 5173,
    strictPort: true,
  },
  preview: {
    host: true,
    port: 5173,
    strictPort: true,
  },
});
