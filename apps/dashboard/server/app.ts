/**
 * Local API adapter: the only component that touches SQLite.
 *
 * Routes (GET only, JSON only):
 *   /api/health            runtime/db status
 *   /api/summary           aggregate counts, registered cost, facets
 *   /api/sessions          filtered, paginated session list
 *   /api/sessions/:id      one session plus its descendants
 *
 * Everything else returns a JSON 404/405. Responses are `no-store` and never
 * include stack traces.
 */
import { existsSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError } from './errors.ts';
import { resolveDbPath } from './config.ts';
import { withReadOnlyDb } from './db.ts';
import { isValidSessionId, parseSessionParams } from './params.ts';
import { toSessionDTO, toSummaryDTO } from './dto.ts';
import {
  getAgentFacets,
  getDescendants,
  getModelFacets,
  getProjectFacets,
  getSession,
  getSummary,
  listSessions,
} from './store.ts';

export interface ApiHandlerOptions {
  /** Explicit database path; defaults to `OPENCODE_DB_PATH` or the OpenCode data directory. */
  dbPath?: string;
}

export type ApiHandler = (req: IncomingMessage, res: ServerResponse) => void;

function sendJson(res: ServerResponse, status: number, payload: unknown, headOnly = false): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(Buffer.byteLength(body)),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(headOnly ? undefined : body);
}

export function createApiHandler(options: ApiHandlerOptions = {}): ApiHandler {
  const dbPath = options.dbPath ?? resolveDbPath();

  return function handleApi(req: IncomingMessage, res: ServerResponse): void {
    const headOnly = req.method === 'HEAD';
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    try {
      if (req.method !== 'GET' && !headOnly) {
        res.setHeader('Allow', 'GET');
        throw new ApiError(405, 'method-not-allowed', 'Only GET is supported.');
      }

      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, localOnly: true, readOnly: true, dbPath, dbExists: existsSync(dbPath) }, headOnly);
        return;
      }

      if (pathname === '/api/summary') {
        const summary = withReadOnlyDb(dbPath, (db) => {
          const row = getSummary(db);
          return toSummaryDTO(row, {
            agents: getAgentFacets(db),
            models: getModelFacets(db),
            projects: getProjectFacets(db),
          });
        });
        sendJson(res, 200, summary, headOnly);
        return;
      }

      if (pathname === '/api/sessions') {
        const parsed = parseSessionParams(url.searchParams);
        if (!parsed.ok) throw new ApiError(400, 'invalid-parameter', parsed.detail.message, parsed.detail);
        const payload = withReadOnlyDb(dbPath, (db) => {
          const { rows, total } = listSessions(db, parsed.value);
          return { sessions: rows.map(toSessionDTO), total };
        });
        sendJson(res, 200, payload, headOnly);
        return;
      }

      if (pathname.startsWith('/api/sessions/')) {
        const id = decodeURIComponent(pathname.slice('/api/sessions/'.length));
        if (!isValidSessionId(id)) {
          throw new ApiError(400, 'invalid-session-id', 'Session ids are 3-128 characters of [A-Za-z0-9_-].', {
            field: 'id',
            message: 'Session id has an unsupported format.',
          });
        }
        const payload = withReadOnlyDb(dbPath, (db) => {
          const row = getSession(db, id);
          if (!row) return null;
          return {
            session: toSessionDTO(row),
            descendants: getDescendants(db, id).map(toSessionDTO),
          };
        });
        if (payload === null) {
          throw new ApiError(404, 'session-not-found', `No session with id ${id} in this database.`);
        }
        sendJson(res, 200, payload, headOnly);
        return;
      }

      throw new ApiError(404, 'route-not-found', `Unknown route: ${req.method} ${pathname}`);
    } catch (cause) {
      if (cause instanceof ApiError) {
        sendJson(res, cause.status, cause.toBody(), headOnly);
        return;
      }
      console.error('[session-dashboard] request failed:', cause);
      sendJson(
        res,
        500,
        { error: { code: 'internal-error', message: 'Unexpected server error. Check the terminal running the dashboard.' } },
        headOnly,
      );
    }
  };
}
