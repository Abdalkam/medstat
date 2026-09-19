import { db } from "./db";
import type { Schedule } from "../types";
import { pushScheduleToSupabase, deleteScheduleFromSupabase } from "./supabaseCourseSync";

export async function createSchedule(schedule: Schedule): Promise<void> {
  await db.schedules.add(schedule);
  // ✅ FIX: Changed "authUser" to "currentUser"
  const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
  if (user.tenantId) pushScheduleToSupabase(schedule, user.tenantId);
}

export async function getSchedulesByCourse(courseId: string): Promise<Schedule[]> {
  const schedules = await db.schedules.where("courseId").equals(courseId).toArray();
  return schedules.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
}

export async function deleteSchedule(scheduleId: string): Promise<void> {
  await db.schedules.delete(scheduleId);
  deleteScheduleFromSupabase(scheduleId);
}