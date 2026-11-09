// src/database/supabaseCourseSync.ts
// ─────────────────────────────────────────────────────────────────────────────
// LOW-LEVEL Supabase operations for the `course_materials` table (v1, kept
// verbatim) plus EXACTLY-TYPED cross-domain sync helpers (v3) for courses,
// assignments, assignment fields, submissions, schedules and users.
//
// This module is the ONLY place that talks to Supabase.
// Components must go through src/database/materialDB.ts for materials,
// which wraps these primitives together with the local Dexie store.
//
// v3 replaces the v2 permissive (...args: unknown[]) helpers: the five
// caller files (assignmentDb / courseDB / deletedIdsTracker / scheduleDB /
// trainerDB) are now known, so every helper has an exact signature and the
// failure semantics those callers were written around:
//
//   • courses / assignments / assignment fields / submissions / users:
//       PUSH and DELETE **throw** on failure. Every caller wraps these in
//       try/catch (or .catch) — trainerDB relies on the throw to keep
//       `synced: false`, and courseDB/trainerDB rely on it to keep the
//       deletion tombstone alive; a silent SyncResult would resurrect
//       deleted rows on the next pull.
//   • schedules: scheduleDB calls push/delete FIRE-AND-FORGET (no await,
//       no catch) — these two NEVER reject; failures are logged instead.
//   • deletes of courses / assignments / users are VERIFIED: the row is
//       selected before and re-selected after the delete; a row still
//       visible afterwards throws (RLS-filtered no-op), per trainerDB's
//       documented contract.
//   • cloud-side cascades mirror the local ones (child rows first, every
//       step best-effort so a missing/renamed child table cannot abort).
//   • pushes map local camelCase keys to the cloud's snake_case columns
//       (verified convention: course_materials uses tenant_id / course_id /
//       uploaded_at / ...). Columns the cloud does not have are dropped
//       automatically: PostgREST's PGRST204 "Could not find the 'x' column"
//       reply triggers one retry without that column, and the column is
//       remembered so later pushes stay single-request.
//
// Payload shape for materials matches the live table exactly:
//   id, tenant_id, course_id, title, description, file_data, file_name,
//   file_type, uploaded_by, uploaded_at, presentation_order, synced,
//   file_url, allow_download, is_presentation, updated_at
// (created_at is defaulted by Postgres and is never written.)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from "../auth/supabase";
import { db } from "./db";
import type {
  Assignment,
  AssignmentField,
  AssignmentSubmission,
  Course,
  CourseMaterial,
  Schedule,
  User,
} from "../types";

export interface SyncResult {
  ok: boolean;
  error?: string;
}

const TABLE = "course_materials";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return !!value && UUID_RE.test(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

// Explicit field-by-field mapping — never spread the material object, so
// local-only bookkeeping flags (e.g. pendingSync) can never leak into a row.
function toRow(material: CourseMaterial, tenantId: string) {
  const url = material.fileUrl ?? "";
  return {
    id: material.id,
    tenant_id: tenantId,
    course_id: material.courseId,
    title: material.title || "Untitled",
    description: material.description ?? "",
    // file_data holds whatever the app uses to render the file:
    // a Storage signed URL, a data URL (small offline fallback) or legacy base64.
    file_data: url,
    // mirrored into file_url as well so either column can be used downstream
    file_url: url,
    file_name: material.fileName ?? null,
    file_type: material.fileType ?? null,
    // uploaded_by is nullable and has no FK — never let a legacy non-UUID
    // local user id fail the whole row
    uploaded_by: isUuid(material.uploadedBy) ? material.uploadedBy : null,
    uploaded_at: material.uploadedAt || nowIso(),
    presentation_order: typeof material.presentationOrder === "number" ? material.presentationOrder : 0,
    allow_download: material.allowDownload ?? true,
    is_presentation: false,
    synced: true,
    updated_at: nowIso(),
  };
}

export function mapMaterialRow(m: any): CourseMaterial {
  return {
    id: m.id,
    courseId: m.course_id,
    title: m.title ?? "Untitled",
    description: m.description ?? "",
    fileUrl: m.file_data || m.file_url || "",
    fileName: m.file_name ?? "",
    fileType: m.file_type ?? "",
    allowDownload: m.allow_download ?? true,
    uploadedBy: m.uploaded_by ?? "",
    uploadedAt: m.uploaded_at || m.created_at || "",
    presentationOrder: m.presentation_order ?? 0,
  };
}

/** Insert or update one material row. Never throws — returns a SyncResult. */
export async function pushMaterialToSupabase(material: CourseMaterial, tenantId: string): Promise<SyncResult> {
  try {
    if (!isUuid(material.id)) {
      return { ok: false, error: `Material id "${material.id}" is not a valid UUID` };
    }
    if (!isUuid(tenantId)) {
      return { ok: false, error: "Session has no valid business (tenant) id — please log out and back in" };
    }
    if (!isUuid(material.courseId)) {
      return { ok: false, error: "Course id is not a valid UUID — this course cannot sync to the cloud" };
    }
    const { error } = await supabase.from(TABLE).upsert(toRow(material, tenantId));
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error while syncing material" };
  }
}

/** Insert or update many material rows in ONE batched request (used for reorder). */
export async function pushMaterialsToSupabase(list: CourseMaterial[], tenantId: string): Promise<SyncResult> {
  try {
    if (!isUuid(tenantId)) {
      return { ok: false, error: "Session has no valid business (tenant) id — please log out and back in" };
    }
    const rows: ReturnType<typeof toRow>[] = [];
    const skipped: string[] = [];
    for (const material of list) {
      if (!isUuid(material.id) || !isUuid(material.courseId)) {
        skipped.push(material.title || material.id);
        continue;
      }
      rows.push(toRow(material, tenantId));
    }
    if (rows.length === 0) {
      return skipped.length > 0
        ? { ok: false, error: `Cannot sync: ${skipped.length} item(s) have legacy ids that cannot be stored in the cloud` }
        : { ok: true };
    }
    const { error } = await supabase.from(TABLE).upsert(rows);
    if (error) return { ok: false, error: error.message };
    if (skipped.length > 0) {
      console.warn(`[materials] ${skipped.length} item(s) skipped in cloud sync (legacy ids):`, skipped);
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error while syncing materials" };
  }
}

/** Delete one row. A non-UUID id can never exist in the cloud → nothing to do. */
export async function deleteMaterialFromSupabase(id: string, tenantId: string): Promise<SyncResult> {
  try {
    if (!isUuid(id)) {
      console.info(`[materials] Local-only material "${id}" (non-UUID) — nothing to delete in the cloud`);
      return { ok: true };
    }
    if (!isUuid(tenantId)) {
      return { ok: false, error: "Session has no valid business (tenant) id — please log out and back in" };
    }
    const { error } = await supabase.from(TABLE).delete().eq("id", id).eq("tenant_id", tenantId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Network error while deleting material" };
  }
}

/**
 * Fetch all materials of one course. Returns null when the fetch failed
 * (offline / RLS / network) so callers can fall back to the local store.
 */
export async function fetchCourseMaterialsFromSupabase(
  courseId: string,
  tenantId: string
): Promise<CourseMaterial[] | null> {
  try {
    if (!isUuid(tenantId) || !isUuid(courseId)) {
      console.warn("[materials] Skipping cloud fetch — tenant or course id is not a UUID");
      return null;
    }
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId)
      .order("presentation_order", { ascending: true })
      .order("uploaded_at", { ascending: true });
    if (error) {
      console.warn("[materials] Cloud fetch failed:", error.message);
      return null;
    }
    return (data ?? []).map(mapMaterialRow);
  } catch (e: any) {
    console.warn("[materials] Cloud fetch threw:", e?.message || e);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// v3 — CROSS-DOMAIN SYNC HELPERS, exact signatures for the five caller files
// ═════════════════════════════════════════════════════════════════════════════
//   assignmentDb.ts   → push/delete Assignment, push/delete AssignmentFields,
//                       push Submission
//   courseDB.ts       → push/delete Course
//   deletedIdsTracker → dynamic import of delete Course / delete User
//   scheduleDB.ts     → push/delete Schedule (fire-and-forget, never reject)
//   trainerDB.ts      → push/delete User
//
// ⚠ TABLE NAMES are constants — edit here if your schema differs. Verified
//   against setup-course-materials.sql / setup-live-tables.sql: the cloud
//   schema uses snake_case (tenant_id, course_id, uploaded_at, ...) and
//   live_session is SINGULAR on purpose. "assignment_submissions" and
//   "chat_messages" follow the same convention — if a push fails with a
//   "relation does not exist" error, rename the constant below.
// ═════════════════════════════════════════════════════════════════════════════

type AnyRow = Record<string, unknown>;

const TABLE_COURSE = "courses";
const TABLE_ASSIGNMENT = "assignments";
const TABLE_ASSIGNMENT_FIELD = "assignment_fields";
const TABLE_SUBMISSION = "assignment_submissions";
const TABLE_SCHEDULE = "schedules";
const TABLE_USER = "users";
const TABLE_ENROLLMENTS = "enrollments";
const TABLE_CHAT = "chat_messages";
/** live_session is singular on purpose — exactly what the live-class code queries. */
const TABLE_LIVE_SESSION = "live_session";
const TABLE_LIVE_PRESENTATIONS = "live_presentations";

/** Column on assignment_fields / assignment_submissions linking to the assignment. */
const ASSIGNMENT_FK = "assignment_id";

/**
 * Per-table overrides for local keys whose cloud column is NOT their
 * snake_case. Empty by default — the generic mapping already covers
 * courseId → course_id, scheduledAt → scheduled_at, createdAt → created_at.
 * Example if your schema ever differs:  courses: { name: "course_name" },
 */
const FIELD_MAP_OVERRIDES: Record<string, Record<string, string>> = {};

/** Local-only bookkeeping flags that must never reach PostgREST. */
const LOCAL_ONLY_KEYS = new Set(["synced", "pendingSync", "pending_sync"]);

/** PostgREST PGRST204 — names the first column the cloud schema lacks. */
const UNKNOWN_COLUMN_RE = /Could not find the '([^']+)' column/;

/**
 * Columns already found missing in the cloud, as `${table}:${column}`.
 * Remembering them keeps every later push a single request.
 */
const droppedColumns = new Set<string>();

function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

/**
 * Build a PostgREST payload from a local entity:
 *  - camelCase keys → snake_case columns (with FIELD_MAP_OVERRIDES applied)
 *  - local-only flags, undefined values stripped; Dates → ISO strings
 *  - any *_id column carrying "" or a legacy non-UUID becomes null (a raw
 *    string would fail Postgres' uuid cast and abort the whole row)
 *  - the session tenant always wins as tenant_id
 */
function mapEntityToRow(entity: object, table: string, tenantId: string): AnyRow {
  const overrides = FIELD_MAP_OVERRIDES[table] ?? {};
  const row: AnyRow = {};
  for (const [key, value] of Object.entries(entity)) {
    if (LOCAL_ONLY_KEYS.has(key)) continue;
    if (value === undefined) continue;
    const col = overrides[key] ?? camelToSnake(key);
    if (droppedColumns.has(`${table}:${col}`)) continue;
    row[col] = value instanceof Date ? value.toISOString() : value;
  }
  for (const [col, value] of Object.entries(row)) {
    if (col === "tenant_id" || !col.endsWith("_id")) continue;
    if (typeof value === "string" && !isUuid(value)) {
      console.warn(`[sync] ${table}.${col}: "${value}" is not a UUID — storing null instead`);
      row[col] = null;
    }
  }
  row.tenant_id = tenantId;
  return row;
}

/**
 * Upsert (or insert) rows, tolerating schema drift: when PostgREST answers
 * "Could not find the 'x' column", drop x from the payload, remember it and
 * retry. Any other error throws.
 */
async function upsertAdaptive(table: string, rows: AnyRow[], label: string): Promise<void> {
  if (rows.length === 0) return;
  let payload = rows;
  for (let attempt = 0; attempt < 12; attempt++) {
    const hasId = payload.every((r) => typeof r.id === "string" && r.id.length > 0);
    const { error } = hasId
      ? await supabase.from(table).upsert(payload, { onConflict: "id" })
      : await supabase.from(table).insert(payload);
    if (!error) return;
    const match = UNKNOWN_COLUMN_RE.exec(error?.message ?? "");
    if (!match) throw new Error(`${label}: ${error.message}`);
    const col = match[1];
    droppedColumns.add(`${table}:${col}`);
    payload = payload.map((r) => {
      const c = { ...r };
      delete c[col];
      return c;
    });
    console.warn(
      `[sync] ${table}: cloud has no column "${col}" — dropped from the payload. ` +
        `Create the column, or add it to FIELD_MAP_OVERRIDES if the name differs.`
    );
    if (payload.length === 0 || Object.keys(payload[0] ?? {}).length <= 1) {
      throw new Error(`${label}: nothing left to store — check the ${table} schema`);
    }
  }
  throw new Error(`${label}: gave up after 12 schema-mismatch retries on ${table}`);
}

/** true/false when known; null when the check itself failed (offline/RLS). */
async function fetchRowExists(table: string, id: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.from(table).select("id").eq("id", id).limit(1);
    if (error) {
      console.warn(`[sync] ${table}: existence check for "${id}" failed: ${error.message}`);
      return null;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e: any) {
    console.warn(`[sync] ${table}: existence check for "${id}" threw: ${e?.message || e}`);
    return null;
  }
}

/**
 * Delete one row and VERIFY it is gone: select before, re-select after.
 * A row still visible after a successful delete call means RLS filtered the
 * delete (0-rows no-op) → throws, per trainerDB's documented contract.
 */
async function deleteRowVerified(table: string, id: string, tenantId: string | null, label: string): Promise<void> {
  if (!isUuid(id)) {
    console.info(`[sync] ${table} "${id}" is a local-only (non-UUID) record — nothing to delete in the cloud`);
    return;
  }
  const before = await fetchRowExists(table, id);
  if (before === false) {
    console.info(`[sync] ${table} "${id}" is not in the cloud (already deleted) — nothing to do`);
    return;
  }
  let query: any = supabase.from(table).delete().eq("id", id);
  if (tenantId) query = query.eq("tenant_id", tenantId);
  const { error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  if (before === true) {
    const stillThere = await fetchRowExists(table, id);
    if (stillThere === true) {
      throw new Error(
        `${label}: ${table} row "${id}" still exists after delete (RLS filtered it — check the table's DELETE policy)`
      );
    }
  }
}

/** Delete child rows matching a filter. NEVER throws — a missing/renamed
 *  child table is logged and skipped so the parent delete always proceeds. */
async function deleteChildrenBestEffort(
  table: string,
  match: Record<string, string>,
  label: string
): Promise<void> {
  try {
    let query: any = supabase.from(table).delete();
    for (const [k, v] of Object.entries(match)) query = query.eq(k, v);
    const { error } = await query;
    if (error) console.warn(`[sync] ${label}: could not clear ${table}: ${error.message}`);
  } catch (e: any) {
    console.warn(`[sync] ${label}: could not clear ${table}: ${e?.message || e}`);
  }
}

function tenantRequired(tenantId: string): void {
  if (!isUuid(tenantId)) {
    throw new Error("Session has no valid business (tenant) id — please log out and back in");
  }
}

// ── Courses ──────────────────────────────────────────────────────────────────

/** Upsert one course. THROWS on failure — courseDB catches and logs. */
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  tenantRequired(tenantId);
  if (!isUuid(course.id)) {
    throw new Error(`Course id "${course.id}" is not a valid UUID — this course cannot sync to the cloud`);
  }
  await upsertAdaptive(TABLE_COURSE, [mapEntityToRow(course, TABLE_COURSE, tenantId)], "pushCourseToSupabase");
}

/**
 * Verified cloud delete of one course, mirroring courseDB's local cascade:
 * assignments (→ their fields + submissions), course_materials, schedules,
 * enrollments, chat_messages, live_session, live_presentations — each child
 * step best-effort — then the course row itself (verified).
 * THROWS on failure so courseDB can keep the tombstone and retry later.
 */
export async function deleteCourseFromSupabase(id: string, tenantId: string): Promise<void> {
  const label = "deleteCourseFromSupabase";
  tenantRequired(tenantId);
  if (!isUuid(id)) {
    console.info(`[courses] Local-only course "${id}" (non-UUID) — nothing to delete in the cloud`);
    return;
  }
  // Assignment children hang off assignment_id (not course_id), so resolve
  // the course's assignment ids first; if this select fails, the bulk
  // deletes below still run.
  try {
    const { data, error } = await supabase.from(TABLE_ASSIGNMENT).select("id").eq("course_id", id);
    if (!error && Array.isArray(data)) {
      for (const row of data as AnyRow[]) {
        const aid = row.id;
        if (typeof aid !== "string") continue;
        await deleteChildrenBestEffort(TABLE_ASSIGNMENT_FIELD, { [ASSIGNMENT_FK]: aid }, label);
        await deleteChildrenBestEffort(TABLE_SUBMISSION, { [ASSIGNMENT_FK]: aid }, label);
      }
    }
  } catch (e: any) {
    console.warn(`[sync] ${label}: could not enumerate course assignments: ${e?.message || e}`);
  }
  await deleteChildrenBestEffort(TABLE_ASSIGNMENT, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE_SCHEDULE, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE_ENROLLMENTS, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE_CHAT, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE_LIVE_SESSION, { course_id: id }, label);
  await deleteChildrenBestEffort(TABLE_LIVE_PRESENTATIONS, { course_id: id }, label);
  await deleteRowVerified(TABLE_COURSE, id, tenantId, label);
}

// ── Assignments ──────────────────────────────────────────────────────────────

/** Upsert one assignment. THROWS on failure — assignmentDb marks it unsynced. */
export async function pushAssignmentToSupabase(assignment: Assignment, tenantId: string): Promise<void> {
  tenantRequired(tenantId);
  if (!isUuid(assignment.id)) {
    throw new Error(`Assignment id "${assignment.id}" is not a valid UUID — it cannot sync to the cloud`);
  }
  await upsertAdaptive(TABLE_ASSIGNMENT, [mapEntityToRow(assignment, TABLE_ASSIGNMENT, tenantId)], "pushAssignmentToSupabase");
}

/**
 * Verified cloud delete of one assignment: its fields + submissions are
 * cleared first (best-effort), then the assignment row (verified).
 * THROWS on failure so assignmentDb keeps the deletion tombstone.
 */
export async function deleteAssignmentFromSupabase(id: string, tenantId: string): Promise<void> {
  const label = "deleteAssignmentFromSupabase";
  tenantRequired(tenantId);
  if (!isUuid(id)) {
    console.info(`[assignments] Local-only assignment "${id}" (non-UUID) — nothing to delete in the cloud`);
    return;
  }
  await deleteChildrenBestEffort(TABLE_ASSIGNMENT_FIELD, { [ASSIGNMENT_FK]: id }, label);
  await deleteChildrenBestEffort(TABLE_SUBMISSION, { [ASSIGNMENT_FK]: id }, label);
  await deleteRowVerified(TABLE_ASSIGNMENT, id, tenantId, label);
}

// ── Assignment fields ────────────────────────────────────────────────────────

/**
 * Push the given assignment's fields (questions) from Dexie to the cloud.
 * Called by assignmentDb as (assignmentId, tenantId, [field.id]) — the field
 * rows are read back from Dexie (they were just saved there). Omitting
 * fieldIds pushes ALL fields of the assignment.
 * THROWS on failure — assignmentDb catches and logs.
 */
export async function pushAssignmentFieldsToSupabase(
  assignmentId: string,
  tenantId: string,
  fieldIds?: string[]
): Promise<void> {
  tenantRequired(tenantId);
  if (!isUuid(assignmentId)) {
    console.info(`[${TABLE_ASSIGNMENT_FIELD}] Local-only assignment "${assignmentId}" — skipping field sync`);
    return;
  }
  let fields: AssignmentField[] = await db.assignmentFields.where("assignmentId").equals(assignmentId).toArray();
  if (fieldIds && fieldIds.length > 0) {
    const wanted = new Set(fieldIds);
    fields = fields.filter((f) => wanted.has(f.id));
    const found = new Set(fields.map((f) => f.id));
    for (const fid of fieldIds) {
      if (!found.has(fid)) {
        console.warn(`[${TABLE_ASSIGNMENT_FIELD}] field "${fid}" was requested but not found locally — skipped`);
      }
    }
  }
  if (fields.length === 0) return;
  const rows = fields.map((f) => {
    const row = mapEntityToRow(f, TABLE_ASSIGNMENT_FIELD, tenantId);
    row[ASSIGNMENT_FK] = assignmentId;
    return row;
  });
  await upsertAdaptive(TABLE_ASSIGNMENT_FIELD, rows, "pushAssignmentFieldsToSupabase");
}

/**
 * Delete every cloud field row of one assignment.
 * THROWS on failure — assignmentDb catches and logs.
 */
export async function deleteAssignmentFieldsFromSupabase(assignmentId: string): Promise<void> {
  if (!isUuid(assignmentId)) {
    console.info(`[${TABLE_ASSIGNMENT_FIELD}] Local-only assignment "${assignmentId}" — nothing to delete in the cloud`);
    return;
  }
  const { error } = await supabase.from(TABLE_ASSIGNMENT_FIELD).delete().eq(ASSIGNMENT_FK, assignmentId);
  if (error) throw new Error(`deleteAssignmentFieldsFromSupabase: ${error.message}`);
}

// ── Submissions ──────────────────────────────────────────────────────────────

/** Upsert one submission. THROWS on failure — assignmentDb catches and logs. */
export async function pushSubmissionToSupabase(submission: AssignmentSubmission, tenantId: string): Promise<void> {
  tenantRequired(tenantId);
  if (!isUuid(submission.id)) {
    throw new Error(`Submission id "${submission.id}" is not a valid UUID — it cannot sync to the cloud`);
  }
  await upsertAdaptive(TABLE_SUBMISSION, [mapEntityToRow(submission, TABLE_SUBMISSION, tenantId)], "pushSubmissionToSupabase");
}

// ── Schedules ────────────────────────────────────────────────────────────────

/**
 * Upsert one schedule. scheduleDB calls this FIRE-AND-FORGET (no await, no
 * catch) — it therefore NEVER rejects; failures are logged only.
 */
export async function pushScheduleToSupabase(schedule: Schedule, tenantId: string): Promise<void> {
  try {
    if (!isUuid(tenantId)) {
      console.warn("[schedules] No valid business (tenant) id — schedule kept local only");
      return;
    }
    if (!isUuid(schedule.id)) {
      console.warn(`[schedules] Schedule id "${schedule.id}" is not a UUID — kept local only`);
      return;
    }
    await upsertAdaptive(TABLE_SCHEDULE, [mapEntityToRow(schedule, TABLE_SCHEDULE, tenantId)], "pushScheduleToSupabase");
  } catch (e: any) {
    console.warn("[schedules] Cloud sync failed (local copy kept):", e?.message || e);
  }
}

/**
 * Delete one schedule from the cloud. Fire-and-forget caller → NEVER
 * rejects. (No verification here — the caller passes no tenantId; RLS
 * scopes the delete by session.)
 */
export async function deleteScheduleFromSupabase(scheduleId: string): Promise<void> {
  try {
    if (!isUuid(scheduleId)) {
      console.info(`[schedules] Local-only schedule "${scheduleId}" (non-UUID) — nothing to delete in the cloud`);
      return;
    }
    const { error } = await supabase.from(TABLE_SCHEDULE).delete().eq("id", scheduleId);
    if (error) console.warn(`[schedules] Cloud delete failed: ${error.message}`);
  } catch (e: any) {
    console.warn("[schedules] Cloud delete failed:", e?.message || e);
  }
}

// ── Users / trainers ─────────────────────────────────────────────────────────

/** Upsert one user. THROWS on failure — trainerDB relies on it to keep `synced: false`. */
export async function pushUserToSupabase(user: User, tenantId: string): Promise<void> {
  tenantRequired(tenantId);
  if (!isUuid(user.id)) {
    throw new Error(`User id "${user.id}" is not a valid UUID — this user cannot sync to the cloud`);
  }
  await upsertAdaptive(TABLE_USER, [mapEntityToRow(user, TABLE_USER, tenantId)], "pushUserToSupabase");
}

/**
 * Verified cloud delete of one user, mirroring trainerDB's local cascade:
 * enrollments, submissions, chat_messages, schedules (trainer_id) — each
 * best-effort — then the user row (verified). Per trainerDB's contract a
 * 0-rows RLS no-op MUST throw, so the tombstone survives and
 * retryFailedCloudDeletes re-runs the delete later.
 */
export async function deleteUserFromSupabase(id: string, tenantId: string): Promise<void> {
  const label = "deleteUserFromSupabase";
  tenantRequired(tenantId);
  if (!isUuid(id)) {
    console.info(`[users] Local-only user "${id}" (non-UUID) — nothing to delete in the cloud`);
    return;
  }
  await deleteChildrenBestEffort(TABLE_ENROLLMENTS, { user_id: id }, label);
  await deleteChildrenBestEffort(TABLE_SUBMISSION, { user_id: id }, label);
  await deleteChildrenBestEffort(TABLE_CHAT, { user_id: id }, label);
  await deleteChildrenBestEffort(TABLE_SCHEDULE, { trainer_id: id }, label);
  await deleteRowVerified(TABLE_USER, id, tenantId, label);
}
