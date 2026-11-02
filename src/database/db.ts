import Dexie, { type Table } from "dexie";
import type {
  User, Course, CourseMaterial, Enrollment, LiveSession,
  LivePresentation, ChatMessage, BusinessSettings,
  Assignment, AssignmentField, AssignmentSubmission, Schedule
} from "../types";
import type { Tombstone } from "./deletedIdsTracker";

// Single source of truth for Tombstone lives in ./deletedIdsTracker.
// Re-exported here so existing `import { Tombstone } from "./db"` keeps working.
export type { Tombstone };

export interface ActiveAttendance { userId: string; courseId: string; }
export interface RaisedHand { userId: string; courseId: string; username: string; timestamp: number; }

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
  fields?: any[];
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
  tombstones!: Table<Tombstone, string>;

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
        if (!log.phone && log.to) { log.phone = log.to; delete log.to; }
        if (!log.phone) log.phone = "unknown";
        if (typeof log.id !== "string" || !/^[0-9a-f]{8}-/i.test(String(log.id))) { log.synced = true; }
        else if (log.synced === undefined) { log.synced = true; }
      });
    });

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

    this.version(19).stores({
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
      formCache: "id, tenant_id, status",
      tombstones: "id, entityType, entityId, tenantId, cloudDeleteStatus"
    });

    // v20 — Tombstones aligned with deletedIdsTracker.ts:
    // new shape { status, errorMessage, createdAt, updatedAt } and a `status`
    // index (retryFailedCloudDeletes() queries .where("status") — without this
    // index that query throws SchemaError at runtime). Migrates legacy rows
    // written with the old { markedAt, cloudDeleteStatus, cloudDeleteError,
    // retryCount, lastRetryAt } shape, normalizes ids to `entityType:entityId`,
    // and drops duplicate tombstones for the same entity.
    this.version(20).stores({
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
      formCache: "id, tenant_id, status",
      tombstones: "id, entityType, entityId, tenantId, status"
    }).upgrade(async (tx) => {
      const table = tx.table("tombstones");
      const rows: any[] = await table.toCollection().toArray();
      const now = new Date().toISOString();

      // Prefer the new `status` field (rows may have been written by the new
      // tracker under the v19 schema during dev), fall back to the legacy
      // cloudDeleteStatus, and treat unknown legacy values as confirmed so we
      // never mass-retry old deletions.
      const toStatus = (row: any): "pending" | "failed" | "confirmed" => {
        if (row.status === "pending" || row.status === "failed" || row.status === "confirmed") return row.status;
        const legacy = row.cloudDeleteStatus;
        if (legacy === "pending") return "pending";
        if (legacy === "failed" || legacy === "error" || legacy === "fail") return "failed";
        return "confirmed";
      };

      const seen = new Set<string>();
      for (const row of rows) {
        // Primary keys are immutable in Dexie — delete the legacy row, then
        // re-add it under the canonical `${entityType}:${entityId}` id.
        await table.delete(row.id);

        if (!row.entityType || !row.entityId) continue; // drop malformed entries

        const id = `${row.entityType}:${row.entityId}`;
        if (seen.has(id)) continue; // dedupe legacy rows for the same entity
        seen.add(id);

        const migrated: any = {
          id,
          entityType: row.entityType,
          entityId: row.entityId,
          tenantId: row.tenantId ?? "",
          status: toStatus(row),
          createdAt: row.createdAt || row.markedAt || now,
          updatedAt: row.updatedAt || row.lastRetryAt || row.markedAt || now,
        };
        const errMsg = row.errorMessage || row.cloudDeleteError;
        if (errMsg) migrated.errorMessage = errMsg;

        await table.add(migrated);
      }
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