-- Mirror layouts: boards whose right half is the left half reflected. A wall
-- that is one keeps which hold mirrors which, as {"pairs": [[1, 2], [3, 3], …]}
-- (a centre-line hold pairs with itself); null for a wall that is not.
-- Changed by the owner, like the rest of the wall (walls_change policy). The
-- app validates pairs as it reads them; the check only keeps the column an
-- object, and bounded.
alter table public.walls
  add column mirror jsonb
  check (mirror is null or (jsonb_typeof(mirror) = 'object' and pg_column_size(mirror) < 65536));

-- Which way round an ascent was climbed. On a mirror layout a problem is only
-- fully ticked once climbed both ways.
alter table public.ticks
  add column mirrored boolean not null default false;
