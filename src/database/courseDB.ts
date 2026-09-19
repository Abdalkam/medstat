import { db } from "./db";
import type { Course } from "../types";
import { pushCourseToSupabase, deleteCourseFromSupabase } from "./supabaseCourseSync";

function getTenantId(): string {
  const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
  return user.tenantId || "";
}

export async function getCourses(): Promise<Course[]> {
  return await db.courses.toArray();
}

export async function getCourseById(id: string): Promise<Course | undefined> {
  return await db.courses.get(id);
}

export async function addCourse(course: Course): Promise<string> {
  if (!course.id) {
    course.id = crypto.randomUUID?.() ||
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === "x" ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
  }

  const existing = await db.courses.get(course.id);
  if (existing) {
    console.warn(`Course "${course.name}" already exists. Updating instead of duplicating.`);
    const merged = { ...existing, ...course, id: course.id };
    await db.courses.put(merged);
    const tenantId = getTenantId();
    if (tenantId) pushCourseToSupabase(merged, tenantId);
    return course.id;
  }

  if (!course.createdAt) {
    course.createdAt = new Date().toISOString();
  }

  await db.courses.add(course);
  const tenantId = getTenantId();
  if (tenantId) pushCourseToSupabase(course, tenantId);
  return course.id;
}

export async function updateCourse(course: Course): Promise<void> {
  if (!course.createdAt) course.createdAt = new Date().toISOString();
  await db.courses.put(course);
  const tenantId = getTenantId();
  if (tenantId) pushCourseToSupabase(course, tenantId);
}

export async function deleteCourse(id: string): Promise<void> {
  await db.materials.where("courseId").equals(id).delete();
  await db.assignments.where("courseId").equals(id).each(async (a) => {
    await db.assignmentFields.where("assignmentId").equals(a.id).delete();
    await db.assignmentSubmissions.where("assignmentId").equals(a.id).delete();
  });
  await db.assignments.where("courseId").equals(id).delete();
  await db.enrollments.where("courseId").equals(id).delete();
  await db.schedules.where("courseId").equals(id).delete();
  await db.chatMessages.where("courseId").equals(id).delete();
  await db.liveSessions.where("courseId").equals(id).delete();
  await db.livePresentations.where("courseId").equals(id).delete();
  await db.courses.delete(id);
  const tenantId = getTenantId();
  if (tenantId) deleteCourseFromSupabase(id, tenantId);
}

export async function getTrainerCourses(trainerId: string): Promise<Course[]> {
  const trainerEnrollments = await db.enrollments
    .where("userId").equals(trainerId)
    .and(e => e.role === "trainer")
    .toArray();
    
  const courseIds = trainerEnrollments.map(e => e.courseId);
  if (courseIds.length === 0) return [];
  
  const courses: Course[] = [];
  for (const id of courseIds) {
    const course = await db.courses.get(id);
    if (course) courses.push(course);
  }
  return courses;
}

// ✅ PRIMARY FUNCTION FOR TRAINEE VIEWS
export async function getTraineeCourses(traineeId: string): Promise<Course[]> {
  const traineeEnrollments = await db.enrollments
    .where("userId").equals(traineeId)
    .and(e => e.role === "trainee")
    .toArray();
    
  const courseIds = traineeEnrollments.map(e => e.courseId);
  if (courseIds.length === 0) return [];
  
  const courses: Course[] = [];
  for (const id of courseIds) {
    const course = await db.courses.get(id);
    if (course) courses.push(course);
  }
  return courses;
}