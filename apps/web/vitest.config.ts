import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
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
