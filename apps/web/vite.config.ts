import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '../..');
const domainRoot = path.resolve(repoRoot, 'packages/domain/src');

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // Do not pre-bundle the workspace package; Vite can otherwise cache a CJS
    // entry from node_modules and miss named exports (see resolve.alias).
    exclude: ['@ses/domain'],
  },
  resolve: {
    // Use domain TypeScript source in dev/build so ESM named imports (e.g.
    // MAX_WORKBOOK_FILE_SIZE_BYTES) resolve correctly. The published dist is
    // CommonJS; Vite's CJS interop does not always surface `export *` re-exports.
    alias: [
      { find: /^@ses\/domain\/(.+)$/, replacement: `${domainRoot}/$1` },
      { find: '@ses/domain', replacement: path.resolve(domainRoot, 'index.ts') },
    ],
  },
  server: {
    port: 3210,
    host: '127.0.0.1',
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
    fs: {
      allow: [webRoot, repoRoot],
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
