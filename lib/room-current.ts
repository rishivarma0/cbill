import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

export const ROOM_SLUG = '311';
export const SESSION_KEY = 'room-current-access-v2';

export type RoomAccess = {
  roomId: string;
  username: string;
  displayName: string;
  role: string;
  canEditHistory: boolean;
  canManageRoommates: boolean;
  canEditAll: boolean;
};

export type BillingMember = {
  username: string;
  display_name: string;
  role: string;
  current_due: number;
  advance_credit: number;
  total_paid: number;
  next_payment: number;
  is_active: boolean;
};

export type Payment = {
  id: string;
  username: string;
  display_name: string;
  amount: number;
  effective_at: string;
  note: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Roommate = {
  username: string;
  display_name: string;
  role: string;
  is_active: boolean;
};

export type RoomState = {
  next_username?: string;
};

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function oneRow<T>(data: T[] | T | null): T | null {
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

const INITIAL_ORDER = ['rishi', 'mohan', 'nandan'];

function roommateOrder(username: string) {
  const index = INITIAL_ORDER.indexOf(username);
  return index < 0 ? INITIAL_ORDER.length : index;
}

export function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : '';
  if (/network|fetch|offline|timeout/i.test(message)) return 'Network connection lost. Your action was not saved.';
  if (/owner|admin|permission|access/i.test(message)) return 'You do not have permission for that action.';
  return fallback;
}

export async function joinRoom(client: SupabaseClient, loginId: string, password: string) {
  const username = loginId.trim().toLowerCase();
  const { data, error } = await client.rpc('join_room', {
    p_room_slug: ROOM_SLUG,
    p_login_id: username,
    p_password: password,
  });
  const joined = oneRow<{ room_id: string; display_name: string; role: string }>(data);
  if (error || !joined) throw new Error('Incorrect login details');
  return {
    username,
    roomId: joined.room_id,
    displayName: joined.display_name,
    role: joined.role,
  };
}

export async function getAccess(client: SupabaseClient, roomId: string, username: string) {
  const { data, error } = await client.rpc('get_my_room_access', { p_room_id: roomId });
  const row = oneRow<{
    display_name: string;
    role: string;
    can_edit_history: boolean;
    can_manage_roommates: boolean;
    can_edit_all: boolean;
  }>(data);
  if (error || !row) throw new Error('Your room session has expired.');
  return {
    roomId,
    username,
    displayName: row.display_name,
    role: row.role,
    canEditHistory: row.can_edit_history,
    canManageRoommates: row.can_manage_roommates,
    canEditAll: row.can_edit_all,
  } satisfies RoomAccess;
}

export async function getBillingSnapshot(client: SupabaseClient, roomId: string) {
  const { data, error } = await client.rpc('get_room_billing_snapshot', { p_room_id: roomId });
  if (error) throw new Error('Could not load the latest billing status.');
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    username: String(row.username),
    display_name: String(row.display_name),
    role: String(row.role),
    current_due: toNumber(row.current_due),
    advance_credit: toNumber(row.advance_credit),
    total_paid: toNumber(row.total_paid),
    next_payment: toNumber(row.next_payment),
    is_active: Boolean(row.is_active),
  })).sort((a, b) => roommateOrder(a.username) - roommateOrder(b.username)) satisfies BillingMember[];
}

export async function getPaymentHistory(client: SupabaseClient, roomId: string, includeDeleted: boolean) {
  const { data, error } = await client.rpc('get_room_payment_history', {
    p_room_id: roomId,
    p_include_deleted: includeDeleted,
  });
  if (error) throw new Error('Could not load payment history.');
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    username: String(row.username),
    display_name: String(row.display_name),
    amount: toNumber(row.amount),
    effective_at: String(row.effective_at),
    note: typeof row.note === 'string' ? row.note : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    deleted_at: typeof row.deleted_at === 'string' ? row.deleted_at : null,
  })) satisfies Payment[];
}

export async function getRoomState(client: SupabaseClient, roomId: string) {
  const { data, error } = await client
    .from('room_state')
    .select('state,revision')
    .eq('room_id', roomId)
    .single();
  if (error) throw new Error('Could not load the payment turn.');
  return {
    state: (data.state ?? {}) as RoomState,
    revision: Number(data.revision),
  };
}

export async function saveNextPayer(
  client: SupabaseClient,
  roomId: string,
  state: RoomState,
  revision: number,
  nextUsername: string | undefined,
) {
  const nextState = { ...state, next_username: nextUsername };
  const { data, error } = await client
    .from('room_state')
    .update({ state: nextState })
    .eq('room_id', roomId)
    .eq('revision', revision)
    .select('revision')
    .maybeSingle();
  if (error) throw new Error('Payment saved, but the next turn could not be updated. Refresh to check the latest turn.');
  return Boolean(data);
}

export async function listRoommates(client: SupabaseClient, roomId: string) {
  const { data, error } = await client.rpc('owner_list_roommates', { p_room_id: roomId });
  if (error) throw new Error('Could not load roommates.');
  return ((data ?? []) as Roommate[]).sort(
    (a, b) => roommateOrder(a.username) - roommateOrder(b.username),
  );
}

export async function recordPayment(
  client: SupabaseClient,
  access: RoomAccess,
  amount: number,
  note: string,
) {
  const { error } = await client.rpc('record_room_payment', {
    p_room_id: access.roomId,
    p_username: access.username,
    p_amount: amount,
    p_effective_at: new Date().toISOString(),
    p_note: note.trim() || null,
  });
  if (error) throw new Error('Payment could not be saved. Nothing was changed.');
}

export async function startBillingCycle(client: SupabaseClient, roomId: string, note: string) {
  const { data, error } = await client.rpc('start_billing_cycle', {
    p_room_id: roomId,
    p_note: note.trim() || null,
  });
  if (error) throw new Error('The new billing cycle could not be started. Nothing was changed.');
  return oneRow<{ cycle_id: string; cycle_number: number }>(data);
}

export async function updatePayment(
  client: SupabaseClient,
  paymentId: string,
  username: string,
  amount: number,
  effectiveAt: string,
  note: string,
) {
  const { error } = await client.rpc('owner_update_payment', {
    p_payment_id: paymentId,
    p_username: username,
    p_amount: amount,
    p_effective_at: effectiveAt,
    p_note: note.trim() || null,
  });
  if (error) throw new Error('The payment could not be updated. Nothing was changed.');
}

export async function deletePayment(client: SupabaseClient, paymentId: string) {
  const { error } = await client.rpc('owner_delete_payment', { p_payment_id: paymentId });
  if (error) throw new Error('The payment could not be deleted. Nothing was changed.');
}

export async function restorePayment(client: SupabaseClient, paymentId: string) {
  const { error } = await client.rpc('owner_restore_payment', { p_payment_id: paymentId });
  if (error) throw new Error('The payment could not be restored. Nothing was changed.');
}

export async function upsertRoommate(
  client: SupabaseClient,
  roomId: string,
  username: string,
  displayName: string,
  password: string,
  role: string,
) {
  const { error } = await client.rpc('owner_upsert_roommate', {
    p_room_id: roomId,
    p_username: username.trim().toLowerCase(),
    p_display_name: displayName.trim(),
    p_password: password,
    p_role: role,
  });
  if (error) throw new Error('The roommate could not be saved. Nothing was changed.');
}

export async function setRoommateActive(
  client: SupabaseClient,
  roomId: string,
  username: string,
  isActive: boolean,
) {
  const { error } = await client.rpc('owner_set_roommate_active', {
    p_room_id: roomId,
    p_username: username,
    p_is_active: isActive,
  });
  if (error) throw new Error('The roommate status could not be changed. Nothing was changed.');
}

export function subscribeToRoom(
  client: SupabaseClient,
  roomId: string,
  onChange: () => void,
  onStatus: (status: string) => void,
): RealtimeChannel {
  const channel = client.channel(`room-current:${roomId}`);
  for (const table of [
    'room_member_balances',
    'room_payments',
    'billing_cycles',
    'billing_cycle_members',
    'ledger_events',
    'room_state',
  ]) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `room_id=eq.${roomId}` },
      onChange,
    );
  }
  channel.subscribe(onStatus);
  return channel;
}
