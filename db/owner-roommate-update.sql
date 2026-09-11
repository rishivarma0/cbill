create or replace function public.owner_upsert_roommate(
  p_room_id uuid, p_username text, p_display_name text,
  p_password text, p_role text default 'member'
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_username text := lower(trim(p_username));
  v_existing_role text;
begin
  if auth.uid() is null or not private.is_room_owner(p_room_id) then
    raise exception 'Owner access required';
  end if;
  if v_username is null or v_username = '' or char_length(v_username) > 40
    or v_username !~ '^[a-z0-9._-]+$' then
    raise exception 'Invalid username';
  end if;
  if p_display_name is null or trim(p_display_name) = ''
    or char_length(trim(p_display_name)) > 60 then
    raise exception 'Invalid display name';
  end if;
  if p_password is null or char_length(p_password) < 6 then
    raise exception 'Password must be at least 6 characters';
  end if;
  select a.role into v_existing_role from public.room_accounts a
    where a.room_id = p_room_id and a.username = v_username for update;
  if p_role is null or p_role not in ('owner','admin','member') then
    raise exception 'Invalid role';
  end if;
  if (v_existing_role = 'owner' and p_role <> 'owner')
     or (p_role = 'owner' and v_existing_role is distinct from 'owner') then
    raise exception 'Room ownership cannot be changed here';
  end if;
  insert into public.room_accounts(room_id, username, display_name, password_hash, role, is_active)
  values (p_room_id, v_username, trim(p_display_name),
    extensions.crypt(p_password, extensions.gen_salt('bf')), p_role, true)
  on conflict (room_id, username) do update set
    display_name = excluded.display_name,
    password_hash = excluded.password_hash,
    role = excluded.role,
    updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.owner_upsert_roommate(uuid,text,text,text,text) from public, anon;
grant execute on function public.owner_upsert_roommate(uuid,text,text,text,text) to authenticated;
