"use client";

import {
  createContext,
  ReactNode,
  SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Loader2, LockKeyhole, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  SESSION_KEY,
  RoomAccess,
  friendlyError,
  getAccess,
  joinRoom,
  listMyRooms,
  AvailableRoom,
} from "@/lib/room-current";
import { ensureAnonymousSession, getSupabase } from "@/lib/supabase";

type RoomSession = {
  roomId: string;
  username: string;
  access: RoomAccess;
};

type RoomContextValue = RoomSession & {
  logout: () => void;
  rooms: AvailableRoom[];
  switchRoom: (id: string) => Promise<void>;
  refreshRooms: () => Promise<void>;
};

const RoomContext = createContext<RoomContextValue | null>(null);

export function useRoomSession() {
  const value = useContext(RoomContext);
  if (!value) throw new Error("useRoomSession must be used inside LoginGate");
  return value;
}

export default function LoginGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<RoomSession | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rooms, setRooms] = useState<AvailableRoom[]>([]);
  const [roomSlug, setRoomSlug] = useState("311");
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function restore() {
      try {
        const saved = sessionStorage.getItem(SESSION_KEY);
        if (!saved) return;
        const parsed = JSON.parse(saved) as { roomId?: string; username?: string };
        if (!parsed.roomId) return;

        const client = await getSupabase();
        await ensureAnonymousSession(client);
        const available = await listMyRooms(client);
        const selected = available.find((room) => room.room_id === parsed.roomId);
        if (!selected) throw new Error("Room access expired");
        setRooms(available);
        const access = await getAccess(client, parsed.roomId, selected.username ?? "");
        if (!cancelled) {
          setSession({ roomId: parsed.roomId, username: selected.username ?? "", access });
        }
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    void restore();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLogin(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");

    try {
      const client = await getSupabase();
      await ensureAnonymousSession(client);
      const joined = await joinRoom(client, loginId, password, roomSlug);
      const access = await getAccess(client, joined.roomId, joined.username);
      const nextSession = {
        roomId: joined.roomId,
        username: loginId.trim().toLowerCase(),
        access,
      };
      sessionStorage.setItem(
        SESSION_KEY,
        JSON.stringify({ roomId: nextSession.roomId, username: nextSession.username }),
      );
      setRooms(await listMyRooms(client));
      setPassword("");
      setSession(nextSession);
    } catch (loginError) {
      setPassword("");
      const message = friendlyError(loginError, "Incorrect login details");
      setError(message.startsWith("Network") ? "Network unavailable. Please try again." : "Incorrect login details");
    } finally {
      setSubmitting(false);
    }
  }

  const logout = useCallback(() => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
    setSubmitting(true);
    void getSupabase()
      .then((client) => client.auth.signOut({ scope: 'local' }))
      .catch(() => setError('Could not finish signing out. Please retry.'))
      .finally(() => setSubmitting(false));
  }, []);


  async function refreshRooms() {
    setRooms(await listMyRooms(await getSupabase()));
  }
  async function switchRoom(id: string) {
    if (!session) return;
    const client = await getSupabase();
    const available = await listMyRooms(client);
    const room = available.find((item) => item.room_id === id);
    if (!room) throw new Error("Room access unavailable");
    const access = await getAccess(client, id, room.username ?? "");
    const next = { roomId: id, username: room.username ?? "", access };
    setRooms(available);
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ roomId: id, username: next.username }));
    setSession(next);
  }
  const contextValue = session ? { ...session, logout, rooms, switchRoom, refreshRooms } : null;


  if (checking) {
    return (
      <main className="login-shell">
        <output className="login-loader" aria-label="Loading Room Current">
          <Loader2 className="spin" size={24} />
        </output>
      </main>
    );
  }

  if (!contextValue) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark" aria-hidden="true">
            <Zap size={24} />
          </div>
          <p className="eyebrow">YOUR ROOM LEDGER</p>
          <h1>Room Current</h1>
          <p className="login-subtitle">Track every payment and know who pays next.</p>

          <form className="login-form" onSubmit={handleLogin}>
            <label htmlFor="login-room">Room ID</label>
            <Input id="login-room" value={roomSlug} autoCapitalize="none" maxLength={40} onChange={(event) => setRoomSlug(event.target.value)} required />
            <label htmlFor="login-id">Login ID</label>
            <Input
              id="login-id"
              name="login-id"
              autoComplete="username"
              autoCapitalize="none"
              value={loginId}
              onChange={(event) => setLoginId(event.target.value)}
              required
            />

            <label htmlFor="password">Password</label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />

            {error ? <p className="form-error" role="alert">{error}</p> : null}

            <Button className="primary-button" type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="spin" size={17} /> : <LockKeyhole size={17} />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="maker-credit">Made with ❤️ by Rishi Varma</p>
        </section>
      </main>
    );
  }

  return <RoomContext.Provider value={contextValue}><div key={session?.roomId}>{children}</div></RoomContext.Provider>;
}
