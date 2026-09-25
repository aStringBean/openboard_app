import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient, type Session } from "@supabase/supabase-js";
import { AppState } from "react-native";

/*
 * Local Supabase by default: the phone reaches the laptop over USB with
 * `adb reverse tcp:54321 tcp:54321`. The key is the standard local-
 * development key the Supabase CLI prints, not a secret. A hosted project
 * sets both through EXPO_PUBLIC_ variables at build time.
 */
const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "http://localhost:54321";
/** Which server this build talks to; shared walls belong to one server. */
export const SERVER_URL = URL;
const KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY ?? "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

export const cloud = createClient(URL, KEY, {
  auth: {
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    /* Sign-in is by a typed code, never a link, so there is no URL to read. */
    detectSessionInUrl: false,
  },
});

/* Refresh tokens only while the app is in front, as Supabase recommends on
 * mobile: a backgrounded app cannot keep a timer running anyway. */
AppState.addEventListener("change", (s) => {
  if (s === "active") void cloud.auth.startAutoRefresh();
  else void cloud.auth.stopAutoRefresh();
});

// ------------------------------------------------------------------ session

/* One session per app, read by every screen through useSession. */
let session: Session | null = null;
let known = false;
const listeners = new Set<() => void>();

const emit = () => {
  for (const l of listeners) l();
};

void cloud.auth.getSession().then(({ data }) => {
  session = data.session;
  known = true;
  emit();
});

cloud.auth.onAuthStateChange((_event, next) => {
  session = next;
  known = true;
  emit();
});

export interface SessionState {
  /** False until the stored session has been read, so screens can wait rather than flash "signed out". */
  known: boolean;
  session: Session | null;
}

let snapshot: SessionState = { known, session };

export function getSessionState(): SessionState {
  if (snapshot.known !== known || snapshot.session !== session) snapshot = { known, session };
  return snapshot;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentUserId = (): string | null => session?.user.id ?? null;

// --------------------------------------------------------------------- auth

const clean = (email: string) => email.trim().toLowerCase();

/** Emails a 6-digit sign-in code. The account is created on first use. */
export async function sendCode(email: string): Promise<void> {
  const { error } = await cloud.auth.signInWithOtp({ email: clean(email), options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyCode(email: string, code: string): Promise<void> {
  const { error } = await cloud.auth.verifyOtp({ email: clean(email), token: code.trim(), type: "email" });
  if (error) throw error;
}

export async function signOut(): Promise<void> {
  const { error } = await cloud.auth.signOut();
  if (error) throw error;
}

// ------------------------------------------------------------------ profile

export async function getDisplayName(): Promise<string> {
  const id = currentUserId();
  if (!id) return "";
  const { data, error } = await cloud.from("profiles").select("display_name").eq("id", id).single();
  if (error) throw error;
  return data.display_name;
}

export async function setDisplayName(name: string): Promise<void> {
  const id = currentUserId();
  if (!id) throw new Error("Not signed in");
  const { error } = await cloud.from("profiles").update({ display_name: name.trim().slice(0, 40) }).eq("id", id);
  if (error) throw error;
}

/** Plain-language versions of the errors people will actually hit. */
export function friendlyAuthError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/network request failed|fetch failed/i.test(msg)) return "Can't reach the server. Check your connection.";
  if (/expired|invalid/i.test(msg) && /token|otp/i.test(msg)) return "That code is wrong or has expired.";
  if (/rate limit|too many/i.test(msg)) return "Too many attempts — wait a minute and try again.";
  if (/email/i.test(msg) && /invalid|format/i.test(msg)) return "That doesn't look like an email address.";
  return msg;
}
