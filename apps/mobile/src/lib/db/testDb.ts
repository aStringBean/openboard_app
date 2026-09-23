/**
 * The Db interface over Node's built-in SQLite, for tests. Same engine family
 * as the phone, so foreign keys, conflicts and transactions behave for real.
 */
import { createRequire } from "node:module";

import type { Db, Param } from "./types";

/* Loaded at runtime rather than imported: node:sqlite is a prefix-only
 * builtin, and Vite strips the prefix and then looks for a package called
 * "sqlite". */
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export function memoryDb(): Db {
  const raw = new DatabaseSync(":memory:");

  return {
    async exec(sql) {
      raw.exec(sql);
    },
    async run(sql, params: Param[] = []) {
      raw.prepare(sql).run(...params);
    },
    async all<T>(sql: string, params: Param[] = []) {
      return raw.prepare(sql).all(...params) as T[];
    },
    async get<T>(sql: string, params: Param[] = []) {
      return raw.prepare(sql).get(...params) as T | undefined;
    },
    async transaction(fn) {
      raw.exec("BEGIN");
      try {
        await fn();
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}
