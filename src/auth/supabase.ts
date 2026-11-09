// src/auth/supabase.ts
// REVISED: data path goes DIRECT to Supabase (Render backend kept only for the settings pull)
// - pullAllTenantData(): Supabase SELECT + tenant filter + deleted_at filter + tombstone guard
// - syncUp(): Supabase UPSERT of unsynced local users, rows shaped to public.users
// - mapUser/mapCourse/mapEnrollment: jsonb fields preserved (old version wiped tuition/remuneration)
// - sbFetch: your fixes kept verbatim; optional notDeleted flag added
// - TS strict fix: assignedCourses narrowed once before use in syncUp

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = ((import.meta.env.VITE_SUPABASE_URL as string) || "").trim();
const supabaseAnonKey = ((import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "").trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env and restart the dev server."
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ==========================================
// HELPER: Strip "eq." prefix from filter values (your fix, kept)
// ==========================================
// Callers pass values like `eq.${id}` but Supabase .eq() already adds
// the "eq." operator to the URL. Without stripping, we get "eq.eq.UUID" → 400.
function stripEq(val: any): any {
  if (typeof val === "string" && val.startsWith("eq.")) {
    return val.slice(3);
  }
  return val;
}

// ==========================================
// SUPABASE FETCH WRAPPER (your fixed version + notDeleted flag)
// ==========================================
export async function sbFetch(table: string, options: Record<string, any> = {}) {
  // --- PATCH method ---
  if (options.method === "PATCH" && options.body) {
    let patchQuery = supabase.from(table).update(JSON.parse(options.body));
    if (options.id) patchQuery = patchQuery.eq("id", stripEq(options.id));
    if (options.tenant_id) patchQuery = patchQuery.eq("tenant_id", stripEq(options.tenant_id));
    if (options.course_id) patchQuery = patchQuery.eq("course_id", stripEq(options.course_id));
    if (options.user_id) patchQuery = patchQuery.eq("user_id", stripEq(options.user_id));
    if (options.assignment_id) patchQuery = patchQuery.eq("assignment_id", stripEq(options.assignment_id));
    if (options.trainer_id) patchQuery = patchQuery.eq("trainer_id", stripEq(options.trainer_id));
    const { data, error } = await patchQuery;
    return { data, error };
  }

  // --- DELETE method ---
  if (options.method === "DELETE") {
    let deleteQuery = supabase.from(table).delete();
    if (options.id) deleteQuery = deleteQuery.eq("id", stripEq(options.id));
    if (options.tenant_id) deleteQuery = deleteQuery.eq("tenant_id", stripEq(options.tenant_id));
    if (options.course_id) deleteQuery = deleteQuery.eq("course_id", stripEq(options.course_id));
    if (options.user_id) deleteQuery = deleteQuery.eq("user_id", stripEq(options.user_id));
    if (options.assignment_id) deleteQuery = deleteQuery.eq("assignment_id", stripEq(options.assignment_id));
    if (options.trainer_id) deleteQuery = deleteQuery.eq("trainer_id", stripEq(options.trainer_id));
    const { data, error } = await deleteQuery;
    return { data, error };
  }

  // --- POST method (insert) ---
  if (options.method === "POST" && options.body) {
    const { data, error } = await supabase.from(table).insert(JSON.parse(options.body)).select();
    return { data, error };
  }

  // --- SELECT method (default) ---
  let query = supabase.from(table).select(options.select || "*");

  if (options.id) query = query.eq("id", stripEq(options.id));
  if (options.tenant_id) query = query.eq("tenant_id", stripEq(options.tenant_id));
  if (options.course_id) query = query.eq("course_id", stripEq(options.course_id));
  if (options.user_id) query = query.eq("user_id", stripEq(options.user_id));
  if (options.assignment_id) query = query.eq("assignment_id", stripEq(options.assignment_id));
  if (options.trainer_id) query = query.eq("trainer_id", stripEq(options.trainer_id));
  if (options.notDeleted) query = query.is("deleted_at", null); // soft-delete aware
  if (options.limit) query = query.limit(parseInt(options.limit as any));

  const { data, error } = await query;
  return { data, error };
}

// ==========================================
// BACKEND API (now used ONLY for the settings pull)
// ==========================================
let periodicPullInterval: ReturnType<typeof setInterval> | null = null;

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function hasValidAuth(): boolean {
  return !!localStorage.getItem("authToken") && !!localStorage.getItem("currentUser");
}

async function apiFetch(path: string) {
  if (!hasValidAuth()) {
    throw new Error("No auth token available - skipping API call");
  }
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) {
    if (res.status === 401) throw new Error(`API fetch failed: 401 - Auth token may be expired`);
    throw new Error(`API fetch failed: ${res.status}`);
  }
  return res.json();
}

// ==========================================
// 1. REALTIME SYNC (stub, unchanged)
// ==========================================
export function enableSyncHooks() {
  console.log("Sync hooks enabled (Polling mode).");
}

// ==========================================
// 2. PERIODIC PULL (unchanged — now feeds the direct-Supabase pull)
// ==========================================
export function startPeriodicPull(ms: number = 15000) {
  if (periodicPullInterval) clearInterval(periodicPullInterval);

  // Prevent 401 spam by disabling backend polling on the Live Classroom page
  if (window.location.pathname.includes("/trainer/live/")) {
    console.log("Skipping periodic pull on live classroom page.");
    return;
  }

  console.log(`Starting periodic pull every ${ms}ms`);
  periodicPullInterval = setInterval(async () => {
    if (!hasValidAuth()) return;
    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (user?.tenantId) {
      await pullAllTenantData(user.tenantId);
    }
  }, ms);
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
    console.log("Stopped periodic pull.");
  }
}

// ==========================================
// 3. PULL ALL DATA — DIRECT FROM SUPABASE
// ==========================================
export async function pullAllTenantData(tenantId: string) {
  if (!hasValidAuth()) {
    console.log("Skipping pull - not authenticated yet");
    return;
  }

  console.log("Pulling all tenant data directly from Supabase...");
  try {
    const { db } = await import("../database/db");
    const { getDeletedIds, purgeDeletedFromDexie } = await import("../database/deletedIdsTracker");

    const [usersRes, coursesRes, enrollmentsRes] = await Promise.all([
      supabase.from("users").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
      supabase.from("courses").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
      // If your enrollments table has no tenant_id column, remove that filter
      supabase.from("enrollments").select("*").eq("tenant_id", tenantId),
    ]);

    if (usersRes.error) throw usersRes.error;
    if (coursesRes.error) throw coursesRes.error;
    if (enrollmentsRes.error) throw enrollmentsRes.error;

    // Tombstones: never resurrect rows deleted on any device
    const deletedUserIds = new Set(await getDeletedIds("user"));
    const deletedCourseIds = new Set(await getDeletedIds("course"));

    for (const u of usersRes.data || []) {
      if (deletedUserIds.has(u.id)) continue;
      // Locally-pending (unsynced) edits win until they are pushed
      const local: any = await db.users.get(u.id);
      if (local && local.synced === false) continue;
      await db.users.put(mapUser(u));
    }

    for (const c of coursesRes.data || []) {
      if (deletedCourseIds.has(c.id)) continue;
      const local: any = await db.courses.get(c.id);
      if (local && local.synced === false) continue;
      await db.courses.put(mapCourse(c));
    }

    for (const e of enrollmentsRes.data || []) {
      const local: any = await db.enrollments.get(e.id);
      if (local && local.synced === false) continue;
      await db.enrollments.put(mapEnrollment(e));
    }

    try { await purgeDeletedFromDexie(); } catch { /* best effort */ }

    // UserManagement already listens for this — makes the 15s pull actually refresh the UI
    window.dispatchEvent(new Event("dataSynced"));
    console.log("Tenant data pull complete.");
  } catch (error) {
    console.warn("Pull tenant data failed:", error);
  }
}

// ==========================================
// 4. PULL SETTINGS (unchanged — still backend; switch to a Supabase
//    settings table later via supabase.from("settings")...maybeSingle())
// ==========================================
export async function pullSettings() {
  if (!hasValidAuth()) {
    console.log("Skipping settings pull - not authenticated yet");
    return null;
  }
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = user?.tenantId;
  if (!tenantId) {
    console.warn("No tenantId found for settings pull");
    return null;
  }
  try {
    return await apiFetch(`/api/settings/get?tenant_id=${tenantId}`);
  } catch (error) {
    console.error("Failed to pull settings:", error);
    return null;
  }
}

// ==========================================
// 5. MANUAL SYNC DOWN (unchanged)
// ==========================================
export async function syncDown() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  if (user?.tenantId) {
    await pullAllTenantData(user.tenantId);
  }
}

// ==========================================
// 6. PUSH LOCAL DATA TO CLOUD — DIRECT TO SUPABASE
// ==========================================
export async function syncUp() {
  if (!hasValidAuth()) {
    console.log("Skipping sync up - not authenticated yet");
    return;
  }

  console.log("Starting Sync Up (direct to Supabase)...");
  try {
    const { db } = await import("../database/db");
    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u: any) => !u.synced && u.role !== "admin");

    for (const user of usersToSync) {
      const row = mapUserToRow(user);
      const { error } = await supabase.from("users").upsert(row, { onConflict: "id" });
      if (error) {
        console.warn(`User ${user.id} sync failed:`, error.message);
        continue; // stays synced:false → retried next cycle
      }

      // Best-effort enrolment copy (assigned_courses already lives on the row)
      const assignedCourses: string[] = user.assignedCourses ?? [];
      if (assignedCourses.length > 0) {
        try {
          const rows = assignedCourses.map((courseId) => ({
            tenant_id: row.tenant_id,
            user_id: user.id,
            course_id: courseId,
            status: "active",
          }));
          const { error: enrError } = await supabase
            .from("enrollments")
            .upsert(rows, { onConflict: "user_id,course_id" });
          if (enrError) console.warn("Enrolment copy failed:", enrError.message);
        } catch (e) {
          console.warn("Enrolment copy failed:", e);
        }
      }

      await db.users.update(user.id, { synced: true });
    }
    console.log("Sync Up complete.");
  } catch (error) {
    console.error("Sync Up failed:", error);
  }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function toAmount(v: unknown): number {
  const n = parseFloat(String(v ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

// Dexie (camelCase) → public.users row (snake_case).
// Empty phone → NULL so the partial unique index uniq_user_phone_active
// can't collide on '' between two phone-less users.
function mapUserToRow(u: any) {
  return {
    id: u.id,
    tenant_id: u.tenantId || u.tenant_id || "",
    username: u.username,
    phone: u.phone?.trim() ? u.phone.trim() : null,
    email: u.email?.trim() ? u.email.trim() : null,
    password: u.password || "",
    role: u.role || "trainee",
    assigned_courses: u.assignedCourses ?? [],
    profile_pic: u.profilePic || null,
    tuition: {
      expected: toAmount(u.tuition?.expected),
      paid: toAmount(u.tuition?.paid),
    },
    remuneration: {
      net_salary: toAmount(u.remuneration?.netSalary),
      per_diem: toAmount(u.remuneration?.perDiem),
    },
    synced: true,
  };
}

// Remote → Dexie. Shape matches mapUserFromSupabase in UserManagement.tsx so
// both pull paths write identical records.
function mapUser(u: any) {
  const tuition = u.tuition || {};
  const remuneration = u.remuneration || {};
  return {
    ...u, // keeps password, assignedDepartments, etc.
    username: u.username,
    email: u.email || "",
    phone: u.phone || "",
    password: u.password || "",
    role: u.role || "trainee",
    profilePic: u.profile_pic || u.profilePic || "",
    assignedCourses: u.assigned_courses || u.assignedCourses || [],
    tenantId: u.tenant_id || u.tenantId,
    createdAt: u.created_at || u.createdAt || "",
    // jsonb fields — the old version dropped these, so every 15s pull
    // REPLACED the Dexie record and wiped tuition/remuneration
    tuition: { expected: tuition.expected ?? 0, paid: tuition.paid ?? 0 },
    remuneration: {
      netSalary: remuneration.net_salary ?? remuneration.netSalary ?? 0,
      perDiem: remuneration.per_diem ?? remuneration.perDiem ?? 0,
    },
    paymentHistory: u.payment_history || u.paymentHistory || [],
    remunerationHistory: u.remuneration_history || u.remunerationHistory || [],
    synced: true,
  };
}

function mapCourse(c: any) {
  return {
    ...c,
    name: c.name || "",
    description: c.description || "",
    tuitionType: c.tuition_type || c.tuitionType || "free",
    amount: c.amount ?? 0,
    startDate: c.start_date || c.startDate || "",
    period: c.period || "",
    trainerId: c.trainer_id || c.trainerId || "",
    mediaUrl: c.logo || c.mediaUrl || "",
    tenantId: c.tenant_id || c.tenantId,
    createdAt: c.created_at || c.createdAt || "",
    synced: true,
  };
}

function mapEnrollment(e: any) {
  return {
    ...e,
    userId: e.user_id || e.userId || "",
    courseId: e.course_id || e.courseId || "",
    tenantId: e.tenant_id || e.tenantId,
    status: e.status || "active",
    role: e.role || "trainee",
    enrolledAt: e.enrolled_at || e.enrolledAt || "",
    createdAt: e.created_at || e.createdAt || "",
    synced: true,
  };
}
