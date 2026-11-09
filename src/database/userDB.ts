// src/database/userDB.ts
// MedStat user accounts, authentication and offline-first user storage.
// REVISED (direct-to-Supabase): login, deleteUser() and getUser() no longer
// call the localhost:3001 / Render backend — they talk to Supabase directly.
// The backend is now used only for first-run tenant registration
// (register-tenant), plus settings via supabase.ts pullSettings.

import { db } from "./db";
import type { User } from "../types";
import { compareSync } from "bcryptjs";

/* -------------------------------------------------------------------------- */
/* API configuration                                                          */
/* -------------------------------------------------------------------------- */

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:3001")
).replace(/\/+$/, "");

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface MedStatUser {
  id: string;
  username: string;
  phone: string | null;
  email: string | null;
  role: string;
  tenant_id: string;
  tenantId?: string;
  assigned_courses?: string[];
  assignedCourses?: string[];
  profile_pic?: string | null;
  profilePic?: string | null;
  created_at?: string;
  createdAt?: string;
  tuition?: { expected: number; paid: number };
  remuneration?: { net_salary: number; per_diem: number };
  password?: string;
  synced?: boolean;
  authToken?: string;
  token?: string;
}

export interface LoginInput {
  username: string;
  password: string;
  phone?: string;
  tenantId?: string;
  business_name?: string;
  businessName?: string;
}

export interface NewUserInput {
  id?: string;
  username: string;
  password?: string;
  phone?: string;
  email?: string;
  role?: string;
  assigned_courses?: string[];
  profile_pic?: string | null;
  tuition?: { expected: number; paid: number };
  remuneration?: { net_salary: number; per_diem: number };
  businessName?: string;
  business_name?: string;
  tempToken?: string;
}

/* -------------------------------------------------------------------------- */
/* Session helpers                                                            */
/* -------------------------------------------------------------------------- */

export function getToken(): string | null {
  try {
    const currentUser = JSON.parse(
      localStorage.getItem("currentUser") || "null",
    );

    return (
      localStorage.getItem("authToken") ||
      localStorage.getItem("token") ||
      currentUser?.authToken ||
      currentUser?.token ||
      null
    );
  } catch {
    return null;
  }
}

export function setSession(
  authToken: string,
  user: MedStatUser,
): MedStatUser {
  const sessionUser = {
    ...user,
    authToken,
    token: authToken,
  };

  try {
    localStorage.setItem("authToken", authToken);
    localStorage.setItem("currentUser", JSON.stringify(sessionUser));
  } catch {
    // Session persistence may be unavailable in private browsing.
  }

  return sessionUser;
}

export function clearSession(): void {
  try {
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
  } catch {
    // Ignore unavailable storage.
  }
}

/* -------------------------------------------------------------------------- */
/* HTTP helper (backend — login + tenant registration only)                    */
/* -------------------------------------------------------------------------- */

class BackendOfflineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendOfflineError";
  }
}

async function api<T>(
  path: string,
  init?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    token?: string | null;
  },
): Promise<T> {
  const token = init?.token === undefined ? getToken() : init.token;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: init?.method || "POST",
      headers,
      body: init?.body == null ? undefined : JSON.stringify(init.body),
    });
  } catch (error: any) {
    throw new BackendOfflineError(
      `Cannot reach the backend at ${API_BASE}: ${
        error?.message || "network error"
      }`,
    );
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      (data as any)?.error || `Request failed (${response.status})`,
    );
  }

  return data as T;
}

/* -------------------------------------------------------------------------- */
/* Supabase access (dynamic import — keeps env-missing crashes isolated)       */
/* -------------------------------------------------------------------------- */

async function getSupabase(): Promise<any | null> {
  try {
    const module: any = await import("../auth/supabase");
    return module?.supabase?.from ? module.supabase : null;
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Local database and utility helpers                                         */
/* -------------------------------------------------------------------------- */

async function dexieUsers(): Promise<any[]> {
  try {
    return (await (db as any).users.toArray()) || [];
  } catch {
    return [];
  }
}

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // Use the fallback below.
  }

  return `u-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function sameText(a: unknown, b: unknown): boolean {
  const first = String(a ?? "").trim();
  const second = String(b ?? "").trim();

  return (
    first !== "" &&
    second !== "" &&
    first.toLowerCase() === second.toLowerCase()
  );
}

function normalizeUser(row: any): MedStatUser {
  const courses = Array.isArray(row?.assigned_courses)
    ? row.assigned_courses
    : Array.isArray(row?.assignedCourses)
      ? row.assignedCourses
      : undefined;

  const profilePic = row?.profile_pic ?? row?.profilePic ?? null;
  const createdAt = row?.created_at ?? row?.createdAt ?? undefined;

  const user: MedStatUser = {
    id: String(row?.id ?? row?.user_id ?? makeId()),
    username: String(row?.username ?? ""),
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    role: String(row?.role ?? "admin"),
    tenant_id: String(row?.tenant_id ?? row?.tenantId ?? ""),
    tenantId: row?.tenantId ?? row?.tenant_id ?? undefined,
    assigned_courses: courses,
    assignedCourses: courses,
    profile_pic: profilePic,
    profilePic,
    created_at: createdAt,
    createdAt,
  };

  if (row?.password != null) user.password = row.password;
  if (row?.synced != null) user.synced = row.synced;
  if (row?.tuition != null) user.tuition = row.tuition;
  if (row?.remuneration != null) user.remuneration = row.remuneration;

  return user;
}

/**
 * Supports legacy plaintext records and bcrypt hashes.
 * Missing passwords are rejected rather than treating a cached account
 * as authenticated without a password check.
 */
async function verifyPassword(
  typedPassword: string,
  storedPassword: unknown,
): Promise<boolean> {
  const typed = String(typedPassword ?? "");
  const stored = String(storedPassword ?? "");

  if (!typed || !stored) return false;

  // Legacy records may still contain plaintext passwords.
  if (stored === typed) return true;

  if (/^\$2[aby]\$/.test(stored)) {
    try {
      return compareSync(typed, stored);
    } catch {
      return false;
    }
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Credential lookup: Supabase first (authoritative), local second            */
/* -------------------------------------------------------------------------- */

interface SupabaseLookup {
  row: any | null;
  reachable: boolean;
}

/**
 * Looks a user up directly in Supabase (public.users). `reachable` is false
 * only when the network call itself failed or the client is unavailable — a
 * clean "no row" result is reachable:true with row:null.
 */
async function findSupabaseUser(
  username: string,
  phone: string,
  tenantId?: string,
): Promise<SupabaseLookup> {
  const supabase = await getSupabase();

  if (!supabase) return { row: null, reachable: false };

  const filters = [
    username ? `username.ilike.${username}` : "",
    phone ? `phone.eq.${phone}` : "",
  ].filter(Boolean);

  if (!filters.length) return { row: null, reachable: true };

  try {
    let query = supabase.from("users").select("*").is("deleted_at", null);

    if (tenantId) query = query.eq("tenant_id", tenantId);

    const { data, error } = await query.or(filters.join(",")).limit(1);

    return {
      row: !error && Array.isArray(data) ? (data[0] ?? null) : null,
      reachable: true,
    };
  } catch {
    return { row: null, reachable: false };
  }
}

/**
 * Locally saved accounts: Dexie first, then the cached session user.
 * Covers accounts created offline (synced:false) and previously signed-in
 * users, so login still works with no network at all.
 */
async function findLocalUser(
  username: string,
  phone: string,
): Promise<any | null> {
  // 1. Dexie local users.
  const users = await dexieUsers();
  const localUser = users.find(
    (user) =>
      sameText(user?.username, username) ||
      (phone && sameText(user?.phone, phone)),
  );

  if (localUser) return localUser;

  // 2. Previously signed-in user.
  let cachedUser: any = null;

  try {
    cachedUser = JSON.parse(
      localStorage.getItem("currentUser") || "null",
    );
  } catch {
    cachedUser = null;
  }

  if (
    cachedUser &&
    (sameText(cachedUser.username, username) ||
      (phone && sameText(cachedUser.phone, phone)))
  ) {
    return cachedUser;
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Login                                                                      */
/* -------------------------------------------------------------------------- */

export async function loginUser(
  input: string | LoginInput,
  passwordArg?: string,
  phoneArg?: string,
): Promise<MedStatUser> {
  const credentials: LoginInput =
    typeof input === "string"
      ? {
          username: input,
          password: passwordArg || "",
          phone: phoneArg,
        }
      : input;

  if (!credentials?.username || !credentials?.password) {
    throw new Error("Username and password are required.");
  }

  const username = String(credentials.username || "").trim();
  const phone = String(credentials.phone || "").trim();

  // 1. Primary path — authenticate straight against Supabase. No backend call:
  //    the localhost:3001 / Render hop (and its "backend unreachable" error)
  //    is gone from the login flow entirely.
  const { row: supabaseUser, reachable } = await findSupabaseUser(
    username,
    phone,
    credentials.tenantId,
  );

  if (supabaseUser) {
    if (!(await verifyPassword(credentials.password, supabaseUser.password))) {
      throw new Error("Invalid username or password.");
    }

    try {
      await (db as any).users.put({
        ...supabaseUser,
        synced: true,
      });
    } catch {
      // Continue with the authenticated session.
    }

    return setSession(
      getToken() || `offline-${supabaseUser.id || makeId()}`,
      normalizeUser(supabaseUser),
    );
  }

  // 2. Fallback — locally saved account (created offline or previously cached).
  const localUser = await findLocalUser(username, phone);

  if (localUser) {
    if (!(await verifyPassword(credentials.password, localUser.password))) {
      throw new Error("Invalid username or password.");
    }

    console.warn(
      "[userDB] Signed in using locally stored credentials (Supabase unavailable or account not yet synced).",
    );

    return setSession(
      getToken() || `offline-${localUser.id || makeId()}`,
      normalizeUser(localUser),
    );
  }

  // 3. Nothing matched — a clear message, with no backend URL in it.
  if (!reachable) {
    throw new Error(
      "Cannot sign in right now: you appear to be offline and no saved " +
        "account on this device matches these credentials.",
    );
  }

  throw new Error("Invalid username or password.");
}

/* -------------------------------------------------------------------------- */
/* Add user                                                                   */
/* -------------------------------------------------------------------------- */

export async function addUser(
  input: NewUserInput,
): Promise<MedStatUser> {
  if (!input?.username?.trim()) {
    throw new Error("Username is required.");
  }

  const token = getToken();
  const users = await dexieUsers();
  const username = input.username.trim();
  const phone = String(input.phone || "").trim();

  const existingByUsername =
    users.find(
      (user) =>
        sameText(user?.username, username) && user?.id !== input.id,
    ) || null;

  const existingByPhone =
    (phone &&
      users.find(
        (user) =>
          sameText(user?.phone, phone) && user?.id !== input.id,
      )) ||
    null;

  if ((existingByUsername || existingByPhone) && token) {
    throw new Error(
      existingByUsername
        ? "Username already exists."
        : "Phone number already registered to another user.",
    );
  }

  const existing = existingByUsername || existingByPhone;

  const localRow: any = existing
    ? {
        ...existing,
        ...input,
        id: existing.id,
        synced: existing.synced ?? false,
      }
    : {
        ...input,
        id: input.id || makeId(),
        // Respect a caller-provided flag: the login flow passes synced:true
        // because the row already exists in Supabase. Only genuinely
        // offline-created users default to false.
        synced: (input as any).synced ?? false,
      };

  localRow.username = username;
  localRow.role = localRow.role || "admin";
  localRow.tenant_id =
    localRow.tenant_id ||
    (input as any).tenant_id ||
    (input as any).tenantId ||
    "";
  localRow.phone = localRow.phone ?? null;
  localRow.email = localRow.email ?? null;

  try {
    await (db as any).users.put(localRow);
  } catch {
    // The caller may still perform the cloud operation.
  }

  // First-run tenant registration.
  if (!token && input.tempToken) {
    const businessName = input.businessName ?? input.business_name;

    if (businessName) {
      const response = await api<{
        authToken: string;
        user: MedStatUser;
      }>("/api/auth/register-tenant", {
        body: {
          phone: input.phone,
          tempToken: input.tempToken,
          businessName,
          username: input.username,
          password: input.password,
        },
        token: null,
      });

      return setSession(
        response.authToken,
        normalizeUser({
          ...response.user,
          tenant_id:
            response.user.tenant_id || response.user.tenantId || "",
        }),
      );
    }
  }

  if (token) return normalizeUser(localRow);

  if (existing) return normalizeUser(localRow);

  console.warn(
    "[userDB] User saved locally only (synced:false). Cloud sync will occur after sign-in.",
  );

  return normalizeUser(localRow);
}

/* -------------------------------------------------------------------------- */
/* Get user — Supabase first, Dexie fallback (no backend)                      */
/* -------------------------------------------------------------------------- */

export async function getUser(
  id?: string,
): Promise<MedStatUser | null> {
  let currentUser: MedStatUser | null = null;

  try {
    currentUser = JSON.parse(
      localStorage.getItem("currentUser") || "null",
    );
  } catch {
    currentUser = null;
  }

  if (!id) return currentUser;
  if (currentUser?.id === id) return currentUser;

  // 1. Supabase (direct — replaces GET /api/users/list).
  const supabase = await getSupabase();

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("users")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .maybeSingle();

      if (!error && data) {
        try {
          await (db as any).users.put({ ...data, synced: true });
        } catch {
          // Cache failure is non-fatal.
        }
        return normalizeUser(data);
      }
    } catch {
      // Supabase may be unreachable while offline — fall through to Dexie.
    }
  }

  // 2. Local Dexie fallback.
  const users = await dexieUsers();
  const found = users.find((user) => user?.id === id);

  return found ? normalizeUser(found) : null;
}

/* -------------------------------------------------------------------------- */
/* Get all users                                                              */
/* -------------------------------------------------------------------------- */

export async function getUsers(): Promise<User[]> {
  return (await dexieUsers()) as User[];
}

/* -------------------------------------------------------------------------- */
/* Update user                                                                */
/* -------------------------------------------------------------------------- */

export async function updateUser(
  user: Partial<User> & { id: string },
): Promise<void> {
  if (!user?.id) throw new Error("User ID is required.");

  try {
    const existing = await (db as any).users.get(user.id);

    await (db as any).users.put({
      ...(existing || {}),
      ...user,
      synced: false,
    });
  } catch {
    // Cloud update may still be handled by the caller.
  }
}

/* -------------------------------------------------------------------------- */
/* Delete user — Supabase soft-delete first, then local                        */
/* -------------------------------------------------------------------------- */

export async function deleteUser(id: string): Promise<void> {
  if (!id) throw new Error("User ID is required.");

  // 1. Soft-delete in Supabase FIRST (replaces POST /api/users/delete).
  //    Cloud-first order: if the network is down we throw BEFORE touching the
  //    local row, so the delete can simply be retried later instead of the
  //    user disappearing locally and resurrecting on the next pull.
  const supabase = await getSupabase();

  if (!supabase) {
    throw new Error("Supabase client unavailable — cloud delete skipped.");
  }

  const { error } = await supabase
    .from("users")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);

  if (error) throw new Error(error.message);

  // 2. Local delete.
  try {
    await (db as any).users.delete(id);
  } catch {
    // purgeDeletedFromDexie() will catch stragglers on the next pull.
  }

  // 3. Best-effort tombstone, so the row can never be resurrected even if
  //    someone hard-deletes it from the Supabase dashboard later.
  try {
    const tracker: any = await import("./deletedIdsTracker");
    const mark =
      tracker.trackDeletedId ??
      tracker.markDeletedId ??
      tracker.recordDeletedId ??
      tracker.addDeletedId ??
      tracker.noteDeletedId;
    if (typeof mark === "function") {
      await mark("user", id);
    }
  } catch {
    // The tracker may expose a different marker or be unavailable — the
    // deleted_at soft-delete above is the primary resurrection guard.
  }
}

/* -------------------------------------------------------------------------- */
/* Recently pushed users — protects against read-after-write lag              */
/* -------------------------------------------------------------------------- */

const PUSH_LOG_KEY = "userPushLog";
const PUSH_LOG_WINDOW_MS = 60_000;
const PUSH_LOG_MAX = 200;

export function noteUserPushed(id: string): void {
  if (!id) return;

  try {
    const now = Date.now();
    const previous: { id: string; ts: number }[] = JSON.parse(
      localStorage.getItem(PUSH_LOG_KEY) || "[]",
    );

    const updated = [{ id, ts: now }, ...previous]
      .filter(
        (entry) =>
          entry?.id && now - entry.ts < PUSH_LOG_WINDOW_MS,
      )
      .slice(0, PUSH_LOG_MAX);

    localStorage.setItem(PUSH_LOG_KEY, JSON.stringify(updated));
  } catch {
    // Storage may be unavailable.
  }
}

export async function getRecentlyPushedUserIds(): Promise<string[]> {
  try {
    const now = Date.now();
    const entries: { id: string; ts: number }[] = JSON.parse(
      localStorage.getItem(PUSH_LOG_KEY) || "[]",
    );

    return entries
      .filter(
        (entry) =>
          entry?.id && now - entry.ts < PUSH_LOG_WINDOW_MS,
      )
      .map((entry) => entry.id);
  } catch {
    return [];
  }
}
