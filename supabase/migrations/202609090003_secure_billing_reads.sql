create or replace function public.get_room_billing_snapshot(p_room_id uuid)
returns table (
  username text,
  display_name text,
  role text,
  current_due numeric,
  advance_credit numeric,
  total_paid numeric,
  next_payment numeric,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'room access required';
  end if;

  return query
  select
    account.username,
    account.display_name,
    account.role,
    balance.current_due,
    balance.advance_credit,
    balance.total_paid,
    least(setting.contribution_amount, balance.current_due) as next_payment,
    account.is_active
  from public.room_accounts as account
  join public.room_member_balances as balance
    on balance.account_id = account.id and balance.room_id = account.room_id
  join public.room_billing_settings as setting on setting.room_id = account.room_id
  where account.room_id = p_room_id
  order by account.created_at, account.username;
end;
$$;

revoke all on function public.get_room_billing_snapshot(uuid) from public;
revoke all on function public.get_room_billing_snapshot(uuid) from anon;
grant execute on function public.get_room_billing_snapshot(uuid) to authenticated;

create or replace function public.get_room_payment_history(
  p_room_id uuid,
  p_include_deleted boolean default false
)
returns table (
  id uuid,
  username text,
  display_name text,
  amount numeric,
  effective_at timestamptz,
  note text,
  created_at timestamptz,
  updated_at timestamptz,
  deleted_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if auth.uid() is null or not exists (
    select 1
    from public.room_members as member
    where member.room_id = p_room_id
      and member.user_id = auth.uid()
  ) then
    raise exception 'room access required';
  end if;

  if p_include_deleted and not private.is_room_manager(p_room_id) then
    raise exception 'owner access required';
  end if;

  return query
  select
    payment.id,
    account.username,
    account.display_name,
    payment.amount,
    payment.effective_at,
    payment.note,
    payment.created_at,
    payment.updated_at,
    payment.deleted_at
  from public.room_payments as payment
  join public.room_accounts as account on account.id = payment.account_id
  where payment.room_id = p_room_id
    and (payment.deleted_at is null or p_include_deleted)
  order by payment.effective_at desc, payment.created_at desc;
end;
$$;

revoke all on function public.get_room_payment_history(uuid, boolean) from public;
revoke all on function public.get_room_payment_history(uuid, boolean) from anon;
grant execute on function public.get_room_payment_history(uuid, boolean) to authenticated;
