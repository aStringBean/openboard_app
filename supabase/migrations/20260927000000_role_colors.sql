-- A wall's own role colours: only the roles it has changed from the app's
-- defaults, as {"no_match": {"r": 0, "g": 255, "b": 255}, …}. Changed by the
-- owner, like the rest of the wall (walls_change policy). The app validates
-- entries as it reads them; the check here only keeps the column an object,
-- and small.
alter table public.walls
  add column role_colors jsonb not null default '{}'::jsonb
  check (jsonb_typeof(role_colors) = 'object' and pg_column_size(role_colors) < 2048);
