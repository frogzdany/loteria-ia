import base44 from '@base44/vite-plugin';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [base44(), react()],
  // Listen on all interfaces so phones on the same Wi-Fi can open /tabla during a local rehearsal.
  server: { host: '0.0.0.0' },
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./base44/shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
