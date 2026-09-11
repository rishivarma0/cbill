"use client";

import {
  SyntheticEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowRight,
  Check,
  Download,
  Edit3,
  History,
  Loader2,
  LogOut,
  Plus,
  Receipt,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
  Users,
  Wifi,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useRoomSession } from "./login-gate";
import {
  BillingMember,
  Payment,
  RoomState,
  Roommate,
  deletePayment,
  friendlyError,
  getBillingSnapshot,
  getPaymentHistory,
  getRoomState,
  listRoommates,
  recordPayment,
  restorePayment,
  saveNextPayer,
  setRoommateActive,
  startBillingCycle,
  subscribeToRoom,
  updatePayment,
  upsertRoommate,
} from "@/lib/room-current";
import { getSupabase } from "@/lib/supabase";
import { afterNextPayment, nextAfter, resolveNextPayer } from "@/lib/turns";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: string }>;
};

type RoommateDraft = {
  isEditing: boolean;
  username: string;
  displayName: string;
  password: string;
  role: string;
};

function money(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
}

function localDateTime(value: string) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function displayDate(value: string, note?: string | null) {
  if (note?.startsWith('Imported payment record: 20/22 August')) return '20/22 Aug 2026 · date unspecified';
  if (note?.startsWith('Imported payment record:')) {
    return new Date(value).toLocaleDateString('en-IN', {day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});
  }
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Home() {
  const { roomId, username, access, logout } = useRoomSession();
  const isOwner = access.role === "owner";
  const canEdit = isOwner && access.canEditHistory;
  const canManage = isOwner && access.canManageRoommates;

  const [members, setMembers] = useState<BillingMember[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [roommates, setRoommates] = useState<Roommate[]>([]);
  const [roomState, setRoomState] = useState<RoomState>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [live, setLive] = useState<"online" | "reconnecting">("online");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [ownerOpen, setOwnerOpen] = useState(false);
  const [cycleConfirm, setCycleConfirm] = useState(false);
  const [cycleNote, setCycleNote] = useState("");
  const [editPayment, setEditPayment] = useState<Payment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Payment | null>(null);
  const [roommateDraft, setRoommateDraft] = useState<RoommateDraft | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    const client = await getSupabase();
    const [snapshot, history, state, managedRoommates] = await Promise.all([
      getBillingSnapshot(client, roomId),
      getPaymentHistory(client, roomId, canEdit),
      getRoomState(client, roomId),
      canManage ? listRoommates(client, roomId) : Promise.resolve([]),
    ]);
    setMembers(snapshot);
    setPayments(history);
    setRoomState(state.state);
    setRoommates(managedRoommates);
  }, [canEdit, canManage, roomId]);

  useEffect(() => {
    let cancelled = false;
    const initialRefresh = setTimeout(() => {
      void refresh()
        .catch((refreshError) => {
          if (!cancelled) setError(friendlyError(refreshError, "Could not load Room 311."));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 0);

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const captureInstall = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", captureInstall);
    return () => {
      cancelled = true;
      clearTimeout(initialRefresh);
      window.removeEventListener("beforeinstallprompt", captureInstall);
    };
  }, [refresh]);

  useEffect(() => {
    let channel: ReturnType<typeof subscribeToRoom> | null = null;
    let cancelled = false;
    void getSupabase().then((client) => {
      if (cancelled) return;
      channel = subscribeToRoom(
        client,
        roomId,
        () => {
          if (refreshTimer.current) clearTimeout(refreshTimer.current);
          refreshTimer.current = setTimeout(() => {
            refresh().catch(() => setLive("reconnecting"));
          }, 180);
        },
        (status) => {
          if (status === "SUBSCRIBED") {
            setLive("online");
            void refresh().catch(() => setLive("reconnecting"));
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            setLive("reconnecting");
          }
        },
      );
    }).catch(() => setLive("reconnecting"));
    return () => {
      cancelled = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (channel) void channel.unsubscribe();
    };
  }, [refresh, roomId]);

  const activePayments = useMemo(
    () => payments.filter((payment) => !payment.deleted_at),
    [payments],
  );
  const deletedPayments = useMemo(
    () => payments.filter((payment) => payment.deleted_at),
    [payments],
  );
  const nextPayer = useMemo(
    () => resolveNextPayer(members, roomState.next_username),
    [members, roomState.next_username],
  );
  const me = members.find((member) => member.username === username);
  const totalPaid = members.reduce((sum, member) => sum + member.total_paid, 0);

  async function runAction(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    let saved = false;
    try {
      await action();
      saved = true;
      await refresh();
      setMessage(success);
    } catch (actionError) {
      setError(saved ? 'Saved successfully, but the latest display could not be refreshed. Refresh before submitting again.' : friendlyError(actionError, actionError instanceof Error ? actionError.message : 'Could not confirm the result. Refresh history before trying again.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitPayment(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    const paidAmount = Number(amount);
    if (!Number.isFinite(paidAmount) || paidAmount <= 0) {
      setError("Enter a valid payment amount.");
      return;
    }

    await runAction(async () => {
      const client = await getSupabase();
      const previousNext = nextPayer?.username;
      await recordPayment(client, access, paidAmount, note);
      setAmount("");
      setNote("");
      try {
      const [latestMembers, latestState] = await Promise.all([
        getBillingSnapshot(client, roomId),
        getRoomState(client, roomId),
      ]);
      const candidate =
        previousNext === username
          ? nextAfter(latestMembers, username)
          : resolveNextPayer(latestMembers, previousNext);
      await saveNextPayer(
        client,
        roomId,
        latestState.state,
        latestState.revision,
        candidate?.username,
      );
      } catch {
        throw new Error('Payment saved, but the next turn could not be refreshed. Do not submit it again; refresh the page.');
      }
    }, "Payment saved and synced.");
  }

  async function submitPaymentEdit(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editPayment || !canEdit) return;
    const form = new FormData(event.currentTarget);
    const editedAmount = Number(form.get("amount"));
    const effectiveAtValue = form.get("effectiveAt");
    const usernameValue = form.get("username");
    const noteValue = form.get("note");
    const effectiveAt = new Date(typeof effectiveAtValue === "string" ? effectiveAtValue : "").toISOString();
    const editedUsername = typeof usernameValue === "string" ? usernameValue : "";
    const editedNote = typeof noteValue === "string" ? noteValue : "";
    await runAction(async () => {
      const client = await getSupabase();
      await updatePayment(client, editPayment.id, editedUsername, editedAmount, effectiveAt, editedNote);
      setEditPayment(null);
    }, "Payment corrected and balances recalculated.");
  }

  async function confirmDelete() {
    if (!deleteTarget || !canEdit) return;
    await runAction(async () => {
      const client = await getSupabase();
      await deletePayment(client, deleteTarget.id);
      setDeleteTarget(null);
    }, "Payment deleted and balances recalculated.");
  }

  async function handleRestore(payment: Payment) {
    if (!canEdit) return;
    await runAction(async () => {
      const client = await getSupabase();
      await restorePayment(client, payment.id);
    }, "Payment restored and balances recalculated.");
  }

  async function confirmNewCycle() {
    if (!isOwner) return;
    await runAction(async () => {
      const client = await getSupabase();
      await startBillingCycle(client, roomId, cycleNote);
      setCycleNote("");
      setCycleConfirm(false);
    }, "New ₹500 billing cycle started.");
  }

  async function submitRoommate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roommateDraft || !isOwner || !canManage) return;
    await runAction(async () => {
      const client = await getSupabase();
      await upsertRoommate(
        client,
        roomId,
        roommateDraft.username,
        roommateDraft.displayName,
        roommateDraft.password,
        roommateDraft.role,
      );
      setRoommateDraft(null);
    }, "Roommate saved. Their password was not stored on this device.");
  }

  async function toggleRoommate(roommate: Roommate) {
    if (!isOwner || !canManage || roommate.username === username) return;
    await runAction(async () => {
      const client = await getSupabase();
      await setRoommateActive(client, roomId, roommate.username, !roommate.is_active);
    }, roommate.is_active ? "Roommate disabled." : "Roommate enabled.");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Room Current home">
          <span className="brand-icon"><Zap size={20} fill="currentColor" /></span>
          <span>Room Current</span>
          <span className="room-tag">311</span>
        </a>
        <div className="top-actions">
          {installPrompt ? (
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await installPrompt.prompt();
                setInstallPrompt(null);
              }}
            >
              <Download size={15} /> Install
            </Button>
          ) : null}
          {isOwner ? <span className="owner-badge">Owner</span> : null}
          <span className="signed-in">{access.displayName}</span>
          <Button variant="ghost" size="icon-sm" onClick={logout} aria-label="Sign out">
            <LogOut size={17} />
          </Button>
        </div>
      </header>

      <main id="top" className="dashboard">
        <div className="page-heading">
          <div>
            <p className="eyebrow">ROOM 311 · ELECTRICITY</p>
          </div>
          <span className={`live-label ${live}`}>
            {live === "online" ? <Wifi size={14} /> : <WifiOff size={14} />}
            {live === "online" ? "Live sync" : "Reconnecting"}
          </span>
        </div>

        {message ? <output className="notice success"><Check size={17} />{message}</output> : null}
        {error ? (
          <div className="notice error" role="alert">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => refresh().then(() => setError(""))}>
              <RefreshCw size={14} /> Retry
            </Button>
          </div>
        ) : null}

        <div className="dashboard-grid">
          <section className="primary-column">
            <article className={`next-card ${nextPayer ? "has-payment" : "covered"}`}>
              <div className="card-top">
                <p className="eyebrow">NEXT PAYMENT</p>
                <span className="turn-pill">Live room rotation</span>
              </div>
              {loading ? (
                <div className="loading-row"><Loader2 className="spin" /> Loading the latest balance…</div>
              ) : members.length === 0 ? (
                <div className="loading-row">Billing status unavailable. Please retry.</div>
              ) : nextPayer ? (
                <>
                  <div className="next-person">
                    <span className="avatar large">{nextPayer.display_name.slice(0, 1)}</span>
                    <div>
                      <p>Up next</p>
                      <h2>{nextPayer.display_name}</h2>
                    </div>
                    <strong className="next-amount">{money(nextPayer.next_payment)}</strong>
                  </div>
                  <div className="next-details">
                    <span>{money(nextPayer.current_due)} outstanding</span>
                    <span>{money(afterNextPayment(nextPayer))} after this payment</span>
                  </div>
                </>
              ) : (
                <div className="covered-state">
                  <span className="covered-icon"><Check size={24} /></span>
                  <div><h2>Covered this cycle ✓</h2><p>No payment is currently required.</p></div>
                </div>
              )}
              <div className="rotation" aria-label="Payment rotation">
                {members.filter((member) => member.is_active).map((member, index) => (
                  <span key={member.username} className={member.username === nextPayer?.username ? "active" : member.current_due === 0 ? "paid" : ""}>
                    <span className="step">{member.current_due === 0 ? <Check size={11} /> : index + 1}</span>
                    {member.display_name}
                  </span>
                ))}
              </div>
            </article>

            <article className="panel payment-card">
              <div className="section-heading">
                <div><p className="eyebrow">YOUR PAYMENT</p><h2>Record a payment</h2></div>
                <Zap size={20} />
              </div>
              <p className="section-note">
                This payment will be recorded only for {access.displayName}. The date and time are added automatically.
              </p>
              {me ? (
                <div className="personal-balance">
                  <div><span>Outstanding</span><strong className={me.current_due > 0 ? "amber" : "green"}>{money(me.current_due)}</strong></div>
                  <div><span>Advance credit</span><strong>{money(me.advance_credit)}</strong></div>
                </div>
              ) : null}
              <form onSubmit={submitPayment}>
                <label htmlFor="amount">Amount paid</label>
                <div className="amount-field">
                  <span>₹</span>
                  <Input
                    id="amount"
                    type="number"
                    min="0.01"
                    step="0.01"
                    inputMode="decimal"
                    placeholder="500"
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    required
                  />
                </div>
                <label htmlFor="payment-note">Note <span className="optional">optional</span></label>
                <Textarea
                  id="payment-note"
                  placeholder="Meter recharge, bill payment…"
                  maxLength={240}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
                <Button className="primary-button full" type="submit" disabled={busy || loading || !me?.is_active}>
                  {busy ? <Loader2 className="spin" size={17} /> : <ArrowRight size={18} />}
                  {busy ? "Saving…" : "Save my payment"}
                </Button>
              </form>
            </article>
          </section>

          <section className="secondary-column">
            <div className="summary-strip">
              <div><span>Total paid</span><strong>{money(totalPaid)}</strong></div>
              <div><span>Payments</span><strong>{activePayments.length}</strong></div>
              <div><span>Active roommates</span><strong>{members.filter((member) => member.is_active).length}</strong></div>
            </div>

            <article className="panel balances-card">
              <div className="section-heading">
                <div><p className="eyebrow">ROOM STATUS</p><h2>Everyone’s balance</h2></div>
                <Users size={20} />
              </div>
              <div className="balance-list">
                {members.filter((member) => member.is_active).map((member) => (
                  <div className="balance-row" key={member.username}>
                    <span className="avatar">{member.display_name.slice(0, 1)}</span>
                    <div className="balance-name">
                      <strong>{member.display_name}</strong>
                      <span>{member.advance_credit > 0 ? `${money(member.advance_credit)} advance` : `${money(member.total_paid)} paid`}</span>
                    </div>
                    <div className="balance-value">
                      <strong className={member.current_due > 0 ? "amber" : "green"}>{money(member.current_due)}</strong>
                      <span>{member.current_due > 0 ? `Next ${money(member.next_payment)}` : "Covered"}</span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="panel history-card">
              <div className="section-heading">
                <div><p className="eyebrow">LEDGER</p><h2>Payment history</h2></div>
                <Receipt size={20} />
              </div>
              {loading ? (
                <div className="empty-state"><Loader2 className="spin" /> Loading history…</div>
              ) : activePayments.length === 0 ? (
                <div className="empty-state"><Receipt size={25} /><strong>No payments yet</strong><span>The first payment will appear here.</span></div>
              ) : (
                <ol className="history-list">
                  {activePayments.map((payment) => (
                    <li key={payment.id}>
                      <span className="avatar">{payment.display_name.slice(0, 1)}</span>
                      <div className="history-person">
                        <strong>{payment.display_name}</strong>
                        <time dateTime={payment.effective_at}>{displayDate(payment.effective_at, payment.note)}</time>
                        {payment.note ? <span className="payment-note">{payment.note}</span> : null}
                      </div>
                      <div className="history-amount"><strong>{money(payment.amount)}</strong><span><Check size={12} /> Paid</span></div>
                      {canEdit ? (
                        <div className="history-actions">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditPayment(payment)} aria-label={`Edit ${payment.display_name} payment`}><Edit3 size={15} /></Button>
                          <Button variant="ghost" size="icon-sm" className="danger" onClick={() => setDeleteTarget(payment)} aria-label={`Delete ${payment.display_name} payment`}><Trash2 size={15} /></Button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </article>

            {isOwner ? (
              <Button className="owner-entry" variant="outline" onClick={() => setOwnerOpen(true)}>
                <Settings2 size={17} /> Owner controls
              </Button>
            ) : null}
          </section>
        </div>
        <footer>Made with ❤️ by Rishi Varma</footer>
      </main>

      {ownerOpen && isOwner ? (
        <div className="modal-backdrop">
          <dialog open className="owner-panel" aria-label="Owner controls">
            <div className="modal-heading">
              <div><span className="owner-badge">Owner</span><h2>Room controls</h2></div>
              <Button variant="ghost" size="icon-sm" onClick={() => setOwnerOpen(false)} aria-label="Close owner controls"><X /></Button>
            </div>
            <section className="owner-section">
              <div><h3>Billing cycle</h3><p>Add the configured ₹500 obligation to every active roommate.</p></div>
              <Button onClick={() => setCycleConfirm(true)}><Plus size={16} /> Start New Cycle</Button>
            </section>
            {isOwner && canManage ? (
              <section className="owner-block">
                <div className="section-heading"><div><p className="eyebrow">ACCESS</p><h3>Manage Roommates</h3></div><Users size={19} /></div>
                <div className="roommate-list">
                  {roommates.map((roommate) => (
                      <div className="roommate-row" key={roommate.username}>
                        <span className="avatar">{roommate.display_name.slice(0, 1)}</span>
                        <div><strong>{roommate.display_name}</strong><span>@{roommate.username} · {roommate.role}</span></div>
                        <Button variant="ghost" size="sm" onClick={() => setRoommateDraft({ isEditing: true, username: roommate.username, displayName: roommate.display_name, password: "", role: roommate.role })}>Edit</Button>
                        {roommate.username === username ? <span className="protected-label">Current</span> : <Button variant="outline" size="sm" onClick={() => toggleRoommate(roommate)} disabled={busy}>{roommate.is_active ? "Disable" : "Enable"}</Button>}
                      </div>
                    ))}
                </div>
                <Button variant="outline" className="full" onClick={() => setRoommateDraft({ isEditing: false, username: "", displayName: "", password: "", role: "member" })}>
                  <Plus size={16} /> Add roommate
                </Button>
                <p className="security-note">Passwords are sent directly to the secure backend and are never displayed or saved on this device.</p>
              </section>
            ) : null}
            {canEdit ? (
              <section className="owner-block">
                <div className="section-heading"><div><p className="eyebrow">ARCHIVE</p><h3>Deleted payments</h3></div><History size={19} /></div>
                {deletedPayments.length === 0 ? <p className="section-note">No deleted payments.</p> : (
                  <div className="deleted-list">
                    {deletedPayments.map((payment) => (
                      <div key={payment.id}>
                        <span><strong>{payment.display_name} · {money(payment.amount)}</strong><small>{displayDate(payment.effective_at)}</small></span>
                        <Button variant="outline" size="sm" onClick={() => handleRestore(payment)} disabled={busy}><RotateCcw size={14} /> Restore</Button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ) : null}
          </dialog>
        </div>
      ) : null}

      {cycleConfirm && isOwner ? (
        <div className="modal-backdrop centered">
          <div className="confirm-card" role="alertdialog" aria-modal="true">
            <h2>Start a new billing cycle?</h2>
            <p>This adds ₹500 to each active roommate’s obligation. Existing unpaid amounts remain and personal advance is applied automatically.</p>
            <label htmlFor="cycle-note">Cycle note <span className="optional">optional</span></label>
            <Input id="cycle-note" value={cycleNote} onChange={(event) => setCycleNote(event.target.value)} placeholder="September current bill" maxLength={240} />
            <div className="modal-actions"><Button variant="ghost" onClick={() => setCycleConfirm(false)}>Cancel</Button><Button onClick={confirmNewCycle} disabled={busy}>{busy ? <Loader2 className="spin" /> : <Plus />} Start cycle</Button></div>
          </div>
        </div>
      ) : null}

      {deleteTarget && canEdit ? (
        <div className="modal-backdrop centered">
          <div className="confirm-card" role="alertdialog" aria-modal="true">
            <h2>Delete this payment?</h2>
            <p>{deleteTarget.display_name} · {money(deleteTarget.amount)} · {displayDate(deleteTarget.effective_at)}. Balances will be recalculated by the backend. You can restore it later.</p>
            <div className="modal-actions"><Button variant="ghost" onClick={() => setDeleteTarget(null)}>Cancel</Button><Button className="destructive-button" onClick={confirmDelete} disabled={busy}>{busy ? <Loader2 className="spin" /> : <Trash2 />} Delete</Button></div>
          </div>
        </div>
      ) : null}

      {editPayment && canEdit ? (
        <div className="modal-backdrop centered">
          <dialog open className="form-modal"><form onSubmit={submitPaymentEdit}>
            <div className="modal-heading"><h2>Edit payment</h2><Button type="button" variant="ghost" size="icon-sm" onClick={() => setEditPayment(null)}><X /></Button></div>
            <label htmlFor="edit-payer">Payer</label>
            <select id="edit-payer" name="username" defaultValue={editPayment.username} required>
              {roommates.filter((roommate) => roommate.is_active || roommate.username === editPayment.username).map((roommate) => <option key={roommate.username} value={roommate.username}>{roommate.display_name}</option>)}
            </select>
            <label htmlFor="edit-amount">Amount</label>
            <Input id="edit-amount" name="amount" type="number" min="0.01" step="0.01" defaultValue={editPayment.amount} required />
            <label htmlFor="edit-date">Payment date and time</label>
            <Input id="edit-date" name="effectiveAt" type="datetime-local" defaultValue={localDateTime(editPayment.effective_at)} required />
            <label htmlFor="edit-note">Note</label>
            <Textarea id="edit-note" name="note" defaultValue={editPayment.note ?? ""} maxLength={240} />
            <Button className="primary-button full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Check />} Save correction</Button>
          </form></dialog>
        </div>
      ) : null}

      {roommateDraft && isOwner && canManage ? (
        <div className="modal-backdrop centered">
          <dialog open className="form-modal"><form onSubmit={submitRoommate}>
            <div className="modal-heading"><h2>{roommateDraft.isEditing ? "Edit roommate" : "Add roommate"}</h2><Button type="button" variant="ghost" size="icon-sm" onClick={() => setRoommateDraft(null)}><X /></Button></div>
            <label htmlFor="roommate-username">Login ID</label>
            <Input id="roommate-username" autoCapitalize="none" value={roommateDraft.username} disabled={roommateDraft.isEditing} onChange={(event) => setRoommateDraft({ ...roommateDraft, username: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "") })} required />
            <label htmlFor="roommate-name">Display name</label>
            <Input id="roommate-name" value={roommateDraft.displayName} onChange={(event) => setRoommateDraft({ ...roommateDraft, displayName: event.target.value })} required />
            <label htmlFor="roommate-password">{roommateDraft.isEditing ? "New password" : "Password"}</label>
            <Input id="roommate-password" type="password" autoComplete="new-password" value={roommateDraft.password} onChange={(event) => setRoommateDraft({ ...roommateDraft, password: event.target.value })} required />
            <label htmlFor="roommate-role">Role</label>
            <select id="roommate-role" value={roommateDraft.role} onChange={(event) => setRoommateDraft({ ...roommateDraft, role: event.target.value })}>
              <option value="member">Member</option><option value="admin">Admin</option>{roommateDraft.role === "owner" ? <option value="owner">Owner</option> : null}
            </select>
            <p className="security-note">The password is sent to the backend once. It will not be displayed again.</p>
            <Button className="primary-button full" type="submit" disabled={busy}>{busy ? <Loader2 className="spin" /> : <Check />} Save roommate</Button>
          </form></dialog>
        </div>
      ) : null}
    </div>
  );
}
