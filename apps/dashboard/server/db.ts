/**
 * Read-only SQLite access.
 *
 * The database is opened with `readOnly: true` on every request: OpenCode keeps
 * writing to the same file, so per-request handles avoid stale file descriptors
 * and guarantee that this process can never write, even by accident.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { ApiError } from './errors.ts';
import { DB_PATH_ENV_VAR, resolveDbPath } from './config.ts';

export function withReadOnlyDb<T>(dbPath: string | undefined, run: (db: DatabaseSync) => T): T {
  const path = dbPath ?? resolveDbPath();
  if (!existsSync(path)) {
    throw new ApiError(
      503,
      'db-not-found',
      `OpenCode database not found at ${path}. Start OpenCode once, or point ${DB_PATH_ENV_VAR} at the correct file.`,
    );
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path, { readOnly: true });
  } catch (cause) {
    throw new ApiError(503, 'db-open-failed', `Cannot open the database read-only: ${messageOf(cause)}`);
  }

  try {
    return run(db);
  } catch (cause) {
    if (cause instanceof ApiError) throw cause;
    throw new ApiError(503, 'db-unavailable', `Read-only query failed: ${messageOf(cause)}`);
  } finally {
    db.close();
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
