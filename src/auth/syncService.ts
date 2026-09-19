// src/auth/syncService.ts
import { supabase } from "./supabase";
import { db } from "../database/db";
import type { RealtimeChannel } from "@supabase/supabase-js";

let activeChannels: RealtimeChannel[] = [];

// ==========================================
// 1. INSTANT REALTIME SYNC
// ==========================================
export function enableRealtimeSync() {
  console.log("📡 Enabling Realtime Sync...");
  setupUserRealtime();
  setupCourseRealtime();
  setupEnrollmentRealtime();
}

function setupUserRealtime() {
  const channel = supabase
    .channel("users-realtime")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "users" }, async (payload: { new: Record<string, unknown> }) => {
      console.log("📥 Realtime User received:", payload.new);
      const localData = mapUser(payload.new);
      await db.users.put(localData);
      // Trigger UI refresh if needed
      window.dispatchEvent(new Event("userChanged"));
    })
    .subscribe();
  activeChannels.push(channel);
}

function setupCourseRealtime() {
  const channel = supabase
    .channel("courses-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "courses" }, async (payload) => {
      console.log("📥 Realtime Course event:", payload.eventType);
      
      if (payload.eventType === "DELETE") {
        await db.courses.delete((payload as any).old.id);
      } else {
        const localData = mapCourse((payload as any).new);
        await db.courses.put(localData);
      }
      
      // Trigger UI refresh for course components
      window.dispatchEvent(new Event("coursesChanged"));
    })
    .subscribe();
  activeChannels.push(channel);
}

function setupEnrollmentRealtime() {
  const channel = supabase
    .channel("enrollments-realtime")
    .on("postgres_changes", { event: "*", schema: "public", table: "enrollments" }, async (payload) => {
      console.log("📥 Realtime Enrollment event:", payload.eventType);
      
      if (payload.eventType === "DELETE") {
        await db.enrollments.delete((payload as any).old.id);
      } else {
        const localData = mapEnrollment((payload as any).new);
        await db.enrollments.put(localData);
      }
      
      window.dispatchEvent(new Event("enrollmentsChanged"));
    })
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
    const { data: onlineUsers } = await supabase.from("users").select("*");
    if (onlineUsers) {
      for (const u of onlineUsers) await db.users.put(mapUser(u as unknown as Record<string, unknown>));
      console.log(`✅ Pulled ${onlineUsers.length} users.`);
    }

    const { data: onlineCourses } = await supabase.from("courses").select("*");
    if (onlineCourses) {
      for (const c of onlineCourses) await db.courses.put(mapCourse(c as unknown as Record<string, unknown>));
      console.log(`✅ Pulled ${onlineCourses.length} courses.`);
    }

    const { data: onlineEnrollments } = await supabase.from("enrollments").select("*");
    if (onlineEnrollments) {
      for (const e of onlineEnrollments) await db.enrollments.put(mapEnrollment(e as unknown as Record<string, unknown>));
      console.log(`✅ Pulled ${onlineEnrollments.length} enrollments.`);
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
    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u) => !(u as any).synced);

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
      if (!courseRecord.synced) {
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
    enrolledAt: (e.enrolled_at as string) || (e.created_at as string) || new Date().toISOString(),
    createdAt: (e.enrolled_at as string) || (e.created_at as string) || new Date().toISOString(),
    synced: true,
  };
}