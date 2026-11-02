// ================================================================
// src/database/supabaseCourseSync.ts  (v4.1)
// Supabase REST plumbing + push/delete for ALL syncable entities
// (courses, users, assignments, assignment fields, submissions,
// materials, schedules) + ENROLLMENTS pull (v3, unchanged).
//
// v4.1: signatures aligned to the REAL call sites:
//   - pushAssignmentFieldsToSupabase(assignmentId, tenantId, fieldIds)
//       → called with field IDS (assignmentDB.ts:145); each field row
//         is re-read from the local Dexie table (name auto-detected).
//   - deleteAssignmentFieldsFromSupabase(assignmentId) / deleteScheduleFromSupabase(scheduleId)
//       → called WITHOUT tenantId; the tenant is resolved from
//         localStorage ("currentUser" / "authUser") instead.
//
// NOTE: isTombstoned / purgeIfTombstoned are defined LOCALLY at the
// bottom of this file, so deletedIdsTracker.ts needs NO changes —
// it only has to export isDeleted, which it already does.
// ================================================================

import { db } from "./db";
import type { Course, Enrollment } from "../types";
import { isDeleted, type EntityType } from "./deletedIdsTracker";

// ----------------------------------------------------------------
// Supabase REST plumbing
// ----------------------------------------------------------------
// Adjust the env var names / localStorage keys to whatever your project
// uses. If you already have a Supabase client or fetch helper elsewhere
// (e.g. in your user-sync module), import that instead and delete this block.

let SB_URL = "";
let SB_KEY = "";
let SB_USER_TOKEN = ""; // logged-in user's access token (optional, for RLS)

function readEnv(...keys: string[]): string {
  try {
    const metaEnv = (import.meta as any)?.env; // Vite
    if (metaEnv) {
      for (const k of keys) { const v = metaEnv[k]; if (v) return String(v); }
    }
  } catch { /* import.meta unavailable */ }
  try {
    const nodeEnv = (globalThis as any)?.process?.env; // CRA / SSR fallback
    if (nodeEnv) {
      for (const k of keys) { const v = nodeEnv[k]; if (v) return String(v); }
    }
  } catch { /* no process env */ }
  return "";
}

function readLS(key: string): string {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function initConfig(): void {
  if (SB_URL && SB_KEY) return;
  SB_URL = (readEnv("VITE_SUPABASE_URL", "REACT_APP_SUPABASE_URL") || readLS("supabaseUrl")).replace(/\/+$/, "");
  SB_KEY = readEnv("VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_PUBLISHABLE_KEY", "REACT_APP_SUPABASE_ANON_KEY") || readLS("supabaseKey");
}

/**
 * Best-effort tenant id from localStorage — the SAME source scheduleDB.ts
 * uses ("currentUser"). Used by delete helpers when the caller passes no
 * tenantId. With RLS enabled the user token scopes deletes anyway.
 */
function currentTenantId(): string {
  try {
    for (const key of ["currentUser", "authUser"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const u = JSON.parse(raw);
      if (u && typeof u.tenantId === "string" && u.tenantId) return u.tenantId;
    }
  } catch { /* ignore */ }
  return "";
}

/** Optional runtime configuration: call once at app startup if you don't use env vars. */
export function sbConfig(url: string, anonKey: string): void {
  SB_URL = url.replace(/\/+$/, "");
  SB_KEY = anonKey;
}

/** Optional: use the signed-in user's token so RLS policies apply. */
export function sbSetUserToken(token: string): void {
  SB_USER_TOKEN = token || "";
}

export type SbError = { message: string };
export type SbResult<T> = { data: T | null; error: SbError | null };

/** Minimal PostgREST helper: GET by default; pass init for POST/PATCH/DELETE. */
export async function sbFetch<T = any>(
  table: string,
  params: Record<string, string> = {},
  init: RequestInit = {}
): Promise<SbResult<T[]>> {
  initConfig();
  if (!SB_URL || !SB_KEY) {
    return { data: null, error: { message: "Supabase is not configured (missing URL or key)" } };
  }
  try {
    const url = new URL(`${SB_URL}/rest/v1/${table}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), {
      ...init,
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_USER_TOKEN || SB_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { data: null, error: { message: `Supabase REST ${res.status}: ${body || res.statusText}` } };
    }
    if (res.status === 204) return { data: null, error: null };
    const text = await res.text();
    return { data: (text ? JSON.parse(text) : null) as T[] | null, error: null };
  } catch (e: unknown) {
    return { data: null, error: { message: e instanceof Error ? e.message : "Network error" } };
  }
}

// ----------------------------------------------------------------
// Generic row serialization (camelCase app model → snake_case columns)
// ----------------------------------------------------------------

function camelToSnake(key: string): string {
  return key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/**
 * One serializer for every entity: copies all own properties into a flat
 * snake_case row, stamps tenant_id / created_at / updated_at, and drops
 * client-only bookkeeping keys. Works with any object shape, so new
 * entity types need no dedicated serializer.
 */
function serializeRow(row: object, tenantId: string): Record<string, unknown> {
  const src = row as Record<string, unknown>;
  const out: Record<string, unknown> = { id: src.id, tenant_id: tenantId };
  for (const [k, v] of Object.entries(src)) {
    if (k === "id" || k === "synced" || v === undefined) continue;
    out[camelToSnake(k)] = v;
  }
  if (!out.created_at) out.created_at = new Date().toISOString();
  out.updated_at = new Date().toISOString(); // last-write timestamp for conflict resolution
  return out;
}

/** Shared upsert: POST with merge-duplicates on id. Throws on REST error. */
async function upsertRows(table: string, body: object, label: string): Promise<void> {
  const { error } = await sbFetch(table, { on_conflict: "id" }, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(body),
  });
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

/** Shared single-row DELETE by id (+ tenant guard when a tenant is known). */
async function deleteRowById(
  table: string,
  id: string,
  tenantId: string,
  label: string
): Promise<void> {
  const params: Record<string, string> = { id: `eq.${id}` };
  const tid = tenantId || currentTenantId();
  if (tid) params.tenant_id = `eq.${tid}`;
  const { error } = await sbFetch(table, params, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (error) throw new Error(`${label} failed: ${error.message}`);
}

// ----------------------------------------------------------------
// COURSES — push / delete (courseDB.ts)
// ----------------------------------------------------------------

/** Upsert one course (merge on id). Throws so the caller can tombstone/retry. */
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  await upsertRows("courses", serializeRow(course, tenantId), "pushCourseToSupabase");
  console.log(`    ✅ Course ${course.id} pushed to Supabase`);
}

/**
 * Delete one course in the cloud. Best-effort guarded cascade over the child
 * tables first (mirrors the local guarded cascade in courseDB.deleteCourse):
 * a missing/unwritable table is logged and skipped, never fatal.
 */
export async function deleteCourseFromSupabase(courseId: string, tenantId: string): Promise<void> {
  const childTables = [
    "materials", "assignments", "assignment_fields", "assignment_submissions",
    "enrollments", "schedules", "chat_messages", "live_sessions", "live_presentations",
  ];
  for (const t of childTables) {
    const r = await sbFetch(t, { course_id: `eq.${courseId}` }, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (r.error) console.warn(`    ⚠️ Cloud cascade on "${t}" skipped (non-fatal): ${r.error.message}`);
  }

  await deleteRowById("courses", courseId, tenantId, "deleteCourseFromSupabase");
  console.log(`    ✅ Course ${courseId} deleted from Supabase`);
}

// ----------------------------------------------------------------
// USERS — push / delete (trainerDB.ts / deletedIdsTracker.ts)
// ----------------------------------------------------------------

/**
 * Upsert one user (merge on id). Generic on purpose: whatever shape
 * trainerDB.ts passes is serialized generically — no dependency on a
 * specific User type name.
 */
export async function pushUserToSupabase<T extends object>(user: T, tenantId: string): Promise<void> {
  await upsertRows("users", serializeRow(user, tenantId), "pushUserToSupabase");
  console.log(`    ✅ User ${(user as unknown as Record<string, unknown>).id} pushed to Supabase`);
}

/**
 * Delete one user in the cloud. Best-effort guarded cascade over the user's
 * cloud rows first (non-fatal), then the users row itself.
 */
export async function deleteUserFromSupabase(userId: string, tenantId: string): Promise<void> {
  const childTables = ["enrollments"]; // add more (chat_messages, …) if your schema has them
  for (const t of childTables) {
    const r = await sbFetch(t, { user_id: `eq.${userId}` }, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (r.error) console.warn(`    ⚠️ Cloud cascade on "${t}" skipped (non-fatal): ${r.error.message}`);
  }

  await deleteRowById("users", userId, tenantId, "deleteUserFromSupabase");
  console.log(`    ✅ User ${userId} deleted from Supabase`);
}

// ----------------------------------------------------------------
// ASSIGNMENTS — push / delete + fields + submissions (assignmentDB.ts)
// ----------------------------------------------------------------

/** Upsert one assignment (merge on id). */
export async function pushAssignmentToSupabase<T extends object>(assignment: T, tenantId: string): Promise<void> {
  await upsertRows("assignments", serializeRow(assignment, tenantId), "pushAssignmentToSupabase");
  console.log(`    ✅ Assignment ${(assignment as unknown as Record<string, unknown>).id} pushed to Supabase`);
}

/**
 * Delete one assignment in the cloud, cascading over its child tables
 * first (guarded, non-fatal) — mirrors deleteCourseFromSupabase.
 */
export async function deleteAssignmentFromSupabase(assignmentId: string, tenantId: string): Promise<void> {
  const childTables = ["assignment_fields", "assignment_submissions"];
  for (const t of childTables) {
    const r = await sbFetch(t, { assignment_id: `eq.${assignmentId}` }, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" },
    });
    if (r.error) console.warn(`    ⚠️ Cloud cascade on "${t}" skipped (non-fatal): ${r.error.message}`);
  }

  await deleteRowById("assignments", assignmentId, tenantId, "deleteAssignmentFromSupabase");
  console.log(`    ✅ Assignment ${assignmentId} deleted from Supabase`);
}

// --- local lookup of the assignment-fields Dexie table (name auto-detected) ---

let fieldsTableCache: any | null | undefined = undefined;

async function getFieldRow(fieldId: string): Promise<Record<string, unknown> | null> {
  if (fieldsTableCache === undefined) {
    fieldsTableCache = null;
    try {
      const tables = ((db as any).tables || []) as Array<{ name: string }>;
      const exact = tables.find((t) => t.name === "assignmentFields" || t.name === "assignment_fields");
      const fuzzy = tables.find((t) => /field/i.test(t.name));
      const chosen = exact || fuzzy || null;
      if (chosen) fieldsTableCache = (db as any).table(chosen.name);
    } catch { /* Dexie not ready — stays null */ }
  }
  if (!fieldsTableCache) return null;
  try {
    return (await fieldsTableCache.get(fieldId)) || null;
  } catch { return null; }
}

/**
 * Push the assignment field rows whose IDS are given — assignmentDB.ts calls
 * `pushAssignmentFieldsToSupabase(field.assignmentId, tenantId, [field.id])`
 * after saving a field locally. Each field row is re-read from the local
 * Dexie table, serialized and upserted; assignment_id is backfilled from the
 * first argument when the row lacks it.
 */
export async function pushAssignmentFieldsToSupabase(
  assignmentId: string,
  tenantId: string,
  fieldIds: string[]
): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (const fieldId of fieldIds) {
    const field = await getFieldRow(fieldId);
    if (!field) {
      console.warn(`    ⚠️ Assignment field ${fieldId} not found locally — skipped`);
      continue;
    }
    const row = serializeRow(field, tenantId);
    if (row.assignment_id === undefined) row.assignment_id = assignmentId;
    rows.push(row);
  }
  if (rows.length === 0) return;
  await upsertRows("assignment_fields", rows, "pushAssignmentFieldsToSupabase");
  console.log(`    ✅ ${rows.length} assignment field(s) pushed to Supabase`);
}

/** Delete ALL cloud field rows of one assignment (tenantId optional). */
export async function deleteAssignmentFieldsFromSupabase(assignmentId: string, tenantId?: string): Promise<void> {
  const params: Record<string, string> = { assignment_id: `eq.${assignmentId}` };
  const tid = tenantId || currentTenantId();
  if (tid) params.tenant_id = `eq.${tid}`;
  const { error } = await sbFetch("assignment_fields", params, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
  if (error) throw new Error(`deleteAssignmentFieldsFromSupabase failed: ${error.message}`);
  console.log(`    ✅ Fields of assignment ${assignmentId} deleted from Supabase`);
}

/** Upsert one submission (merge on id). Table: assignment_submissions. */
export async function pushSubmissionToSupabase<T extends object>(submission: T, tenantId: string): Promise<void> {
  await upsertRows("assignment_submissions", serializeRow(submission, tenantId), "pushSubmissionToSupabase");
  console.log(`    ✅ Submission ${(submission as unknown as Record<string, unknown>).id} pushed to Supabase`);
}

// ----------------------------------------------------------------
// MATERIALS (materialDB.ts) / SCHEDULES (scheduleDB.ts)
// ----------------------------------------------------------------

/** Upsert one material (merge on id). */
export async function pushMaterialToSupabase<T extends object>(material: T, tenantId: string): Promise<void> {
  await upsertRows("materials", serializeRow(material, tenantId), "pushMaterialToSupabase");
  console.log(`    ✅ Material ${(material as unknown as Record<string, unknown>).id} pushed to Supabase`);
}

/** Upsert one schedule entry (merge on id). */
export async function pushScheduleToSupabase<T extends object>(schedule: T, tenantId: string): Promise<void> {
  await upsertRows("schedules", serializeRow(schedule, tenantId), "pushScheduleToSupabase");
  console.log(`    ✅ Schedule ${(schedule as unknown as Record<string, unknown>).id} pushed to Supabase`);
}

/** Delete one schedule entry in the cloud (tenantId optional). */
export async function deleteScheduleFromSupabase(scheduleId: string, tenantId?: string): Promise<void> {
  await deleteRowById("schedules", scheduleId, tenantId || "", "deleteScheduleFromSupabase");
  console.log(`    ✅ Schedule ${scheduleId} deleted from Supabase`);
}

// ================================================================
// PULL ENROLLMENTS (v3)
// ✅ Kept: tombstone + soft-delete guards.
// ✅ NEW: pair-level guards (composite tombstone + enrollmentDB pending-removal log).
// ✅ NEW: role backfill for legacy cloud rows with no role — derived from the
//    user's own record, so getTrainerCourses()/getTraineeCourses() finally see
//    courses assigned before the role column existed.
// ✅ NEW: heals existing local rows (wrong/missing role or tenant) and marks
//    pulled rows synced:true so they are never re-pushed.
// ================================================================
export async function pullEnrollmentsFromSupabase(tenantId: string): Promise<number> {
  try {
    console.log("    🌐 Fetching enrollments from Supabase for tenant:", tenantId);
    const { data, error } = await sbFetch("enrollments", {
      select: "*",
      tenant_id: `eq.${tenantId}`,
    });

    if (error) {
      console.error("    ❌ Supabase Error pulling enrollments:", error);
      throw new Error(error.message);
    }

    if (!data || data.length === 0) {
      console.warn("    ⚠️ Supabase returned 0 enrollments for this tenant!");
      return 0;
    }

    console.log(`    ✅ Supabase returned ${data.length} enrollments:`, data);

    // Pending (userId:courseId) removals logged by enrollmentDB — the cloud
    // delete is not confirmed yet, so hide these pairs from the pull.
    let pendingRemovals: Set<string> | null = null;
    try {
      const m = await import("./enrollmentDB");
      pendingRemovals = m.getPendingRemovals();
    } catch { /* module unavailable — row-id tombstones still guard */ }

    let upserted = 0;

    for (const e of data) {
      const userId = e.user_id as string;
      const courseId = e.course_id as string;
      if (!userId || !courseId) continue;

      // 🪦 GUARD: soft-deleted remotely → never re-insert
      if ((e as any).deleted_at) continue;
      // 🪦 GUARD: tombstoned locally (row id) → purge local copy, never re-insert
      if (await purgeIfTombstoned("enrollments", "enrollment", e.id as string)) continue;
      // 🪦 GUARD: the enrollment's user was deleted locally → don't resurrect orphans
      if (await isTombstoned("user", userId)) continue;
      // 🪦 GUARD: pair-level tombstone or pending removal → hide until cloud confirms
      if (await isTombstoned("enrollment", `${userId}:${courseId}`)) continue;
      if (pendingRemovals && pendingRemovals.has(`${userId}:${courseId}`)) continue;

      // Role: trust the cloud value; legacy rows (no role) fall back to the
      // user's own record. roleKnown=false means we could NOT verify — then we
      // only fill an EMPTY role and never overwrite an existing one.
      let role: "trainer" | "trainee" = "trainee";
      let roleKnown = false;
      if (e.role === "trainer" || e.role === "trainee") {
        role = e.role;
        roleKnown = true;
      } else {
        try {
          const u: any = await db.users.get(userId);
          if (u && (u.role === "trainer" || u.role === "trainee")) {
            role = u.role;
            roleKnown = true;
          }
        } catch { /* keep default */ }
      }

      const exists = (await db.enrollments
        .where({ userId, courseId })
        .first()) as any;

      if (!exists) {
        console.log(`    📥 Adding enrollment: User ${userId} -> Course ${courseId} (Role: ${role})`);
        await db.enrollments.add({
          id: e.id as string,
          userId,
          courseId,
          role,
          enrolledAt: (e.created_at as string) || new Date().toISOString(),
          status: (e.status as string) || "active",
          tenantId: (e.tenant_id as string) || tenantId,
          synced: true, // came from the cloud — must not be re-pushed
        } as unknown as Enrollment);
        upserted++;
      } else {
        // 🩹 HEAL: legacy local rows missing/wrong role or tenant — fix them so
        // role-filtered reads (getTrainerCourses/getTraineeCourses) work.
        const patch: any = {};
        if (!exists.role || (roleKnown && exists.role !== role)) patch.role = role;
        if (!exists.tenantId && !exists.tenant_id) patch.tenantId = (e.tenant_id as string) || tenantId;
        if (Object.keys(patch).length > 0) {
          try {
            await db.enrollments.update(exists.id, patch);
            console.log(`    🩹 Healed enrollment ${exists.id}:`, patch);
          } catch { /* ignore */ }
        }
      }
    }
    return upserted;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("    ❌ Pull enrollments crashed:", msg);
    return 0;
  }
}

// ----------------------------------------------------------------
// LOCAL TOMBSTONE HELPERS (used by the pull guards above).
// Defined here so deletedIdsTracker.ts needs no changes — it only has
// to export isDeleted, which it already does.
// ----------------------------------------------------------------
export async function isTombstoned(
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  return isDeleted(entityType, entityId);
}

export async function purgeIfTombstoned(
  table: string,            // Dexie table name, e.g. "enrollments" — NOT an EntityType
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  if (!(await isDeleted(entityType, entityId))) return false;
  try {
    await (db as any)[table]?.delete(entityId);
  } catch { /* table may not exist — never abort the pull */ }
  return true;
}