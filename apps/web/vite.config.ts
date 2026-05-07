import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

const webRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webRoot, '../..');
const domainRoot = path.resolve(repoRoot, 'packages/domain/src');

/**
 * Force any browser still holding a Service Worker / cached shell from a
 * previous nginx-served prod build (or older dev session) to drop them.
 *
 * Two layers because `Clear-Site-Data` alone can't kill a SW that's
 * already registered and intercepting fetches:
 *
 *   (1) Serve a REAL `/sw.js` that unregisters itself + clears caches.
 *       The browser fetches this on activation/update checks and runs
 *       it as a Service Worker — guaranteed kill switch.
 *   (2) Serve `/registerSW.js` as a no-op so any old prod-built HTML
 *       that bootstrapped the SW doesn't produce a 404 either.
 *   (3) Send `Clear-Site-Data` on the SPA shell as a belt-and-braces
 *       cleanup for caches/storage on plain navigations.
 */
const clearStaleClientPlugin = (): PluginOption => ({
  name: 'ses-clear-stale-client-shell',
  configureServer(server) {
    const SW_KILL = `// Service Worker kill switch — replaces any prod-era SW with a no-op.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) {
      try { client.navigate(client.url); } catch (_) {}
    }
  })());
});
// Pass-through everything else to the network — never intercept again.
self.addEventListener('fetch', () => {});
`;

    server.middlewares.use((req, res, next) => {
      const url = (req.url ?? '').split('?')[0] ?? '';

      // Layer 1+2: serve the SW kill-switch and a no-op register helper.
      if (url === '/sw.js' || url === '/service-worker.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Service-Worker-Allowed', '/');
        res.end(SW_KILL);
        return;
      }
      if (url === '/registerSW.js' || url === '/workbox-sw.js') {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.end('// no-op (SW killed)\n');
        return;
      }

      // Layer 3: belt-and-braces — Clear-Site-Data on the SPA shell.
      const isShell =
        url === '/' ||
        url === '/index.html' ||
        (!url.includes('.') &&
          !url.startsWith('/api') &&
          !url.startsWith('/@') &&
          !url.startsWith('/node_modules') &&
          !url.startsWith('/src'));
      if (isShell) {
        res.setHeader('Clear-Site-Data', '"cache", "storage"');
        res.setHeader('Cache-Control', 'no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
      }
      next();
    });
  },
});

export default defineConfig({
  plugins: [react(), clearStaleClientPlugin()],
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
    // Permit the SPA to be reached via Cloudflare quick tunnels and
    // local LAN hosts. Without this, Vite returns 403 to any host it
    // doesn't recognize, which breaks `cloudflared tunnel --url ...`.
    allowedHosts: [
      '127.0.0.1',
      'localhost',
      '.trycloudflare.com',
      '.ngrok.io',
      '.ngrok-free.app',
      '.local',
    ],
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3211',
        changeOrigin: true,
        ws: true,
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
