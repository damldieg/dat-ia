import { existsSync } from 'node:fs';
import { DB_PATH_ENV_VAR, resolveDbPath } from './config.ts';

/** Human-readable local-only notice printed at startup. */
export const LOCAL_ONLY_NOTICE =
  'Local only: the API binds to 127.0.0.1, opens the OpenCode SQLite database READ-ONLY and ' +
  'returns an allowlisted session DTO (no prompts, messages, credentials, account data, events, ' +
  'share URLs or raw metadata). Nothing is sent off this machine.';

export function describeLocalRuntime(dbPath: string = resolveDbPath()): string {
  const present = existsSync(dbPath);
  return [
    `[session-dashboard] ${LOCAL_ONLY_NOTICE}`,
    `[session-dashboard] database (read-only): ${dbPath}`,
    present
      ? '[session-dashboard] database file: present'
      : `[session-dashboard] database file: MISSING — start OpenCode once or set ${DB_PATH_ENV_VAR}`,
  ].join('\n');
}
