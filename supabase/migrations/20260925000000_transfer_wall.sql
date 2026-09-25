-- Handing a wall to another member.
--
-- The owner's rights are spread across policies that all ask "is this the
-- owner?", and ownership itself cannot change through them: walls_change
-- keeps owner_id = auth.uid(), and members_role never touches the owner
-- role. So the handover is one function, done atomically: the new owner
-- takes the wall and the owner role, and the old owner stays on as a
-- setter.
create function public.transfer_wall(p_wall uuid, p_to uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_owner(p_wall) then
    raise exception 'only the wall''s owner can hand it on' using errcode = '42501';
  end if;
  if p_to = auth.uid() then
    return;
  end if;
  if not exists (select 1 from public.wall_members where wall_id = p_wall and user_id = p_to) then
    raise exception 'they must be a member of the wall first' using errcode = 'P0002';
  end if;

  update public.wall_members set role = 'setter' where wall_id = p_wall and user_id = auth.uid();
  update public.wall_members set role = 'owner' where wall_id = p_wall and user_id = p_to;
  update public.walls set owner_id = p_to where id = p_wall;
end $$;
