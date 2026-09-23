export type Param = string | number | null;

/**
 * The slice of SQLite the app uses. expo-sqlite implements it on the phone;
 * Node's built-in SQLite implements it in tests, so the repository runs
 * against a real database engine — foreign keys included — in both.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: Param[]): Promise<void>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  get<T>(sql: string, params?: Param[]): Promise<T | undefined>;
  /** Runs `fn` atomically: every statement in it lands, or none do. */
  transaction(fn: () => Promise<void>): Promise<void>;
}
