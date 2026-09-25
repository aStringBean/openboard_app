-- Handing a wall on, exercised as real users (see rls.test.sql for the method).
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'owner@test.local'),
  ('00000000-0000-0000-0000-0000000000b1', 'member@test.local'),
  ('00000000-0000-0000-0000-0000000000c1', 'stranger@test.local');

create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
$$;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
insert into public.walls (id, name, angle_mode, angles, current_angle)
values ('10000000-0000-0000-0000-0000000000a1', 'Garage', 'fixed', '{40}', 40);
create temp table invite as select public.create_invite('10000000-0000-0000-0000-0000000000a1') as code;
grant select on invite to authenticated;

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select public.join_wall((select code from invite));
select throws_ok($$ select public.transfer_wall('10000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1') $$, '42501', NULL, 'a member cannot take a wall for themselves');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.transfer_wall('10000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1') $$, 'P0002', NULL, 'nor can it go to someone outside it');
select lives_ok($$ select public.transfer_wall('10000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000b1') $$, 'the owner can hand it to a member');
select is((select owner_id from public.walls), '00000000-0000-0000-0000-0000000000b1'::uuid,
  'who then owns the wall');
select is((select role from public.wall_members where user_id = '00000000-0000-0000-0000-0000000000b1'), 'owner',
  'with the owner role');
select is((select role from public.wall_members where user_id = auth.uid()), 'setter',
  'and the old owner stays on as a setter');
select throws_ok($$ select public.create_invite('10000000-0000-0000-0000-0000000000a1') $$,
  NULL, 'without the owner''s rights');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
update public.walls set name = 'Their garage';
select is((select name from public.walls), 'Their garage', 'the new owner has them');
select is((select count(*)::int from public.wall_members where role = 'owner'), 1, 'and there is still one owner');

select * from finish();
rollback;
