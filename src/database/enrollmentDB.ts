// src/database/enrollmentDB.ts — v2: single source of truth for course assignment
//
// v2 changes (trainer-not-seeing-assigned-courses fix):
//  • applyUserAssignmentsCore no longer skips every course on a fresh device
//    (empty courses table) and heals duplicate rows kept with the wrong role.
//  • user.assignedCourses mirror updates now flag the user synced:false so the
//    normal user push carries the refreshed mirror to the cloud.
//
// Why this module exists — the bugs in the previous flow it eliminates:
//  1. UserManagement.syncEnrollmentsToCloud() was ADD-ONLY: unchecking a course
//     never deleted the enrollment, so /api/enrollments/sync re-upserted it and
//     the course "resurrected" on the next refresh/pull.
//  2. Assignments were never written to the LOCAL Dexie `enrollments` table, so
//     courseDB.getTrainerCourses() / getTraineeCourses() (which read enrollments)
//     returned stale/empty results until the next cloud pull.
//  3. Two sources of truth (user.assignedCourses vs enrollment rows) drifted;
//     duplicate rows for one (userId, courseId) pair made rosters list the same
//     course twice.
//  4. Sync payloads carried no id / role / tenant_id, so rows could not be
//     reconciled or tombstoned across devices.
//
// Model:
//   - The `enrollments` table is CANONICAL. user.assignedCourses is a mirror
//     that this module keeps in step (existing UI keeps reading it unchanged).
//   - All writes are diff-based, tenant-scoped, idempotent and offline-first:
//     local rows are written immediately (synced:false), cloud push is
//     best-effort with automatic retry via syncPendingEnrollments().
//   - Removals are tombstone-first (row ids AND the `${userId}:${courseId}`
//     composite), exactly like userDB/courseDB, so a 60s pull can never
//     resurrect a removed enrollment; the cloud delete retries until confirmed.
//
// Cloud strategy: prefers your existing Express routes (/api/enrollments/sync,
// /api/users/update). For REMOVALS it first tries POST /api/enrollments/remove
// and — if that route is not deployed (404) — falls back to a direct Supabase
// soft-delete (deleted_at = now), consistent with the pull's is:deleted_at:null.

import { db } from "./db";
import type { Enrollment } from "../types";
import { supabase } from "../auth/supabase";
import { markDeleted, unmarkDeleted, isDeleted, getDeletedIds } from "./deletedIdsTracker";

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";
const PENDING_DELETES_KEY = "enrollmentPendingDeletes";
const PENDING_DELETES_MAX = 500;

/* ============================= small helpers ============================= */

function getTenantId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return user?.tenantId || user?.tenant_id || "";
  } catch {
    return "";
  }
}

/** Tenant match that tolerates camelCase (local writes) and snake_case
 *  (rows mirrored straight from Supabase). Rows with NO tenant at all are
 *  treated as belonging to this tenant (legacy local rows). */
function sameTenant(row: any, tenantId?: string): boolean {
  if (!tenantId) return true;
  return row?.tenantId === tenantId || row?.tenant_id === tenantId ||
    (!row?.tenantId && !row?.tenant_id);
}

function makeId(): string {
  try {
    const c: any = typeof crypto !== "undefined" ? (crypto as any) : null;
    if (c && typeof c.randomUUID === "function") return c.randomUUID();
  } catch { /* ignore */ }
  return `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function roleOf(user: any): "trainer" | "trainee" {
  return user?.role === "trainer" ? "trainer" : "trainee";
}

/* ================== pending cloud-removal log (retryable) ==================
 * A removal tombstones local rows, but the cloud delete can fail (offline,
 * RLS). The pull guard checks tombstoned ROW ids — a cloud-only row we have
 * never seen has an id we don't know. This log stores (userId, courseId)
 * pairs so removals stay hidden and retry until the cloud confirms.
 * ------------------------------------------------------------------------ */

interface PendingDelete {
  userId: string;
  courseId: string;
  tenantId: string;
  rowIds: string[];
  ts: number;
}

function loadPendingDeletes(): PendingDelete[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PENDING_DELETES_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((d: any) => d && d.userId && d.courseId) : [];
  } catch {
    return [];
  }
}

function savePendingDeletes(list: PendingDelete[]): void {
  try {
    localStorage.setItem(PENDING_DELETES_KEY, JSON.stringify(list.slice(0, PENDING_DELETES_MAX)));
  } catch { /* storage unavailable — retry simply loses visibility */ }
}

function logPendingDelete(userId: string, courseId: string, tenantId: string, rowIds: string[]): void {
  const list = loadPendingDeletes().filter((d) => !(d.userId === userId && d.courseId === courseId));
  list.unshift({ userId, courseId, tenantId, rowIds, ts: Date.now() });
  savePendingDeletes(list);
}

function clearPendingDelete(userId: string, courseId: string): void {
  savePendingDeletes(loadPendingDeletes().filter((d) => !(d.userId === userId && d.courseId === courseId)));
}

export function getPendingRemovals(): Set<string> {
  return new Set(loadPendingDeletes().map((d) => `${d.userId}:${d.courseId}`));
}

/* ============================= READS ============================= */

/** All enrollments visible in this tenant — tombstoned rows, pending
 *  removals and rows from other tenants are filtered out. */
export async function getEnrollments(tenantId?: string): Promise<Enrollment[]> {
  try {
    const tid = tenantId ?? getTenantId();
    const [all, tombstoned] = await Promise.all([
      db.enrollments.toArray() as Promise<any[]>,
      getDeletedIds("enrollment"),
    ]);
    const dead = new Set(tombstoned);
    const pending = getPendingRemovals();
    return all.filter((e: any) =>
      !dead.has(e.id) &&
      !dead.has(`${e.userId}:${e.courseId}`) &&
      !pending.has(`${e.userId}:${e.courseId}`) &&
      sameTenant(e, tid)
    );
  } catch {
    return []; // table missing / private mode
  }
}

export async function getEnrollmentsForUser(userId: string, tenantId?: string): Promise<Enrollment[]> {
  return (await getEnrollments(tenantId)).filter((e: any) => e.userId === userId);
}

export async function getEnrollmentsForCourse(courseId: string, tenantId?: string): Promise<Enrollment[]> {
  return (await getEnrollments(tenantId)).filter((e: any) => e.courseId === courseId);
}

/** Deduped course-id list for one user, read from the canonical enrollments
 *  table. Falls back to the user.assignedCourses mirror ONLY when the
 *  enrollments table has nothing for the user (fresh device, pre-first-pull),
 *  so the two sources can never show different things once rows exist. */
export async function getAssignedCourseIdsForUser(userId: string, tenantId?: string): Promise<string[]> {
  const rows = (await getEnrollmentsForUser(userId, tenantId)) as any[];
  const ids: string[] = [];
  for (const r of rows) {
    if (r.courseId && !ids.includes(r.courseId)) ids.push(r.courseId);
  }
  if (ids.length === 0) {
    try {
      const u: any = await db.users.get(userId);
      const mirror = u?.assignedCourses || u?.assigned_courses || [];
      for (const c of mirror) if (c && !ids.includes(c)) ids.push(c);
    } catch { /* ignore */ }
  }
  return ids;
}

/** Deduped member userIds of one course (any role). */
export async function getCourseMemberIds(courseId: string, tenantId?: string): Promise<string[]> {
  const rows = (await getEnrollmentsForCourse(courseId, tenantId)) as any[];
  const ids: string[] = [];
  for (const r of rows) {
    if (r.userId && !ids.includes(r.userId)) ids.push(r.userId);
  }
  return ids;
}

/** Roster split by role — matches courseDB.getTrainerCourses() semantics
 *  (role:'trainer' rows are how trainers attach to courses). */
export async function getCourseRoster(
  courseId: string,
  tenantId?: string
): Promise<{ trainers: string[]; trainees: string[] }> {
  const rows = (await getEnrollmentsForCourse(courseId, tenantId)) as any[];
  const trainers: string[] = [];
  const trainees: string[] = [];
  for (const r of rows) {
    if (!r.userId) continue;
    if (r.role === "trainer") {
      if (!trainers.includes(r.userId)) trainers.push(r.userId);
    } else if (!trainees.includes(r.userId)) {
      trainees.push(r.userId);
    }
  }
  return { trainers, trainees };
}

/* ============================= CLOUD I/O ============================= */

/** Push newly-created enrollment rows. Express first (your existing
 *  /api/enrollments/sync endpoint, now with id/role/tenant_id so rows are
 *  reconcilable), direct Supabase upsert as fallback. Throws on failure —
 *  callers keep the rows as synced:false and retry later. */
async function pushEnrollmentRows(rows: any[], tenantId: string): Promise<void> {
  if (rows.length === 0) return;

  // 1) Express — same endpoint UserManagement already uses, richer payload
  try {
    const payload = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      courseId: r.courseId,
      role: r.role || "trainee",
      status: "active",
      tenant_id: r.tenantId || tenantId,
      enrolled_at: r.enrolledAt,
      created_at: r.createdAt,
    }));
    const res = await fetch(`${API_BASE_URL}/api/enrollments/sync`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({ enrollments: payload }),
    });
    if (res.ok) return;
    if (res.status !== 404) {
      console.warn(`[enrollmentDB] /api/enrollments/sync failed: ${res.status} — trying Supabase directly`);
    }
    // 404 → route missing in this deployment — fall through to Supabase
  } catch { /* offline / API down — Supabase fallback below */ }

  // 2) Direct Supabase upsert
  const sbRows = rows.map((r) => ({
    id: r.id,
    user_id: r.userId,
    course_id: r.courseId,
    role: r.role || "trainee",
    status: "active",
    tenant_id: r.tenantId || tenantId,
    enrolled_at: r.enrolledAt || new Date().toISOString(),
    created_at: r.createdAt || new Date().toISOString(),
    deleted_at: null,
  }));
  const { error } = await supabase.from("enrollments").upsert(sbRows, { onConflict: "id" });
  if (error) throw error;
}

/** Cloud-delete EVERY enrollment row for a (userId, courseId) pair,
 *  regardless of which device generated the row ids:
 *    1. POST /api/enrollments/remove (service role, RLS-immune) — preferred.
 *    2. Fallback: direct Supabase soft-delete (deleted_at = now), matching the
 *       pull's is:deleted_at:null filter. If the table has no such column,
 *       hard-delete instead.
 *  Throws on failure so the caller keeps the tombstone + retry log. */
async function removeEnrollmentsInCloud(userId: string, courseId: string, tenantId: string): Promise<void> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/enrollments/remove`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ userId, courseId, tenantId }),
    });
    if (res.ok) return;
    if (res.status !== 404) throw new Error(`API remove failed: ${res.status}`);
    // 404 → route not deployed — fall through to Supabase
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.startsWith("API remove failed")) throw e; // auth/5xx — surface, keep tombstone
    // network error (offline) — try Supabase anyway; if it also fails the
    // tombstone + retry log keep the removal alive for the next sync tick
  }

  const now = new Date().toISOString();
  let q: any = supabase.from("enrollments").update({ deleted_at: now });
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { error } = await q.eq("user_id", userId).eq("course_id", courseId);
  if (!error) return;

  // deleted_at column may not exist on enrollments — hard delete instead
  let q2: any = supabase.from("enrollments").delete();
  if (tenantId) q2 = q2.eq("tenant_id", tenantId);
  const { error: err2 } = await q2.eq("user_id", userId).eq("course_id", courseId);
  if (err2) throw err2;
}

/** After the cloud confirms a removal, lift the tombstones (row ids + composite)
 *  and clear the retry-log entry. */
async function clearRemovalTombstones(userId: string, courseId: string, rowIds: string[]): Promise<void> {
  try { await unmarkDeleted("enrollment", `${userId}:${courseId}`); } catch { /* not tombstoned */ }
  for (const id of rowIds) {
    try { await unmarkDeleted("enrollment", id); } catch { /* not tombstoned */ }
  }
  clearPendingDelete(userId, courseId);
}

/** Local part of a removal: tombstone FIRST (row ids AND the composite key, so
 *  no pull can resurrect mid-delete), then delete every local row for the pair. */
async function removeEnrollmentRows(userId: string, courseId: string, tenantId: string): Promise<string[]> {
  let rowIds: string[] = [];
  try {
    const rows = (await db.enrollments.where("userId").equals(userId).toArray()) as any[];
    rowIds = rows.filter((r) => r.courseId === courseId).map((r) => r.id);
  } catch { /* table may not exist */ }

  for (const id of rowIds) {
    try { await markDeleted("enrollment", id, tenantId, "pending"); } catch { /* ignore */ }
  }
  try { await markDeleted("enrollment", `${userId}:${courseId}`, tenantId, "pending"); } catch { /* ignore */ }

  logPendingDelete(userId, courseId, tenantId, rowIds);

  for (const id of rowIds) {
    try { await db.enrollments.delete(id); } catch { /* ignore */ }
  }
  return rowIds;
}

/* ============================= CORE DIFF ENGINE ============================= */

export interface AssignResult {
  added: string[];                 // courseIds newly assigned
  removed: string[];               // courseIds un-assigned
  skipped: string[];               // desired ids rejected (unknown / deleted course or user)
  touchedUsers: string[];          // users whose mirror changed (push /api/users/update for these)
  cloudSynced: boolean;            // true when every add + remove reached the cloud
  errors: string[];
}

interface CoreOutcome {
  addedRows: any[];
  removedPairs: { userId: string; courseId: string; rowIds: string[] }[];
  added: string[];
  removed: string[];
  skipped: string[];
  errors: string[];
}

/** Diff one user's enrollments against the desired course-id list and apply it
 *  locally (adds as synced:false rows, removals tombstone-first). Cloud commit
 *  is the caller's job (commitCloud) so batched flows pay one network pass. */
async function applyUserAssignmentsCore(
  userId: string,
  desiredCourseIds: string[],
  role: "trainer" | "trainee",
  tenantId: string
): Promise<CoreOutcome> {
  const errors: string[] = [];

  // Dedupe the desired list, dropping unknown or tombstoned courses —
  // never (re)assign a deleted course.
  const desired: string[] = [];
  for (const id of desiredCourseIds || []) {
    if (id && !desired.includes(id)) desired.push(id);
  }
  let validCourseIds = new Set<string>();
  try {
    validCourseIds = new Set((await db.courses.toArray() as any[]).map((c) => c.id));
  } catch { /* table may not exist */ }

  // ✅ FIX v2: only filter "unknown course" when the courses table actually has
  // data — on a fresh device (pre-first-pull) an empty table would skip EVERY
  // course and silently drop the whole assignment.
  const haveCourseData = validCourseIds.size > 0;
  const skipped: string[] = [];
  for (const id of desired) {
    if ((haveCourseData && !validCourseIds.has(id)) || (await isDeleted("course", id))) skipped.push(id);
  }
  const finalDesired = desired.filter((id) => !skipped.includes(id));

  // Current visible rows for this user, deduped per (userId, courseId):
  // keep the row that matches this user's role, else the cloud-known one;
  // delete local ghosts.
  let rows: any[] = [];
  try {
    rows = ((await db.enrollments.where("userId").equals(userId).toArray()) as any[])
      .filter((r) => sameTenant(r, tenantId));
  } catch { rows = []; }

  const dead = new Set(await getDeletedIds("enrollment"));
  const pending = getPendingRemovals();
  const alive = rows.filter((r) =>
    !dead.has(r.id) &&
    !dead.has(`${r.userId}:${r.courseId}`) &&
    !pending.has(`${r.userId}:${r.courseId}`)
  );

  const roleMatches = (r: any) => r.role === role;
  const byCourse = new Map<string, any>();
  for (const r of alive) {
    const prev = byCourse.get(r.courseId);
    if (!prev) { byCourse.set(r.courseId, r); continue; }
    // ✅ FIX v2: prefer the duplicate whose role matches this user's role —
    // keeping a wrong-role row is what made trainers' courses invisible
    if (roleMatches(r) && !roleMatches(prev)) {
      byCourse.set(r.courseId, r);
      try { await db.enrollments.delete(prev.id); } catch { /* ignore */ }
      continue;
    }
    if (!roleMatches(r) && roleMatches(prev)) {
      try { await db.enrollments.delete(r.id); } catch { /* ignore */ }
      continue;
    }
    if (r.synced && !prev.synced) {
      byCourse.set(r.courseId, r);
      try { await db.enrollments.delete(prev.id); } catch { /* ignore */ }
    } else {
      try { await db.enrollments.delete(r.id); } catch { /* ignore */ }
    }
  }

  const currentCourseIds = [...byCourse.keys()];
  const toAdd = finalDesired.filter((id) => !byCourse.has(id));
  const toRemove = currentCourseIds.filter((id) => !finalDesired.includes(id));

  const now = new Date().toISOString();
  const addedRows: any[] = [];

  // ✅ FIX v2: heal kept rows whose role doesn't match this user's role.
  // All enrollments of a user carry the user's own role; legacy rows with a
  // wrong/missing role are exactly why getTrainerCourses() came back empty.
  // Healed rows ride the same cloud pass (synced:false → commitCloud).
  for (const [courseId, r] of byCourse) {
    if (r.role !== role) {
      try {
        await db.enrollments.update(r.id, { role, synced: false } as any);
        const healed = { ...r, role, synced: false };
        byCourse.set(courseId, healed);
        addedRows.push(healed);
      } catch { /* ignore */ }
    }
  }

  // Adds — re-adding a previously removed pairing is legitimate: lift the
  // composite tombstone + retry-log entry first, then write synced:false.
  for (const courseId of toAdd) {
    try { await unmarkDeleted("enrollment", `${userId}:${courseId}`); } catch { /* none */ }
    clearPendingDelete(userId, courseId);
    const row: any = {
      id: makeId(),
      userId,
      courseId,
      role,
      tenantId,
      status: "active",
      enrolledAt: now,
      createdAt: now,
      synced: false,
    };
    try {
      await db.enrollments.put(row);
      addedRows.push(row);
    } catch (e: any) {
      errors.push(`local add ${userId}:${courseId} failed: ${e?.message || e}`);
    }
  }

  // Removals — tombstone-first, cloud commit deferred to commitCloud()
  const removedPairs: { userId: string; courseId: string; rowIds: string[] }[] = [];
  for (const courseId of toRemove) {
    const rowIds = await removeEnrollmentRows(userId, courseId, tenantId);
    removedPairs.push({ userId, courseId, rowIds });
  }

  // Mirror — keep user.assignedCourses in step (order-insensitive compare)
  try {
    const u: any = await db.users.get(userId);
    if (u) {
      const cur = u.assignedCourses || u.assigned_courses || [];
      const norm = (a: string[]) => JSON.stringify([...a].sort());
      if (norm(cur) !== norm(finalDesired)) {
        // ✅ FIX v2: flag the user unsynced so the normal user push carries the
        // refreshed assigned_courses to the cloud automatically.
        await db.users.update(userId, { assignedCourses: finalDesired, synced: false } as any);
      }
    }
  } catch { /* mirror is best-effort */ }

  return { addedRows, removedPairs, added: toAdd, removed: toRemove, skipped, errors };
}

/** One network pass for a batch of local changes: push adds, then confirm
 *  removals in the cloud. Adds that fail stay synced:false (retried by
 *  syncPendingEnrollments); removals that fail stay tombstoned (retried too). */
async function commitCloud(
  addedRows: any[],
  removedPairs: { userId: string; courseId: string; rowIds: string[] }[],
  tenantId: string
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];
  let ok = true;

  if (addedRows.length > 0) {
    try {
      await pushEnrollmentRows(addedRows, tenantId);
      for (const r of addedRows) {
        try { await db.enrollments.update(r.id, { synced: true } as any); } catch { /* ignore */ }
      }
    } catch (e: any) {
      ok = false;
      errors.push(`enrollment add sync failed: ${e?.message || e} (kept as pending, will retry)`);
    }
  }

  for (const p of removedPairs) {
    try {
      await removeEnrollmentsInCloud(p.userId, p.courseId, tenantId);
      await clearRemovalTombstones(p.userId, p.courseId, p.rowIds);
    } catch (e: any) {
      ok = false;
      errors.push(`enrollment remove sync failed ${p.userId}:${p.courseId}: ${e?.message || e} (tombstone kept, will retry)`);
    }
  }

  return { ok, errors };
}

/* ============================= PUBLIC WRITES ============================= */

/** Assign a set of courses to ONE user (diff-based). Checking a course adds an
 *  enrollment; unchecking REMOVES it (tombstoned locally + soft-deleted in the
 *  cloud) — this is what stops unchecked courses resurrecting after a refresh. */
export async function applyUserAssignments(opts: {
  userId: string;
  courseIds: string[];
  role?: "trainer" | "trainee";   // defaults to the stored user's role
  pushCloud?: boolean;            // default true — set false to batch yourself
  tenantId?: string;
}): Promise<AssignResult> {
  if (!opts?.userId) throw new Error("userId is required");
  if (await isDeleted("user", opts.userId)) {
    throw new Error("Cannot assign courses to a deleted user.");
  }
  const tenantId = opts.tenantId || getTenantId();
  let user: any = null;
  try { user = await db.users.get(opts.userId); } catch { /* ignore */ }
  const role = opts.role || roleOf(user);

  const core = await applyUserAssignmentsCore(opts.userId, opts.courseIds || [], role, tenantId);
  const cloud = opts.pushCloud === false
    ? { ok: true, errors: [] as string[] }
    : await commitCloud(core.addedRows, core.removedPairs, tenantId);

  return {
    added: core.added,
    removed: core.removed,
    skipped: core.skipped,
    touchedUsers: [opts.userId],
    cloudSynced: cloud.ok,
    errors: [...core.errors, ...cloud.errors],
  };
}

/** Roster direction: make `userIds` the FULL member list of one course.
 *  Everyone ticked gets enrolled (role derived from their user record),
 *  everyone currently enrolled but not ticked gets removed. Other courses a
 *  user has are untouched. One cloud pass for the whole roster. */
export async function applyCourseAssignments(opts: {
  courseId: string;
  userIds: string[];
  pushCloud?: boolean;
  tenantId?: string;
}): Promise<AssignResult> {
  if (!opts?.courseId) throw new Error("courseId is required");
  if (await isDeleted("course", opts.courseId)) {
    throw new Error("Cannot assign members to a deleted course.");
  }
  const tenantId = opts.tenantId || getTenantId();

  let users: any[] = [];
  try { users = await db.users.toArray(); } catch { /* ignore */ }
  const userMap = new Map(users.map((u: any) => [u.id, u]));

  const desired: string[] = [];
  for (const id of opts.userIds || []) if (id && !desired.includes(id)) desired.push(id);

  const currentMemberIds = await getCourseMemberIds(opts.courseId, tenantId);
  const toRemoveUsers = currentMemberIds.filter((id) => !desired.includes(id));

  const added: string[] = [];
  const removed: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const allAddedRows: any[] = [];
  const allRemovedPairs: { userId: string; courseId: string; rowIds: string[] }[] = [];
  const touchedUsers: string[] = [];

  for (const uid of desired) {
    const u = userMap.get(uid);
    if (!u || (await isDeleted("user", uid))) { skipped.push(uid); continue; }
    const cur = await getAssignedCourseIdsForUser(uid, tenantId);
    if (cur.includes(opts.courseId)) continue; // already a member — nothing to do
    const core = await applyUserAssignmentsCore(
      uid,
      [...cur, opts.courseId],
      roleOf(u),
      tenantId
    );
    allAddedRows.push(...core.addedRows);
    allRemovedPairs.push(...core.removedPairs);
    added.push(...core.added);
    removed.push(...core.removed);
    skipped.push(...core.skipped);
    errors.push(...core.errors);
    touchedUsers.push(uid);
  }

  for (const uid of toRemoveUsers) {
    const u = userMap.get(uid);
    if (!u || (await isDeleted("user", uid))) continue;
    const cur = await getAssignedCourseIdsForUser(uid, tenantId);
    if (!cur.includes(opts.courseId)) continue;
    const core = await applyUserAssignmentsCore(
      uid,
      cur.filter((c) => c !== opts.courseId),
      roleOf(u),
      tenantId
    );
    allAddedRows.push(...core.addedRows);
    allRemovedPairs.push(...core.removedPairs);
    added.push(...core.added);
    removed.push(...core.removed);
    skipped.push(...core.skipped);
    errors.push(...core.errors);
    touchedUsers.push(uid);
  }

  const cloud = opts.pushCloud === false
    ? { ok: true, errors: [] as string[] }
    : await commitCloud(allAddedRows, allRemovedPairs, tenantId);

  return {
    added,
    removed,
    skipped,
    touchedUsers: [...new Set(touchedUsers)],
    cloudSynced: cloud.ok,
    errors: [...errors, ...cloud.errors],
  };
}

/** Cohort assign: every user in `userIds` gets every course in `courseIds`
 *  (add-only per user — existing enrollments untouched). Onboard a whole class
 *  in one action with one cloud pass. */
export async function bulkAssignCourses(opts: {
  userIds: string[];
  courseIds: string[];
  pushCloud?: boolean;
  tenantId?: string;
}): Promise<AssignResult> {
  const tenantId = opts.tenantId || getTenantId();
  let users: any[] = [];
  try { users = await db.users.toArray(); } catch { /* ignore */ }
  const userMap = new Map(users.map((u: any) => [u.id, u]));

  const added: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const allAddedRows: any[] = [];
  const touchedUsers: string[] = [];

  for (const uid of opts.userIds || []) {
    const u = userMap.get(uid);
    if (!u || (await isDeleted("user", uid))) { skipped.push(uid); continue; }
    const cur = await getAssignedCourseIdsForUser(uid, tenantId);
    const merged = [...cur];
    for (const cid of opts.courseIds || []) if (!merged.includes(cid)) merged.push(cid);
    if (merged.length === cur.length) continue; // nothing new
    const core = await applyUserAssignmentsCore(uid, merged, roleOf(u), tenantId);
    allAddedRows.push(...core.addedRows);
    added.push(...core.added);
    skipped.push(...core.skipped);
    errors.push(...core.errors);
    touchedUsers.push(uid);
  }

  const cloud = opts.pushCloud === false
    ? { ok: true, errors: [] as string[] }
    : await commitCloud(allAddedRows, [], tenantId);

  return {
    added,
    removed: [],
    skipped,
    touchedUsers: [...new Set(touchedUsers)],
    cloudSynced: cloud.ok,
    errors: [...errors, ...cloud.errors],
  };
}

/* ============================= MAINTENANCE ============================= */

/** Retry every pending enrollment change: pushes adds that are synced:false,
 *  re-attempts cloud removals from the retry log. Called from
 *  pullAllTenantData every sync tick — cheap and safe to run often. */
export async function syncPendingEnrollments(tenantId?: string): Promise<void> {
  const tid = tenantId || getTenantId();
  if (!tid || !localStorage.getItem("authToken")) return;

  // 1) unsynced adds
  try {
    const rows = ((await db.enrollments.toArray()) as any[]).filter(
      (r) => r.synced === false && sameTenant(r, tid)
    );
    if (rows.length > 0) {
      const dead = new Set(await getDeletedIds("enrollment"));
      const pending = getPendingRemovals();
      const pushable = rows.filter((r) =>
        !dead.has(r.id) &&
        !dead.has(`${r.userId}:${r.courseId}`) &&
        !pending.has(`${r.userId}:${r.courseId}`)
      );
      if (pushable.length > 0) {
        try {
          await pushEnrollmentRows(pushable, tid);
          for (const r of pushable) {
            try { await db.enrollments.update(r.id, { synced: true } as any); } catch { /* ignore */ }
          }
        } catch { /* stay pending — retried on the next tick */ }
      }
    }
  } catch { /* table may not exist */ }

  // 2) pending cloud removals
  const list = loadPendingDeletes();
  const remaining: PendingDelete[] = [];
  for (const d of list) {
    try {
      await removeEnrollmentsInCloud(d.userId, d.courseId, d.tenantId);
      await clearRemovalTombstones(d.userId, d.courseId, d.rowIds || []);
    } catch {
      remaining.push(d); // keep for the next retry
    }
  }
  savePendingDeletes(remaining);
}

/** Repair drift for one user: collapses duplicate (userId, courseId) rows —
 *  keeps the cloud-known row locally and soft-deletes the duplicate cloud rows
 *  (online only). This is what stops rosters listing the same course twice. */
export async function reconcileUserEnrollments(userId: string, tenantId?: string): Promise<void> {
  const tid = tenantId || getTenantId();
  let rows: any[] = [];
  try {
    rows = ((await db.enrollments.where("userId").equals(userId).toArray()) as any[])
      .filter((r) => sameTenant(r, tid));
  } catch { return; }

  const groups = new Map<string, any[]>();
  for (const r of rows) {
    if (!r.courseId) continue;
    const arr = groups.get(r.courseId) || [];
    arr.push(r);
    groups.set(r.courseId, arr);
  }

  for (const [courseId, group] of groups) {
    if (group.length <= 1) continue;
    // Prefer the cloud-confirmed row; oldest wins as a tiebreak.
    group.sort((a, b) =>
      ((b.synced ? 1 : 0) - (a.synced ? 1 : 0)) ||
      String(a.createdAt || "").localeCompare(String(b.createdAt || ""))
    );
    const keep = group[0];

    try {
      let q: any = supabase
        .from("enrollments")
        .update({ deleted_at: new Date().toISOString() })
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .neq("id", keep.id);
      if (tid) q = q.eq("tenant_id", tid);
      await q; // best-effort — offline falls back to local dedupe only
    } catch { /* ignore */ }

    for (const r of group.slice(1)) {
      try { await db.enrollments.delete(r.id); } catch { /* ignore */ }
    }
  }
}

/** Reconcile every local user — run once after a remote merge in your admin
 *  screens (cheap at MedStat tenant scale). */
export async function reconcileAllEnrollments(tenantId?: string): Promise<void> {
  try {
    const users = await db.users.toArray();
    for (const u of users) await reconcileUserEnrollments((u as any).id, tenantId);
  } catch { /* ignore */ }
}

/** Push the full user row (with the refreshed assigned_courses mirror) through
 *  your existing PUT /api/users/update — same payload shape as
 *  UserManagement.saveInlineUser, so the server contract is unchanged.
 *  Best-effort: returns false when offline; the local mirror is already saved. */
export async function pushUserAssignmentsMirror(userId: string): Promise<boolean> {
  try {
    const u: any = await db.users.get(userId);
    if (!u) return false;
    const assigned = u.assignedCourses || u.assigned_courses || [];
    const num = (v: any) => {
      const n = parseFloat(String(v ?? "0").replace(/,/g, ""));
      return isNaN(n) ? 0 : n;
    };
    const res = await fetch(`${API_BASE_URL}/api/users/update`, {
      method: "PUT",
      headers: authHeaders(),
      body: JSON.stringify({
        id: u.id,
        username: u.username,
        phone: u.phone || "",
        email: u.email || "",
        password: u.password || "",
        role: u.role,
        assigned_courses: assigned,
        profile_pic: u.profilePic || null,
        tuition: { expected: num(u.tuition?.expected), paid: num(u.tuition?.paid) },
        remuneration: {
          net_salary: num(u.remuneration?.netSalary),
          per_diem: num(u.remuneration?.perDiem),
        },
      }),
    });
    return res.ok;
  } catch {
    return false; // offline — the mirror is saved locally and rides the next user push
  }
}