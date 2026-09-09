create or replace function public.join_room(
  p_room_slug text,
  p_login_id text,
  p_password text
)
returns table(room_id uuid, display_name text, role text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room public.rooms%rowtype;
  v_account public.room_accounts%rowtype;
  v_username text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  v_username := lower(trim(p_login_id));

  select room_record.* into v_room
  from public.rooms as room_record
  where room_record.slug = p_room_slug;

  if not found then
    raise exception 'Room not found';
  end if;

  select account_record.* into v_account
  from public.room_accounts as account_record
  where account_record.room_id = v_room.id
    and account_record.username = v_username
    and account_record.is_active = true
  limit 1;

  if not found
    or extensions.crypt(p_password, v_account.password_hash) <> v_account.password_hash then
    raise exception 'Invalid login details';
  end if;

  insert into public.room_members(room_id, user_id, display_name, role)
  values (v_room.id, auth.uid(), v_account.display_name, v_account.role)
  on conflict on constraint room_members_pkey
  do update set
    display_name = excluded.display_name,
    role = excluded.role;

  return query select v_room.id, v_account.display_name, v_account.role;
end;
$$;
