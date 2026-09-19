import { db } from "./db";
import { sbFetch } from "../auth/supabase";
import type { Course, Enrollment, CourseMaterial, Assignment, AssignmentSubmission, Schedule } from "../types";

// ================================================================
// PUSH COURSES TO SUPABASE
// ================================================================
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  try {
    await sbFetch("courses", {
      method: "POST",
      body: JSON.stringify({
        id: course.id,
        tenant_id: tenantId,
        name: course.name,
        description: course.description || "",
        tuition_type: course.tuitionType || "free",
        amount: course.amount || 0,
        start_date: course.startDate || new Date().toISOString(),
        period: course.period || "",
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push course failed:", msg);
  }
}

export async function deleteCourseFromSupabase(id: string, tenantId: string): Promise<void> {
  try {
    await sbFetch("courses", {
      method: "DELETE",
      id: `eq.${id}`,
      tenant_id: `eq.${tenantId}`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Delete course failed:", msg);
  }
}

// ================================================================
// PUSH MATERIALS TO SUPABASE
// ================================================================
export async function pushMaterialToSupabase(material: CourseMaterial, tenantId: string): Promise<void> {
  try {
    const course = await db.courses.get(material.courseId);
    const finalTenantId = tenantId || course?.tenantId;
    if (!finalTenantId) return;

    await sbFetch("course_materials", {
      method: "POST",
      body: JSON.stringify({
        id: material.id,
        tenant_id: finalTenantId,
        course_id: material.courseId,
        title: material.title,
        file_name: material.fileName || "file",
        file_type: material.fileType || "pdf",
        presentation_order: material.presentationOrder || 0,
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push material failed:", msg);
  }
}

export async function deleteMaterialFromSupabase(id: string): Promise<void> {
  try {
    await sbFetch("course_materials", {
      method: "DELETE",
      id: `eq.${id}`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Delete material failed:", msg);
  }
}

// ================================================================
// PUSH ASSIGNMENTS TO SUPABASE
// ================================================================
export async function pushAssignmentToSupabase(assignment: Assignment, tenantId: string): Promise<void> {
  try {
    await sbFetch("assignments", {
      method: "POST",
      body: JSON.stringify({
        id: assignment.id,
        tenant_id: tenantId,
        course_id: assignment.courseId,
        trainer_id: assignment.trainerId,
        title: assignment.title,
        description: assignment.description || "",
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push assignment failed:", msg);
  }
}

export async function deleteAssignmentFromSupabase(id: string, tenantId: string): Promise<void> {
  try {
    await sbFetch("assignments", {
      method: "DELETE",
      id: `eq.${id}`,
      tenant_id: `eq.${tenantId}`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Delete assignment failed:", msg);
  }
}

// ================================================================
// PUSH ASSIGNMENT FIELDS TO SUPABASE
// ================================================================
export async function pushAssignmentFieldsToSupabase(assignmentId: string, _tenantId: string, fieldIds: string[]): Promise<void> {
  try {
    const fields = await db.assignmentFields.where("assignmentId").equals(assignmentId).toArray();
    const fieldsToPush = fields.filter(f => fieldIds.includes(f.id));

    for (const f of fieldsToPush) {
      await sbFetch("assignment_fields", {
        method: "POST",
        body: JSON.stringify({
          id: f.id,
          assignment_id: f.assignmentId,
          type: f.type,
          label: f.label || "",
          required: f.required || false,
          options: f.options || [],
          file_types: f.fileTypes || [],
        }),
      });
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push assignment fields failed:", msg);
  }
}

export async function deleteAssignmentFieldsFromSupabase(assignmentId: string): Promise<void> {
  try {
    await sbFetch("assignment_fields", {
      method: "DELETE",
      assignment_id: `eq.${assignmentId}`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Delete assignment fields failed:", msg);
  }
}

// ================================================================
// PUSH SUBMISSIONS TO SUPABASE
// ================================================================
export async function pushSubmissionToSupabase(submission: AssignmentSubmission, _tenantId: string): Promise<void> {
  try {
    await sbFetch("assignment_submissions", {
      method: "POST",
      body: JSON.stringify({
        id: submission.id,
        assignment_id: submission.assignmentId,
        user_id: submission.userId,
        data: submission.answers || {},
        grade: submission.grade || "",
        feedback: submission.feedback || "",
        submitted_at: submission.submittedAt || new Date().toISOString(),
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push submission failed:", msg);
  }
}

// ================================================================
// PUSH SCHEDULES TO SUPABASE
// ================================================================
export async function pushScheduleToSupabase(schedule: Schedule, tenantId: string): Promise<void> {
  try {
    await sbFetch("schedules", {
      method: "POST",
      body: JSON.stringify({
        id: schedule.id,
        tenant_id: tenantId,
        course_id: schedule.courseId,
        trainer_id: schedule.trainerId,
        scheduled_at: schedule.scheduledAt,
        trainer_name: schedule.trainerName || "",
        title: schedule.title || "",
        description: schedule.description || "",
      }),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Push schedule failed:", msg);
  }
}

export async function deleteScheduleFromSupabase(scheduleId: string): Promise<void> {
  try {
    await sbFetch("schedules", {
      method: "DELETE",
      id: `eq.${scheduleId}`,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Delete schedule failed:", msg);
  }
}


// ================================================================
// PULL ENROLLMENTS (WITH DEBUG LOGS)
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
    let upserted = 0;

    for (const e of data) {
      const exists = await db.enrollments
        .where({ userId: e.user_id as string, courseId: e.course_id as string })
        .first();

      if (!exists) {
        console.log(`    📥 Adding enrollment: User ${e.user_id} -> Course ${e.course_id} (Role: ${e.role})`);
        await db.enrollments.add({
          id: e.id as string,
          userId: e.user_id as string,
          courseId: e.course_id as string,
          role: (e.role as "trainer" | "trainee") || "trainee",
          enrolledAt: (e.created_at as string) || new Date().toISOString(),
          status: (e.status as string) || "active",
          tenantId: tenantId,
        } as unknown as Enrollment);
        upserted++;
      }
    }
    return upserted;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("    ❌ Pull enrollments crashed:", msg);
    return 0;
  }
}

// ================================================================
// PULL COURSES
// ================================================================
export async function pullCoursesFromSupabase(tenantId: string): Promise<number> {
  try {
    const { data, error } = await sbFetch("courses", {
      select: "*",
      tenant_id: `eq.${tenantId}`,
    });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return 0;

    let upserted = 0;
    for (const c of data) {
      const local = await db.courses.get(c.id as string);
      if (!local) {
        await db.courses.add({
          id: c.id as string,
          name: (c.name as string) || "",
          description: (c.description as string) || "",
          tuitionType: (c.tuition_type as "free" | "paid") || "free",
          amount: (c.amount as number) || 0,
          startDate: (c.start_date as string) || (c.created_at as string) || new Date().toISOString(),
          period: (c.period as string) || "",
          createdAt: (c.created_at as string) || new Date().toISOString(),
        } as unknown as Course);
        upserted++;
      }
    }
    return upserted;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull courses failed:", msg);
    return 0;
  }
}

// ================================================================
// PULL MATERIALS FOR COURSE
// ================================================================
export async function pullMaterialsForCourse(courseId: string, tenantId: string): Promise<number> {
  try {
    const { data, error } = await sbFetch("course_materials", {
      select: "*",
      tenant_id: `eq.${tenantId}`,
      course_id: `eq.${courseId}`,
    });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return 0;

    let upserted = 0;
    for (const m of data) {
      const local = await db.materials.get(m.id as string);
      if (!local) {
        await db.materials.add({
          id: m.id as string,
          courseId: m.course_id as string,
          title: (m.title as string) || "",
          description: "",
          fileName: (m.file_name as string) || "file",
          fileType: (m.file_type as string) || "pdf",
          allowDownload: false,
          uploadedBy: "",
          uploadedAt: (m.created_at as string) || new Date().toISOString(),
          presentationOrder: (m.presentation_order as number) ?? 0,
        } as unknown as CourseMaterial);
        upserted++;
      }
    }
    return upserted;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull materials failed:", msg);
    return 0;
  }
}

// ================================================================
// PULL ASSIGNMENTS FOR COURSE
// ================================================================
async function pullAssignmentsForCourse(courseId: string, tenantId: string): Promise<number> {
  try {
    const { data, error } = await sbFetch("assignments", {
      select: "*",
      course_id: `eq.${courseId}`,
      tenant_id: `eq.${tenantId}`,
    });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return 0;

    let count = 0;
    for (const a of data) {
      const localA = await db.assignments.get(a.id as string);
      if (!localA) {
        await db.assignments.add({
          id: a.id as string,
          courseId: a.course_id as string,
          trainerId: a.trainer_id as string,
          title: (a.title as string) || "",
          description: (a.description as string) || "",
          createdAt: (a.created_at as string) || new Date().toISOString(),
        } as unknown as Assignment);
        count++;
      }

      const { data: fields } = await sbFetch("assignment_fields", {
        select: "*",
        assignment_id: `eq.${a.id}`,
      });

      if (fields) {
        for (const f of fields) {
          const localF = await db.assignmentFields.get(f.id as string);
          if (!localF) {
            await db.assignmentFields.add({
              id: f.id as string,
              assignmentId: f.assignment_id as string,
              type: f.type as "text" | "paragraph" | "dropdown" | "checkbox" | "toggle" | "file" | "note" | "header",
              label: (f.label as string) || "",
              required: (f.required as boolean) || false,
              options: (f.options as string[]) || [],
              fileTypes: (f.file_types as string[]) || [],
            });
          }
        }
      }
    }
    return count;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull assignments failed:", msg);
    return 0;
  }
}

// ================================================================
// PULL USER SUBMISSIONS FOR COURSE
// ================================================================
async function pullUserSubmissionsForCourse(courseId: string, userId: string): Promise<number> {
  try {
    const localAssignments = await db.assignments.where("courseId").equals(courseId).toArray();
    if (localAssignments.length === 0) return 0;

    let count = 0;
    for (const assignment of localAssignments) {
      const { data, error } = await sbFetch("assignment_submissions", {
        select: "*",
        assignment_id: `eq.${assignment.id}`,
        user_id: `eq.${userId}`,
      });

      if (error || !data) continue;

      for (const s of data) {
        const localS = await db.assignmentSubmissions.get(s.id as string);
        if (!localS) {
          await db.assignmentSubmissions.add({
            id: s.id as string,
            assignmentId: s.assignment_id as string,
            userId: s.user_id as string,
            username: "",
            submittedAt: (s.submitted_at as string) || (s.created_at as string) || new Date().toISOString(),
            answers: (s.data as Record<string, unknown>) || {},
            grade: s.grade as string,
            feedback: s.feedback as string,
          } as unknown as AssignmentSubmission);
          count++;
        }
      }
    }
    return count;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull submissions failed:", msg);
    return 0;
  }
}

// ================================================================
// PULL ALL SUBMISSIONS FOR COURSE
// ================================================================
async function pullAllSubmissionsForCourse(courseId: string): Promise<number> {
  try {
    const localAssignments = await db.assignments.where("courseId").equals(courseId).toArray();
    if (localAssignments.length === 0) return 0;

    let count = 0;
    for (const assignment of localAssignments) {
      const { data, error } = await sbFetch("assignment_submissions", {
        select: "*",
        assignment_id: `eq.${assignment.id}`,
      });

      if (error || !data) continue;

      for (const s of data) {
        const localS = await db.assignmentSubmissions.get(s.id as string);
        if (!localS) {
          await db.assignmentSubmissions.add({
            id: s.id as string,
            assignmentId: s.assignment_id as string,
            userId: s.user_id as string,
            username: "",
            submittedAt: (s.submitted_at as string) || (s.created_at as string) || new Date().toISOString(),
            answers: (s.data as Record<string, unknown>) || {},
            grade: s.grade as string,
            feedback: s.feedback as string,
          } as unknown as AssignmentSubmission);
          count++;
        }
      }
    }
    return count;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull all submissions failed:", msg);
    return 0;
  }
}

// ================================================================
// PULL SCHEDULES FOR COURSE
// ================================================================
async function pullSchedulesForCourse(courseId: string, tenantId: string): Promise<number> {
  try {
    const { data, error } = await sbFetch("schedules", {
      select: "*",
      course_id: `eq.${courseId}`,
      tenant_id: `eq.${tenantId}`,
    });

    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return 0;

    let count = 0;
    for (const s of data) {
      const localS = await db.schedules.get(s.id as string);
      if (!localS) {
        await db.schedules.add({
          id: s.id as string,
          courseId: s.course_id as string,
          trainerId: s.trainer_id as string,
          scheduledAt: (s.scheduled_at as string) || "",
          trainerName: (s.trainer_name as string) || "",
          title: (s.title as string) || "",
          description: (s.description as string) || "",
          createdAt: (s.created_at as string) || new Date().toISOString(),
        } as Schedule);
        count++;
      }
    }
    return count;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.warn("Pull schedules failed:", msg);
    return 0;
  }
}

// ================================================================
// HELPER: Get course IDs from all sources (FIXED: No strict role filter)
// ================================================================
async function getUserCourseIds(userId: string, _role?: string): Promise<string[]> {
  const courseIdsSet = new Set<string>();

  // ✅ FIX: Get ALL enrollments for this user regardless of role to be safe
  const enrollments = await db.enrollments
    .where("userId")
    .equals(userId)
    .toArray();

  console.log(`    🗄️ Found ${enrollments.length} local enrollments for user ${userId}:`, enrollments);
  enrollments.forEach((e) => {
    console.log(`       -> Enrollment: Course ${e.courseId} (Role: ${e.role})`);
    courseIdsSet.add(e.courseId);
  });

  // Also check user.assignedCourses array
  const localUser = await db.users.get(userId);
  if (localUser?.assignedCourses) {
    localUser.assignedCourses.forEach((courseId) => courseIdsSet.add(courseId));
  }

  // Also check localStorage
  try {
    const storedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (storedUser.assignedCourses && Array.isArray(storedUser.assignedCourses)) {
      storedUser.assignedCourses.forEach((courseId: string) => courseIdsSet.add(courseId));
    }
  } catch {
    // Ignore
  }

  const finalIds = [...courseIdsSet];
  console.log(`    🎯 Final course IDs to load:`, finalIds);
  return finalIds;
}

// ================================================================
// HELPER: Pull full course data
// ================================================================
async function pullFullCourseData(courseId: string, tenantId: string): Promise<void> {
  console.log(`    ⬇️ Pulling full data for course: ${courseId}`);
  const { data } = await sbFetch("courses", {
    select: "*",
    id: `eq.${courseId}`,
    tenant_id: `eq.${tenantId}`,
    limit: "1",
  });

  if (data && data.length > 0) {
    const c = data[0];
    const local = await db.courses.get(c.id as string);
    if (!local) {
      console.log(`       ➕ Added course to local DB: ${c.name}`);
      await db.courses.add({
        id: c.id as string,
        name: (c.name as string) || "",
        description: (c.description as string) || "",
        tuitionType: (c.tuition_type as "free" | "paid") || "free",
        amount: (c.amount as number) || 0,
        startDate: (c.start_date as string) || (c.created_at as string) || new Date().toISOString(),
        period: (c.period as string) || "",
        createdAt: (c.created_at as string) || new Date().toISOString(),
      } as unknown as Course);
    } else {
      console.log(`       ✅ Course already exists locally`);
    }
  } else {
    console.warn(`       ⚠️ Course NOT found in Supabase!`);
  }

  await pullMaterialsForCourse(courseId, tenantId);
  await pullAssignmentsForCourse(courseId, tenantId);
  await pullSchedulesForCourse(courseId, tenantId);
}

// ================================================================
// MASTER SYNC: Trainer
// ================================================================
export async function syncTrainerData(trainerId: string, tenantId: string): Promise<void> {
  if (!tenantId) return;
  console.log("🔄 Syncing trainer data...");

  const enCount = await pullEnrollmentsFromSupabase(tenantId);
  console.log(`  📦 Enrollments: ${enCount} new`);

  const courseIds = await getUserCourseIds(trainerId);
  console.log(`  📚 Trainer has ${courseIds.length} courses:`, courseIds);

  for (const courseId of courseIds) {
    await pullFullCourseData(courseId, tenantId);
    await pullAllSubmissionsForCourse(courseId);
  }

  console.log("✅ Trainer data sync complete");
  window.dispatchEvent(new Event("coursesSynced"));
}

// ================================================================
// MASTER SYNC: Trainee (WITH DETAILED LOGS)
// ================================================================
export async function syncTraineeData(traineeId: string, tenantId: string): Promise<void> {
  if (!tenantId) {
    console.error("❌ SYNC STOPPED: No tenantId provided!");
    return;
  }
  console.log("🔄 Syncing trainee data...", { traineeId, tenantId });

  const enCount = await pullEnrollmentsFromSupabase(tenantId);
  console.log(`  📦 Enrollments pulled: ${enCount} new`);

  const courseIds = await getUserCourseIds(traineeId);
  console.log(`  📚 Trainee has ${courseIds.length} courses:`, courseIds);

  for (const courseId of courseIds) {
    await pullFullCourseData(courseId, tenantId);
    await pullUserSubmissionsForCourse(courseId, traineeId);
  }

  console.log("✅ Trainee data sync complete");
  window.dispatchEvent(new Event("coursesSynced"));
}

// ================================================================
// MASTER SYNC: Admin
// ================================================================
export async function syncAdminData(tenantId: string): Promise<void> {
  if (!tenantId) return;
  console.log("🔄 Syncing admin data...");

  const cCount = await pullCoursesFromSupabase(tenantId);
  console.log(`  📚 Courses: ${cCount} new`);

  const enCount = await pullEnrollmentsFromSupabase(tenantId);
  console.log(`  📦 Enrollments: ${enCount} new`);

  const allCourses = await db.courses.toArray();
  let mCount = 0;
  for (const course of allCourses) {
    mCount += await pullMaterialsForCourse(course.id, tenantId);
    await pullAssignmentsForCourse(course.id, tenantId);
    await pullAllSubmissionsForCourse(course.id);
    await pullSchedulesForCourse(course.id, tenantId);
  }
  console.log(`  📄 Materials: ${mCount} new`);

  console.log("✅ Admin data sync complete");
  window.dispatchEvent(new Event("coursesSynced"));
}

// ================================================================
// CONVENIENCE: Auto-detect role and sync
// ================================================================
export async function syncUserAssignedData(userId: string, tenantId: string, role: string): Promise<void> {
  if (!tenantId || !userId) return;

  if (role === "admin") {
    await syncAdminData(tenantId);
  } else if (role === "trainer") {
    await syncTrainerData(userId, tenantId);
  } else if (role === "trainee") {
    await syncTraineeData(userId, tenantId);
  } else {
    console.warn(`Unknown role "${role}" for sync.`);
  }
}