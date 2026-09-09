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
  if auth.uid() is null or not private.is_room_member(p_room_id) then
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
