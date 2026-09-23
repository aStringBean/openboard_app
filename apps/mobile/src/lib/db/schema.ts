import type { Db } from "./types";

/**
 * Migrations, applied in order. Each runs once and the database records how
 * far it has got, so an existing install upgrades in place. Never edit a
 * shipped entry — add a new one.
 */
const MIGRATIONS: string[] = [
  /* 1: walls, holds and problems. */
  `
  CREATE TABLE wall (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    photo_uri TEXT,
    photo_aspect REAL,
    angle_mode TEXT NOT NULL CHECK (angle_mode IN ('fixed', 'adjustable')),
    angles TEXT NOT NULL,
    current_angle INTEGER NOT NULL,
    calibration TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE hold (
    wall_id TEXT NOT NULL REFERENCES wall(id),
    id INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    led INTEGER,
    source TEXT NOT NULL CHECK (source IN ('detected', 'manual')),
    created_by_led INTEGER,
    PRIMARY KEY (wall_id, id)
  );

  CREATE TABLE problem (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL REFERENCES wall(id),
    name TEXT NOT NULL,
    grade INTEGER NOT NULL,
    angle INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX problem_by_wall ON problem (wall_id, created_at);

  -- RESTRICT is the backstop for the rule the calibration code keeps: a hold
  -- a problem uses can never be deleted out from under it.
  CREATE TABLE problem_hold (
    problem_id TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
    wall_id TEXT NOT NULL,
    hold_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('start', 'hand', 'no_match', 'foot', 'finish')),
    PRIMARY KEY (problem_id, hold_id),
    FOREIGN KEY (wall_id, hold_id) REFERENCES hold (wall_id, id) ON DELETE RESTRICT
  );
  CREATE INDEX problem_hold_by_hold ON problem_hold (wall_id, hold_id);

  CREATE TABLE setting (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,

  /* 2: ascents. Deleting a problem takes its ticks with it. */
  `
  CREATE TABLE tick (
    id TEXT PRIMARY KEY,
    problem_id TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
    climbed_at INTEGER NOT NULL,
    angle INTEGER NOT NULL,
    attempts INTEGER NOT NULL CHECK (attempts >= 1),
    grade INTEGER,
    stars INTEGER CHECK (stars IS NULL OR stars BETWEEN 1 AND 3),
    comment TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX tick_by_problem ON tick (problem_id, climbed_at);
  `,

  /* 3: lists of problems, ordered. A problem appears in a list at most once,
   * and leaves every list when it is deleted. */
  `
  CREATE TABLE list (
    id TEXT PRIMARY KEY,
    wall_id TEXT NOT NULL REFERENCES wall(id),
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE list_item (
    list_id TEXT NOT NULL REFERENCES list(id) ON DELETE CASCADE,
    problem_id TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    PRIMARY KEY (list_id, problem_id)
  );
  CREATE INDEX list_item_order ON list_item (list_id, position);
  `,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Brings the database up to `target` (all migrations by default; tests stop earlier). */
export async function migrate(db: Db, target = MIGRATIONS.length): Promise<void> {
  /* Foreign keys are off by default in SQLite, per connection. */
  await db.exec("PRAGMA foreign_keys = ON");

  const row = await db.get<{ user_version: number }>("PRAGMA user_version");
  const from = row?.user_version ?? 0;

  for (let v = from; v < target; v++) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[v]!);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}
