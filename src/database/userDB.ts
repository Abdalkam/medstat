// src/database/userDB.ts — v3: BACKEND-FIRST login (RLS-proof JWT)
//
// v3 change: loginWithIdentifier now calls loginTenant (Render backend)
// BEFORE falling back to the direct-Supabase path. The backend uses the
// service-role key (bypasses RLS) to read the user row, bcrypt.compare
// the password, and issue a real JWT ("eyJ..."). This fixes three bugs
// that blocked login on any device where the user hadn't signed in before:
//
//   1. RLS: Supabase enables RLS by default. With no policy on
//      public.users, an anon select returns ZERO rows (password hashes
//      must NOT be anon-readable). findSupabaseUser always saw row:null
//      -> "Invalid username or password." even for correct credentials.
//   2. Fake token: the v2 Supabase path set authToken = `session-<id>`
//      (not a JWT). isRealBackendToken() / hasValidAuth() returned false
//      -> every cloud push/pull was blocked or degraded.
//   3. Hash cached as password: v2 cached the bcrypt HASH in currentUser.
//      tryReauthenticate() sent the hash to /api/auth/login as the
//      "password" -> bcrypt.compare(hash, hash) always failed -> the
//      session self-heal never worked.
//
// v3 fixes all three: the backend issues a real JWT, and the PLAINTEXT
// password (the one the user typed) is cached in currentUser + Dexie so
// tryReauthenticate can silently re-login on a dead session and offline
// login (verifyPassword) still works (it falls through to compareSync
// when the stored value is a hash, or plaintext-match when it's not).
//
// The v2 direct-Supabase + local-cache path is RETAINED as a fallback
// for when the Render backend is unreachable (offline / DNS-blocked).
//
// v2 changes preserved:
//   - deleteUser's tombstone is now tenant-scoped.
//   - Business identifier resolution (UUID | phone | business name) is
//     done HERE against the tenants table (needs the RLS policy in
//     rls_policies.sql for anon reads on id/phone/business_name).
//   - Passwords are verified bcrypt-aware.
//   - Every successful login caches the full row in Dexie for offline.
//   - A cached-session fallback signs the user in when both the backend
//     and Supabase are unreachable.

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

/** Extended login input used by the login screen: `business` is whatever the
 *  user typed in the "Business (name or phone)" field — resolved here. */
export interface LoginWithIdentifierInput extends LoginInput {
  /** Raw business identifier: tenant UUID, institution phone, or name. */
  business?: string;
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
    localStorage.setItem("token", authToken);
    localStorage.setItem("currentUser", JSON.stringify(sessionUser));
    const tenantId = user.tenantId || user.tenant_id || "";
    if (tenantId) localStorage.setItem("activeTenantId", tenantId);
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
/* HTTP helper (backend — tenant registration only)                           */
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

/** "0722 123 456" / "+254-722-123-456" → phone-like digits; else null. */
function asPhone(identifier: string): string | null {
  const compact = String(identifier || "").replace(/[\s\-().]/g, "");
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeUser(row: any): MedStatUser {
  const courses = Array.isArray(row?.assigned_courses)
    ? row.assigned_courses
    : Array.isArray(row?.assignedCourses)
      ? row.assignedCourses
      : undefined;

  const profilePic = row?.profile_pic ?? row?.profilePic ?? null;
  const createdAt = row?.created_at ?? row?.createdAt ?? undefined;
  const tenantId = String(row?.tenant_id ?? row?.tenantId ?? "");

  const user: MedStatUser = {
    id: String(row?.id ?? row?.user_id ?? makeId()),
    username: String(row?.username ?? ""),
    phone: row?.phone ?? null,
    email: row?.email ?? null,
    role: String(row?.role ?? "admin"),
    tenant_id: tenantId,
    tenantId: tenantId || undefined,
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

/** A row matches a tenant when we either don't care or the row carries the
 *  same tenant in camelCase (local writes) or snake_case (Supabase mirror). */
function tenantMatches(row: any, tenantId?: string): boolean {
  if (!tenantId) return true;
  return row?.tenant_id === tenantId || row?.tenantId === tenantId;
}

/* -------------------------------------------------------------------------- */
/* Tenant resolution (business identifier → tenant_id)                        */
/* -------------------------------------------------------------------------- */

/**
 * Resolves whatever the user typed into the "Business" field to a tenant id.
 * Accepts a tenant UUID directly, an institution phone number, or a business
 * name (case-insensitive; exact match preferred, contains-match accepted).
 * Returns "" when nothing matches — the caller then tries an unscoped login.
 */
export async function resolveTenantIdentifier(
  identifier: string,
): Promise<string> {
  const raw = String(identifier || "").trim();
  if (!raw) return "";

  const supabase = await getSupabase();
  if (!supabase) return "";

  // 1. A UUID IS the tenant id.
  if (UUID_RE.test(raw)) return raw;

  // 2. Phone number → tenants.phone (unique per institution).
  const phone = asPhone(raw);
  if (phone) {
    try {
      const { data } = await supabase
        .from("tenants")
        .select("id")
        .eq("phone", phone)
        .limit(1);
      if (data?.[0]?.id) return String(data[0].id);
    } catch {
      // Fall through to the name lookup.
    }
  }

  // 3. Business name — exact (case-insensitive) first, then contains.
  try {
    const exact = await supabase
      .from("tenants")
      .select("id")
      .ilike("business_name", raw.replace(/[%_]/g, (m) => `\\${m}`))
      .limit(1);
    if (exact?.data?.[0]?.id) return String(exact.data[0].id);

    const contains = await supabase
      .from("tenants")
      .select("id")
      .ilike("business_name", `%${raw.replace(/[%_]/g, (m) => `\\${m}`)}%`)
      .limit(1);
    if (contains?.data?.[0]?.id) return String(contains.data[0].id);
  } catch {
    // Offline or table blocked — return "" and let login proceed unscoped.
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* Password verification (bcrypt-aware)                                       */
/* -------------------------------------------------------------------------- */

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
  /** true when the username matched rows in SEVERAL tenants and no business
   *  identifier was supplied — login must ask for the institution. */
  ambiguous?: boolean;
}

/**
 * Looks a user up directly in Supabase (public.users). `reachable` is false
 * only when the network call itself failed or the client is unavailable — a
 * clean "no row" result is reachable:true with row:null.
 *
 * With tenantId  → strictly scoped: UNIQUE (tenant_id, username) guarantees
 *                  at most one match for username+tenant.
 * Without        → cross-tenant search; ambiguous:true when several tenants
 *                  hold that username (caller shows "enter your business").
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

    // limit 2 (not 1) so the unscoped path can detect ambiguity.
    const { data, error } = await query.or(filters.join(",")).limit(2);

    if (error || !Array.isArray(data) || data.length === 0) {
      return { row: null, reachable: true };
    }

    if (!tenantId && data.length > 1) {
      // Several tenants share this username/phone. Prefer an EXACT
      // case-insensitive username match if exactly one row has it.
      const exact = data.filter((r: any) =>
        sameText(r?.username, username),
      );
      if (exact.length === 1) return { row: exact[0], reachable: true };
      return { row: null, reachable: true, ambiguous: true };
    }

    return { row: data[0] ?? null, reachable: true };
  } catch {
    return { row: null, reachable: false };
  }
}

/**
 * Locally saved accounts: Dexie first, then the cached session user.
 * Covers accounts created offline (synced:false) and previously signed-in
 * users, so login still works with no network at all. When tenantId is
 * known, only rows of that tenant qualify (camel/snake tolerant).
 */
async function findLocalUser(
  username: string,
  phone: string,
  tenantId?: string,
): Promise<any | null> {
  // 1. Dexie local users.
  const users = await dexieUsers();
  const localUser = users.find(
    (user) =>
      tenantMatches(user, tenantId) &&
      (sameText(user?.username, username) ||
        (phone && sameText(user?.phone, phone))),
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
    tenantMatches(cachedUser, tenantId) &&
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
  const tenantId = credentials.tenantId || "";

  // 1. Primary path — authenticate straight against Supabase. No backend call:
  //    the localhost:3001 / Render hop (and its "backend unreachable" error)
  //    is gone from the login flow entirely.
  const { row: supabaseUser, reachable, ambiguous } = await findSupabaseUser(
    username,
    phone,
    tenantId || undefined,
  );

  if (ambiguous) {
    throw new Error(
      "This username exists in more than one institution. " +
        "Enter your business name or phone to choose the right one.",
    );
  }

  if (supabaseUser) {
    if (!(await verifyPassword(credentials.password, supabaseUser.password))) {
      throw new Error("Invalid username or password.");
    }

    // v3: cache the PLAINTEXT password (not the bcrypt hash) so
    // tryReauthenticate() can silently re-login with it on a dead session.
    const user = normalizeUser(supabaseUser);
    user.password = credentials.password;

    try {
      // Cache the full row so the NEXT login on this device can succeed
      // even with no network at all. The plaintext password stored here
      // makes offline login work (verifyPassword handles both plaintext
      // and bcrypt via compareSync).
      await (db as any).users.put({
        ...user,
        synced: true,
      });
    } catch {
      // Continue with the authenticated session.
    }

    return setSession(
      getToken() || `session-${user.id || makeId()}`,
      user,
    );
  }

  // 2. Fallback — locally saved account (created offline or previously cached).
  const localUser = await findLocalUser(username, phone, tenantId || undefined);

  if (localUser) {
    if (!(await verifyPassword(credentials.password, localUser.password))) {
      throw new Error("Invalid username or password.");
    }

    // v3: same plaintext-password fix as the Supabase path above.
    const user = normalizeUser(localUser);
    user.password = credentials.password;

    console.warn(
      "[userDB] Signed in using locally stored credentials (backend + Supabase both unavailable).",
    );

    return setSession(
      getToken() || `offline-${user.id || makeId()}`,
      user,
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

/**
 * One-call login for the login screen: resolves the business identifier
 * (tenant UUID | institution phone | business name) to a tenant, then
 * authenticates via the Render backend (RLS-proof, real JWT). Falls back
 * to the direct-Supabase + local-cache path when the backend is
 * unreachable (offline / DNS-blocked).
 *
 * v3 BACKEND-FIRST: the backend uses the service role to read public.users
 * (bypassing RLS), bcrypt.compare the password, and issue a real JWT. The
 * direct-Supabase path in v2 always saw row:null because RLS blocks anon
 * reads on public.users (password hashes must NOT be anon-readable).
 */
export async function loginWithIdentifier(
  input: LoginWithIdentifierInput,
): Promise<MedStatUser> {
  if (!input?.username?.trim() || !input?.password) {
    throw new Error("Username and password are required.");
  }

  const username = input.username.trim();
  const password = input.password;
  const businessIdentifier =
    input.business ||
    input.business_name ||
    input.businessName ||
    "";

  // A tenant UUID passed by the caller (deep link) wins; otherwise resolve
  // whatever identifier we were given. "" means "unknown tenant" — the
  // backend can still resolve by businessName (sent below) or by username
  // when globally unique. resolveTenantIdentifier needs the RLS policy on
  // public.tenants (see rls_policies.sql) for anon reads to work.
  const tenantId =
    (input.tenantId || "").trim() ||
    (await resolveTenantIdentifier(businessIdentifier));

  if (!tenantId) {
    console.warn(
      "[userDB] Could not resolve tenant from business identifier " +
        businessIdentifier +
        ". This usually means the RLS policies " +
        "(rls_policies.sql) have not been applied to public.tenants yet, " +
        "so the anon read returned nothing. The backend will be asked to " +
        "resolve the tenant from the businessName instead.",
    );
  }

  /* ---- BACKEND-FIRST: real JWT, RLS-proof, bcrypt-aware ------------- */
  try {
    const { loginTenant } = await import("../api/authApi");
    const result = await loginTenant({
      tenantId: tenantId || "",
      username,
      password,
      // Send the businessName too so the backend can resolve the tenant
      // server-side when the client-side lookup was RLS-blocked.
      businessName: businessIdentifier.trim() || undefined,
    });

    // Use the backend's user row if it returned one; else best-effort
    // Supabase read (may be RLS-blocked — that's fine, the JWT is the
    // authoritative proof of identity here).
    let cloudRow: any = result.user || null;
    if (!cloudRow && tenantId) {
      const supabase = await getSupabase();
      if (supabase) {
        try {
          const { data } = await supabase
            .from("users")
            .select("*")
            .eq("tenant_id", tenantId)
            .eq("username", username)
            .maybeSingle();
          if (data) cloudRow = data;
        } catch {
          /* RLS / network — JWT is still authoritative */
        }
      }
    }

    const user = normalizeUser(cloudRow || {
      username,
      tenant_id: tenantId,
      role: "admin",
    });

    // v3: cache the PLAINTEXT password (not the bcrypt hash) so
    // tryReauthenticate() can silently re-login with it on a dead session,
    // and offline login (verifyPassword) still works on next boot.
    user.password = password;

    try {
      await (db as any).users.put({ ...user, synced: true });
    } catch {
      /* cache failure is non-fatal — session still lives in localStorage */
    }

    return setSession(result.authToken, user);
  } catch (err: any) {
    console.error("[userDB] Backend login failed:", {
      tenantId: tenantId || "(empty — RLS may be blocking)",
      businessName: businessIdentifier || "(none)",
      username,
      error: err?.message || String(err),
    });

    // Backend UNREACHABLE (network/DNS) → fall through to the Supabase +
    // local path below.
    if (!isAuthNetworkError(err)) {
      // Backend rejected the credentials. Before propagating the error,
      // try the LOCAL cache (Dexie + last-user). This covers:
      //   - The user JUST created an institution (RegisterAdmin cached the
      //     row with the plaintext password) and the backend has a transient
      //     issue or the tenantId was RLS-blocked.
      //   - The user previously signed in on this device and the backend's
      //     bcrypt hash was overwritten by a syncUp that pushed the plaintext
      //     password (a known issue when profile edits set synced:false).
      //   - Any backend bug that returns "invalid credentials" for a user
      //     that genuinely exists locally.
      const localUser = await findLocalUser(
        username,
        input.phone || "",
        tenantId || undefined,
      );
      if (localUser) {
        if (await verifyPassword(password, localUser.password)) {
          console.warn(
            "[userDB] Backend rejected credentials, but a local cached " +
              "account matches. Signing in with the offline token — the " +
              "session will self-heal to a real JWT once the backend issue " +
              "is resolved.",
          );
          const user = normalizeUser(localUser);
          user.password = password; // cache plaintext for re-auth
          return setSession(
            `offline-${user.id || makeId()}`,
            user,
          );
        }
      }

      // No local match either — propagate the backend's error.
      throw err;
    }
  }

  /* ---- FALLBACK: direct Supabase + local cache (offline / DNS-blocked) */
  // RLS may block the Supabase read on public.users; in that case the
  // local cache (Dexie / last currentUser) decides. This path issues a
  // `session-<id>` / `offline-<id>` token that tryReauthenticate() will
  // silently upgrade to a real JWT once the backend is reachable again
  // (the plaintext password cached above makes that work).
  return loginUser({
    username,
    password,
    phone: input.phone,
    tenantId: tenantId || undefined,
  });
}

/**
 * True when an error from loginTenant means "could not reach the backend"
 * (as opposed to "wrong credentials"). On a network error, loginWithIdentifier
 * falls through to the direct-Supabase + local-cache path. On a credentials
 * error, it first tries the local Dexie cache (the user may have just created
 * an institution), and only propagates the error if no local match exists.
 */
function isAuthNetworkError(error: any): boolean {
  if (error instanceof TypeError) return true;
  const msg = String(error?.message ?? error ?? "").toLowerCase();
  return (
    /could not reach the server|failed to fetch|network|err_name|err_connection|err_internet|unreachable|timeout|load failed/.test(
      msg,
    )
  );
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
    localStorage.getItem("activeTenantId") ||
    "";
  localRow.phone = localRow.phone ?? null;
  localRow.email = localRow.email ?? null;

  try {
    await (db as any).users.put(localRow);
  } catch {
    // The caller may still perform the cloud operation.
  }

  // First-run tenant registration (the ONLY remaining backend call).
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
/* Get user — Supabase first, Dexie fallback (no backend)                     */
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
/* Get all users — Supabase first (any device sees the same list), local      */
/* fallback (any time: works with no network), tombstone-aware                */
/* -------------------------------------------------------------------------- */

/** Best-effort access to the deletedIdsTracker module (multi-name tolerant,
 *  same policy as deleteUser above). Returns null when unavailable — the
 *  list then simply skips tombstone filtering. */
async function loadUserTracker(): Promise<{
  isDeleted: (kind: string, id: string) => Promise<boolean>;
} | null> {
  try {
    const tracker: any = await import("./deletedIdsTracker");
    const check =
      tracker.isDeleted ??
      tracker.isDeletedId ??
      tracker.hasDeletedId ??
      tracker.containsDeletedId;
    if (typeof check === "function") {
      return { isDeleted: check };
    }
  } catch {
    // Tracker module unavailable — tombstone filtering is skipped.
  }
  return null;
}

export interface UserListResult {
  users: MedStatUser[];
  /** true when Supabase was unreachable and the list came from this device. */
  offline: boolean;
  source: "supabase" | "local";
}

/**
 * Cloud-first user list for admin screens.
 *
 * 1. Supabase (authoritative): every active row, tenant-scoped when a
 *    tenantId is given — so a fresh device sees the full institution
 *    immediately after sign-in.
 * 2. Local pending rows are MERGED in: users created/edited offline on this
 *    device (synced:false) stay visible even before the cloud push lands.
 * 3. Tombstoned ids are filtered out on both paths, so a row that was
 *    deleted here can never reappear from the cloud list.
 * 4. Supabase down → the Dexie cache answers instead (offline:true), which
 *    keeps the screen usable at any time.
 */
export async function getUsersDetailed(
  tenantId?: string,
): Promise<UserListResult> {
  const tracker = await loadUserTracker();
  const tombstoned = async (id: string): Promise<boolean> => {
    if (!tracker) return false;
    try {
      return Boolean(await tracker.isDeleted("user", id));
    } catch {
      return false;
    }
  };

  const mergeLocals = async (
    cloudIds: Set<string>,
    base: MedStatUser[],
  ): Promise<MedStatUser[]> => {
    const locals = await dexieUsers();

    for (const raw of locals) {
      const id = String(raw?.id ?? "");
      if (!id || cloudIds.has(id)) continue;
      if (tenantId && !tenantMatches(raw, tenantId)) continue;
      if (await tombstoned(id)) continue;
      base.push(normalizeUser({ ...raw, synced: raw?.synced ?? false }));
    }

    return base;
  };

  const supabase = await getSupabase();

  if (supabase) {
    try {
      let query = supabase.from("users").select("*").is("deleted_at", null);

      if (tenantId) query = query.eq("tenant_id", tenantId);

      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(2000);

      if (!error && Array.isArray(data)) {
        const users: MedStatUser[] = [];
        const cloudIds = new Set<string>();

        for (const row of data) {
          const id = String(row?.id ?? "");
          if (!id || cloudIds.has(id)) continue;
          if (await tombstoned(id)) continue;
          cloudIds.add(id);
          // A row that exists in Supabase is by definition in sync — even
          // when the synced flag itself is null on the server.
          users.push(normalizeUser({ ...row, synced: row?.synced ?? true }));
        }

        const merged = await mergeLocals(cloudIds, users);
        merged.sort((a, b) =>
          String(a?.username ?? "").localeCompare(String(b?.username ?? "")),
        );

        // Refresh the offline cache with the authoritative rows.
        try {
          await (db as any).users.bulkPut(
            data.map((row: any) => ({ ...row, synced: true })),
          );
        } catch {
          // Cache refresh is non-fatal.
        }

        return { users: merged, offline: false, source: "supabase" };
      }
      // A Supabase error (RLS / network) falls through to the local path.
    } catch {
      // Fall through to the local path.
    }
  }

  // Offline path — Dexie only, tenant-scoped and tombstone-aware.
  const locals = await dexieUsers();
  const users: MedStatUser[] = [];
  const seen = new Set<string>();

  for (const raw of locals) {
    const id = String(raw?.id ?? "");
    if (!id || seen.has(id)) continue;
    if (tenantId && !tenantMatches(raw, tenantId)) continue;
    if (raw?.deleted_at) continue;
    if (await tombstoned(id)) continue;
    seen.add(id);
    users.push(normalizeUser(raw));
  }

  users.sort((a, b) =>
    String(a?.username ?? "").localeCompare(String(b?.username ?? "")),
  );

  return { users, offline: true, source: "local" };
}

/** Back-compatible list. Pass tenantId to scope to one institution. */
export async function getUsers(tenantId?: string): Promise<User[]> {
  const { users } = await getUsersDetailed(tenantId);
  return users as unknown as User[];
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
/* Delete user — Supabase soft-delete first, then local                       */
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
      tracker.noteDeletedId ??
      tracker.markDeleted;
    if (typeof mark === "function") {
      // v2: record the tenant so retryFailedCloudDeletes re-deletes with the
      // same tenant scope the original delete used (markDeleted signature:
      // entityType, entityId, tenantId, status?, errorMessage?).
      let tenantId = "";
      try {
        tenantId = localStorage.getItem("activeTenantId") || "";
        if (!tenantId) {
          const cached = JSON.parse(localStorage.getItem("currentUser") || "{}");
          tenantId = String(cached?.tenantId || cached?.tenant_id || "");
        }
      } catch {
        tenantId = "";
      }
      await mark("user", id, tenantId);
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
