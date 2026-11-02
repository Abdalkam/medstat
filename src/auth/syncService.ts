// src/auth/syncService.ts — v2: tombstone-aware realtime + pull
// (v1 put Supabase rows straight into Dexie with no tombstone check — a failed
//  cloud delete meant every realtime event / manual syncDown resurrected the
//  deleted user)

import { supabase } from "./supabase";
import { db } from "../database/db";
import { isDeleted, getDeletedIds } from "../database/deletedIdsTracker";
import type { RealtimeChannel } from "@supabase/supabase-js";

let activeChannels: RealtimeChannel[] = [];

function getTenantId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return user?.tenantId || "";
  } catch {
    return "";
  }
}

// ==========================================
// 1. INSTANT REALTIME SYNC
// ==========================================
export function enableRealtimeSync() {
  console.log("📡 Enabling Realtime Sync...");
  setupUserRealtime();
  setupCourseRealtime();
  setupEnrollmentRealtime();
}

function realtimeFilter(tenantId: string): { filter: string } | {} {
  // Scope the channel to the current tenant when we know it — otherwise this
  // client receives (and stores) rows from every institution on the server.
  return tenantId ? { filter: `tenant_id=eq.${tenantId}` } : {};
}

function setupUserRealtime() {
  const tenantId = getTenantId();
  const channel = supabase
    .channel("users-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "users", ...realtimeFilter(tenantId) },
      async (payload: any) => {
        // DELETE — hard delete on the cloud: drop the local row too
        if (payload.eventType === "DELETE") {
          const id = payload.old?.id;
          if (id) await db.users.delete(id);
          window.dispatchEvent(new Event("userChanged"));
          return;
        }

        const row = mapUser(payload.new);
        if (!row.id) return;
        if ((payload.new as any)?.deleted_at) return; // soft-deleted remotely

        // ✅ TOMBSTONE CHECK — never re-insert a locally-deleted user.
        // This is the path that resurrected deleted users in v1.
        if (await isDeleted("user", row.id)) {
          console.warn(`[realtime] Skipped tombstoned user ${row.id}`);
          return;
        }

        console.log("📥 Realtime User received:", row.id);
        await db.users.put(row);
        // Trigger UI refresh if needed
        window.dispatchEvent(new Event("userChanged"));
      }
    )
    .subscribe();
  activeChannels.push(channel);
}

function setupCourseRealtime() {
  const tenantId = getTenantId();
  const channel = supabase
    .channel("courses-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "courses", ...realtimeFilter(tenantId) },
      async (payload: any) => {
        console.log("📥 Realtime Course event:", payload.eventType);

        if (payload.eventType === "DELETE") {
          await db.courses.delete(payload.old?.id);
        } else {
          const localData = mapCourse(payload.new);
          // ✅ TOMBSTONE CHECK — same protection as users
          if (!localData.id || (payload.new as any)?.deleted_at || (await isDeleted("course", localData.id))) {
            console.warn(`[realtime] Skipped tombstoned course ${localData.id || "?"}`);
          } else {
            await db.courses.put(localData);
          }
        }

        // Trigger UI refresh for course components
        window.dispatchEvent(new Event("coursesChanged"));
      }
    )
    .subscribe();
  activeChannels.push(channel);
}

function setupEnrollmentRealtime() {
  const tenantId = getTenantId();
  const channel = supabase
    .channel("enrollments-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "enrollments", ...realtimeFilter(tenantId) },
      async (payload: any) => {
        console.log("📥 Realtime Enrollment event:", payload.eventType);

        if (payload.eventType === "DELETE") {
          await db.enrollments.delete(payload.old?.id);
        } else {
          const localData = mapEnrollment(payload.new);
          // ✅ TOMBSTONE CHECK
          if (!localData.id || (payload.new as any)?.deleted_at || (await isDeleted("enrollment", localData.id))) {
            console.warn(`[realtime] Skipped tombstoned enrollment ${localData.id || "?"}`);
          } else {
            await db.enrollments.put(localData);
          }
        }

        window.dispatchEvent(new Event("enrollmentsChanged"));
      }
    )
    .subscribe();
  activeChannels.push(channel);
}

export function disableRealtimeSync() {
  activeChannels.forEach((channel) => supabase.removeChannel(channel));
  activeChannels = [];
}

// ==========================================
// 2. MANUAL PULL
// ==========================================
export async function syncDown() {
  console.log("🔄 Starting Manual Sync Down...");
  try {
    const tenantId = getTenantId();

    // ✅ Load tombstoned IDs once — the pull must never resurrect them
    const deletedUserIds = new Set(await getDeletedIds("user"));
    const deletedCourseIds = new Set(await getDeletedIds("course"));
    const deletedEnrollmentIds = new Set(await getDeletedIds("enrollment"));

    // Users — tombstone + soft-delete filtered, tenant-scoped when known
    // (v1 pulled every user from every tenant and put them all into Dexie)
    let usersQuery = supabase.from("users").select("*");
    if (tenantId) usersQuery = usersQuery.eq("tenant_id", tenantId);
    const { data: onlineUsers } = await usersQuery;
    if (onlineUsers) {
      let pulled = 0;
      for (const u of onlineUsers as any[]) {
        if (deletedUserIds.has(u.id)) continue;
        if (u.deleted_at) continue;
        await db.users.put(mapUser(u));
        pulled++;
      }
      console.log(`✅ Pulled ${pulled}/${onlineUsers.length} users (tombstoned/deleted skipped).`);
    }

    // Courses
    let coursesQuery = supabase.from("courses").select("*");
    if (tenantId) coursesQuery = coursesQuery.eq("tenant_id", tenantId);
    const { data: onlineCourses } = await coursesQuery;
    if (onlineCourses) {
      let pulled = 0;
      for (const c of onlineCourses as any[]) {
        if (deletedCourseIds.has(c.id)) continue;
        if (c.deleted_at) continue;
        await db.courses.put(mapCourse(c));
        pulled++;
      }
      console.log(`✅ Pulled ${pulled}/${onlineCourses.length} courses (tombstoned/deleted skipped).`);
    }

    // Enrollments
    let enrollmentsQuery = supabase.from("enrollments").select("*");
    if (tenantId) enrollmentsQuery = enrollmentsQuery.eq("tenant_id", tenantId);
    const { data: onlineEnrollments } = await enrollmentsQuery;
    if (onlineEnrollments) {
      let pulled = 0;
      for (const e of onlineEnrollments as any[]) {
        if (deletedEnrollmentIds.has(e.id)) continue;
        if (e.deleted_at) continue;
        await db.enrollments.put(mapEnrollment(e));
        pulled++;
      }
      console.log(`✅ Pulled ${pulled}/${onlineEnrollments.length} enrollments (tombstoned/deleted skipped).`);
    }

    window.dispatchEvent(new Event("dataSynced"));
    console.log("✅ Manual Sync Down complete.");
  } catch (error) {
    console.error("❌ Sync Down failed:", error);
  }
}

// ==========================================
// 3. PUSH LOCAL DATA TO CLOUD
// ==========================================
export async function syncUp() {
  console.log("☁️ Starting Sync Up...");
  try {
    // ✅ Never push a tombstoned row back to the cloud
    const deletedUserIds = new Set(await getDeletedIds("user"));
    const deletedCourseIds = new Set(await getDeletedIds("course"));

    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u) => !(u as any).synced && !deletedUserIds.has(u.id));

    for (const user of usersToSync) {
      const userRecord = user as any;
      const payload = {
        id: user.id,
        username: user.username,
        email: userRecord.email || "",
        phone: userRecord.phone || "",
        password: userRecord.password, // Ensure your backend strips this if you don't actually store plain passwords in Supabase
        role: user.role,
        assigned_courses: userRecord.assignedCourses || [],
      };
      const { error } = await supabase.from("users").upsert(payload, { onConflict: "id" });
      if (!error) {
        await db.users.update(user.id, { synced: true } as any);
        console.log(`✅ Pushed user: ${user.username}`);
      } else {
        console.error(`Failed to push user ${user.username}:`, error.message);
      }
    }

    const localCourses = await db.courses.toArray();
    for (const course of localCourses) {
      const courseRecord = course as any;
      if (!courseRecord.synced && !deletedCourseIds.has(course.id)) {
        const { error } = await supabase
          .from("courses")
          .upsert(
            {
              id: course.id,
              name: course.name,
              description: courseRecord.description || "",
              logo: courseRecord.logo || null,
              tuition_type: courseRecord.tuitionType || "free",
              amount: parseFloat(String(courseRecord.amount || 0)) || 0,
              start_date: courseRecord.startDate || null,
              period: courseRecord.period || null,
            },
            { onConflict: "id" }
          );

        if (!error) {
          await db.courses.update(course.id, { synced: true } as any);
          console.log(`✅ Pushed course: ${course.name}`);
        } else {
           console.error(`Failed to push course ${course.name}:`, error.message);
        }
      }
    }

    window.dispatchEvent(new Event("dataSynced"));
    console.log("☁️ Sync Up complete.");
  } catch (error) {
    console.error("❌ Sync Up failed:", error);
  }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function mapUser(u: Record<string, unknown>) {
  return {
    id: u.id as string,
    username: u.username as string,
    email: (u.email as string) || "",
    phone: (u.phone as string) || "",
    password: (u.password as string) || "",
    role: (u.role as "admin" | "trainer" | "trainee") || "trainee",
    profilePic: (u.profile_pic as string) || "",
    assignedCourses: (u.assigned_courses as string[]) || [],
    tenantId: (u.tenant_id as string) || "", // preserve tenant on mirrored rows
    createdAt: (u.created_at as string) || new Date().toISOString(),
    synced: true,
  };
}

// FIXED: Added missing fields to match CourseManagement expectations
function mapCourse(c: Record<string, unknown>) {
  return {
    id: c.id as string,
    name: (c.name as string) || "",
    description: (c.description as string) || "",
    tuitionType: (c.tuition_type as "free" | "paid") || "free",
    amount: (c.amount as number) || 0,
    startDate: (c.start_date as string) || "",
    period: (c.period as string) || "",
    logo: (c.logo as string) || "",
    mediaUrl: (c.logo as string) || "", // Mirror logo to mediaUrl for UI consistency
    mediaType: "image" as const,
    mediaName: "course-logo",
    trainerId: (c.trainer_id as string) || "",
    tenantId: (c.tenant_id as string) || "",
    createdAt: (c.created_at as string) || new Date().toISOString(),
    synced: true,
  };
}

function mapEnrollment(e: Record<string, unknown>) {
  return {
    id: e.id as string,
    userId: (e.user_id as string) || "",
    courseId: (e.course_id as string) || "",
    role: (e.role as "trainer" | "trainee") || "trainee",
    tenantId: (e.tenant_id as string) || "",
    enrolledAt: (e.enrolled_at as string) || (e.created_at as string) || new Date().toISOString(),
    createdAt: (e.enrolled_at as string) || (e.created_at as string) || new Date().toISOString(),
    synced: true,
  };
}
