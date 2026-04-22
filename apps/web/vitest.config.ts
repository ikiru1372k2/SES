import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const domainRoot = path.resolve(webRoot, '../../packages/domain/src');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^@ses\/domain\/(.+)$/, replacement: `${domainRoot}/$1` },
      { find: '@ses/domain', replacement: path.resolve(domainRoot, 'index.ts') },
    ],
  },
  test: {
    pool: 'threads',
    environment: 'happy-dom',
    globals: true,
    setupFiles: './test/setup.ts',
    include: [
      'test/**/*.component.test.tsx',
      'test/filePersistence.test.tsx',
      'test/fileDraftsApi.beacon.test.ts',
      'test/processPersistDebounce.test.ts',
      'src/**/__tests__/**/*.test.tsx',
      'src/**/__tests__/**/*.test.ts',
    ],
  },
});
