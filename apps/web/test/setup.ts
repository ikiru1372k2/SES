import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

globalThis.fetch = vi.fn(() =>
  Promise.resolve(
    new Response(JSON.stringify({}), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ),
) as typeof fetch;
