
// src/auth/supabase.ts
// Direct Supabase synchronization.
// Render backend is used only for settings.
//
// Local User objects use camelCase:
//   assignedCourses, assignedDepartments, tenantId, profilePic
//
// Supabase public.users uses:
//   assigned_courses, assignedDepartments, tenant_id, profile_pic
//
// Supabase public.enrollments uses:
//   id (text), tenant_id, user_id, course_id, role, status,
//   enrolled_at, created_at, deleted_at

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

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey
);

const OFFLINE_TOKEN = "offline-mode-pending-sync";

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

function getAuthToken(): string | null {
  const token = localStorage.getItem("authToken");

  if (!token || token === OFFLINE_TOKEN) {
    return null;
  }

  return token;
}

function hasValidAuth(): boolean {
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
  // PATCH
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

  // DELETE
  if (options.method === "DELETE") {
    let query: any = supabase.from(table).delete();
    query = applyCommonFilters(query, options);

    const { data, error } = await query;

    return { data, error };
  }

  // POST
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

  // SELECT
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
// BACKEND API — SETTINGS ONLY
// ==========================================

const API_BASE_URL = import.meta.env.PROD
  ? "https://medstat-3rxl.onrender.com"
  : "";

function getAuthHeaders(): Record<string, string> {
  const token = getAuthToken();

  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string) {
  if (!hasValidAuth()) {
    throw new Error("No valid authentication token.");
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error(
        "API fetch failed: 401 - Authentication may have expired."
      );
    }

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
    if (periodicPullRunning || !hasValidAuth()) return;

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
    console.log("Skipping pull - not authenticated.");
    return;
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

    // USERS
    for (const remoteUser of usersRes.data || []) {
      if (deletedUserIds.has(remoteUser.id)) continue;

      const localUser: any = await db.users.get(remoteUser.id);

      if (localUser && localUser.synced === false) {
        continue;
      }

      await db.users.put(mapUser(remoteUser, localUser));
    }

    // COURSES
    for (const remoteCourse of coursesRes.data || []) {
      if (deletedCourseIds.has(remoteCourse.id)) continue;

      const localCourse: any = await db.courses.get(remoteCourse.id);

      if (localCourse && localCourse.synced === false) {
        continue;
      }

      await db.courses.put(mapCourse(remoteCourse));
    }

    // ENROLLMENTS
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
    console.log("Skipping settings pull - not authenticated.");
    return null;
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
    console.log("Skipping sync down - not authenticated.");
    return;
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
  if (!hasValidAuth()) {
    console.log("Skipping sync up - not authenticated.");
    return;
  }

  if (syncUpRunning) {
    console.log("Sync Up already running. Skipping duplicate call.");
    return;
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

    const usersToSync = localUsers.filter((user) => {
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

        // Local User type uses assignedCourses.
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

        if (!enrollmentSyncFailed) {
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

    // Exact quoted SQL column name.
    assignedDepartments,

    profile_pic:
      user.profilePic ||
      null,

    tuition: {
      expected: toAmount(user.tuition?.expected),
      paid: toAmount(user.tuition?.paid),
    },

    remuneration: {
      net_salary: toAmount(
        user.remuneration?.netSalary
      ),

      per_diem: toAmount(
        user.remuneration?.perDiem
      ),
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

    password: remoteUser.password || "",

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

    // These history fields are not columns in the supplied SQL.
    // Keep local values rather than replacing them with empty arrays.
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
