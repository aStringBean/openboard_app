-- Row-level security, exercised as real users. Each block switches identity
-- the way PostgREST does (role authenticated + JWT claims), so auth.uid()
-- and every policy behave exactly as they do for the app.
begin;
create extension if not exists pgtap with schema extensions;
select plan(48);

-- Owner, a climber who will join, and a stranger who never does.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@test.local'),
  ('00000000-0000-0000-0000-00000000000b', 'climber@test.local'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@test.local');

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;

-- -------------------------------------------------------------- profiles
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-00000000000a'),
  'owner', 'sign-up creates a profile named from the email');

-- ----------------------------------------------------------------- walls
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.walls (id, name, angle_mode, angles, current_angle)
values ('10000000-0000-0000-0000-000000000001', 'Garage', 'fixed', '{40}', 40);

select is((select role from public.wall_members where user_id = auth.uid()), 'owner',
  'creating a wall makes you its owner');
select lives_ok($$ select public.replace_holds('10000000-0000-0000-0000-000000000001',
  '[{"id":0,"x":0.1,"y":0.9,"led":0,"source":"detected"},
    {"id":1,"x":0.5,"y":0.5,"led":1,"source":"detected"},
    {"id":2,"x":0.9,"y":0.1,"led":2,"source":"manual"},
    {"id":3,"x":0.3,"y":0.3,"led":null,"source":"detected"}]') $$,
  'the owner can set the holds');
select is((select holds_version from public.walls), 1, 'replacing holds bumps the version');
select is((select x from public.holds where id = 0), 0.1::double precision, 'hold positions are stored exactly');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.walls), 0, 'a stranger cannot see the wall');
select is((select count(*)::int from public.holds), 0, 'nor its holds');
select throws_ok($$ select public.replace_holds('10000000-0000-0000-0000-000000000001', '[]') $$,
  NULL, 'nor change them');

-- --------------------------------------------------------------- invites
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
create temp table invite as select public.create_invite('10000000-0000-0000-0000-000000000001') as code;
grant select on invite to authenticated;
select matches((select code from invite), '^[A-HJ-NP-Z2-9]{8}$', 'invite codes are 8 unambiguous characters');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ select public.create_invite('10000000-0000-0000-0000-000000000001') $$,
  NULL, 'only the owner can make invites');
select is((select count(*)::int from public.wall_invites), 0, 'and only the owner can see them');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.join_wall('NOTACODE') $$, 'P0002', NULL, 'a wrong code joins nothing');
select is(public.join_wall(lower((select code from invite))), '10000000-0000-0000-0000-000000000001'::uuid,
  'a valid code joins, whatever its case');
select is((select role from public.wall_members where user_id = auth.uid()), 'climber', 'joiners start as climbers');
select is((select count(*)::int from public.holds), 4, 'members can see the holds');
select lives_ok($$ select public.join_wall((select code from invite)) $$, 'joining twice is harmless');

-- ----------------------------------------------- setting: policy 'everyone'
select lives_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000001",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Climber''s first","grade":4,"angle":40,
  "holds":[{"hold_id":0,"role":"start"},{"hold_id":2,"role":"finish"}]}') $$,
  'under "everyone", a climber can set a problem');
select is((select setter_id from public.problems where id = '20000000-0000-0000-0000-000000000001'),
  '00000000-0000-0000-0000-00000000000b'::uuid, 'the setter is whoever saved it, not what the client said');
select throws_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000009",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Too many","grade":4,"angle":40,
  "holds":[{"hold_id":0,"role":"start"},{"hold_id":1,"role":"start"},{"hold_id":3,"role":"start"},
           {"hold_id":2,"role":"finish"}]}') $$, NULL, 'three start holds are refused');
select throws_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000008",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"No finish","grade":4,"angle":40,
  "holds":[{"hold_id":0,"role":"start"}]}') $$, NULL, 'a problem without a finish is refused');

-- --------------------------------------------------------- holds in use
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ select public.replace_holds('10000000-0000-0000-0000-000000000001',
  '[{"id":1,"x":0.5,"y":0.5,"led":1,"source":"detected"},{"id":2,"x":0.9,"y":0.1,"led":2,"source":"manual"}]') $$,
  '23503', NULL, 'the owner cannot delete a hold a member''s problem uses');
select is((select count(*)::int from public.holds), 4, 'and the whole replacement rolls back');
select lives_ok($$ select public.replace_holds('10000000-0000-0000-0000-000000000001',
  '[{"id":0,"x":0.1,"y":0.9,"led":0,"source":"detected"},{"id":1,"x":0.5,"y":0.5,"led":1,"source":"detected"},
    {"id":2,"x":0.9,"y":0.1,"led":2,"source":"manual"}]') $$, 'but can delete an unused one');

-- ----------------------------------------------- setting: policy 'chosen'
update public.walls set setter_policy = 'chosen';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000002",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Not allowed","grade":4,"angle":40,
  "holds":[{"hold_id":0,"role":"start"},{"hold_id":2,"role":"finish"}]}') $$,
  '42501', NULL, 'under "chosen", a climber cannot set');
select lives_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000001",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Renamed","grade":5,"angle":40,
  "holds":[{"hold_id":0,"role":"start"},{"hold_id":2,"role":"finish"}]}') $$,
  'but can still edit a problem they set before');
update public.wall_members set role = 'setter' where user_id = auth.uid();
select is((select role from public.wall_members where user_id = auth.uid()), 'climber',
  'a climber cannot promote themselves');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
update public.wall_members set role = 'setter' where user_id = '00000000-0000-0000-0000-00000000000b';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000002",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Now allowed","grade":4,"angle":40,
  "holds":[{"hold_id":0,"role":"start"},{"hold_id":1,"role":"finish"}]}') $$,
  'once the owner makes them a setter, they can');
update public.walls set setter_policy = 'everyone';
select is((select setter_policy from public.walls), 'chosen', 'only the owner changes the setter policy');

-- ------------------------------------------------------ others' problems
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000003",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Owner''s","grade":6,"angle":40,
  "holds":[{"hold_id":1,"role":"start"},{"hold_id":2,"role":"finish"}]}') $$, 'the owner sets a problem');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.save_problem('{"id":"20000000-0000-0000-0000-000000000003",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Hijacked","grade":6,"angle":40,
  "holds":[{"hold_id":1,"role":"start"},{"hold_id":2,"role":"finish"}]}') $$,
  '42501', NULL, 'a member cannot edit someone else''s problem');
select is((select name from public.problems where id = '20000000-0000-0000-0000-000000000003'), 'Owner''s',
  '(unchanged)');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select throws_ok($$ update public.problems set setter_id = auth.uid() where id = '20000000-0000-0000-0000-000000000001' $$,
  NULL, NULL, 'not even the owner can change who set a problem');
select lives_ok($$ select public.delete_problem('20000000-0000-0000-0000-000000000002') $$,
  'the owner can take down a member''s problem');
select isnt((select deleted_at from public.problems where id = '20000000-0000-0000-0000-000000000002'), NULL,
  'which leaves a tombstone for devices to sync');
select is((select count(*)::int from public.problem_holds where problem_id = '20000000-0000-0000-0000-000000000002'), 0,
  'and releases its holds');

-- ---------------------------------------------------- ticks and comments
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into public.ticks (id, problem_id, wall_id, climbed_at, angle, attempts, grade, stars)
values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
        '99999999-9999-9999-9999-999999999999', now(), 40, 1, 7, 3);
select is((select wall_id from public.ticks where id = '30000000-0000-0000-0000-000000000001'),
  '10000000-0000-0000-0000-000000000001'::uuid, 'a tick takes its wall from its problem, not the client');
insert into public.comments (id, problem_id, wall_id, body)
values ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003',
        '10000000-0000-0000-0000-000000000001', 'The crimp to the pinch is the crux');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.ticks), 1, 'everyone on the wall sees everyone''s ticks');
update public.ticks set stars = 1 where id = '30000000-0000-0000-0000-000000000001';
select is((select stars from public.ticks where id = '30000000-0000-0000-0000-000000000001'), 3,
  'but cannot change them');
update public.comments set deleted_at = now() where id = '40000000-0000-0000-0000-000000000001';
select isnt((select deleted_at from public.comments where id = '40000000-0000-0000-0000-000000000001'), NULL,
  'the owner can take down a comment');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
select throws_ok($$ insert into public.ticks (id, problem_id, wall_id, climbed_at, angle, attempts)
  values ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003',
          '10000000-0000-0000-0000-000000000001', now(), 40, 1) $$,
  '42501', NULL, 'a stranger cannot tick');

-- ------------------------------------------------------------------ lists
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.save_list('{"id":"50000000-0000-0000-0000-000000000001",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"My projects","shared":false,
  "problem_ids":["20000000-0000-0000-0000-000000000003","20000000-0000-0000-0000-000000000001"]}') $$,
  'a member makes a private list');
select is((select array_agg(problem_id order by position) from public.list_items),
  array['20000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001']::uuid[],
  'in the order given');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select count(*)::int from public.lists), 0, 'a private list is invisible to others, owner included');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
select lives_ok($$ select public.save_list('{"id":"50000000-0000-0000-0000-000000000001",
  "wall_id":"10000000-0000-0000-0000-000000000001","name":"Circuit","shared":true,
  "problem_ids":["20000000-0000-0000-0000-000000000001"]}') $$, 'and then shares it');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select is((select name from public.lists), 'Circuit', 'a shared list is visible to the wall');
select is((select count(*)::int from public.list_items), 1, 'with its items');

-- ---------------------------------------------------------------- leaving
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
delete from public.wall_members where user_id = auth.uid();
select is((select role from public.wall_members where user_id = auth.uid()), 'owner',
  'the owner cannot leave their own wall');

select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
delete from public.wall_members where user_id = auth.uid();
select is((select count(*)::int from public.problems), 0, 'a member who leaves loses access');

select * from finish();
rollback;
