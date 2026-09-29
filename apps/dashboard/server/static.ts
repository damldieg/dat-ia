/**
 * Minimal static file server for the built SPA (`npm start`).
 * GET/HEAD only, traversal-safe, SPA fallback to index.html.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function notBuilt(res: ServerResponse, headOnly: boolean): void {
  const body =
    'Session dashboard build not found.\nRun `npm run build` inside apps/dashboard, then `npm start`.\n';
  res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(headOnly ? undefined : body);
}

export function serveStatic(req: IncomingMessage, res: ServerResponse, distDir: string): void {
  const headOnly = req.method === 'HEAD';
  if (req.method !== 'GET' && !headOnly) {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    res.end();
    return;
  }

  if (!existsSync(path.join(distDir, 'index.html'))) {
    notBuilt(res, headOnly);
    return;
  }

  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolved = path.resolve(distDir, relative);
  const insideDist = resolved === distDir || resolved.startsWith(distDir + path.sep);

  let target = insideDist ? resolved : '';
  if (target && existsSync(target) && statSync(target).isDirectory()) {
    target = path.join(target, 'index.html');
  }

  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    // SPA fallback: unknown non-asset paths render the app shell.
    if (!path.extname(relative)) {
      target = path.join(distDir, 'index.html');
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
  }

  const type = CONTENT_TYPES[path.extname(target)] ?? 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(statSync(target).size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (headOnly) {
    res.end();
    return;
  }
  createReadStream(target).pipe(res);
}
