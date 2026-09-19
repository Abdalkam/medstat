import { db } from "./db";
import type { Enrollment, User } from "../types";

export async function addEnrollment(enrollment: Enrollment) {
  const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = currentUser.tenantId || undefined;

  // Safeguard: Ensure role is strictly defined
  const finalEnrollment: Enrollment = {
    ...enrollment,
    tenantId,
    role: enrollment.role || "trainee", 
  };
  
  await db.enrollments.add(finalEnrollment);
}

export async function getEnrollments() {
  return await db.enrollments.toArray();
}

export async function getCourseEnrollments(courseId: string) {
  return await db.enrollments.where("courseId").equals(courseId).toArray();
}

export async function getTrainerEnrollments(trainerId: string) {
  return await db.enrollments
    .where("userId").equals(trainerId)
    .and(item => item.role === "trainer")
    .toArray();
}

export async function getCourseLearners(courseId: string) {
  return await db.enrollments
    .where("courseId").equals(courseId)
    .and(item => item.role === "trainee")
    .toArray();
}

export async function getCourseTrainer(courseId: string) {
  return await db.enrollments
    .where("courseId").equals(courseId)
    .and(item => item.role === "trainer")
    .first();
}

export async function isUserEnrolled(userId: string, courseId: string) {
  const result = await db.enrollments.where({ userId, courseId }).first();
  return !!result;
}

export async function removeEnrollment(id: string) {
  await db.enrollments.delete(id);
}

export async function syncUserEnrollments(user: User, newCourseIds: string[]): Promise<void> {
  const oldCourseIds = user.assignedCourses || [];

  // Update the user's profile array
  user.assignedCourses = newCourseIds;
  await db.users.put(user);

  // Find what was added
  const addedCourses = newCourseIds.filter(id => !oldCourseIds.includes(id));

  for (const courseId of addedCourses) {
    const exists = await db.enrollments.where({ userId: user.id, courseId }).first();
    if (!exists) {
      const enrollment: Enrollment = {
        id: crypto.randomUUID(),
        userId: user.id,
        courseId: courseId,
        tenantId: user.tenantId || undefined,
        // STRICT FIX: Explicitly check user role instead of assuming trainee
        role: user.role === "trainer" ? "trainer" : "trainee",
        enrolledAt: new Date().toISOString(),
        status: "active",
      };
      await db.enrollments.add(enrollment);
    }
  }

  // Find what was removed
  const removedCourses = oldCourseIds.filter(id => !newCourseIds.includes(id));
  for (const courseId of removedCourses) {
    const record = await db.enrollments.where({ userId: user.id, courseId }).first();
    if (record) {
      await db.enrollments.delete(record.id);
    }
  }
}