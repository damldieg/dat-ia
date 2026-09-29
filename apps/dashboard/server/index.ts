/**
 * Standalone entry point: `npm start` (or `npm run api`).
 *
 * Binds to the loopback interface only. The database is never opened here at
 * startup: each request opens it read-only, so a missing or busy database
 * produces a clear 503 instead of a crash.
 *
 * Configuration (filesystem path and port only — never secrets):
 *   OPENCODE_DB_PATH  database to read (default: ~/.local/share/opencode/opencode.db)
 *   PORT              listening port (default: 8787)
 */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createApiHandler } from './app.ts';
import { describeLocalRuntime } from './banner.ts';
import { resolvePort } from './config.ts';
import { serveStatic } from './static.ts';

const HOST = '127.0.0.1';
const distDir = fileURLToPath(new URL('../dist', import.meta.url));
const handler = createApiHandler();

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/api' || url.startsWith('/api/')) {
    handler(req, res);
    return;
  }
  serveStatic(req, res, distDir);
});

let port: number;
try {
  port = resolvePort();
} catch (cause) {
  console.error(`[session-dashboard] ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(2);
}

server.on('error', (cause: NodeJS.ErrnoException) => {
  if (cause.code === 'EADDRINUSE') {
    console.error(`[session-dashboard] port ${port} is already in use. Set PORT=<other> and retry.`);
  } else {
    console.error('[session-dashboard] server error:', cause.message);
  }
  process.exit(1);
});

server.listen(port, HOST, () => {
  console.log(describeLocalRuntime());
  console.log(`[session-dashboard] listening on http://${HOST}:${port} (loopback only)`);
  console.log(`[session-dashboard] serving SPA from ${path.resolve(distDir)}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
