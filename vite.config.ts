import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const localDbPath = path.resolve('data', 'ses-data.json');
const MAX_LOCAL_DB_BYTES = 10 * 1024 * 1024;

function ensureLocalDb() {
  fs.mkdirSync(path.dirname(localDbPath), { recursive: true });
  if (!fs.existsSync(localDbPath)) {
    fs.writeFileSync(localDbPath, JSON.stringify({ processes: [], version: 1 }, null, 2));
  }
}

function sendJson(response: { statusCode: number; setHeader: (name: string, value: string) => void; end: (body: string) => void }, statusCode: number, body: unknown) {
  response.statusCode = statusCode;
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(body));
}

function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function sanitizeLocalDbPayload(value: unknown) {
  const item = value && typeof value === 'object' ? value as { processes?: unknown } : {};
  const processes = Array.isArray(item.processes)
    ? item.processes.filter((process) => {
        if (!process || typeof process !== 'object') return false;
        const candidate = process as { id?: unknown; name?: unknown };
        return typeof candidate.id === 'string' && typeof candidate.name === 'string';
      })
    : [];
  return { processes, version: 1, savedAt: new Date().toISOString() };
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
            if (!isAllowedOrigin(request.headers.origin)) {
              sendJson(response, 403, { ok: false, error: 'Forbidden' });
              return;
            }
            ensureLocalDb();
            if (request.method === 'GET') {
              const parsed = JSON.parse(fs.readFileSync(localDbPath, 'utf8') || '{}');
              sendJson(response, 200, sanitizeLocalDbPayload(parsed));
              return;
            }

            const contentType = request.headers['content-type'] ?? '';
            if (!String(contentType).toLowerCase().includes('application/json')) {
              sendJson(response, 415, { ok: false, error: 'Content-Type must be application/json' });
              return;
            }

            let body = '';
            let rejected = false;
            request.on('data', (chunk) => {
              if (rejected) return;
              if (Buffer.byteLength(body) + chunk.length > MAX_LOCAL_DB_BYTES) {
                rejected = true;
                sendJson(response, 413, { ok: false, error: 'Request body too large' });
                request.destroy();
                return;
              }
              body += chunk;
            });
            request.on('end', () => {
              if (rejected) return;
              try {
                const parsed = JSON.parse(body || '{}');
                fs.writeFileSync(localDbPath, JSON.stringify(sanitizeLocalDbPayload(parsed), null, 2));
                sendJson(response, 200, { ok: true });
              } catch {
                sendJson(response, 400, { ok: false, error: 'Invalid JSON' });
              }
            });
          } catch {
            sendJson(response, 500, { ok: false, error: 'Local DB error' });
          }
        });
      },
    },
  ],
  server: {
    port: 3210,
    host: '127.0.0.1',
    strictPort: true,
    headers: {
      'Cache-Control': 'no-store',
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
