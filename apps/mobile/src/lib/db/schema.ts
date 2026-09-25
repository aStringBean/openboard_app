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

  /* 4: sharing. Who made each row; which walls are shared and my role on
   * them; comments; a cache of each shared wall's members; and the outbox of
   * changes waiting to reach the server. */
  `
  ALTER TABLE wall ADD COLUMN cloud INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE wall ADD COLUMN my_role TEXT;
  ALTER TABLE wall ADD COLUMN setter_policy TEXT NOT NULL DEFAULT 'everyone';
  ALTER TABLE wall ADD COLUMN photo_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE wall ADD COLUMN holds_version INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE wall ADD COLUMN sync_cursor TEXT;
  ALTER TABLE wall ADD COLUMN synced_at INTEGER;

  ALTER TABLE problem ADD COLUMN setter_id TEXT;
  ALTER TABLE tick ADD COLUMN user_id TEXT;
  ALTER TABLE list ADD COLUMN owner_id TEXT;
  ALTER TABLE list ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;

  CREATE TABLE comment (
    id TEXT PRIMARY KEY,
    problem_id TEXT NOT NULL REFERENCES problem(id) ON DELETE CASCADE,
    user_id TEXT,
    body TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX comment_by_problem ON comment (problem_id, created_at);

  CREATE TABLE member (
    wall_id TEXT NOT NULL REFERENCES wall(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('owner', 'setter', 'climber')),
    name TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (wall_id, user_id)
  );

  -- One row per change waiting to reach the server. seq changes on every
  -- re-enqueue, so a push only clears the entry if nothing changed while it
  -- was in flight.
  CREATE TABLE outbox (
    kind TEXT NOT NULL CHECK (kind IN ('wall', 'holds', 'photo', 'problem', 'tick', 'list', 'comment')),
    id TEXT NOT NULL,
    wall_id TEXT NOT NULL,
    op TEXT NOT NULL CHECK (op IN ('upsert', 'delete')),
    seq INTEGER NOT NULL,
    error TEXT,
    PRIMARY KEY (kind, id)
  );
  CREATE INDEX outbox_by_wall ON outbox (wall_id, seq);
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
