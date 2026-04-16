import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const localDbPath = path.resolve('data', 'ses-data.json');

function ensureLocalDb() {
  fs.mkdirSync(path.dirname(localDbPath), { recursive: true });
  if (!fs.existsSync(localDbPath)) {
    fs.writeFileSync(localDbPath, JSON.stringify({ processes: [], version: 1 }, null, 2));
  }
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ses-local-file-db',
      configureServer(server) {
        server.middlewares.use('/api/local-db', (request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'PUT') {
            next();
            return;
          }

          try {
            ensureLocalDb();
            if (request.method === 'GET') {
              response.setHeader('Content-Type', 'application/json');
              response.end(fs.readFileSync(localDbPath, 'utf8'));
              return;
            }

            let body = '';
            request.on('data', (chunk) => {
              body += chunk;
            });
            request.on('end', () => {
              try {
                const parsed = JSON.parse(body || '{}');
                fs.writeFileSync(localDbPath, JSON.stringify({ processes: parsed.processes ?? [], version: 1, savedAt: new Date().toISOString() }, null, 2));
                response.setHeader('Content-Type', 'application/json');
                response.end(JSON.stringify({ ok: true }));
              } catch {
                response.statusCode = 400;
                response.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
              }
            });
          } catch (error) {
            response.statusCode = 500;
            response.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : 'Local DB error' }));
          }
        });
      },
    },
  ],
  server: {
    port: 3210,
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
    },
  },
  preview: {
    port: 3210,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: {
        taskpane: 'taskpane.html',
      },
    },
  },
});
