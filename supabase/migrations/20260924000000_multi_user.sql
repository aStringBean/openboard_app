-- OpenBoard: shared walls.
--
-- The wall is the tenant. Everything is scoped to a wall and readable only
-- by its members. The owner alone changes the wall itself; problems are set
-- by those the wall's setter policy allows; everyone edits only their own
-- problems, ticks, comments and lists.
--
-- Problems, ticks, comments and lists are soft-deleted (deleted_at), so that
-- devices syncing later learn about deletions. Every synced row carries a
-- server-set updated_at, which devices use as their pull cursor.

-- ------------------------------------------------------------------ helpers

-- Server time for sync cursors. clock_timestamp() rather than now(): now()
-- is fixed at transaction start, which widens the window in which a row can
-- commit behind a cursor that has already moved past it.
create function public.touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;

create function public.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when others then
  return null;
end $$;

-- ----------------------------------------------------------------- profiles

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch();

-- Everyone gets a profile on sign-up, named from their email until they
-- choose a name.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(split_part(coalesce(new.email, ''), '@', 1), 40));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- -------------------------------------------------------------------- walls

create table public.walls (
  id uuid primary key,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  angle_mode text not null check (angle_mode in ('fixed', 'adjustable')),
  angles int[] not null check (cardinality(angles) >= 1),
  current_angle int not null,
  -- 'everyone': every member may set problems. 'chosen': only the owner and
  -- members the owner has made setters.
  setter_policy text not null default 'everyone' check (setter_policy in ('everyone', 'chosen')),
  chain_length int not null default 250 check (chain_length between 1 and 1000),
  photo_path text,
  photo_aspect double precision,
  -- Bumped when the photo or the hold set changes, so members know to fetch
  -- them again in full rather than tracking them row by row.
  photo_version int not null default 0,
  holds_version int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp()
);

create trigger walls_touch before update on public.walls
  for each row execute function public.touch();

create table public.wall_members (
  wall_id uuid not null references public.walls(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'setter', 'climber')),
  joined_at timestamptz not null default now(),
  primary key (wall_id, user_id)
);
create index wall_members_by_user on public.wall_members (user_id);

-- The creator of a wall is its owner and first member.
create function public.add_owner_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.wall_members (wall_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return new;
end $$;

create trigger walls_add_owner after insert on public.walls
  for each row execute function public.add_owner_membership();

-- Membership checks. Security definer, so policies on wall_members can use
-- them without recursing into their own row-level security.
create function public.is_member(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wall_members where wall_id = w and user_id = auth.uid());
$$;

create function public.is_owner(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wall_members where wall_id = w and user_id = auth.uid() and role = 'owner');
$$;

create function public.can_set(w uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.wall_members m join public.walls wl on wl.id = m.wall_id
    where m.wall_id = w and m.user_id = auth.uid()
      and (m.role in ('owner', 'setter') or wl.setter_policy = 'everyone')
  );
$$;

create table public.wall_invites (
  code text primary key,
  wall_id uuid not null references public.walls(id) on delete cascade,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked boolean not null default false
);

-- -------------------------------------------------------------------- holds

-- Positions must round-trip to the device bit for bit, or a re-synced hold
-- would look moved. numeric keeps the exact decimal the device sent; double
-- precision would come back rounded to 15 digits, since Supabase's Postgres
-- prints floats with extra_float_digits = 0.
create table public.holds (
  wall_id uuid not null references public.walls(id) on delete cascade,
  id int not null,
  x numeric not null check (x between 0 and 1),
  y numeric not null check (y between 0 and 1),
  led int,
  source text not null check (source in ('detected', 'manual')),
  primary key (wall_id, id)
);

-- ----------------------------------------------------------------- problems

create table public.problems (
  id uuid primary key,
  wall_id uuid not null references public.walls(id) on delete cascade,
  setter_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  -- An index into the app's grade scale (Font 4 … 8C+).
  grade int not null check (grade between 0 and 21),
  angle int not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index problems_sync on public.problems (wall_id, updated_at);

create trigger problems_touch before update on public.problems
  for each row execute function public.touch();

-- A problem's wall and setter are fixed once it exists.
create function public.problems_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.wall_id <> old.wall_id or new.setter_id <> old.setter_id then
    raise exception 'a problem''s wall and setter cannot change';
  end if;
  return new;
end $$;

create trigger problems_immutable before update on public.problems
  for each row execute function public.problems_immutable();

-- RESTRICT is the rule the app keeps locally, enforced across every member:
-- a hold that anyone's problem uses cannot be deleted, even by an owner whose
-- device has not yet seen that problem.
create table public.problem_holds (
  problem_id uuid not null references public.problems(id) on delete cascade,
  wall_id uuid not null,
  hold_id int not null,
  role text not null check (role in ('start', 'hand', 'no_match', 'foot', 'finish')),
  primary key (problem_id, hold_id),
  foreign key (wall_id, hold_id) references public.holds (wall_id, id) on delete restrict
);
create index problem_holds_by_hold on public.problem_holds (wall_id, hold_id);

-- ------------------------------------------------------- ticks and comments

-- Ticks and comments take their wall from their problem, whatever the client
-- sends, so no one can attach them to a wall they are not in.
create function public.wall_from_problem() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select wall_id into new.wall_id from public.problems where id = new.problem_id;
  return new;
end $$;

create table public.ticks (
  id uuid primary key,
  problem_id uuid not null references public.problems(id) on delete cascade,
  wall_id uuid not null references public.walls(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  climbed_at timestamptz not null,
  angle int not null,
  attempts int not null check (attempts >= 1),
  grade int check (grade is null or grade between 0 and 21),
  stars int check (stars is null or stars between 1 and 3),
  comment text not null default '' check (char_length(comment) <= 500),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index ticks_sync on public.ticks (wall_id, updated_at);

create trigger ticks_wall before insert or update on public.ticks
  for each row execute function public.wall_from_problem();
create trigger ticks_touch before update on public.ticks
  for each row execute function public.touch();

create table public.comments (
  id uuid primary key,
  problem_id uuid not null references public.problems(id) on delete cascade,
  wall_id uuid not null references public.walls(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index comments_sync on public.comments (wall_id, updated_at);

create trigger comments_wall before insert or update on public.comments
  for each row execute function public.wall_from_problem();
create trigger comments_touch before update on public.comments
  for each row execute function public.touch();

-- -------------------------------------------------------------------- lists

-- Private to their owner unless shared with the wall.
create table public.lists (
  id uuid primary key,
  wall_id uuid not null references public.walls(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz
);
create index lists_sync on public.lists (wall_id, updated_at);

create trigger lists_touch before update on public.lists
  for each row execute function public.touch();

create table public.list_items (
  list_id uuid not null references public.lists(id) on delete cascade,
  problem_id uuid not null references public.problems(id) on delete cascade,
  position int not null,
  primary key (list_id, problem_id)
);

-- ---------------------------------------------------------- row-level security

alter table public.profiles enable row level security;
alter table public.walls enable row level security;
alter table public.wall_members enable row level security;
alter table public.wall_invites enable row level security;
alter table public.holds enable row level security;
alter table public.problems enable row level security;
alter table public.problem_holds enable row level security;
alter table public.ticks enable row level security;
alter table public.comments enable row level security;
alter table public.lists enable row level security;
alter table public.list_items enable row level security;

-- Profiles: your own, and those of people you share a wall with.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid() or exists (
    select 1 from public.wall_members mine join public.wall_members theirs on theirs.wall_id = mine.wall_id
    where mine.user_id = auth.uid() and theirs.user_id = profiles.id
  )
);
create policy profiles_write on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Walls: members read; owners create, change and delete.
create policy walls_read on public.walls for select to authenticated using (public.is_member(id));
create policy walls_create on public.walls for insert to authenticated with check (owner_id = auth.uid());
create policy walls_change on public.walls for update to authenticated
  using (public.is_owner(id)) with check (owner_id = auth.uid());
create policy walls_delete on public.walls for delete to authenticated using (public.is_owner(id));

-- Members: members see who else is in; joining goes through join_wall();
-- the owner changes roles (never to or from owner) and removes people;
-- anyone but the owner may leave.
create policy members_read on public.wall_members for select to authenticated using (public.is_member(wall_id));
create policy members_role on public.wall_members for update to authenticated
  using (public.is_owner(wall_id) and role <> 'owner')
  with check (public.is_owner(wall_id) and role in ('setter', 'climber'));
create policy members_remove on public.wall_members for delete to authenticated using (
  role <> 'owner' and (public.is_owner(wall_id) or user_id = auth.uid())
);

-- Invites: the owner's business alone.
create policy invites_owner on public.wall_invites for all to authenticated
  using (public.is_owner(wall_id)) with check (public.is_owner(wall_id));

-- Holds: members read; the owner writes.
create policy holds_read on public.holds for select to authenticated using (public.is_member(wall_id));
create policy holds_insert on public.holds for insert to authenticated with check (public.is_owner(wall_id));
create policy holds_update on public.holds for update to authenticated
  using (public.is_owner(wall_id)) with check (public.is_owner(wall_id));
create policy holds_delete on public.holds for delete to authenticated using (public.is_owner(wall_id));

-- Problems: members read; setters create their own; setters edit their own,
-- and the owner may edit anyone's (to take a problem down, say).
create policy problems_read on public.problems for select to authenticated using (public.is_member(wall_id));
create policy problems_create on public.problems for insert to authenticated
  with check (setter_id = auth.uid() and public.can_set(wall_id));
create policy problems_change on public.problems for update to authenticated
  using (setter_id = auth.uid() or public.is_owner(wall_id))
  with check (setter_id = auth.uid() or public.is_owner(wall_id));

create policy problem_holds_read on public.problem_holds for select to authenticated using (public.is_member(wall_id));
create policy problem_holds_write on public.problem_holds for all to authenticated
  using (exists (
    select 1 from public.problems p where p.id = problem_id
      and (p.setter_id = auth.uid() or public.is_owner(p.wall_id))
  ))
  with check (exists (
    select 1 from public.problems p where p.id = problem_id and p.wall_id = problem_holds.wall_id
      and (p.setter_id = auth.uid() or public.is_owner(p.wall_id))
  ));

-- Ticks: members read all; each writes their own.
create policy ticks_read on public.ticks for select to authenticated using (public.is_member(wall_id));
create policy ticks_create on public.ticks for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(wall_id));
create policy ticks_change on public.ticks for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Comments: members read all and write their own; the owner may take any down.
create policy comments_read on public.comments for select to authenticated using (public.is_member(wall_id));
create policy comments_create on public.comments for insert to authenticated
  with check (user_id = auth.uid() and public.is_member(wall_id));
create policy comments_change on public.comments for update to authenticated
  using (user_id = auth.uid() or public.is_owner(wall_id))
  with check (user_id = auth.uid() or public.is_owner(wall_id));

-- Lists: your own, plus lists shared with a wall you are in.
create policy lists_read on public.lists for select to authenticated
  using (owner_id = auth.uid() or (shared and public.is_member(wall_id)));
create policy lists_create on public.lists for insert to authenticated
  with check (owner_id = auth.uid() and public.is_member(wall_id));
create policy lists_change on public.lists for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy list_items_read on public.list_items for select to authenticated using (exists (
  select 1 from public.lists l where l.id = list_id
    and (l.owner_id = auth.uid() or (l.shared and public.is_member(l.wall_id)))
));
create policy list_items_write on public.list_items for all to authenticated
  using (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()))
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = auth.uid()));

-- ------------------------------------------------------------------ functions

-- An invite code: 8 characters from an alphabet without look-alikes (no I,
-- O, 0 or 1), 40 random bits. Security invoker, so only the owner can make
-- one — the insert is checked by the invites policy.
create function public.create_invite(p_wall uuid, p_days int default 30) returns text
language plpgsql set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  -- The bytes of a v4 UUID that carry no version or variant bits.
  src bytea := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
  picks constant int[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  code text := '';
  i int;
begin
  foreach i in array picks loop
    code := code || substr(alphabet, (get_byte(src, i) % 32) + 1, 1);
  end loop;
  insert into public.wall_invites (code, wall_id, expires_at)
  values (code, p_wall, case when p_days is null then null else now() + make_interval(days => p_days) end);
  return code;
end $$;

-- Joining. Security definer, since the joiner is not yet a member and could
-- not otherwise see the invite. New members climb; the setter policy decides
-- whether that also lets them set.
create function public.join_wall(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  w uuid;
begin
  if auth.uid() is null then
    raise exception 'sign in to join a wall';
  end if;

  select wall_id into w from public.wall_invites
  where code = upper(trim(p_code)) and not revoked and (expires_at is null or expires_at > now());

  if w is null then
    raise exception 'that invite code is not valid' using errcode = 'P0002';
  end if;

  insert into public.wall_members (wall_id, user_id, role) values (w, auth.uid(), 'climber')
  on conflict do nothing;
  return w;
end $$;

-- Replaces a wall's whole hold set in one transaction, and bumps the wall's
-- holds_version so members fetch it again. Fails as a whole if it would
-- delete a hold some problem uses.
create function public.replace_holds(p_wall uuid, p_holds jsonb) returns int
language plpgsql set search_path = '' as $$
declare
  v int;
begin
  insert into public.holds (wall_id, id, x, y, led, source)
  select p_wall, (h->>'id')::int, (h->>'x')::numeric, (h->>'y')::numeric,
         (h->>'led')::int, h->>'source'
  from jsonb_array_elements(p_holds) h
  on conflict (wall_id, id) do update
    set x = excluded.x, y = excluded.y, led = excluded.led, source = excluded.source;

  delete from public.holds
  where wall_id = p_wall
    and id not in (select (h->>'id')::int from jsonb_array_elements(p_holds) h);

  update public.walls set holds_version = holds_version + 1 where id = p_wall
  returning holds_version into v;

  if v is null then
    raise exception 'only the wall''s owner can change its holds';
  end if;
  return v;
end $$;

-- Creates or updates a problem together with its holds, atomically, and
-- checks the start and finish limits the app enforces.
create function public.save_problem(p jsonb) returns timestamptz
language plpgsql set search_path = '' as $$
declare
  pid uuid := (p->>'id')::uuid;
  w uuid;
  starts int;
  finishes int;
  stamp timestamptz;
begin
  select count(*) filter (where h->>'role' = 'start'), count(*) filter (where h->>'role' = 'finish')
  into starts, finishes from jsonb_array_elements(p->'holds') h;

  if starts not between 1 and 2 or finishes not between 1 and 2 then
    raise exception 'a problem needs one or two start holds and one or two finish holds';
  end if;

  -- Update if it exists, insert if not — not an upsert. INSERT … ON CONFLICT
  -- checks the insert policy against the row before discovering the
  -- conflict, and the insert policy needs setting rights: a climber could
  -- then no longer edit a problem they set before the wall's policy changed.
  update public.problems
     set name = p->>'name', grade = (p->>'grade')::int, angle = (p->>'angle')::int
   where id = pid
  returning wall_id, updated_at into w, stamp;

  if not found then
    if exists (select 1 from public.problems where id = pid) then
      raise exception 'not yours to edit' using errcode = '42501';
    end if;
    insert into public.problems (id, wall_id, name, grade, angle, created_at)
    values (pid, (p->>'wall_id')::uuid, p->>'name', (p->>'grade')::int, (p->>'angle')::int,
            coalesce((p->>'created_at')::timestamptz, now()))
    returning wall_id, updated_at into w, stamp;
  end if;

  delete from public.problem_holds where problem_id = pid;
  insert into public.problem_holds (problem_id, wall_id, hold_id, role)
  select pid, w, (h->>'hold_id')::int, h->>'role' from jsonb_array_elements(p->'holds') h;

  return stamp;
end $$;

-- Takes a problem down. It stays as a tombstone so devices learn it has
-- gone; its holds are released at once. Deleting a problem that is already
-- gone, or never arrived, succeeds: a device may delete one the server
-- refused, and its delete must not be refused too.
create function public.delete_problem(p_id uuid) returns void
language plpgsql set search_path = '' as $$
begin
  update public.problems set deleted_at = now() where id = p_id and deleted_at is null;
  if not found and exists (select 1 from public.problems where id = p_id and deleted_at is null) then
    raise exception 'not yours to delete' using errcode = '42501';
  end if;
  delete from public.problem_holds where problem_id = p_id;
end $$;

-- Creates or updates a list and its items, atomically.
create function public.save_list(l jsonb) returns timestamptz
language plpgsql set search_path = '' as $$
declare
  lid uuid := (l->>'id')::uuid;
  stamp timestamptz;
begin
  insert into public.lists (id, wall_id, name, shared, created_at)
  values (lid, (l->>'wall_id')::uuid, l->>'name', coalesce((l->>'shared')::boolean, false),
          coalesce((l->>'created_at')::timestamptz, now()))
  on conflict (id) do update
    set name = excluded.name, shared = excluded.shared, deleted_at = null
  returning updated_at into stamp;

  delete from public.list_items where list_id = lid;
  insert into public.list_items (list_id, problem_id, position)
  select lid, (i.value)::uuid, (i.ordinality - 1)::int
  from jsonb_array_elements_text(l->'problem_ids') with ordinality i;

  return stamp;
end $$;

-- ------------------------------------------------------------------ storage

-- Wall photos, one folder per wall: members read, the owner writes.
insert into storage.buckets (id, name, public) values ('wall-photos', 'wall-photos', false)
on conflict (id) do nothing;

create policy wall_photos_read on storage.objects for select to authenticated using (
  bucket_id = 'wall-photos' and public.is_member(public.try_uuid((storage.foldername(name))[1]))
);
create policy wall_photos_write on storage.objects for insert to authenticated with check (
  bucket_id = 'wall-photos' and public.is_owner(public.try_uuid((storage.foldername(name))[1]))
);
create policy wall_photos_change on storage.objects for update to authenticated using (
  bucket_id = 'wall-photos' and public.is_owner(public.try_uuid((storage.foldername(name))[1]))
);
create policy wall_photos_delete on storage.objects for delete to authenticated using (
  bucket_id = 'wall-photos' and public.is_owner(public.try_uuid((storage.foldername(name))[1]))
);
