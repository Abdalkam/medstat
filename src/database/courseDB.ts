// src/database/courseDB.ts — v5: truly honest synced flag + airtight delete guard
//
// Changes vs v4 (the v4 behavior list is preserved — nothing regressed):
//  • pushCourseRow now marks the row DIRTY FIRST (synced:false before the
//    cloud call) and stamps synced:true only when the cloud confirms.
//    v4 left the pre-push flag untouched, so an edited row that carried
//    synced:true from an earlier push stayed "synced" even when its update
//    never reached the cloud — and a new row created offline kept
//    synced:undefined, which deleteCourse's guard misread as cloud-known.
//  • deleteCourse's never-synced guard is extended to the "cloud absent"
//    outcome: when deleteCourseFromSupabase throws "matched no row" and the
//    local row was never CONFIRMED synced (synced !== true, or no local row
//    at all), the tombstone is lifted instead of being stranded as an
//    immortal "failed" entry the retry loop chases forever. Rows confirmed
//    in the cloud (synced === true) keep the strict verify-or-throw path:
//    a real RLS problem still lands as a retryable "failed" tombstone.
//  (v4 recap) synced:true is stamped ONLY on cloud confirmation; deleteCourse
//  reads the row BEFORE the cascade; rows with no synced flag are treated by
//  the same never-confirmed rule above; deleteCourseFromSupabase is
//  count-verified and throws "matched no row" for cloud-absent courses.
//  (v3 recap) pushCourseToSupabase / deleteCourseFromSupabase come from
//  supabaseCourseSync — v4 of that file is SHAPE-AWARE: it pushes courses to
//  the doc-store public.courses table ({id, tenant_id, course_id, data,
//  updated_at}) by default and soft-deletes through data.deleted_at, with a
//  self-healing relational fallback. Deletions propagate to other devices
//  through their pull filters either way.

import { db } from "./db";
import type { Course } from "../types";
import { pushCourseToSupabase, deleteCourseFromSupabase } from "./supabaseCourseSync";
import { markDeleted, unmarkDeleted, isDeleted } from "./deletedIdsTracker";

function getTenantId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return user?.tenantId || user?.tenant_id || "";
  } catch {
    return "";
  }
}

export async function getCourses(): Promise<Course[]> {
  return await db.courses.toArray();
}

export async function getCourseById(id: string): Promise<Course | undefined> {
  return await db.courses.get(id);
}

/** Tenant-scoped course list (tolerates camelCase local rows and snake_case
 *  cloud mirrors; rows with no tenant at all count as legacy local rows). */
export async function getCoursesByTenant(tenantId?: string): Promise<Course[]> {
  const tid = tenantId ?? getTenantId();
  const all = await db.courses.toArray();
  if (!tid) return all;
  return all.filter((c: any) =>
    c?.tenantId === tid || c?.tenant_id === tid || (!c?.tenantId && !c?.tenant_id)
  ) as Course[];
}

/** Push + stamp: the row is marked synced:false BEFORE the request so the
 *  flag always tells the truth — false means "there are local changes the
 *  cloud has not confirmed", true means "the cloud accepted this version".
 *  Failures keep synced:false so deleteCourse's never-synced guard knows the
 *  row may be cloud-absent (mirrors trainerDB's push handling). */
async function pushCourseRow(course: Course, tenantId: string): Promise<void> {
  try {
    await db.courses.update(course.id as string, { synced: false } as any);
  } catch {
    /* row may have been deleted mid-flight — the push below will fail too */
  }
  try {
    await pushCourseToSupabase(course, tenantId);
    await db.courses.update(course.id as string, { synced: true } as any);
  } catch (e: unknown) {
    console.warn("Supabase push failed (kept as pending, will retry):", e);
  }
}

export async function addCourse(course: Course): Promise<string> {
  if (!course.id) {
    course.id = crypto.randomUUID?.() || "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; const v = c === "x" ? r : (r & 0x3) | 0x8; return v.toString(16); });
  }

  // Re-creating a previously deleted course is legitimate — lift the tombstone.
  if (await isDeleted("course", course.id)) {
    console.warn(`Course ${course.id} was tombstoned. Removing tombstone to allow re-creation.`);
    await unmarkDeleted("course", course.id);
  }

  const tenantId = getTenantId();
  if (!tenantId) {
    // No institution linked — keep the course strictly local. It stays
    // unsynced, so a later delete never attempts a doomed cloud delete.
    (course as any).synced = false;
    if (!course.createdAt) course.createdAt = new Date().toISOString();
    const existing = await db.courses.get(course.id);
    if (existing) {
      await db.courses.put({ ...(existing as any), ...(course as any), id: course.id });
    } else {
      await db.courses.add(course);
    }
    return course.id;
  }

  const c: any = course;
  c.tenantId = c.tenantId || c.tenant_id || tenantId;
  const existing = await db.courses.get(course.id);
  if (existing) {
    const merged = { ...existing, ...course, id: course.id } as Course;
    await db.courses.put(merged);
    await pushCourseRow(merged, tenantId);
    return course.id;
  }
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.add(course);
  await pushCourseRow(course, tenantId);
  return course.id;
}

export async function updateCourse(course: Course): Promise<void> {
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.put(course);
  const tenantId = getTenantId();
  if (tenantId) await pushCourseRow(course, tenantId);
}

export async function deleteCourse(id: string): Promise<void> {
  const tenantId = getTenantId();

  // Read BEFORE the cascade — whether this course was ever pushed decides
  // whether a cloud delete is meaningful at all (see header).
  const local: any = await db.courses.get(id).catch(() => null);
  const everSynced = !local || local.synced !== false;

  // Tombstone FIRST — same ordering as userDB.deleteUser. Writing it after
  // the local delete left a resurrection window on every pull/realtime event.
  await markDeleted("course", id, tenantId, "pending");

  // Local cascade (each step guarded — a missing table must not abort)
  try { await db.materials.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }
  try {
    const assignments = await db.assignments.where("courseId").equals(id).toArray();
    for (const a of assignments) {
      if (!a.id) continue; // Assignment.id is optional — skip instead of feeding undefined to Dexie
      await db.assignmentFields.where("assignmentId").equals(a.id).delete();
      await db.assignmentSubmissions.where("assignmentId").equals(a.id).delete();
    }
    await db.assignments.where("courseId").equals(id).delete();
  } catch { /* table may not exist */ }
  try { await db.enrollments.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.schedules.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.chatMessages.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.liveSessions.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.livePresentations.where("courseId").equals(id).delete(); } catch { /* table may not exist */ }

  await db.courses.delete(id);

  if (tenantId && everSynced) {
    try {
      await deleteCourseFromSupabase(id, tenantId);
      await unmarkDeleted("course", id);
      console.log(`Course ${id} fully deleted (local + cloud)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      // v5: the cloud says there is no row. For a course whose pushes never
      // succeeded (offline creation, every push failing, pre-v4 rows without
      // a synced stamp) that is the NORMAL outcome — there is nothing to
      // delete there. Lift the tombstone so the retry loop never chases a
      // row that cannot exist. A cloud-confirmed row (synced === true) takes
      // the strict path instead: a "matched no row" there is suspicious
      // (RLS/another device) and stays a retryable "failed" tombstone.
      if (local?.synced !== true && /matched no row/i.test(msg)) {
        await unmarkDeleted("course", id);
        console.log(`Course ${id} deleted locally (cloud has no row to remove — never synced)`);
        return;
      }
      console.warn(`Course ${id} deleted locally but cloud delete failed: ${msg}`);
      await markDeleted("course", id, tenantId, "failed", msg);
      throw new Error(`Course deleted locally but cloud delete failed: ${msg}`);
    }
  } else {
    // No institution linked, or the row has unconfirmed local changes —
    // there is nothing to delete in the cloud. Lift the tombstone so the
    // retry loop never chases a row that cannot exist.
    await unmarkDeleted("course", id);
    console.log(`Course ${id} deleted locally (never synced — no cloud row to remove)`);
  }
}

export async function getTrainerCourses(trainerId: string): Promise<Course[]> {
  try {
    const ens = await db.enrollments.where("userId").equals(trainerId).and((e: any) => e.role === "trainer").toArray();
    const courses: Course[] = [];
    for (const id of ens.map((e: any) => e.courseId)) { const c = await db.courses.get(id); if (c) courses.push(c); }
    return courses;
  } catch { /* enrollments table may not exist */ return []; }
}

export async function getTraineeCourses(traineeId: string): Promise<Course[]> {
  try {
    const ens = await db.enrollments.where("userId").equals(traineeId).and((e: any) => e.role === "trainee").toArray();
    const courses: Course[] = [];
    for (const id of ens.map((e: any) => e.courseId)) { const c = await db.courses.get(id); if (c) courses.push(c); }
    return courses;
  } catch { /* enrollments table may not exist */ return []; }
}
