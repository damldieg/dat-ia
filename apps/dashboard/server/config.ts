/**
 * Runtime configuration.
 *
 * The database path is explicitly configurable and defaults to the OpenCode
 * data directory. Only a filesystem path and a port are read from the
 * environment: no tokens, credentials or other environment secrets are used.
 */
import { homedir } from 'node:os';
import path from 'node:path';

export const DB_PATH_ENV_VAR = 'OPENCODE_DB_PATH';
export const PORT_ENV_VAR = 'PORT';

export const DEFAULT_PORT = 8787;
export const DEFAULT_DB_PATH = path.join(homedir(), '.local', 'share', 'opencode', 'opencode.db');

type Env = Record<string, string | undefined>;

export function resolveDbPath(env: Env = process.env): string {
  const raw = env[DB_PATH_ENV_VAR]?.trim();
  if (!raw) return DEFAULT_DB_PATH;
  return path.resolve(raw);
}

export function resolvePort(env: Env = process.env): number {
  const raw = env[PORT_ENV_VAR]?.trim();
  if (!raw) return DEFAULT_PORT;
  if (!/^\d{1,5}$/.test(raw)) {
    throw new Error(`${PORT_ENV_VAR} must be an integer between 1 and 65535, received "${raw}".`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`${PORT_ENV_VAR} must be between 1 and 65535, received ${parsed}.`);
  }
  return parsed;
}
