import { env } from "../config/env.js";
import { PostgresAdapter } from "./postgres.js";
import { SqliteAdapter } from "./sqlite.js";
import type { DatabaseAdapter } from "./types.js";

export * from "./types.js";

let adapter: DatabaseAdapter | null = null;

/**
 * Returns a singleton database adapter. PostgreSQL is used when DATABASE_URL
 * is set (typical for cloud deployments); otherwise SQLite is used, which is
 * ideal for local development and small self-hosted deployments.
 */
export function getDb(): DatabaseAdapter {
  if (!adapter) {
    adapter = env.DATABASE_URL
      ? new PostgresAdapter(env.DATABASE_URL)
      : new SqliteAdapter(env.SQLITE_PATH);
  }
  return adapter;
}

/** Used by tests to inject a fresh adapter instance. */
export function setDb(customAdapter: DatabaseAdapter): void {
  adapter = customAdapter;
}
