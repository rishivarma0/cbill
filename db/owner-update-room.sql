create or replace function public.owner_update_room(p_room_id uuid,p_slug text,p_display_name text)
returns void language plpgsql security definer set search_path='' as $$
declare v_slug text:=lower(trim(p_slug));
begin
 if auth.uid() is null or not private.is_room_owner(p_room_id) then raise exception 'Owner access required'; end if;
 if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then raise exception 'Invalid room ID'; end if;
 if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 60 then raise exception 'Invalid room name'; end if;
 update public.rooms set slug=v_slug,display_name=trim(p_display_name) where id=p_room_id;
 if not found then raise exception 'Room not found'; end if;
end; $$;
revoke all on function public.owner_update_room(uuid,text,text) from public,anon;
grant execute on function public.owner_update_room(uuid,text,text) to authenticated;
