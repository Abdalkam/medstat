// src/database/courseDB.ts — v3: tombstone-first deletes, guarded cascades, typed callbacks
//
// Changes vs v2 (tsc fixes only — behavior and flow unchanged):
//   1. pushCourseToSupabase / deleteCourseFromSupabase now exist in
//      supabaseCourseSync — see supabaseCourseSync_additions.ts (append it to
//      supabaseCourseSync.ts). Fixes TS2724 at line 16 (the compiler's
//      "Did you mean pushUserRowToSupabase" hint proves those course functions
//      never existed — the file only had user-row sync).
//   2. The three .catch((e) => …) callbacks are now typed (e: unknown) —
//      fixes TS7006 "Parameter 'e' implicitly has an 'any' type" at 47/52/60.
//   3. deleteCourse() cascade skips Assignment rows without an id
//      (Assignment.id is optional — fixes TS2345 at 75/76).

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
    if (tenantId) await pushCourseToSupabase(merged, tenantId).catch((e: unknown) => console.warn("Supabase push failed:", e));
    return course.id;
  }
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.add(course);
  if (tenantId) await pushCourseToSupabase(course, tenantId).catch((e: unknown) => console.warn("Supabase push failed:", e));
  return course.id;
}

export async function updateCourse(course: Course): Promise<void> {
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.put(course);
  const tenantId = getTenantId();
  if (tenantId) await pushCourseToSupabase(course, tenantId).catch((e: unknown) => console.warn("Supabase push failed:", e));
}

export async function deleteCourse(id: string): Promise<void> {
  const tenantId = getTenantId();

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

  if (tenantId) {
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
