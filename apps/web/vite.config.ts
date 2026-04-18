import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3210,
    host: '127.0.0.1',
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3211',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 3210,
    host: '127.0.0.1',
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        index: 'index.html',
        taskpane: 'taskpane.html',
      },
    },
  },
});
