// Vite configuration: React SPA plus the local read-only API mounted on the
// dev server middleware chain. The browser only ever talks to `/api/*` on the
// loopback interface; SQLite access happens inside this Node process.
import { defineConfig, type Plugin, type Connect } from 'vite';
import react from '@vitejs/plugin-react';
import { createApiHandler } from './server/app.ts';
import { describeLocalRuntime } from './server/banner.ts';

function sessionDashboardApi(): Plugin {
  return {
    name: 'session-dashboard:local-api',
    configureServer(server) {
      const handler = createApiHandler();
      console.log(describeLocalRuntime());
      const middleware: Connect.NextHandleFunction = (req, res, next) => {
        if (!req.url || !(req.url === '/api' || req.url.startsWith('/api/'))) {
          next();
          return;
        }
        handler(req, res);
      };
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), sessionDashboardApi()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
