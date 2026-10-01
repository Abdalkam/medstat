import Dexie, { type Table } from "dexie";
import type {
  User, Course, CourseMaterial, Enrollment, LiveSession,
  LivePresentation, ChatMessage, BusinessSettings,
  Assignment, AssignmentField, AssignmentSubmission, Schedule
} from "../types";

export interface ActiveAttendance { userId: string; courseId: string; }
export interface RaisedHand { userId: string; courseId: string; username: string; timestamp: number; }

// SMS log — single source of truth (imported by database/smsLogDB.ts).
// tenant_id / sent_by are optional: offline-created or legacy rows may not have them.
// synced === false means the row hasn't reached Supabase yet (queued for silent retry).
export interface SmsLog {
  id: string;
  tenant_id?: string | null;
  phone: string;
  message: string;
  status: string;
  sent_by?: string | null;
  sentAt: string;
  synced?: boolean;
}
export interface AllowedSpeaker { userId: string; allowed: boolean; }

// Form cache — offline-first copy of admin forms (imported by database/formDB.ts).
// Each row holds the form plus its full field list so the builder and user filler
// work with zero network. synced === false means cloud writes are still queued.
export interface FormCache {
  id: string;
  tenant_id: string;
  title: string;
  description?: string | null;
  status: string;
  allow_download?: boolean;
  allow_multiple_submissions?: boolean;
  visible_to?: string[] | null;
  updated_at: string;
  fields?: any[];          // full field list for this form (offline fill support)
  synced?: boolean;
}

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
  formCache!: Table<FormCache, string>;

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
      smsLogs: "++id,to,sentAt", // Old schema (upgraded in v16+)
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
      smsLogs: "++id,to,sentAt", // Old schema (upgraded in v16+)
      allowedSpeakers: "userId"
    });

    // VERSION 16: Fix smsLogs schema to use UUID ids and correct columns
    this.version(16).stores({
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
      smsLogs: "id,tenant_id,phone,status,sentAt",
      allowedSpeakers: "userId"
    });

    // VERSION 17: Migrate legacy smsLogs rows to the new shape.
    //  - old "to" column → "phone"
    //  - legacy rows keep their history but are marked synced (they predate the
    //    cloud table and have numeric ids, so they're device-local only)
    this.version(17).stores({
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
      smsLogs: "id,tenant_id,phone,status,sentAt",
      allowedSpeakers: "userId"
    }).upgrade(async (tx) => {
      await tx.table("smsLogs").toCollection().modify((log: any) => {
        // Old schema used "to" for the recipient
        if (!log.phone && log.to) {
          log.phone = log.to;
          delete log.to;
        }
        if (!log.phone) log.phone = "unknown";
        // Legacy rows have numeric/auto ids and no cloud counterpart —
        // mark them synced so the background push never chokes on them.
        if (typeof log.id !== "string" || !/^[0-9a-f]{8}-/i.test(String(log.id))) {
          log.synced = true;
        } else if (log.synced === undefined) {
          log.synced = true;
        }
      });
    });

    // VERSION 18: Forms offline cache — each row stores a form plus its full
    // field list so the admin builder, forms list, and user filler all work
    // with zero network. No migration needed: brand-new table.
    this.version(18).stores({
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
      smsLogs: "id,tenant_id,phone,status,sentAt",
      allowedSpeakers: "userId",
      formCache: "id, tenant_id, status"
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