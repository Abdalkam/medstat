// src/database/sync.ts — v8: enrollment-aware pulls + shape-aware course pull
//
// Changes vs v7 (cross-device data completeness fix — all preserved):
//  1. Pull Enrollments: pair-level tombstones + pending-removal log respected,
//     no duplicate rows for the same (userId, courseId) pair, cloud roles only
//     trusted when explicitly present, missing roles backfilled from the user.
//  2. Pull Users/Courses skip rows with pending local edits (synced:false).
//  3. pullAllTenantData also runs syncPendingEnrollments() every tick.
//  4. syncUp flags successfully pushed users as synced:true (push-then-flag).
//  5. mapUser no longer drops tuition, remuneration or assignedDepartments —
//     the mapping matches the public.users DDL exactly:
//     • tuition jsonb is camelCase on both sides ({expected, paid}) —
//       the column default is '{"paid": 0, "expected": 0}';
//     • remuneration jsonb is snake_case in the cloud
//       ('{"per_diem": 0, "net_salary": 0}') and camelCase locally —
//       normalized via supabaseUserSync.shapeRemunerationLocal();
//     • departments are carried under their literal cloud column name
//       "assignedDepartments" (camelCase — unlike assigned_courses);
//     • assigned_courses/assignedCourses stay mirrored (existing readers).
//
// Changes vs v7 in THIS version (the course-pull fix):
//  6. Pull Courses goes through supabaseCourseSync.fetchCoursesFromSupabase —
//     SHAPE-AWARE. The live public.courses table is the doc-store shape
//     ({id, tenant_id, course_id, assignment_id, data jsonb, updated_at}),
//     so the old relational pull — select("*") + is:deleted_at:null — died
//     with PGRST204 "Could not find the 'deleted_at' column" on every tick
//     and courses never arrived from the cloud. fetchCoursesFromSupabase
//     handles both shapes, filters soft-deleted rows (deleted_at column OR
//     data.deleted_at jsonb) and returns local-shape courses, so the mapper
//     that used to live here (mapCourse) is gone — one source of truth.

import { db } from "./db";
import { sbFetch } from "../auth/supabase";
import { purgeDeletedFromDexie, retryFailedCloudDeletes } from "./deletedIdsTracker";
import { shapeRemunerationLocal, shapeTuition } from "./supabaseUserSync";
import { fetchCoursesFromSupabase } from "./supabaseCourseSync";

let periodicPullInterval: ReturnType<typeof setInterval> | null = null;

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

// ==========================================
// LOCAL AUTH HELPERS
// (Defined here so sync.ts is self-contained —
//  no dependency on supabase.ts exports for these)
// ==========================================
function hasValidAuth(): boolean {
  return !!localStorage.getItem("authToken") && !!localStorage.getItem("currentUser");
}

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string) {
  if (!hasValidAuth()) throw new Error("No auth token available");
  const res = await fetch(`${API_BASE_URL}${path}`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API fetch failed: ${res.status}`);
  return res.json();
}

// Single source of truth for logging out.
export function hardRedirectToLogin() {
  stopPeriodicPull();
  localStorage.removeItem("authToken");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("activeTenantId");
  window.dispatchEvent(new Event("authStateChanged"));
}

// ==========================================
// 1. REALTIME SYNC (Disabled for stability)
// ==========================================
export function enableSyncHooks() {
  console.log("Sync hooks enabled (Polling mode).");
}

// ==========================================
// 2. PERIODIC PULL
// ==========================================
export function startPeriodicPull(ms: number = 60000) {
  if (periodicPullInterval) clearInterval(periodicPullInterval);

  periodicPullInterval = setInterval(async () => {
    if (!hasValidAuth()) return;

    const token = localStorage.getItem("authToken");
    if (token === "offline-mode-pending-sync") return;

    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (user?.tenantId) {
      try {
        await pullAllTenantData(user.tenantId);
        await retryFailedCloudDeletes();
      } catch {
        // errors already logged inside pullAllTenantData
      }
    }
  }, ms);
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
  }
}

// ==========================================
// 3. PULL ALL DATA
// ==========================================
export async function pullAllTenantData(tenantId: string) {
  if (!tenantId) return;

  const token = localStorage.getItem("authToken");
  if (token === "offline-mode-pending-sync") return;

  try {
    const { getDeletedIds } = await import("./deletedIdsTracker");

    // Pre-load ALL tombstoned IDs to block re-insertion.
    // For enrollments this includes both row ids AND the composite
    // `${userId}:${courseId}` keys written by enrollmentDB.removeEnrollmentRows().
    const deletedUserIds = new Set(await getDeletedIds("user"));
    const deletedCourseIds = new Set(await getDeletedIds("course"));
    const deletedEnrollmentIds = new Set(await getDeletedIds("enrollment"));
    const deletedAssignmentIds = new Set(await getDeletedIds("assignment"));

    // --- Pull Users ---
    try {
      const { data: users } = await sbFetch("users", {
        select: "*",
        tenant_id: `eq.${tenantId}`,
        is: { column: "deleted_at", value: null },
      });

      if (users) {
        for (const u of users) {
          if (deletedUserIds.has(u.id)) continue;
          if (u.deleted_at) continue;
          // ✅ Never clobber pending local edits (incl. the assignedCourses
          //    mirror) — they win until their own push completes.
          const local: any = await db.users.get(u.id);
          if (local && local.synced === false) continue;
          await db.users.put(mapUser(u));
        }
      }
    } catch (e) {
      console.warn("Pull users from Supabase failed:", e instanceof Error ? e.message : e);
    }

    // --- Pull Courses (shape-aware — see supabaseCourseSync v4) ---
    try {
      const courses = await fetchCoursesFromSupabase(tenantId);
      if (courses) {
        for (const c of courses) {
          // ✅ Course.id is optional on the shared type — skip id-less rows.
          if (!c.id || deletedCourseIds.has(c.id)) continue;
          // ✅ Same pending-edit guard as users — locally edited rows win
          //    until their own push completes.
          const local: any = await db.courses.get(c.id);
          if (local && local.synced === false) continue;
          // Rows arrive already mapped to the local shape with synced:true.
          await db.courses.put(c);
        }
      }
    } catch (e) {
      console.warn("Pull courses from Supabase failed:", e instanceof Error ? e.message : e);
    }

    // --- Pull Enrollments ---
    try {
      const { data: enrollments } = await sbFetch("enrollments", {
        select: "*",
        tenant_id: `eq.${tenantId}`,
        is: { column: "deleted_at", value: null },
      });

      if (enrollments) {
        // ✅ Pairs whose cloud removal is NOT confirmed yet (enrollmentDB
        //    retry log) must stay hidden from the pull.
        let pendingPairs: Set<string> | null = null;
        try {
          const m = await import("./enrollmentDB");
          pendingPairs = m.getPendingRemovals();
        } catch { /* row-id tombstones still guard */ }

        for (const e of enrollments) {
          if (deletedEnrollmentIds.has(e.id)) continue;
          if (e.deleted_at) continue;

          const userId = e.user_id || e.userId || "";
          const courseId = e.course_id || e.courseId || "";
          if (!userId || !courseId) continue;

          // ✅ Pair-level tombstone (composite) or pending removal → never re-insert
          if (deletedEnrollmentIds.has(`${userId}:${courseId}`)) continue;
          if (pendingPairs && pendingPairs.has(`${userId}:${courseId}`)) continue;

          // ✅ Only trust a role that is EXPLICITLY on the cloud row —
          //    mapEnrollment's "trainee" fallback must never look like cloud truth.
          const cloudRole =
            e.role === "trainer" || e.role === "trainee" ? (e.role as string) : "";

          const mapped = mapEnrollment(e);

          const existing: any = await db.enrollments
            .where({ userId: mapped.userId, courseId: mapped.courseId })
            .first();

          if (!existing) {
            // New row from the cloud. Legacy rows without a role are backfilled
            // from the user's own record (users were pulled just above, so fresh).
            if (!cloudRole) {
              try {
                const u: any = await db.users.get(mapped.userId);
                if (u && (u.role === "trainer" || u.role === "trainee")) {
                  mapped.role = u.role;
                }
              } catch { /* keep mapped default */ }
            }
            await db.enrollments.put(mapped);
          } else if (existing.id === mapped.id) {
            // Same row — conflict rule: pending local edits (synced:false) win;
            // otherwise an explicit cloud role heals a wrong/missing local one.
            const patch: any = {};
            if (existing.synced === false) {
              if (!existing.role && cloudRole) patch.role = cloudRole;
              if (!existing.tenantId && !existing.tenant_id && mapped.tenantId) {
                patch.tenantId = mapped.tenantId;
              }
            } else {
              if (cloudRole && existing.role !== cloudRole) patch.role = cloudRole;
              if (!existing.tenantId && !existing.tenant_id && mapped.tenantId) {
                patch.tenantId = mapped.tenantId;
              }
            }
            if (Object.keys(patch).length > 0) {
              await db.enrollments.update(existing.id, patch);
            }
          }
          // existing.id !== mapped.id → duplicate cloud row for the same pair:
          // keep the local row; cloud-side dedupe is handled by
          // reconcileUserEnrollments() in enrollmentDB.
        }
      }
    } catch (e) {
      console.warn("Pull enrollments from Supabase failed:", e instanceof Error ? e.message : e);
    }

    // --- Pull Assignments ---
    try {
      const { data: assignments } = await sbFetch("assignments", {
        select: "*",
        tenant_id: `eq.${tenantId}`,
        is: { column: "deleted_at", value: null },
      });

      if (assignments) {
        for (const a of assignments) {
          if (deletedAssignmentIds.has(a.id)) continue;
          if (a.deleted_at) continue;
          await db.assignments.put(mapAssignment(a));
        }
      }
    } catch (e) {
      console.warn("Pull assignments from Supabase failed:", e instanceof Error ? e.message : e);
    }

    // --- Pull SMS Logs (non-critical) ---
    try {
      const { data: smsLogs } = await sbFetch("sms_logs", {
        select: "*",
        tenant_id: `eq.${tenantId}`,
        order: { column: "sent_at", ascending: false },
        limit: "1000",
      });

      if (smsLogs) {
        for (const log of smsLogs) {
          if (log.deleted_at) continue;
          await db.smsLogs.put(mapSmsLog(log));
        }
      }
    } catch (e) {
      console.warn("Pull SMS logs failed (non-critical):", e instanceof Error ? e.message : e);
    }

    // Defensively purge any tombstoned items that snuck back into Dexie
    await purgeDeletedFromDexie();

    // ✅ Retry pending enrollment pushes + unconfirmed cloud removals
    //    (from enrollmentDB) — cheap, safe, runs every tick.
    try {
      const { syncPendingEnrollments } = await import("./enrollmentDB");
      await syncPendingEnrollments(tenantId);
    } catch { /* offline — retried next tick */ }
  } catch (error) {
    if (!(error instanceof Error && error.message === "401")) {
      console.error("Pull tenant data failed:", error);
    }
  }
}

// ==========================================
// 4. PULL SETTINGS
// ==========================================
export async function pullSettings() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = user?.tenantId;
  if (!tenantId) return null;

  const token = localStorage.getItem("authToken");
  if (token === "offline-mode-pending-sync") return null;

  try {
    return await apiFetch(`/api/settings/get?tenant_id=${tenantId}`);
  } catch (error) {
    if (!(error instanceof Error && error.message === "API fetch failed: 401")) {
      console.error("Failed to pull settings:", error);
    }
    return null;
  }
}

// ==========================================
// 5. MANUAL SYNC DOWN
// ==========================================
export async function syncDown() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  if (user?.tenantId) await pullAllTenantData(user.tenantId);
}

// ==========================================
// 6. PUSH LOCAL DATA TO CLOUD
// ==========================================
export async function syncUp() {
  if (!hasValidAuth()) return;

  try {
    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u) => !(u as any).synced);

    if (usersToSync.length > 0) {
      const { getDeletedIds } = await import("./deletedIdsTracker");
      const deletedUserIds = new Set(await getDeletedIds("user"));
      const filtered = usersToSync.filter(u => !deletedUserIds.has(u.id));

      if (filtered.length > 0) {
        const res = await fetch(`${API_BASE_URL}/api/sync/push-users`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: JSON.stringify({ users: filtered }),
        });
        if (!res.ok) {
          console.warn(`Push users failed: ${res.status}`);
        } else {
          // ✅ Push-then-flag (same pattern as trainerDB/courseDB):
          //    only mark rows synced after the cloud accepted them, so the
          //    assignedCourses mirror doesn't re-push forever.
          for (const u of filtered) {
            try { await db.users.update(u.id, { synced: true } as any); } catch { /* ignore */ }
          }
        }
      }
    }
  } catch (error) {
    console.error("Sync Up failed:", error);
  }
}

// ==========================================
// MAPPER HELPERS
// ==========================================

/** tuition jsonb — camelCase keys on BOTH sides ({expected, paid}); the
 *  Supabase column default is '{"paid": 0, "expected": 0}'. */
function mapTuitionLocal(tuition: any) {
  return shapeTuition(tuition);
}

/** remuneration jsonb — the cloud column is snake_case
 *  ('{"per_diem": 0, "net_salary": 0}'), local rows use camelCase; accepts
 *  either spelling and always emits the local shape. */
function mapRemunerationLocal(remuneration: any) {
  return shapeRemunerationLocal(remuneration);
}

function mapUser(u: any) {
  const courses = u.assigned_courses || u.assignedCourses || [];
  // The departments column is literally "assignedDepartments" in the DDL —
  // carry it under the camelCase key local readers already tolerate.
  const departments = u.assignedDepartments || u.assigned_departments || [];

  return {
    id: u.id,
    username: u.username,
    email: u.email || "",
    phone: u.phone || "",
    password: u.password || "",
    role: u.role || "trainee",
    profilePic: u.profile_pic || u.profilePic || "",
    assigned_courses: courses,
    assignedCourses: courses,
    assignedDepartments: departments,
    tuition: mapTuitionLocal(u.tuition),
    remuneration: mapRemunerationLocal(u.remuneration),
    tenantId: u.tenant_id || u.tenantId,
    createdAt: u.created_at || u.createdAt || new Date().toISOString(),
    synced: true,
  };
}

// mapCourse was removed in v8 — course mapping now lives in
// supabaseCourseSync.mapCloudCourseToLocal (one source of truth for BOTH
// cloud table shapes). Pull Courses uses fetchCoursesFromSupabase above.

function mapEnrollment(e: any) {
  return {
    id: e.id,
    userId: e.user_id || e.userId || "",
    courseId: e.course_id || e.courseId || "",
    role: e.role || "trainee",
    tenantId: e.tenant_id || e.tenantId,
    enrolledAt: e.enrolled_at || e.enrolledAt || new Date().toISOString(),
    createdAt: e.created_at || e.createdAt || new Date().toISOString(),
    synced: true,
  };
}

function mapAssignment(a: any) {
  return {
    id: a.id,
    courseId: a.course_id || a.courseId || "",
    trainerId: a.trainer_id || a.trainerId || "",
    title: a.title || "",
    description: a.description || "",
    dueDate: a.due_date || a.dueDate || "",
    tenantId: a.tenant_id || a.tenantId,
    createdAt: a.created_at || a.createdAt || new Date().toISOString(),
    synced: true,
  };
}

function mapSmsLog(log: any) {
  return {
    id: log.id,
    tenant_id: log.tenant_id || log.tenantId || "",
    phone: log.phone || "",
    message: log.message || "",
    status: log.status || "Unknown",
    sent_by: log.sent_by || log.sentBy || "",
    sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : new Date().toISOString(),
  };
}
