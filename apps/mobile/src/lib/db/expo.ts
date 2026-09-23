import * as SQLite from "expo-sqlite";

import type { Db } from "./types";

export async function openDb(name = "openboard.db"): Promise<Db> {
  const raw = await SQLite.openDatabaseAsync(name);
  await raw.execAsync("PRAGMA journal_mode = WAL");

  return {
    exec: (sql) => raw.execAsync(sql),
    run: async (sql, params = []) => {
      await raw.runAsync(sql, params);
    },
    all: (sql, params = []) => raw.getAllAsync(sql, params),
    get: async (sql, params = []) => (await raw.getFirstAsync(sql, params)) ?? undefined,
    transaction: (fn) => raw.withTransactionAsync(fn),
  };
}
