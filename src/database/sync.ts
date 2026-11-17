// src/database/sync.ts — v11: ALWAYS-DRAINING offline-first engine + live status store
//
// v11 — SELF-CONTAINED (no extra files): the sync-status store and the
//  useSyncStatus() React hook now live in THIS file, so screens can do
//  `import { useSyncStatus, syncNow } from "../database/sync"`:
//   • subscribeSyncStatus(cb) / getSyncSnapshot() — framework-free store
//   • useSyncStatus() — React binding (useState/useEffect, React 17-safe)
//   • notifySyncStart / notifySyncEnd — published by the flush below
//   • refreshPendingCounts() — live counts of queued users/courses/
//     enrollments/deletes (the number behind the "待同步" badge)
//
// WHY v10 EXISTS — the "Admin stays 待同步 forever" bug:
//  v9 only re-pushed USERS on the browser "online" event (flushPendingWork).
//  The 60s tick pulled data but never called syncUp(). So the first time a
//  user push failed — a Render cold-start timeout on the Express host, a 401
//  from the offline sign-in token, a network blip, or /api/sync/push-users
//  INSERTing a row that already exists in the cloud (duplicate-key error) —
//  that row stayed synced:false FOREVER while the device stayed online. That
//  is exactly the "Admin — 待同步" badge in the users list.
//
// v10 fixes:
//  1. One flush path for every queue, run by EVERY trigger (60s tick, browser
//     "online", tab refocus/visibility, re-login, manual "Sync now"):
//     pending courses → failed cloud deletes → pending USERS → pull (which
//     itself retries pending enrollments + unconfirmed removals).
//  2. syncUp is defensive:
//     • skips the offline sign-in token ("offline-mode-pending-sync") instead
//       of spamming doomed 401s every tick;
//     • pushes in chunks of 25 so one bad row cannot poison a whole batch;
//     • logs the server's response body on failure (the real reason finally
//       shows up in the console);
//     • FALLS BACK to a direct Supabase upsert (onConflict "id") — so an
//       Express route that INSERTs an already-existing row (the Admin
//       duplicate case) can no longer wedge the queue; upsert is idempotent.
//  3. Exponential backoff per queue (60s → 2m → 4m … cap 10m) so a dead
//     backend is not hammered every minute; user-intent triggers (manual sync,
//     reconnect) bypass the backoff.
//  4. Live status published to the in-file store (section 8): phase, pending
//     counts, last sync time, last error, offline sign-in — consumed by
//     useSyncStatus() (also in this file) and rendered by admin screens.
//
// Preserved from v9 (offline-first hardening):
//  • the tick and pull skip entirely when navigator.onLine is false;
//  • a browser "online" event triggers an immediate flush;
//  • pullAllTenantData is enrollment-aware, shape-aware for courses
//    (supabaseCourseSync.fetchCoursesFromSupabase), respects pair-level
//    tombstones + pending-removals, and never clobbers locally-pending rows
//    (synced:false wins until their own push completes);
//  • mapUser carries tuition/remuneration/assignedDepartments exactly per the
//    public.users DDL; push-then-flag everywhere (no premature synced:true).

import { useEffect, useState } from "react";
import { db } from "./db";
import { supabase, sbFetch } from "../auth/supabase";
import {
  purgeDeletedFromDexie,
  retryFailedCloudDeletes,
  getTombstoneStats,
} from "./deletedIdsTracker";
import { getPendingRemovals } from "./enrollmentDB";
import { shapeRemunerationLocal, shapeTuition } from "./supabaseUserSync";
import { fetchCoursesFromSupabase } from "./supabaseCourseSync";
import { retryPendingCoursePushes } from "./courseDB";

let periodicPullInterval: ReturnType<typeof setInterval> | null = null;
let flushInFlight: Promise<void> | null = null;
let listenersBound = false;
let authFlushTimer: ReturnType<typeof setTimeout> | null = null;

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

// The offline sign-in placeholder token: reads/pushes are deferred while this
// is in localStorage — everything drains on the first real online login.
const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";

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
// 1b. PER-QUEUE BACKOFF
// ==========================================
const BACKOFF_BASE_MS = 60000; // first retry after a failure: next tick
const BACKOFF_MAX_MS = 600000; // cap: 10 minutes

const queueBackoff: Record<string, { failures: number; nextAt: number }> = {};

function queueDue(queue: string, bypass: boolean): boolean {
  if (bypass) return true;
  const s = queueBackoff[queue];
  return !s || Date.now() >= s.nextAt;
}

function markQueueSuccess(queue: string): void {
  delete queueBackoff[queue];
}

function markQueueFailure(queue: string, msg: string): void {
  const failures = (queueBackoff[queue]?.failures || 0) + 1;
  const delay = Math.min(BACKOFF_BASE_MS * Math.pow(2, failures - 1), BACKOFF_MAX_MS);
  queueBackoff[queue] = { failures, nextAt: Date.now() + delay };
  console.warn(
    `[sync] ${queue} failed (${failures}x) — backing off ${Math.round(delay / 1000)}s: ${msg}`
  );
}

function resetAllBackoff(): void {
  for (const k of Object.keys(queueBackoff)) delete queueBackoff[k];
}

// ==========================================
// 2. THE FLUSH — one path for every queue
// ==========================================
async function doFlush(tenantId: string, bypassBackoff: boolean): Promise<void> {
  if (!isOnline()) return;

  notifySyncStart();
  let hadError = false;
  let errMsg = "";

  // 1) Courses edited/created while offline or after a failed push.
  if (queueDue("courses", bypassBackoff)) {
    try {
      await retryPendingCoursePushes();
      markQueueSuccess("courses");
    } catch (e) {
      hadError = true;
      if (!errMsg) errMsg = `Course push: ${errMsgOf(e)}`;
      markQueueFailure("courses", errMsgOf(e));
    }
  }

  // 2) Cloud deletes that failed earlier (tombstoned users/courses).
  if (queueDue("deletes", bypassBackoff)) {
    try {
      await retryFailedCloudDeletes();
      markQueueSuccess("deletes");
    } catch (e) {
      hadError = true;
      if (!errMsg) errMsg = `Cloud deletes: ${errMsgOf(e)}`;
      markQueueFailure("deletes", errMsgOf(e));
    }
  }

  // 3) ✅ THE FIX: pending USERS now drain on every trigger too — this used
  //    to run only on the browser "online" event, which is why a single
  //    failed push left "Admin" pending forever on an always-online device.
  try {
    const usersOk = await syncUp(bypassBackoff);
    if (!usersOk) {
      hadError = true;
      if (!errMsg) errMsg = "User sync failed — will retry";
    }
  } catch (e) {
    hadError = true;
    if (!errMsg) errMsg = `User sync: ${errMsgOf(e)}`;
  }

  // 4) Pull cloud → local. Also retries pending enrollments and unconfirmed
  //    removals (inside pullAllTenantData → syncPendingEnrollments).
  try {
    await pullAllTenantData(tenantId);
  } catch (e) {
    hadError = true;
    if (!errMsg) errMsg = `Pull: ${errMsgOf(e)}`;
  }

  notifySyncEnd(!hadError, errMsg);
  void refreshPendingCounts();
}

/** Re-entrant flush: concurrent triggers share one in-flight run. */
function runFlush(tenantId: string, bypassBackoff: boolean): Promise<void> {
  if (flushInFlight) return flushInFlight;
  flushInFlight = (async () => {
    try {
      await doFlush(tenantId, bypassBackoff);
    } finally {
      flushInFlight = null;
    }
  })();
  return flushInFlight;
}

/** ✅ OFFLINE-FIRST: drain everything queued — manual "Sync now", reconnect,
 *  refocus, re-login. User intent bypasses per-queue backoff. */
export function syncNow(tenantId?: string): Promise<void> {
  let tid = tenantId;
  if (!tid) {
    try {
      tid = JSON.parse(localStorage.getItem("currentUser") || "{}")?.tenantId;
    } catch { tid = undefined; }
  }
  if (!tid || !hasValidAuth()) {
    void refreshPendingCounts();
    return Promise.resolve();
  }
  return runFlush(tid, true);
}

function errMsgOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ==========================================
// 3. TRIGGERS (tick + reconnect + refocus + login)
// ==========================================
function currentTenantId(): string {
  try {
    return JSON.parse(localStorage.getItem("currentUser") || "{}")?.tenantId || "";
  } catch {
    return "";
  }
}

function triggerFlush(bypassBackoff: boolean): void {
  if (!hasValidAuth()) return;
  const tenantId = currentTenantId();
  if (tenantId) void runFlush(tenantId, bypassBackoff);
}

export function startPeriodicPull(ms: number = 60000) {
  if (periodicPullInterval) clearInterval(periodicPullInterval);

  periodicPullInterval = setInterval(() => {
    if (!hasValidAuth()) return;

    // ✅ OFFLINE-FIRST: skip doomed work while the network is down.
    if (!isOnline()) return;

    const token = localStorage.getItem("authToken");
    if (token === OFFLINE_LOGIN_TOKEN) return;

    if (currentTenantId()) void runFlush(currentTenantId(), false);
  }, ms);

  bindFlushListeners();
}

function bindFlushListeners(): void {
  if (listenersBound || typeof window === "undefined") return;
  listenersBound = true;

  // Network back → drain the offline queue immediately (user-intent trigger).
  window.addEventListener("online", () => triggerFlush(true));

  // Tab refocus → fresh chance to sync (bypasses backoff, de-duped by the
  // in-flight guard in runFlush).
  const refocus = () => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    if (!isOnline()) return;
    triggerFlush(true);
  };
  document.addEventListener("visibilitychange", refocus);
  window.addEventListener("focus", refocus);

  // Re-login → flush whatever the previous session queued, and forget any
  // backoff accumulated against the old session's failures.
  window.addEventListener("authStateChanged", () => {
    resetAllBackoff();
    if (authFlushTimer) clearTimeout(authFlushTimer);
    authFlushTimer = setTimeout(() => triggerFlush(true), 1500);
  });
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
  }
  // Global listeners stay bound on purpose: they are no-ops without auth and
  // keep manual "Sync now" working across re-logins.
}

// ==========================================
// 4. PULL ALL DATA
// ==========================================
export async function pullAllTenantData(tenantId: string) {
  if (!tenantId) return;

  // ✅ OFFLINE-FIRST: reads without a network are pure noise — the local
  //    Dexie data is already on screen and stays authoritative until a
  //    later online tick merges the cloud again.
  if (!isOnline()) return;

  const token = localStorage.getItem("authToken");
  if (token === OFFLINE_LOGIN_TOKEN) return;

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
// 5. PULL SETTINGS
// ==========================================
export async function pullSettings() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = user?.tenantId;
  if (!tenantId) return null;

  const token = localStorage.getItem("authToken");
  if (token === OFFLINE_LOGIN_TOKEN) return null;

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
// 6. MANUAL SYNC DOWN
// ==========================================
export async function syncDown() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  if (user?.tenantId) await pullAllTenantData(user.tenantId);
}

// ==========================================
// 7. PUSH LOCAL USERS TO CLOUD — chunked + fallback
// ==========================================

/** True while the session is the offline sign-in placeholder: pushes are
 *  deferred (a fake token can only produce 401s) — the queue drains on the
 *  first real login via the authStateChanged flush. */
function isOfflineLoginSession(): boolean {
  return localStorage.getItem("authToken") === OFFLINE_LOGIN_TOKEN;
}

/** POST one chunk to the existing Express batch route. Returns true when the
 *  chunk was accepted. On failure the response body is logged — after months
 *  of silent `res.status` warnings this finally shows WHY a row is stuck. */
async function pushUsersViaExpress(chunk: any[]): Promise<boolean> {
  const res = await fetch(`${API_BASE_URL}/api/sync/push-users`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ users: chunk }),
  });
  if (!res.ok) {
    let body = "";
    try { body = (await res.text()).slice(0, 300); } catch { /* ignore */ }
    console.warn(`[sync] push-users failed: ${res.status}${body ? ` — ${body}` : ""}`);
    return false;
  }
  // Tolerate a server that reports per-row failures inside a 200 body.
  try {
    const data: any = await res.json();
    if (data && Array.isArray(data.failed) && data.failed.length > 0) {
      console.warn(`[sync] push-users reported ${data.failed.length} rejected row(s)`);
      return false;
    }
  } catch { /* non-JSON body — treat as accepted */ }
  return true;
}

/** Local Dexie row → public.users column shape (per the DDL documented on
 *  mapUser). Deliberately OMITS created_at (never clobber a cloud row's
 *  creation time) and deleted_at (never resurrect a soft-deleted row), and
 *  drops every local-only field (synced). */
function toNum(v: any): number {
  const n = parseFloat(String(v ?? 0).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function mapUserToCloud(u: any): Record<string, unknown> {
  const courses = Array.isArray(u.assigned_courses)
    ? u.assigned_courses
    : Array.isArray(u.assignedCourses)
      ? u.assignedCourses
      : [];
  const departments = Array.isArray(u.assignedDepartments)
    ? u.assignedDepartments
    : Array.isArray(u.assigned_departments)
      ? u.assigned_departments
      : [];
  const r = u.remuneration || {};

  return {
    id: u.id,
    username: u.username,
    email: u.email || "",
    phone: u.phone || "",
    password: u.password || "",
    role: u.role || "trainee",
    profile_pic: u.profilePic || u.profile_pic || null,
    assigned_courses: courses,
    // The departments column is literally camelCase in the cloud DDL.
    assignedDepartments: departments,
    tuition: { expected: toNum(u.tuition?.expected), paid: toNum(u.tuition?.paid) },
    remuneration: {
      per_diem: toNum(r.perDiem ?? r.per_diem),
      net_salary: toNum(r.netSalary ?? r.net_salary),
    },
    tenant_id: u.tenantId || u.tenant_id,
  };
}

/** Direct Supabase upsert (onConflict "id") — the fallback that heals the
 *  Admin case: an Express route doing a plain INSERT on a row that already
 *  exists fails with a duplicate-key error on EVERY retry, while upsert is
 *  idempotent. Uses the same supabase client enrollmentDB already relies on. */
async function pushUsersViaSupabase(chunk: any[]): Promise<boolean> {
  const rows = chunk.map(mapUserToCloud);
  const { error } = await supabase.from("users").upsert(rows, { onConflict: "id" });
  if (error) {
    console.warn("[sync] direct Supabase user upsert failed:", error.message);
    return false;
  }
  return true;
}

export async function syncUp(bypassBackoff = false): Promise<boolean> {
  if (!hasValidAuth()) return true; // nothing attempted — not a failure

  // Offline sign-in: nothing can push yet — do not spam 401s from the tick.
  if (isOfflineLoginSession()) return true;

  // Backoff window still open — skipping is success from the flush's point
  // of view (the pill must not flash "error" for a deliberately deferred
  // retry).
  if (!queueDue("users", bypassBackoff)) return true;

  try {
    const localUsers = await db.users.toArray();
    let usersToSync: any[] = localUsers.filter((u: any) => u.synced === false);

    if (usersToSync.length === 0) {
      markQueueSuccess("users");
      return true;
    }

    // Tombstoned users must never resurrect in the cloud.
    const { getDeletedIds } = await import("./deletedIdsTracker");
    const deletedUserIds = new Set(await getDeletedIds("user"));
    usersToSync = usersToSync.filter((u) => !deletedUserIds.has(u.id));

    if (usersToSync.length === 0) {
      markQueueSuccess("users");
      return true;
    }

    console.info(`[sync] Pushing ${usersToSync.length} pending user(s)…`);
    // ✅ Push-then-flag (same pattern as trainerDB/courseDB): rows are marked
    //    synced:true only AFTER the cloud accepted them, so a failure can
    //    never fake a completed sync. Chunked so one bad row cannot poison
    //    the whole batch.
    const CHUNK = 25;
    const failedRows: any[] = [];

    for (let i = 0; i < usersToSync.length; i += CHUNK) {
      const chunk = usersToSync.slice(i, i + CHUNK);
      let ok = false;
      try {
        ok = await pushUsersViaExpress(chunk);
      } catch { /* network — fall through */ }

      if (!ok) {
        // Express down / rejected the chunk (cold start, 401, duplicate
        // INSERT, 500 …) — the idempotent Supabase upsert heals it.
        try {
          ok = await pushUsersViaSupabase(chunk);
        } catch { /* stays pending */ }
      }

      if (ok) {
        for (const u of chunk) {
          try { await db.users.update(u.id, { synced: true } as any); } catch { /* ignore */ }
        }
      } else {
        failedRows.push(...chunk);
      }
    }

    if (failedRows.length === 0) {
      markQueueSuccess("users");
      console.info("[sync] User push complete.");
      return true;
    }

    markQueueFailure("users", `${failedRows.length} user(s) not accepted`);
    return false;
  } catch (error) {
    markQueueFailure("users", errMsgOf(error));
    return false;
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

// ==========================================
// 8. LIVE SYNC-STATUS STORE (framework-free) + React hook
// ==========================================

export type SyncPhase = "idle" | "syncing" | "error";

export interface SyncSnapshot {
  online: boolean;
  offlineLogin: boolean; // signed in with the offline placeholder token
  phase: SyncPhase;
  pendingUsers: number;
  pendingCourses: number;
  pendingEnrollments: number;
  pendingDeletes: number; // failed tombstones + unconfirmed removals
  lastSyncAt: number;     // epoch ms — 0 = never synced this session
  lastError: string;
}

const syncListeners = new Set<() => void>();
let syncSnapshot: SyncSnapshot = {
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  offlineLogin: false,
  phase: "idle",
  pendingUsers: 0,
  pendingCourses: 0,
  pendingEnrollments: 0,
  pendingDeletes: 0,
  lastSyncAt: 0,
  lastError: "",
};

function publishSyncSnapshot(next: SyncSnapshot): void {
  syncSnapshot = next;
  for (const cb of syncListeners) {
    try { cb(); } catch { /* a broken subscriber must not break the store */ }
  }
}

function patchSyncSnapshot(p: Partial<SyncSnapshot>): void {
  publishSyncSnapshot({ ...syncSnapshot, ...p });
}

export function notifySyncStart(): void {
  patchSyncSnapshot({ phase: "syncing" });
}

/** ok=false marks the phase "error" and records a short reason; ok=true
 *  stamps lastSyncAt and clears the error. */
export function notifySyncEnd(ok: boolean, errMsg?: string): void {
  patchSyncSnapshot(
    ok
      ? { phase: "idle", lastError: "", lastSyncAt: Date.now() }
      : { phase: "error", lastError: errMsg || "Sync failed" }
  );
}

async function countUnsynced(table: "users" | "courses" | "enrollments"): Promise<number> {
  try {
    return await (db as any)[table].filter((r: any) => r?.synced === false).count();
  } catch {
    return 0; // table missing / private mode — never let a counter crash the UI
  }
}

/** Recompute every queued-work counter and refresh the online/offline-login
 *  flags. Cheap at tenant scale; safe to call as often as you like. */
export async function refreshPendingCounts(): Promise<void> {
  const [pendingUsers, pendingCourses, pendingEnrollments] = await Promise.all([
    countUnsynced("users"),
    countUnsynced("courses"),
    countUnsynced("enrollments"),
  ]);

  let failedDeletes = 0;
  try {
    const t = await getTombstoneStats();
    failedDeletes = t.failed + t.pending;
  } catch { /* ignore */ }

  let pendingRemovalPairs = 0;
  try {
    pendingRemovalPairs = getPendingRemovals().size;
  } catch { /* ignore */ }

  let online = syncSnapshot.online;
  try { online = navigator.onLine !== false; } catch { /* keep previous */ }

  let offlineLogin = false;
  try {
    offlineLogin = localStorage.getItem("authToken") === OFFLINE_LOGIN_TOKEN;
  } catch { /* ignore */ }

  publishSyncSnapshot({
    ...syncSnapshot,
    online,
    offlineLogin,
    pendingUsers,
    pendingCourses,
    pendingEnrollments,
    pendingDeletes: failedDeletes + pendingRemovalPairs,
  });
}

/** Total queued changes — the number behind "N pending" chips. */
export function totalPending(s: SyncSnapshot): number {
  return s.pendingUsers + s.pendingCourses + s.pendingEnrollments + s.pendingDeletes;
}

export function getSyncSnapshot(): SyncSnapshot {
  return syncSnapshot;
}

export function subscribeSyncStatus(cb: () => void): () => void {
  syncListeners.add(cb);
  if (syncListeners.size === 1) startSyncWatch();
  return () => {
    syncListeners.delete(cb);
    if (syncListeners.size === 0) stopSyncWatch();
  };
}

/* ---------------- background watch ----------------
   Runs only while at least one component is subscribed: recount every 20s,
   and instantly reflect online/offline + auth changes so UI never lies. */

const SYNC_WATCH_MS = 20000;
let syncWatchTimer: ReturnType<typeof setInterval> | null = null;
let syncWatchBound = false;

function onSyncWatchOnline(): void {
  patchSyncSnapshot({ online: true });
  void refreshPendingCounts();
}
function onSyncWatchOffline(): void {
  patchSyncSnapshot({ online: false });
}
function onSyncWatchAuth(): void {
  void refreshPendingCounts();
}
function onSyncWatchVisible(): void {
  if (typeof document === "undefined" || document.visibilityState === "visible") {
    void refreshPendingCounts();
  }
}

function startSyncWatch(): void {
  if (syncWatchTimer) clearInterval(syncWatchTimer);
  syncWatchTimer = setInterval(() => void refreshPendingCounts(), SYNC_WATCH_MS);

  if (!syncWatchBound && typeof window !== "undefined") {
    syncWatchBound = true;
    window.addEventListener("online", onSyncWatchOnline);
    window.addEventListener("offline", onSyncWatchOffline);
    window.addEventListener("authStateChanged", onSyncWatchAuth);
    window.addEventListener("storage", onSyncWatchAuth);
    document.addEventListener("visibilitychange", onSyncWatchVisible);
  }

  void refreshPendingCounts();
}

function stopSyncWatch(): void {
  if (syncWatchTimer) {
    clearInterval(syncWatchTimer);
    syncWatchTimer = null;
  }
}

/** React binding — re-renders on every published sync-state change.
 *  useState/useEffect (not useSyncExternalStore) so it also works on React 17. */
export function useSyncStatus(): SyncSnapshot {
  const [snap, setSnap] = useState<SyncSnapshot>(getSyncSnapshot);

  useEffect(() => {
    // Catch state changes that happened between render and subscribe.
    setSnap(getSyncSnapshot());
    return subscribeSyncStatus(() => setSnap(getSyncSnapshot()));
  }, []);

  return snap;
}
