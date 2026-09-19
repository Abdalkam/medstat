import Dexie, { type Table } from "dexie";
import type {
  User, Course, CourseMaterial, Enrollment, LiveSession,
  LivePresentation, ChatMessage, BusinessSettings,
  Assignment, AssignmentField, AssignmentSubmission, Schedule
} from "../types";

export interface ActiveAttendance { userId: string; courseId: string; }
export interface RaisedHand { userId: string; courseId: string; username: string; timestamp: number; }
export interface SmsLog { id?: string; to: string; message: string; sentAt: Date; }
export interface AllowedSpeaker { userId: string; allowed: boolean; }

export async function generateConsistentId(prefix: string, uniqueString: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(uniqueString.toLowerCase().trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hashHex.substring(0, 16)}`;
}

export class MedstatDatabase extends Dexie {
  users!: Table<User, string>;
  courses!: Table<Course, string>;
  materials!: Table<CourseMaterial, string>;
  enrollments!: Table<Enrollment, string>;
  liveSessions!: Table<LiveSession, string>;
  livePresentations!: Table<LivePresentation, string>;
  chatMessages!: Table<ChatMessage, string>;
  settings!: Table<BusinessSettings, string>;
  activeAttendances!: Table<ActiveAttendance, string>;
  raisedHands!: Table<RaisedHand, string>;
  assignments!: Table<Assignment, string>;
  assignmentFields!: Table<AssignmentField, string>;
  assignmentSubmissions!: Table<AssignmentSubmission, string>;
  schedules!: Table<Schedule, string>;
  smsLogs!: Table<SmsLog, string>;
  allowedSpeakers!: Table<AllowedSpeaker, string>;

  constructor() {
    super("medstat");

    this.version(14).stores({
      users: "id,email,username,role,createdAt,synced",
      courses: "id,name,createdAt",
      materials: "id,courseId,title,fileType,presentationOrder,createdAt",
      enrollments: "id,courseId,userId,[userId+courseId],createdAt",
      liveSessions: "id,courseId,trainerId,active,createdAt",
      livePresentations: "id,courseId,materialId",
      chatMessages: "id,courseId,userId,createdAt",
      settings: "id",
      activeAttendances: "userId,courseId,[userId+courseId]",
      raisedHands: "userId,courseId,[userId+courseId]",
      assignments: "id,courseId,trainerId",
      assignmentFields: "id,assignmentId,type",
      assignmentSubmissions: "id,assignmentId,userId",
      schedules: "id,courseId,trainerId,scheduledAt",
      smsLogs: "++id,to,sentAt",
      allowedSpeakers: "userId"
    });

    this.version(15).stores({
      users: "id,tenantId,email,username,role,createdAt,synced",
      courses: "id,tenantId,name,createdAt",
      materials: "id,courseId,title,fileType,presentationOrder,createdAt",
      enrollments: "id,tenantId,courseId,userId,[userId+courseId],createdAt",
      liveSessions: "id,courseId,trainerId,active,createdAt",
      livePresentations: "id,courseId,materialId",
      chatMessages: "id,courseId,userId,createdAt",
      settings: "id,tenantId",
      activeAttendances: "userId,courseId,[userId+courseId]",
      raisedHands: "userId,courseId,[userId+courseId]",
      assignments: "id,tenantId,courseId,trainerId",
      assignmentFields: "id,assignmentId,type",
      assignmentSubmissions: "id,assignmentId,userId",
      schedules: "id,tenantId,courseId,trainerId,scheduledAt",
      smsLogs: "++id,to,sentAt",
      allowedSpeakers: "userId"
    });

    this.users.hook('creating', (_primKey, obj, _transaction) => {
      if (!obj.createdAt) obj.createdAt = new Date().toISOString();
      if (!obj.assignedCourses) obj.assignedCourses = [];
      if (obj.synced === undefined) obj.synced = false;
    });

    this.courses.hook('creating', (_primKey, obj, _transaction) => {
      if (!obj.createdAt) obj.createdAt = new Date().toISOString();
    });
  }
}

export const db = new MedstatDatabase();

db.open().catch(async (err) => {
  console.error("Database failed to open, clearing and rebuilding...", err);
  await Dexie.delete("medstat");
  window.location.reload();
});