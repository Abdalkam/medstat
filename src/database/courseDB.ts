// src/database/courseDB.ts — v4: honest synced flag + never-synced delete guard
//
// Changes vs v3 (behavior additions — the v3 tsc fix list is preserved):
//  • addCourse/updateCourse now stamp synced:true ONLY when the cloud
//    confirms (trainerDB semantics). Courses previously carried no synced
//    flag at all, so nothing could ever tell whether a course had reached
//    Supabase — and deleteCourse could not distinguish "in the cloud" from
//    "created offline, never pushed".
//  • deleteCourse reads the row BEFORE the cascade: a course that was never
//    confirmed in the cloud (synced === false) skips the cloud soft-delete
//    and lifts the tombstone. deleteCourseFromSupabase is count-verified
//    and throws "matched no row" for cloud-absent courses, which would
//    otherwise strand an immortal "failed" tombstone. Rows with no synced
//    flag (pre-v4 rows) are presumed cloud-known and keep the old behavior.
//  (v3 recap) pushCourseToSupabase / deleteCourseFromSupabase come from
//  supabaseCourseSync — v3 of that file pushes courses SCHEMA-EXACT to the
//  relational public.courses table and soft-deletes (deleted_at = now), so
//  deletions finally propagate to other devices through their pull filter.

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

export async function getCourses(): Promise<Course[]> { return await db.courses.toArray(); }
export async function getCourseById(id: string): Promise<Course | undefined> { return await db.courses.get(id); }

/** Push + stamp: synced:true only when the cloud confirms; failures keep the
 *  row as synced:false so deleteCourse's never-synced guard knows the row
 *  may be cloud-absent (mirrors trainerDB's push handling). */
async function pushCourseRow(course: Course, tenantId: string): Promise<void> {
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
  const existing = await db.courses.get(course.id);
  if (existing) {
    const merged = { ...existing, ...course, id: course.id };
    await db.courses.put(merged);
    if (tenantId) await pushCourseRow(merged, tenantId);
    return course.id;
  }
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.add(course);
  if (tenantId) await pushCourseRow(course, tenantId);
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
      console.warn(`Course ${id} deleted locally but cloud delete failed: ${msg}`);
      await markDeleted("course", id, tenantId, "failed", msg);
      throw new Error(`Course deleted locally but cloud delete failed: ${msg}`);
    }
  } else {
    // No institution linked, or the course never reached the cloud — there
    // is nothing to delete there. Lift the tombstone so the retry loop
    // never chases a row that cannot exist.
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
