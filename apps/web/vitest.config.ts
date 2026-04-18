import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    pool: 'threads',
    environment: 'happy-dom',
    globals: true,
    setupFiles: './test/setup.ts',
    include: ['test/**/*.component.test.tsx'],
  },
});
