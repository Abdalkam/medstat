// src/auth/syncService.ts — v3: session-aware realtime + unified pull/push
//

import {
  supabase,
  hasValidAuth,
  tryReauthenticate,
  pullAllTenantData,
  pullRemoteSmsLogs,
  syncUp as pushUsersToCloud,
} from "./supabase";
import { db } from "../database/db";
import { isDeleted, getDeletedIds } from "../database/deletedIdsTracker";
import type { RealtimeChannel } from "@supabase/supabase-js";

let activeChannels: RealtimeChannel[] = [];
let realtimeEnabled = false;
let realtimeTenantId = "";
let tenantListener: (() => void) | null = null;

function getTenantId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const t = user?.tenantId || user?.tenant_id;
    return typeof t === "string" ? t.trim() : "";
  } catch {
    return "";
  }
}

/** Gate shared by syncDown/syncUp: heal the session or admit defeat. */
async function ensureAuthenticated(): Promise<boolean> {
  if (hasValidAuth()) return true;
  const healed = await tryReauthenticate();
  return Boolean(healed && hasValidAuth());
}

// ==========================================
// 1. INSTANT REALTIME SYNC
// ==========================================

export function enableRealtimeSync() {
  if (realtimeEnabled) {
    // Already on — just re-check the tenant (cheap no-op when unchanged).
    maybeReconfigureRealtime();
    return;
  }
  console.log("📡 Enabling Realtime Sync...");
  realtimeEnabled = true;
  maybeReconfigureRealtime();

  // Re-scope the channels whenever the signed-in account/tenant changes
  // (Login dispatches "userChanged", supabase.ts dispatches
  // "authStateChanged" after a silent re-login).
  tenantListener = () => maybeReconfigureRealtime();
  window.addEventListener("userChanged", tenantListener);
  window.addEventListener("authStateChanged", tenantListener);
}

export function disableRealtimeSync() {
  teardownChannels();
  realtimeEnabled = false;
  realtimeTenantId = "";
  if (tenantListener) {
    window.removeEventListener("userChanged", tenantListener);
    window.removeEventListener("authStateChanged", tenantListener);
    tenantListener = null;
  }
}

function teardownChannels() {
  for (const channel of activeChannels) {
    try {
      void supabase.removeChannel(channel);
    } catch {
      /* channel already gone */
    }
  }
  activeChannels = [];
}

/** Rebuild the channels when (and only when) the tenant changed. */
function maybeReconfigureRealtime() {
  if (!realtimeEnabled) return;
  const tenantId = getTenantId();
  if (tenantId === realtimeTenantId) return;

  teardownChannels();
  realtimeTenantId = tenantId;

  if (!tenantId) {
    console.warn("[realtime] No tenant yet — channels start after sign-in.");
    return;
  }
  setupUserRealtime(tenantId);
  setupCourseRealtime(tenantId);
  setupEnrollmentRealtime(tenantId);
}

function subscribeChannel(
  name: string,
  tenantId: string,
  table: string,
  handler: (payload: any) => void | Promise<void>,
) {
  // ALWAYS scoped to the tenant — v2 fell back to `{}` (every tenant's rows)
  // when the tenant wasn't known yet; now we simply don't subscribe.
  const channel = supabase
    .channel(`${name}:${tenantId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table, filter: `tenant_id=eq.${tenantId}` },
      handler,
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") console.log(`📡 ${table} realtime live`);
      else if (status === "CHANNEL_ERROR")
        console.warn(`📡 ${table} realtime error — supabase-js keeps retrying`);
    });
  activeChannels.push(channel);
}

function setupUserRealtime(tenantId: string) {
  subscribeChannel("users-realtime", tenantId, "users", async (payload: any) => {
    // DELETE — hard delete on the cloud: drop the local row too
    if (payload.eventType === "DELETE") {
      const id = payload.old?.id;
      if (id) {
        await db.users.delete(id);
        window.dispatchEvent(new Event("userChanged"));
      }
      return;
    }

    const local: any = payload.new?.id ? await db.users.get(payload.new.id) : null;
    const row = mapUser(payload.new, local);
    if (!row.id) return;

    // Soft-deleted remotely — remove the stale local copy too (only when the
    // row is fully synced; an unsynced local edit always wins until pushed).
    if ((payload.new as any)?.deleted_at) {
      if (local && local.synced !== false) {
        await db.users.delete(row.id);
        window.dispatchEvent(new Event("userChanged"));
      }
      return;
    }

    // ✅ TOMBSTONE CHECK — never re-insert a locally-deleted user.
    // This is the path that resurrected deleted users in v1.
    if (await isDeleted("user", row.id)) {
      console.warn(`[realtime] Skipped tombstoned user ${row.id}`);
      return;
    }

    // ✅ LOCAL-EDIT CHECK — a row with pending local changes is not clobbered
    // by the cloud copy (same rule as pullAllTenantData).
    if (local && local.synced === false) return;

    console.log("📥 Realtime User received:", row.id);
    await db.users.put(row);
    // Trigger UI refresh if needed
    window.dispatchEvent(new Event("userChanged"));
  });
}

function setupCourseRealtime(tenantId: string) {
  subscribeChannel("courses-realtime", tenantId, "courses", async (payload: any) => {
    if (payload.eventType === "DELETE") {
      await db.courses.delete(payload.old?.id);
    } else {
      const local: any = payload.new?.id ? await db.courses.get(payload.new.id) : null;
      const localData = mapCourse(payload.new, local);

      if ((payload.new as any)?.deleted_at) {
        // Soft-deleted remotely — drop the stale local copy (unsynced wins).
        if (local && local.synced !== false) await db.courses.delete(localData.id);
      } else if (!localData.id || (await isDeleted("course", localData.id))) {
        console.warn(`[realtime] Skipped tombstoned course ${localData.id || "?"}`);
      } else if (local && local.synced === false) {
        // Local edit pending push — the cloud copy must not clobber it.
      } else {
        await db.courses.put(localData);
      }
    }
    // Trigger UI refresh for course components
    window.dispatchEvent(new Event("coursesChanged"));
  });
}

function setupEnrollmentRealtime(tenantId: string) {
  subscribeChannel("enrollments-realtime", tenantId, "enrollments", async (payload: any) => {
    if (payload.eventType === "DELETE") {
      await db.enrollments.delete(payload.old?.id);
    } else {
      const localData = mapEnrollment(payload.new);
      const local: any = localData.id ? await db.enrollments.get(localData.id) : null;

      if ((payload.new as any)?.deleted_at) {
        // Soft-deleted remotely — drop the stale local copy (unsynced wins).
        if (local && local.synced !== false) await db.enrollments.delete(localData.id);
      } else if (!localData.id || (await isDeleted("enrollment", localData.id))) {
        console.warn(`[realtime] Skipped tombstoned enrollment ${localData.id || "?"}`);
      } else if (!(local && local.synced === false)) {
        await db.enrollments.put(localData);
      }
    }
    window.dispatchEvent(new Event("enrollmentsChanged"));
  });
}

// ==========================================
// 2. MANUAL PULL
// ==========================================

export async function syncDown() {
  console.log("🔄 Starting Manual Sync Down...");
  try {
    // Self-heal first — v2 pulled with a dead session and silently got 401s.
    if (!(await ensureAuthenticated())) {
      console.log("Skipping sync down - not authenticated.");
      return;
    }

    const tenantId = getTenantId();
    if (!tenantId) {
      console.warn("Sync Down stopped - no tenant ID.");
      return;
    }

    // ✅ One unified pull (users + courses + enrollments): tenant-scoped,
    // soft-delete filtered, tombstone-aware, and never overwrites local
    // unsynced edits. Same code the periodic pull uses — no divergent copy.
    await pullAllTenantData(tenantId);

    // Sent-message history too, so every device sees the same Sent History.
    await pullRemoteSmsLogs(tenantId);

    // The tenant may have just become known (fresh login) — start channels.
    maybeReconfigureRealtime();

    window.dispatchEvent(new Event("dataSynced"));
    console.log("✅ Manual Sync Down complete.");
  } catch (error) {
    console.error("❌ Sync Down failed:", error);
  }
}

// ==========================================
// 3. PUSH LOCAL DATA TO CLOUD
// ==========================================

export async function syncUp() {
  console.log("☁️ Starting Sync Up...");
  try {
    if (!(await ensureAuthenticated())) {
      console.log("Skipping sync up - not authenticated.");
      return;
    }

    const tenantId = getTenantId();
    if (!tenantId) {
      console.warn("Sync Up stopped - no tenant ID.");
      return;
    }

    // ✅ Users + their enrollments — delegated to supabase.ts's pusher:
    // full row mapping (tenant_id, assignedDepartments, tuition,
    // remuneration, profile_pic), admin rows excluded, dedupe guard.
    await pushUsersToCloud();

    // ✅ Courses — this module owns the course push (supabase.ts doesn't).
    // v2's payload was missing tenant_id, so offline-created courses failed
    // the NOT NULL constraint; fixed here, plus tombstone + tenant guards.
    const deletedCourseIds = new Set(await getDeletedIds("course"));
    const localCourses = await db.courses.toArray();

    for (const course of localCourses) {
      const rec = course as any;
      // `course.id` is typed `string | undefined` on the Course model —
      // skip rows that somehow lack an id. This guard ALSO narrows
      // `course.id` to `string` for the rest of the loop body, so the
      // deletedCourseIds.has(...) and db.courses.update(...) calls below
      // type-check cleanly without any `as string` casts.
      if (!course.id || rec.synced || deletedCourseIds.has(course.id)) continue;
      if (rec.tenantId && rec.tenantId !== tenantId) continue; // never cross-tenant

      const { error } = await supabase
        .from("courses")
        .upsert(
          {
            id: course.id,
            tenant_id: tenantId,
            name: course.name || "",
            description: rec.description || "",
            logo: rec.logo || null,
            tuition_type: rec.tuitionType || "free",
            amount: parseFloat(String(rec.amount ?? 0)) || 0,
            start_date: rec.startDate || null,
            period: rec.period || null,
            trainer_id: rec.trainerId || null,
          },
          { onConflict: "id" }
        );

      if (!error) {
        await db.courses.update(course.id, { synced: true } as any);
        console.log(`✅ Pushed course: ${course.name}`);
      } else {
        console.error(`Failed to push course ${course.name}:`, error.message);
      }
    }

    window.dispatchEvent(new Event("dataSynced"));
    console.log("☁️ Sync Up complete.");
  } catch (error) {
    console.error("❌ Sync Up failed:", error);
  }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function normalizeRole(role: any): "admin" | "trainer" | "trainee" {
  return role === "admin" || role === "trainer" || role === "trainee" ? role : "trainee";
}

function normalizeStringArray(value: any): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item: any) => typeof item === "string" && item.trim().length > 0)
    .map((item: string) => item.trim());
}

/** Rich user mapper — mirrors supabase.ts's mapUser so a realtime update can
 *  no longer wipe tuition / remuneration / payment history locally. */
function mapUser(u: any, localUser?: any) {
  const tuition = u.tuition || {};
  const remuneration = u.remuneration || {};

  return {
    ...localUser,
    ...u,

    id: u.id,
    username: u.username || "",
    email: u.email || "",
    phone: u.phone || "",

    // Keep the LOCAL password for offline login (cloud rows may hold bcrypt
    // hashes — copying a hash into Dexie breaks plaintext offline login).
    password: localUser?.password || u.password || "",

    role: normalizeRole(u.role),

    profilePic: u.profile_pic || u.profilePic || localUser?.profilePic || "",

    assignedCourses: normalizeStringArray(u.assigned_courses ?? u.assignedCourses),

    assignedDepartments: normalizeStringArray(
      u.assignedDepartments ?? u.assigned_departments ?? localUser?.assignedDepartments
    ),

    tenantId: u.tenant_id || u.tenantId || localUser?.tenantId || "",

    createdAt: u.created_at || u.createdAt || localUser?.createdAt || new Date().toISOString(),

    tuition: {
      expected: tuition.expected ?? 0,
      paid: tuition.paid ?? 0,
    },

    remuneration: {
      netSalary: remuneration.net_salary ?? remuneration.netSalary ?? 0,
      perDiem: remuneration.per_diem ?? remuneration.perDiem ?? 0,
    },

    // History fields are not Supabase columns — keep whatever local had.
    paymentHistory: localUser?.paymentHistory ?? [],
    remunerationHistory: localUser?.remunerationHistory ?? [],

    synced: true,
  };
}

function mapCourse(c: any, localCourse?: any) {
  return {
    ...localCourse,
    ...c,

    id: c.id,
    name: c.name || "",
    description: c.description || "",

    tuitionType: c.tuition_type || c.tuitionType || "free",
    amount: c.amount ?? 0,
    startDate: c.start_date || c.startDate || "",
    period: c.period || "",

    logo: c.logo || localCourse?.logo || "",
    mediaUrl: c.logo || c.mediaUrl || "", // Mirror logo for UI consistency
    trainerId: c.trainer_id || c.trainerId || localCourse?.trainerId || "",

    tenantId: c.tenant_id || c.tenantId || localCourse?.tenantId || "",
    createdAt: c.created_at || c.createdAt || localCourse?.createdAt || new Date().toISOString(),

    synced: true,
  };
}

function mapEnrollment(e: any) {
  return {
    ...e,

    id: e.id,
    userId: e.user_id || e.userId || "",
    courseId: e.course_id || e.courseId || "",
    tenantId: e.tenant_id || e.tenantId || "",
    status: e.status || "active",
    role: e.role || "trainee",

    enrolledAt: e.enrolled_at || e.enrolledAt || e.created_at || new Date().toISOString(),
    createdAt: e.created_at || e.createdAt || e.enrolled_at || new Date().toISOString(),

    synced: true,
  };
}
