-- Room identity is tied to an account ID, never to a display name.
alter table public.room_accounts add column if not exists is_app_owner boolean not null default false;
update public.room_accounts a set is_app_owner=true
from public.rooms r where r.id=a.room_id and r.slug='311' and a.role='owner';
alter table public.room_members add column if not exists account_id uuid references public.room_accounts(id);
update public.room_members m set account_id=a.id from public.room_accounts a
where m.account_id is null and m.room_id=a.room_id and m.display_name=a.display_name
and m.role=a.role and (select count(*) from public.room_accounts b where b.room_id=m.room_id and b.display_name=m.display_name and b.role=m.role)=1;

create or replace function private.is_app_owner() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.room_members m join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and a.is_active and a.is_app_owner);
$$;
create or replace function private.has_room_access(p_room_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_app_owner() or exists(select 1 from public.room_members m
 join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and m.room_id=p_room_id and a.is_active);
$$;
create or replace function private.is_room_owner(p_room_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_app_owner() and exists(select 1 from public.rooms where id=p_room_id);
$$;
create or replace function private.is_room_manager(p_room_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.is_room_owner(p_room_id);
$$;
revoke all on function private.is_app_owner(), private.has_room_access(uuid) from public,anon;
grant execute on function private.is_app_owner(), private.has_room_access(uuid) to authenticated;

create or replace function public.join_room(p_room_slug text,p_login_id text,p_password text)
returns table(room_id uuid,display_name text,role text)
language plpgsql security definer set search_path='' as $$
declare v_account public.room_accounts%rowtype;
begin
 if auth.uid() is null or p_password is null then raise exception 'Incorrect login details'; end if;
 select a.* into v_account from public.room_accounts a join public.rooms r on r.id=a.room_id
 where r.slug=lower(trim(p_room_slug)) and a.username=lower(trim(p_login_id)) and a.is_active;
 if not found or extensions.crypt(p_password,v_account.password_hash) is distinct from v_account.password_hash then
 raise exception 'Incorrect login details'; end if;
 delete from public.room_members where user_id=auth.uid() and room_members.room_id<>v_account.room_id;
 insert into public.room_members(room_id,user_id,account_id,display_name,role)
 values(v_account.room_id,auth.uid(),v_account.id,v_account.display_name,v_account.role)
 on conflict on constraint room_members_pkey do update set account_id=excluded.account_id,display_name=excluded.display_name,role=excluded.role;
 return query select v_account.room_id,v_account.display_name,case when v_account.is_app_owner then 'owner' else 'member' end;
end; $$;

create or replace function public.get_my_room_access(p_room_id uuid)
returns table(display_name text,role text,can_edit_history boolean,can_manage_roommates boolean,can_edit_all boolean)
language sql security definer set search_path='' as $$
 select a.display_name,case when a.is_app_owner then 'owner' else 'member' end,a.is_app_owner,a.is_app_owner,a.is_app_owner
 from public.room_members m join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and a.is_active and (m.room_id=p_room_id or a.is_app_owner)
 and exists(select 1 from public.rooms where id=p_room_id) limit 1;
$$;

create or replace function public.list_my_rooms()
returns table(room_id uuid,slug text,display_name text,can_pay boolean,username text)
language sql security definer set search_path='' as $$
 select r.id,r.slug,r.display_name,
 exists(select 1 from public.room_members m join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and m.room_id=r.id and a.is_active),
 (select a.username from public.room_members m join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and m.room_id=r.id and a.is_active limit 1)
 from public.rooms r where private.has_room_access(r.id) order by r.created_at,r.slug;
$$;

create or replace function public.owner_create_room(p_slug text,p_display_name text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_room uuid; v_slug text:=lower(trim(p_slug));
begin
 if not private.is_app_owner() then raise exception 'Owner access required'; end if;
 if v_slug is null or v_slug !~ '^[a-z0-9][a-z0-9_-]{0,39}$' then raise exception 'Invalid room ID'; end if;
 if p_display_name is null or char_length(trim(p_display_name)) not between 1 and 60 then raise exception 'Invalid room name'; end if;
 insert into public.rooms(slug,display_name,join_code_hash)
 values(v_slug,trim(p_display_name),extensions.crypt(encode(extensions.gen_random_bytes(32),'hex'),extensions.gen_salt('bf')))
 returning id into v_room;
 insert into public.room_state(room_id) values(v_room);
 insert into public.room_billing_settings(room_id,contribution_amount) values(v_room,500);
 return v_room;
end; $$;

-- Reuse the established financial engine and history queries with the shared access guard.
do $$
declare v_name text; v_def text;
begin
 foreach v_name in array array['get_room_billing_snapshot','get_room_payment_history'] loop
 select pg_get_functiondef(p.oid) into strict v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname=v_name;
 v_def:=replace(v_def,'not exists(select 1 from public.room_members as member where member.room_id=p_room_id and member.user_id=auth.uid())','not private.has_room_access(p_room_id)');
 execute v_def;
 end loop;
end; $$;

-- Replace read policies, retaining deleted-payment restrictions.
do $$
declare p record; v_expr text;
begin
 for p in select * from pg_policies where schemaname='public' and cmd='SELECT'
 and tablename in ('rooms','ledger_events','room_state','billing_cycle_members','room_billing_settings','room_member_balances','room_payments','billing_cycles') loop
 v_expr:=case when p.tablename='rooms' then 'private.has_room_access(id)' else 'private.has_room_access(room_id)' end;
 if p.tablename='room_payments' then v_expr:=v_expr||' and (deleted_at is null or private.is_app_owner())'; end if;
 execute format('alter policy %I on public.%I using (%s)',p.policyname,p.tablename,v_expr);
 end loop;
end; $$;
alter policy "members can update room state" on public.room_state
using(private.has_room_access(room_id)) with check(private.has_room_access(room_id));
alter policy "members can add ledger events" on public.ledger_events
with check(created_by=auth.uid() and private.has_room_access(room_id));

create or replace function public.record_room_payment(p_room_id uuid,p_username text,p_amount numeric,p_effective_at timestamptz default now(),p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_account uuid; v_payment uuid;
begin
 if auth.uid() is null then raise exception 'Authentication required'; end if;
 if p_amount is null or p_amount<=0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'Invalid amount'; end if;
 select a.id into v_account from public.room_members m join public.room_accounts a on a.id=m.account_id and a.room_id=m.room_id
 where m.user_id=auth.uid() and m.room_id=p_room_id and a.is_active and a.username=lower(trim(p_username));
 if v_account is null then raise exception 'You can only record your own payment in your room'; end if;
 perform pg_advisory_xact_lock(hashtext(p_room_id::text));
 insert into public.room_payments(room_id,account_id,amount,effective_at,note,created_by)
 values(p_room_id,v_account,round(p_amount,2),coalesce(p_effective_at,now()),nullif(trim(p_note),''),auth.uid()) returning id into v_payment;
 perform private.recalculate_room_billing(p_room_id);
 insert into public.ledger_events(room_id,created_by,event_type,payload)
 values(p_room_id,auth.uid(),'payment_recorded',jsonb_build_object('payment_id',v_payment,'username',p_username,'amount',round(p_amount,2)));
 return v_payment;
end; $$;

create or replace function public.owner_set_roommate_active(p_room_id uuid,p_username text,p_is_active boolean)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not private.is_room_owner(p_room_id) then raise exception 'Owner access required'; end if;
 if p_is_active is null then raise exception 'Invalid status'; end if;
 if exists(select 1 from public.room_accounts where room_id=p_room_id and username=lower(trim(p_username)) and is_app_owner) then
 raise exception 'The app owner must remain active'; end if;
 update public.room_accounts set is_active=p_is_active,updated_at=now() where room_id=p_room_id and username=lower(trim(p_username));
 if not found then raise exception 'Roommate not found'; end if;
end; $$;

revoke all on function public.list_my_rooms(),public.owner_create_room(text,text),public.get_my_room_access(uuid) from public,anon;
grant execute on function public.list_my_rooms(),public.owner_create_room(text,text),public.get_my_room_access(uuid) to authenticated;
