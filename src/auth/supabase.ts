
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (
  (import.meta.env.VITE_SUPABASE_URL as string) || ""
).trim();

const supabaseAnonKey = (
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ""
).trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. " +
      "Add them to .env and restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

try {
  Object.keys(localStorage)
    .filter((k) => k.startsWith("sb-") && k.endsWith("-auth-token"))
    .forEach((k) => localStorage.removeItem(k));
} catch {
  /* storage unavailable */
}

export const OFFLINE_TOKEN = "offline-mode-pending-sync";

// ==========================================
// API ORIGIN FAILOVER
// ==========================================

const PRIMARY_API_BASE = import.meta.env.PROD
  ? "https://medstat-3rxl.onrender.com"
  : "";

const DEV_API_BASE = import.meta.env.PROD
  ? ""
  : "http://localhost:10000";

const EXTRA_API_BASE = (
  (import.meta.env.VITE_API_FALLBACK_URL as string) || ""
).trim().replace(/\/+$/, "");

const SAME_ORIGIN_API_BASE =
  import.meta.env.PROD &&
  typeof window !== "undefined" &&
  window.location.protocol === "https:"
    ? `${window.location.origin}${(import.meta.env.BASE_URL || "/").replace(/\/+$/, "")}/api`
    : "";

let preferredApiBase: string | null = null;

export async function apiFetchAny(
  path: string,
  init?: RequestInit,
  firstBase?: string
): Promise<Response> {
  const bases = [
    ...new Set(
      [
        preferredApiBase,
        firstBase?.replace(/\/+$/, ""),
        PRIMARY_API_BASE,
        DEV_API_BASE,
        EXTRA_API_BASE,
        SAME_ORIGIN_API_BASE,
      ].filter((base): base is string => Boolean(base))
    ),
  ];

  let lastError: unknown = new TypeError("No API origin configured");

  for (const base of bases) {
    try {
      const response = await fetch(`${base}${path}`, init);

      preferredApiBase = base;

      return response;
    } catch (err) {
      lastError = err;

      if (!(err instanceof TypeError)) throw err;

      console.warn(
        `API origin unreachable (${base}${path}) — trying next origin.`
      );
    }
  }

  throw lastError;
}

// ==========================================
// SYNC STATE
// ==========================================

let periodicPullInterval: ReturnType<typeof setInterval> | null = null;
let periodicPullRunning = false;
let syncUpRunning = false;

// ==========================================
// GENERAL HELPERS
// ==========================================

function stripEq(value: any): any {
  if (typeof value === "string" && value.startsWith("eq.")) {
    return value.slice(3);
  }

  return value;
}

function parseStoredUser(): any | null {
  try {
    const value = localStorage.getItem("currentUser");
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function getCurrentTenantId(): string | null {
  const user = parseStoredUser();
  const tenantId = user?.tenantId || user?.tenant_id;

  return typeof tenantId === "string" && tenantId.trim()
    ? tenantId.trim()
    : null;
}

// ==========================================
// TOKEN VALIDATION
// ==========================================

/**
 * Application authentication.
 *
 * These tokens are allowed for local/offline app functionality.
 * They are NOT necessarily valid for the Render backend.
 */
export function isRealBackendToken(
  token: string | null | undefined
): token is string {
  if (typeof token !== "string" || !token) return false;

  return (
    token.startsWith("eyJ") ||
    token.startsWith("session-") ||
    token.startsWith("offline-") ||
    token === OFFLINE_TOKEN
  );
}

/**
 * Render API authentication.
 *
 * Only a three-part JWT is accepted.
 * Supabase session markers and offline tokens are rejected.
 */
export function isRenderJwtToken(
  token: string | null | undefined
): token is string {
  if (typeof token !== "string" || !token.startsWith("eyJ")) {
    return false;
  }

  const parts = token.split(".");

  return (
    parts.length === 3 &&
    parts.every((part) => part.length > 0)
  );
}

function getAuthToken(): string | null {
  const token = localStorage.getItem("authToken");

  return isRealBackendToken(token) ? token : null;
}

function getRenderAuthToken(): string | null {
  const token = localStorage.getItem("authToken");

  return isRenderJwtToken(token) ? token : null;
}

/**
 * Local application authentication.
 * This intentionally continues to accept offline sessions.
 */
export function hasValidAuth(): boolean {
  return Boolean(getAuthToken() && parseStoredUser());
}

function normalizeRole(role: any): "admin" | "trainer" | "trainee" {
  if (role === "admin" || role === "trainer" || role === "trainee") {
    return role;
  }

  return "trainee";
}

function toAmount(value: unknown): number {
  const number = parseFloat(
    String(value ?? "0").replace(/,/g, "").trim()
  );

  return Number.isFinite(number) ? number : 0;
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter(
      (item: any) =>
        typeof item === "string" && item.trim().length > 0
    )
    .map((item: string) => item.trim());
}

// ==========================================
// SILENT RE-AUTHENTICATION
// ==========================================

let reauthInFlight: Promise<string | null> | null = null;
let reauthCooldown: number | undefined;
let reauthReason = "";

export function getReauthReason(): string {
  return reauthReason;
}

/**
 * Wake Render before login.
 */
async function wakeBackend(): Promise<void> {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    90000
  );

  try {
    await apiFetchAny("/api/health", {
      signal: controller.signal,
    });
  } catch {
    /* Login attempt below will report connection problems. */
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * Obtain a genuine Render JWT using saved local credentials.
 *
 * This function deliberately does NOT treat Supabase session markers
 * or offline tokens as valid Render authentication.
 */
export function tryReauthenticate(
  force = false
): Promise<string | null> {
  if (reauthInFlight) return reauthInFlight;

  const existingToken = getRenderAuthToken();

  if (existingToken && !force) {
    reauthReason = "";
    return Promise.resolve(existingToken);
  }

  if (force && reauthCooldown) {
    window.clearTimeout(reauthCooldown);
    reauthCooldown = undefined;
  }

  reauthInFlight = (async () => {
    try {
      const user = parseStoredUser();

      const tenantId = user?.tenantId || user?.tenant_id;
      const username = user?.username;
      const password = user?.password;

      if (!tenantId || !username || !password) {
        reauthReason =
          "No saved sign-in details on this device. Please sign in again.";

        console.warn("Render re-authentication skipped: credentials unavailable.");

        return null;
      }

      await wakeBackend();

      const controller = new AbortController();

      const timeoutId = window.setTimeout(
        () => controller.abort(),
        90000
      );

      let response: Response;

      try {
        response = await apiFetchAny("/api/auth/login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            tenantId,
            username,
            password,
          }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }

      const responseText = await response.text();

      let result: any = {};

      try {
        result = responseText ? JSON.parse(responseText) : {};
      } catch {
        throw new Error(
          "The login server returned an invalid response."
        );
      }

      if (!response.ok) {
        throw new Error(
          result?.error ||
            result?.message ||
            `Render login failed (${response.status}).`
        );
      }

      const authToken = result?.authToken;

      if (!isRenderJwtToken(authToken)) {
        throw new Error(
          "The login endpoint did not return a valid Render JWT."
        );
      }

      localStorage.setItem("authToken", authToken);

      const updatedUser = {
        ...user,
        ...(result.user || {}),
        tenantId:
          result.user?.tenantId ||
          result.user?.tenant_id ||
          tenantId,
        authToken,
        token: authToken,
        synced: true,
      };

      localStorage.setItem(
        "currentUser",
        JSON.stringify(updatedUser)
      );

      reauthReason = "";

      window.dispatchEvent(new Event("authStateChanged"));

      console.log("Render authentication restored successfully.");

      // Background synchronisation.
      pullAllTenantData(tenantId).catch(() => {});
      pullSettings().catch(() => {});

      return authToken;
    } catch (err: any) {
      reauthReason =
        err?.name === "AbortError"
          ? "The server took too long to respond. Wait and retry."
          : err?.message ||
            "Could not authenticate with the MedStat server. Check your connection.";

      console.warn("Render re-authentication failed:", err);

      return null;
    } finally {
      reauthCooldown = window.setTimeout(() => {
        reauthInFlight = null;
        reauthCooldown = undefined;
      }, 30000);
    }
  })();

  return reauthInFlight;
}

/**
 * Ensure a genuine Render JWT is available.
 */
async function ensureRenderToken(): Promise<string | null> {
  let token = getRenderAuthToken();

  if (token) return token;

  token = await tryReauthenticate();

  return isRenderJwtToken(token) ? token : null;
}

// ==========================================
// SUPABASE FETCH WRAPPER
// ==========================================

function applyCommonFilters(
  query: any,
  options: Record<string, any>
) {
  if (options.id) {
    query = query.eq("id", stripEq(options.id));
  }

  if (options.tenant_id) {
    query = query.eq("tenant_id", stripEq(options.tenant_id));
  }

  if (options.course_id) {
    query = query.eq("course_id", stripEq(options.course_id));
  }

  if (options.user_id) {
    query = query.eq("user_id", stripEq(options.user_id));
  }

  if (options.assignment_id) {
    query = query.eq("assignment_id", stripEq(options.assignment_id));
  }

  if (options.trainer_id) {
    query = query.eq("trainer_id", stripEq(options.trainer_id));
  }

  if (options.notDeleted) {
    query = query.is("deleted_at", null);
  }

  return query;
}

export async function sbFetch(
  table: string,
  options: Record<string, any> = {}
) {
  if (options.method === "PATCH" && options.body) {
    const body =
      typeof options.body === "string"
        ? JSON.parse(options.body)
        : options.body;

    let query: any = supabase.from(table).update(body);

    query = applyCommonFilters(query, options);

    const { data, error } = await query;

    return { data, error };
  }

  if (options.method === "DELETE") {
    let query: any = supabase.from(table).delete();

    query = applyCommonFilters(query, options);

    const { data, error } = await query;

    return { data, error };
  }

  if (options.method === "POST" && options.body) {
    const body =
      typeof options.body === "string"
        ? JSON.parse(options.body)
        : options.body;

    const { data, error } = await supabase
      .from(table)
      .insert(body)
      .select();

    return { data, error };
  }

  let query: any = supabase
    .from(table)
    .select(options.select || "*");

  query = applyCommonFilters(query, options);

  if (options.limit) {
    const limit = parseInt(String(options.limit), 10);

    if (Number.isFinite(limit) && limit > 0) {
      query = query.limit(limit);
    }
  }

  const { data, error } = await query;

  return { data, error };
}

// ==========================================
// BACKEND API — SETTINGS
// ==========================================

async function apiFetch(path: string, retry = true) {
  let token = await ensureRenderToken();

  if (!token) {
    throw new Error("No valid Render authentication token.");
  }

  let response = await apiFetchAny(path, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 && retry) {
    const newToken = await tryReauthenticate(true);

    if (newToken && isRenderJwtToken(newToken)) {
      token = newToken;

      response = await apiFetchAny(path, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
    }
  }

  if (!response.ok) {
    throw new Error(`API fetch failed: ${response.status}`);
  }

  return response.json();
}

// ==========================================
// 1. SYNC HOOKS
// ==========================================

export function enableSyncHooks() {
  console.log("Sync hooks enabled (Polling mode).");
}

// ==========================================
// 2. PERIODIC PULL
// ==========================================

export function startPeriodicPull(ms: number = 15000) {
  stopPeriodicPull();

  if (typeof window === "undefined") return;

  if (window.location.pathname.includes("/trainer/live/")) {
    console.log("Skipping periodic pull on live classroom page.");
    return;
  }

  console.log(`Starting periodic pull every ${ms}ms`);

  periodicPullInterval = setInterval(async () => {
    if (periodicPullRunning) return;

    if (!hasValidAuth()) {
      const healed = await tryReauthenticate();

      if (!healed) return;
    }

    const tenantId = getCurrentTenantId();

    if (!tenantId) return;

    periodicPullRunning = true;

    try {
      await pullAllTenantData(tenantId);
    } catch (error) {
      console.warn("Periodic pull failed:", error);
    } finally {
      periodicPullRunning = false;
    }
  }, ms);
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
  }

  console.log("Stopped periodic pull.");
}

// ==========================================
// 3. PULL ALL TENANT DATA
// ==========================================

export async function pullAllTenantData(tenantId: string) {
  if (!hasValidAuth()) {
    const healed = await tryReauthenticate();

    if (!healed || !hasValidAuth()) {
      console.log("Skipping pull - not authenticated.");
      return;
    }
  }

  const currentTenantId = getCurrentTenantId();

  if (!currentTenantId || currentTenantId !== tenantId) {
    console.warn("Skipping pull - tenant mismatch.");
    return;
  }

  console.log("Pulling tenant data directly from Supabase...");

  try {
    const { db } = await import("../database/db");

    const {
      getDeletedIds,
      purgeDeletedFromDexie,
    } = await import("../database/deletedIdsTracker");

    const [usersRes, coursesRes, enrollmentsRes] = await Promise.all([
      supabase
        .from("users")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null),

      supabase
        .from("courses")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null),

      supabase
        .from("enrollments")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("deleted_at", null),
    ]);

    if (usersRes.error) throw usersRes.error;
    if (coursesRes.error) throw coursesRes.error;
    if (enrollmentsRes.error) throw enrollmentsRes.error;

    const deletedUserIds = new Set(
      await getDeletedIds("user")
    );

    const deletedCourseIds = new Set(
      await getDeletedIds("course")
    );

    for (const remoteUser of usersRes.data || []) {
      if (deletedUserIds.has(remoteUser.id)) continue;

      const localUser: any = await db.users.get(remoteUser.id);

      if (localUser && localUser.synced === false) {
        continue;
      }

      await db.users.put(mapUser(remoteUser, localUser));
    }

    for (const remoteCourse of coursesRes.data || []) {
      if (deletedCourseIds.has(remoteCourse.id)) continue;

      const localCourse: any = await db.courses.get(remoteCourse.id);

      if (localCourse && localCourse.synced === false) {
        continue;
      }

      await db.courses.put(mapCourse(remoteCourse));
    }

    for (const remoteEnrollment of enrollmentsRes.data || []) {
      const localEnrollment: any = await db.enrollments.get(
        remoteEnrollment.id
      );

      if (localEnrollment && localEnrollment.synced === false) {
        continue;
      }

      await db.enrollments.put(
        mapEnrollment(remoteEnrollment)
      );
    }

    try {
      await purgeDeletedFromDexie();
    } catch (error) {
      console.warn("Local deletion cleanup failed:", error);
    }

    window.dispatchEvent(new Event("dataSynced"));

    console.log("Tenant data pull complete.");
  } catch (error) {
    console.warn("Pull tenant data failed:", error);
  }
}

// ==========================================
// 4. PULL SETTINGS — RENDER BACKEND
// ==========================================

export async function pullSettings() {
  if (!hasValidAuth()) {
    const healed = await tryReauthenticate();

    if (!healed || !hasValidAuth()) {
      console.log("Skipping settings pull - not authenticated.");
      return null;
    }
  }

  const tenantId = getCurrentTenantId();

  if (!tenantId) {
    console.warn("No tenantId found for settings pull.");
    return null;
  }

  try {
    return await apiFetch(
      `/api/settings/get?tenant_id=${encodeURIComponent(tenantId)}`
    );
  } catch (error) {
    console.error("Failed to pull settings:", error);
    return null;
  }
}

// ==========================================
// 5. MANUAL SYNC DOWN
// ==========================================

export async function syncDown() {
  if (!hasValidAuth()) {
    const healed = await tryReauthenticate();

    if (!healed || !hasValidAuth()) {
      console.log("Skipping sync down - not authenticated.");
      return;
    }
  }

  const tenantId = getCurrentTenantId();

  if (tenantId) {
    await pullAllTenantData(tenantId);
  }
}

// ==========================================
// 6. PUSH LOCAL DATA TO SUPABASE
// ==========================================

export async function syncUp() {
  if (syncUpRunning) {
    console.log("Sync Up already running. Skipping duplicate call.");
    return;
  }

  if (!hasValidAuth()) {
    const healed = await tryReauthenticate();

    if (!healed || !hasValidAuth()) {
      console.log("Skipping sync up - not authenticated.");
      return;
    }
  }

  syncUpRunning = true;

  console.log("Starting Sync Up (direct to Supabase)...");

  try {
    const { db } = await import("../database/db");

    const tenantId = getCurrentTenantId();

    if (!tenantId) {
      console.warn("Sync Up stopped - no tenant ID.");
      return;
    }

    const localUsers = await db.users.toArray();

    const usersToSync = localUsers.filter((user: any) => {
      const userTenantId = user.tenantId;

      return (
        !user.synced &&
        user.role !== "admin" &&
        userTenantId === tenantId
      );
    });

    for (const user of usersToSync) {
      try {
        const row = mapUserToRow(user, tenantId);

        const { error: userError } = await supabase
          .from("users")
          .upsert(row, { onConflict: "id" });

        if (userError) {
          console.warn(
            `User ${user.id} sync failed:`,
            userError.message
          );
          continue;
        }

        const assignedCourses = normalizeStringArray(
          user.assignedCourses
        );

        let enrollmentSyncFailed = false;

        if (assignedCourses.length > 0) {
          const enrollmentRole =
            user.role === "trainer" ? "trainer" : "trainee";

          const enrollmentRows = assignedCourses.map((courseId) => ({
            tenant_id: tenantId,
            user_id: user.id,
            course_id: courseId,
            role: enrollmentRole,
            status: "active",
            deleted_at: null,
          }));

          const { error: enrollmentError } = await supabase
            .from("enrollments")
            .upsert(enrollmentRows, {
              onConflict: "user_id,course_id",
            });

          if (enrollmentError) {
            enrollmentSyncFailed = true;

            console.warn(
              `Enrollment sync failed for user ${user.id}:`,
              enrollmentError.message
            );
          }
        }

        if (!enrollmentSyncFailed && user.id) {
          await db.users.update(user.id, {
            synced: true,
          });
        }
      } catch (error) {
        console.warn(
          `Failed to sync user ${user.id}:`,
          error
        );
      }
    }

    console.log("Sync Up complete.");
  } catch (error) {
    console.error("Sync Up failed:", error);
  } finally {
    syncUpRunning = false;
  }
}

// ==========================================
// 7. MAP LOCAL USER TO SUPABASE ROW
// ==========================================

function mapUserToRow(user: any, tenantId: string) {
  const assignedCourses = normalizeStringArray(
    user.assignedCourses
  );

  const assignedDepartments = normalizeStringArray(
    user.assignedDepartments
  );

  return {
    id: user.id,
    tenant_id: tenantId,
    username: String(user.username || "").trim(),

    phone: user.phone?.trim()
      ? user.phone.trim()
      : null,

    email: user.email?.trim()
      ? user.email.trim()
      : null,

    password: user.password || "",
    role: normalizeRole(user.role),
    assigned_courses: assignedCourses,
    assignedDepartments,

    profile_pic: user.profilePic || null,

    tuition: {
      expected: toAmount(user.tuition?.expected),
      paid: toAmount(user.tuition?.paid),
    },

    remuneration: {
      net_salary: toAmount(user.remuneration?.netSalary),
      per_diem: toAmount(user.remuneration?.perDiem),
    },

    synced: true,
  };
}

// ==========================================
// 8. MAP SUPABASE USER TO DEXIE
// ==========================================

function mapUser(remoteUser: any, localUser?: any) {
  const tuition = remoteUser.tuition || {};
  const remuneration = remoteUser.remuneration || {};

  return {
    ...localUser,
    ...remoteUser,

    id: remoteUser.id,
    username: remoteUser.username || "",
    email: remoteUser.email || "",
    phone: remoteUser.phone || "",

    password: localUser?.password || remoteUser.password || "",

    role: normalizeRole(remoteUser.role),

    profilePic:
      remoteUser.profile_pic ||
      remoteUser.profilePic ||
      localUser?.profilePic ||
      "",

    assignedCourses: normalizeStringArray(
      remoteUser.assigned_courses ??
        remoteUser.assignedCourses
    ),

    assignedDepartments: normalizeStringArray(
      remoteUser.assignedDepartments ??
        remoteUser.assigned_departments ??
        localUser?.assignedDepartments
    ),

    tenantId:
      remoteUser.tenant_id ||
      remoteUser.tenantId ||
      localUser?.tenantId,

    createdAt:
      remoteUser.created_at ||
      remoteUser.createdAt ||
      localUser?.createdAt ||
      "",

    tuition: {
      expected: tuition.expected ?? 0,
      paid: tuition.paid ?? 0,
    },

    remuneration: {
      netSalary:
        remuneration.net_salary ??
        remuneration.netSalary ??
        0,

      perDiem:
        remuneration.per_diem ??
        remuneration.perDiem ??
        0,
    },

    paymentHistory:
      localUser?.paymentHistory ??
      remoteUser.paymentHistory ??
      [],

    remunerationHistory:
      localUser?.remunerationHistory ??
      remoteUser.remunerationHistory ??
      [],

    synced: true,
  };
}

// ==========================================
// 9. MAP SUPABASE COURSE TO DEXIE
// ==========================================

function mapCourse(course: any) {
  return {
    ...course,

    name: course.name || "",
    description: course.description || "",

    tuitionType:
      course.tuition_type ||
      course.tuitionType ||
      "free",

    amount: course.amount ?? 0,

    startDate:
      course.start_date ||
      course.startDate ||
      "",

    period: course.period || "",

    trainerId:
      course.trainer_id ||
      course.trainerId ||
      "",

    mediaUrl:
      course.logo ||
      course.mediaUrl ||
      "",

    tenantId:
      course.tenant_id ||
      course.tenantId,

    createdAt:
      course.created_at ||
      course.createdAt ||
      "",

    synced: true,
  };
}

// ==========================================
// 10. MAP SUPABASE ENROLLMENT TO DEXIE
// ==========================================

function mapEnrollment(enrollment: any) {
  return {
    ...enrollment,

    id: enrollment.id,

    userId:
      enrollment.user_id ||
      enrollment.userId ||
      "",

    courseId:
      enrollment.course_id ||
      enrollment.courseId ||
      "",

    tenantId:
      enrollment.tenant_id ||
      enrollment.tenantId,

    status: enrollment.status || "active",
    role: enrollment.role || "trainee",

    enrolledAt:
      enrollment.enrolled_at ||
      enrollment.enrolledAt ||
      "",

    createdAt:
      enrollment.created_at ||
      enrollment.createdAt ||
      "",

    synced: true,
  };
}

// ==========================================
// 11. SMS LOGS — LOCAL-FIRST + RENDER SYNC
// ==========================================

export interface SmsLogInput {
  id: string;
  tenant_id?: string | null;
  phone: string;
  message: string;
  status: string;
  sent_by?: string | null;
  sentAt?: string;
  sent_at?: string;
  [key: string]: any;
}

export type LocalSmsLog = SmsLogInput & {
  sentAt: string;
  synced: boolean;
};

function mapSmsLogRow(row: any): LocalSmsLog {
  return {
    ...row,

    id: row.id,
    tenant_id: row.tenant_id || null,
    phone: row.phone || "",
    message: row.message || "",
    status: row.status || "Unknown",
    sent_by: row.sent_by || null,

    sentAt:
      row.sent_at ||
      row.sentAt ||
      new Date().toISOString(),

    synced: true,
  };
}

/**
 * Authenticated Render request for SMS log operations.
 * Retries once after a 401 using a fresh Render JWT.
 */
async function smsLogsApiFetch(
  path: string,
  init: RequestInit = {},
  retry = true
): Promise<any> {
  let token = await ensureRenderToken();

  if (!token) {
    throw new Error(
      "No valid Render authentication token for SMS history."
    );
  }

  const makeRequest = (bearer: string) =>
    apiFetchAny(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
        Authorization: `Bearer ${bearer}`,
      },
    });

  let response = await makeRequest(token);

  if (response.status === 401 && retry) {
    const refreshedToken = await tryReauthenticate(true);

    if (
      refreshedToken &&
      isRenderJwtToken(refreshedToken) &&
      refreshedToken !== token
    ) {
      token = refreshedToken;
      response = await makeRequest(token);
    }
  }

  const responseText = await response.text();

  let result: any = {};

  try {
    result = responseText ? JSON.parse(responseText) : {};
  } catch {
    result = {
      error: responseText || "Invalid server response.",
    };
  }

  if (!response.ok) {
    throw new Error(
      result?.error ||
        result?.message ||
        `SMS history request failed (${response.status}).`
    );
  }

  return result;
}

/**
 * Save SMS logs locally first.
 */
export async function recordSmsLogs(
  logs: SmsLogInput[]
): Promise<void> {
  if (!Array.isArray(logs) || logs.length === 0) return;

  const { db } = await import("../database/db");

  const rows: LocalSmsLog[] = logs.map((log) => ({
    ...log,
    synced: false,
    sentAt:
      log.sentAt ||
      log.sent_at ||
      new Date().toISOString(),
  }));

  await db.smsLogs.bulkPut(rows);

  syncUnsyncedSmsLogs().catch(() => {});
}

/**
 * Upload locally queued SMS logs through Render.
 *
 * The server supplies tenant_id and sent_by from the verified JWT.
 */
export async function syncUnsyncedSmsLogs(): Promise<void> {
  const token = await ensureRenderToken();

  if (!token) {
    console.log("SMS log upload deferred: no Render JWT.");
    return;
  }

  try {
    const { db } = await import("../database/db");

    const tenantId = getCurrentTenantId();

    if (!tenantId) return;

    const pending = await db.smsLogs
      .filter((log: any) => !log.synced)
      .toArray();

    // Never upload records belonging to a different tenant.
    const tenantPending = pending.filter(
      (log: any) =>
        !log.tenant_id ||
        log.tenant_id === tenantId
    );

    if (!tenantPending.length) return;

    const rows = tenantPending.map((log: any) => ({
      id: log.id,
      phone: String(log.phone || "").trim(),
      message: String(log.message || ""),
      status: String(log.status || "Success"),
      sent_at:
        log.sent_at ||
        log.sentAt ||
        new Date().toISOString(),
    }));

    await smsLogsApiFetch("/api/sms/logs/sync", {
      method: "POST",
      body: JSON.stringify({ logs: rows }),
    });

    await db.smsLogs.bulkPut(
      tenantPending.map((log: any) => ({
        ...log,
        tenant_id: log.tenant_id || tenantId,
        synced: true,
      }))
    );

    console.log(
      `SMS logs synced through Render: ${tenantPending.length} row(s).`
    );
  } catch (err) {
    console.warn("SMS log upload failed (will retry):", err);
  }
}

/**
 * Pull SMS history through Render.
 *
 * The tenant is checked locally before making the request.
 * Unsynced local records are protected from being overwritten.
 */
export async function pullRemoteSmsLogs(
  tenantId: string
): Promise<void> {
  if (!tenantId) return;

  const currentTenantId = getCurrentTenantId();

  if (!currentTenantId || currentTenantId !== tenantId) {
    console.warn("Skipping SMS log pull - tenant mismatch.");
    return;
  }

  const token = await ensureRenderToken();

  if (!token) {
    console.log("Skipping SMS log pull - no Render JWT.");
    return;
  }

  try {
    const { db } = await import("../database/db");

    const result = await smsLogsApiFetch(
      "/api/sms/logs?limit=1000"
    );

    const remoteLogs = Array.isArray(result?.logs)
      ? result.logs
      : [];

    if (!remoteLogs.length) {
      console.log("No remote SMS logs found.");
      return;
    }

    const localLogs = await db.smsLogs.toArray();

    const unsyncedIds = new Set(
      localLogs
        .filter((log: any) => !log.synced)
        .map((log: any) => log.id)
    );

    const rowsToSave = remoteLogs
      .filter((row: any) => !unsyncedIds.has(row.id))
      .map(mapSmsLogRow);

    if (rowsToSave.length) {
      await db.smsLogs.bulkPut(rowsToSave);
    }

    console.log(
      `SMS logs pulled through Render: ${rowsToSave.length} row(s).`
    );
  } catch (err) {
    console.warn("SMS log pull failed:", err);
  }
}
