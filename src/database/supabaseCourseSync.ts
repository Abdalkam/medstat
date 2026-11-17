/* ================================================================
   src/database/supabaseCourseSync.ts — v3: schema-exact courses +
   doc-store course-content sync
   ================================================================
   WHAT CHANGED IN v3 (P1 fix from the integration audit):

   public.courses is a REAL relational table — AssignCourses pulls it with
   .select("*") and maps name, tuition_type, amount, start_date, logo, and
   filters .is("deleted_at", null). v2/v2.1 pushed courses through the
   doc-store jsonb shape ({ id, tenant_id, course_id, assignment_id, data }),
   which on a relational table fails with PGRST204 "Could not find the
   column" — and because courseDB catches push failures, every course push
   silently died and courses never reached the cloud.

   • Courses are now SCHEMA-EXACT, mirroring how supabaseUserSync treats
     public.users: an explicit column whitelist, camelCase fields mapped to
     the snake_case DDL columns, UUID/tenant/username-style validation up
     front. Adjust COURSE payload columns to your DDL if they differ —
     PostgREST names the offending column in the error either way.
   • deleteCourseFromSupabase is now a count-verified SOFT delete
     (deleted_at = now). A hard delete could never propagate: every device
     only ever UPSERTS on pull, so a vanished row left all other devices
     holding the course forever. Soft-deleted rows flow through the
     existing is:deleted_at:null pull filter instead, exactly like users.
   • deleteScheduleFromSupabase / deleteAssignmentFieldsFromSupabase accept
     an optional tenantId and scope the delete when given (backward
     compatible — existing single-argument call sites keep compiling).
   • No-row cloud deletes THROW (same verify-or-throw contract as
     deleteUserRowFromSupabase); courseDB.deleteCourse guards the legitimate
     never-synced case by checking the local synced flag first.

   UNCHANGED from v2/v2.1 — the doc-store pattern still drives
   assignments / assignment_fields / assignment_submissions /
   course_materials / schedules (jsonb `data` column + real id/tenant_id/
   course_id/assignment_id columns), the self-contained lazy Supabase
   client, and the per-table failure styles:
     course/assignment/submission → THROW on failure (callers use try/catch)
     materials                    → return SyncResult (materialDB reads res.ok)
     fetchCourseMaterials         → return null on failure (materialDB keeps local)
     schedules                    → log only, never throw (scheduleDB has no catch)

   Exports (all 15 members courseDB/assignmentDB/materialDB/scheduleDB use):
     • courseDB.ts      → pushCourseToSupabase, deleteCourseFromSupabase
     • assignmentDB.ts  → pushAssignmentToSupabase, deleteAssignmentFromSupabase,
                          pushAssignmentFieldsToSupabase,
                          deleteAssignmentFieldsFromSupabase, pushSubmissionToSupabase
     • materialDB.ts    → pushMaterialToSupabase, pushMaterialsToSupabase,
                          deleteMaterialFromSupabase, fetchCourseMaterialsFromSupabase,
                          isUuid, SyncResult
     • scheduleDB.ts    → pushScheduleToSupabase, deleteScheduleFromSupabase

   CREDENTIALS (unchanged from v2): the client builds lazily on the first
   sync call, resolving in this order:
     ① process.env      → CRA: REACT_APP_SUPABASE_URL + …ANON_KEY
                          Expo: EXPO_PUBLIC_…, Next: NEXT_PUBLIC_…
     ② import.meta.env  → Vite: VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
     ③ SUPABASE_URL_FALLBACK + SUPABASE_ANON_KEY_FALLBACK below —
       fill these two ONLY if ① and ② come up empty: paste the same
       project URL + anon key your login/user-sync code already uses.
   Until credentials are found the app still boots fine — only sync
   calls fail, each with an error message telling you what to set.
   Running next to any other client in this file is safe: supabase-js
   v2 stores the login session under the same localStorage key for the
   same project URL, so all clients of one project share the user.
   ================================================================ */

import type {
  Assignment,
  AssignmentField,
  AssignmentSubmission,
  Course,
  CourseMaterial,
  Schedule,
} from "../types";

// Namespace import on purpose: it can never collide with the named imports
// (createClient, SupabaseClient, …) that the rest of this file may already use.
import * as SupabaseJS from "@supabase/supabase-js";

/* ── 1. Result type + UUID helper ──────────────────────────────────────────── */

export interface SyncResult {
  ok: boolean;
  error?: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when id looks like a UUID. PostgREST rejects non-UUID ids on uuid
 *  columns with SQLSTATE 22P02, so the push helpers refuse them up front. */
export function isUuid(id: string): boolean {
  return UUID_RE.test(id);
}

/* ── 2. Table names — ADAPT to your Supabase schema if they differ ────────── */

const T = {
  courses: "courses",
  assignments: "assignments",
  assignmentFields: "assignment_fields",
  submissions: "assignment_submissions",
  materials: "course_materials",
  schedules: "schedules",
} as const;

type SyncTable = (typeof T)[keyof typeof T];

/* ── 3. Supabase client — self-contained ──────────────────────────────────── */

/** ③ Fallback credentials — fill ONLY if no env var is found (see header). */
const SUPABASE_URL_FALLBACK = ""; // e.g. "https://abcdefghijk.supabase.co"
const SUPABASE_ANON_KEY_FALLBACK = ""; // e.g. "eyJhbGciOiJIUzI1NiIsInR5cCI6…"

// Module-scoped declaration so `process.env` type-checks even in projects
// without @types/node. It shadows the global `process` INSIDE THIS FILE ONLY.
declare const process: { env: Record<string, string | undefined> } | undefined;

type SbClient = SupabaseJS.SupabaseClient;

let cachedClient: SbClient | null = null;

function resolveCredentials(): { url: string; key: string } | null {
  // ① Node-style env (CRA / Expo / Next / Node scripts). The typeof guard
  //    keeps Vite browsers — where `process` doesn't exist — safe.
  if (typeof process !== "undefined" && process.env) {
    const e = process.env;
    const url =
      e.VITE_SUPABASE_URL ??
      e.NEXT_PUBLIC_SUPABASE_URL ??
      e.REACT_APP_SUPABASE_URL ??
      e.EXPO_PUBLIC_SUPABASE_URL;
    const key =
      e.VITE_SUPABASE_ANON_KEY ??
      e.VITE_SUPABASE_PUBLISHABLE_KEY ??
      e.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      e.REACT_APP_SUPABASE_ANON_KEY ??
      e.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    if (url && key) return { url, key };
  }
  // ② Vite env. `import.meta` needs "module": "esnext"/"bundler" in tsc —
  //    the @ts-ignore keeps other module configs compiling too.
  try {
    // @ts-ignore — import.meta requires module esnext/bundler
    const env = (import.meta as any)?.env as Record<string, string | undefined> | undefined;
    const url = env?.VITE_SUPABASE_URL;
    const key = env?.VITE_SUPABASE_ANON_KEY ?? env?.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (url && key) return { url, key };
  } catch {
    /* import.meta unavailable in this bundler — ignore */
  }
  // ③ Hardcoded fallbacks
  if (SUPABASE_URL_FALLBACK && SUPABASE_ANON_KEY_FALLBACK) {
    return { url: SUPABASE_URL_FALLBACK, key: SUPABASE_ANON_KEY_FALLBACK };
  }
  return null;
}

/** Lazy singleton — built on the FIRST sync call, not at import time, so a
 *  missing-credentials misconfig can never crash app startup. Throws a
 *  descriptive error that the push/delete helpers surface to their callers. */
function getClient(): SbClient {
  if (cachedClient) return cachedClient;
  const creds = resolveCredentials();
  if (!creds) {
    throw new Error(
      "[supabaseCourseSync] No Supabase credentials found. Set " +
        "VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (Vite), " +
        "REACT_APP_SUPABASE_URL + REACT_APP_SUPABASE_ANON_KEY (CRA), " +
        "EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY (Expo) — " +
        "or paste the URL + anon key your login code already uses into " +
        "SUPABASE_URL_FALLBACK / SUPABASE_ANON_KEY_FALLBACK at the top of " +
        "section 3 in supabaseCourseSync.ts."
    );
  }
  cachedClient = SupabaseJS.createClient(creds.url, creds.key);
  return cachedClient;
}

/* ── 4. Generic doc-store helpers (assignments, fields, submissions,
        materials, schedules — NOT courses, see section 5) ─────────────────── */

/** Dexie-only bookkeeping keys that must never be written to the cloud. */
const LOCAL_ONLY_KEYS = new Set(["pendingSync", "synced"]);

/** Full local row → cloud payload. The row itself is stored in `data` (jsonb)
 *  so adding fields to your TS types never requires ALTER TABLE; id/tenant_id/
 *  course_id/assignment_id are real columns used for upserts and queries. */
function toPayload(_table: SyncTable, row: any, tenantId: string) {
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    if (!LOCAL_ONLY_KEYS.has(k)) data[k] = v;
  }
  return {
    id: String(row.id),
    tenant_id: tenantId,
    course_id: row.courseId ?? null,
    assignment_id: row.assignmentId ?? null,
    data,
    updated_at: new Date().toISOString(),
  };
}

async function pushDoc(table: SyncTable, row: any, tenantId: string): Promise<SyncResult> {
  if (!tenantId) return { ok: false, error: "No tenant id" };
  if (!row?.id) return { ok: false, error: `[${table}] row has no id` };
  if (!isUuid(String(row.id))) {
    return { ok: false, error: `[${table}] non-UUID id "${row.id}" — migrate the local id first (see materialDB.ensureUuidId)` };
  }
  try {
    const client = getClient();
    const { error } = await client.from(table).upsert(toPayload(table, row, tenantId), {
      onConflict: "id",
    });
    if (error) return { ok: false, error: `[${table}] upsert: ${error.message}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `[${table}] upsert: ${e?.message ?? String(e)}` };
  }
}

async function deleteDoc(table: SyncTable, id: string, tenantId: string): Promise<SyncResult> {
  if (!tenantId) return { ok: false, error: "No tenant id" };
  // A non-UUID id can never exist in the cloud (uuid PK) → nothing to delete.
  if (!isUuid(id)) return { ok: true };
  try {
    const client = getClient();
    const { error } = await client
      .from(table)
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) return { ok: false, error: `[${table}] delete: ${error.message}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `[${table}] delete: ${e?.message ?? String(e)}` };
  }
}

/** For callers that use try/catch (courseDB, assignmentDB) — rejects on failure. */
async function pushDocOrThrow(table: SyncTable, row: any, tenantId: string): Promise<void> {
  const res = await pushDoc(table, row, tenantId);
  if (!res.ok) throw new Error(res.error);
}

/** For delete callers whose tombstone logic depends on rejection. */
async function deleteDocOrThrow(table: SyncTable, id: string, tenantId: string): Promise<void> {
  const res = await deleteDoc(table, id, tenantId);
  if (!res.ok) throw new Error(res.error);
}

/* ── 5. Courses — SCHEMA-EXACT (v3) ─────────────────────────────────────────
 * public.courses is relational: AssignCourses maps name, tuition_type,
 * amount, start_date, logo, tenant_id and filters deleted_at on pull.
 * The column list below mirrors that shape. ADAPT to your DDL: if your
 * table lacks an optional column (description / created_by / created_at),
 * delete that payload line — PGRST204 names any column you get wrong.     */

/** courseDB.addCourse/updateCourse call this via try/catch → REJECTS on
 *  failure. Local-only bookkeeping keys (synced, syncedAt, pendingSync) are
 *  never sent. */
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  if (!tenantId) throw new Error("[courses] No tenant id");
  const c: any = course;
  const id = String(c?.id ?? "").trim();
  if (!id) throw new Error("[courses] row has no id");
  if (!isUuid(id)) {
    throw new Error(`[courses] non-UUID id "${id}" — migrate the local id first`);
  }
  const name = String(c?.name || c?.title || "").trim();
  if (!name) throw new Error("[courses] row has no name/title");

  const payload: Record<string, unknown> = {
    id,
    tenant_id: String(c?.tenantId || c?.tenant_id || tenantId),
    name,
    tuition_type: c?.tuitionType === "paid" ? "paid" : "free",
    amount: Number(c?.amount) || 0,
    start_date: c?.startDate ? String(c.startDate) : null,
    logo: c?.logo ? String(c.logo) : null,
  };

  // Optional columns — remove any line your courses table does not have.
  const description = String(c?.description ?? "").trim();
  if (description) payload.description = description;
  if (c?.createdBy) payload.created_by = String(c.createdBy);
  if (c?.createdAt || c?.created_at) {
    payload.created_at = String(c.createdAt || c.created_at);
  }

  try {
    const client = getClient();
    const { error } = await client
      .from(T.courses)
      .upsert([payload], { onConflict: "id" });
    if (error) throw new Error(`[courses] upsert: ${error.message}`);
  } catch (e: any) {
    throw new Error(e?.message ?? String(e));
  }
}

/** courseDB.deleteCourse keeps the tombstone (status "failed") on rejection
 *  → REJECTS. v3: count-verified SOFT delete (deleted_at = now) so other
 *  devices learn about the deletion through their existing
 *  is:deleted_at:null pull filter — a hard delete could never propagate
 *  because pulls only ever upsert. Same verify-or-throw contract as
 *  deleteUserRowFromSupabase; courseDB checks the local synced flag first,
 *  so a course that never reached the cloud never gets here. */
export async function deleteCourseFromSupabase(id: string, tenantId: string): Promise<void> {
  // A non-UUID id can never exist in the cloud (uuid PK) → nothing to delete.
  if (!isUuid(id)) return;
  const now = new Date().toISOString();
  try {
    const client = getClient();
    const { error, count } = await client
      .from(T.courses)
      .update({ deleted_at: now }, { count: "exact" })
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (error) throw new Error(error.message);
    if ((count ?? 0) > 0) return;

    // 0 rows updated — was it already deleted, or did RLS swallow the update?
    const { data: existing, error: selectError } = await client
      .from(T.courses)
      .select("deleted_at")
      .eq("id", id)
      .maybeSingle();
    if (selectError) throw new Error(selectError.message);
    if (!existing) {
      throw new Error(
        "Cloud course delete matched no row (never synced, or hidden by RLS).",
      );
    }
    if (existing?.deleted_at) return; // already soft-deleted — success

    throw new Error(
      "Cloud course delete was silently skipped — check the RLS policies on public.courses.",
    );
  } catch (e: any) {
    throw new Error(e?.message ?? String(e));
  }
}

/* ── 6. Assignments, fields, submissions ──────────────────────────────────── */

/** assignmentDB.add/updateAssignment await this in try/catch (sets synced=false) → REJECTS. */
export async function pushAssignmentToSupabase(assignment: Assignment, tenantId: string): Promise<void> {
  await pushDocOrThrow(T.assignments, assignment, tenantId);
}

/** assignmentDB.deleteAssignment flips the tombstone to "failed" on rejection → REJECTS. */
export async function deleteAssignmentFromSupabase(id: string, tenantId: string): Promise<void> {
  await deleteDocOrThrow(T.assignments, id, tenantId);
}

/**
 * Upserts the given field rows for an assignment (one batched request).
 * NOTE: the 3rd argument is the FIELD ROWS — assignmentDB passes [field].
 * (The old signature carried id strings, but ids alone carry no data to write.)
 */
export async function pushAssignmentFieldsToSupabase(
  assignmentId: string,
  tenantId: string,
  fields: AssignmentField[]
): Promise<void> {
  if (fields.length === 0) return;
  if (!tenantId) throw new Error("[assignment_fields] No tenant id");
  const rows = fields.map((f) => ({ ...f, assignmentId: f.assignmentId || assignmentId }));
  const usable = rows.filter((r) => {
    // r.id is optional on AssignmentField — guard before isUuid(id: string).
    if (r.id != null && isUuid(r.id)) return true;
    console.warn(`[supabaseCourseSync] skipping field with missing/non-UUID id "${r.id}" — migrate locally first`);
    return false;
  });
  if (usable.length === 0) return;
  const payloads = usable.map((r) => toPayload(T.assignmentFields, r, tenantId));
  try {
    const client = getClient();
    const { error } = await client.from(T.assignmentFields).upsert(payloads, {
      onConflict: "id",
    });
    if (error) throw new Error(`[assignment_fields] upsert: ${error.message}`);
  } catch (e: any) {
    throw new Error(e?.message ?? String(e));
  }
}

/** Deletes ALL cloud field rows of an assignment. v3: optional tenantId
 *  scopes the delete explicitly when given; without it, tenant scoping
 *  relies on RLS (as before). */
export async function deleteAssignmentFieldsFromSupabase(
  assignmentId: string,
  tenantId?: string
): Promise<void> {
  try {
    const client = getClient();
    let query: any = client
      .from(T.assignmentFields)
      .delete()
      .eq("assignment_id", assignmentId);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { error } = await query;
    if (error) throw new Error(`[assignment_fields] delete: ${error.message}`);
  } catch (e: any) {
    throw new Error(e?.message ?? String(e));
  }
}

/** assignmentDB.add/updateSubmission await this in try/catch → REJECTS on failure. */
export async function pushSubmissionToSupabase(submission: AssignmentSubmission, tenantId: string): Promise<void> {
  await pushDocOrThrow(T.submissions, submission, tenantId);
}

/* ── 7. Materials — SyncResult style, NEVER rejects (materialDB reads res.ok) ─ */

export async function pushMaterialToSupabase(material: CourseMaterial, tenantId: string): Promise<SyncResult> {
  return pushDoc(T.materials, material, tenantId);
}

export async function pushMaterialsToSupabase(materials: CourseMaterial[], tenantId: string): Promise<SyncResult> {
  if (materials.length === 0) return { ok: true };
  if (!tenantId) return { ok: false, error: "No tenant id" };
  // m.id guarded the same way as field rows above — keeps compiling even if
  // CourseMaterial.id ever becomes optional in ../types.
  const usable = materials.filter((m) => m.id != null && isUuid(m.id));
  const skipped = materials.length - usable.length;
  if (skipped > 0) {
    console.warn(`[supabaseCourseSync] ${skipped} material(s) with non-UUID id skipped`);
  }
  if (usable.length === 0) return { ok: false, error: "[course_materials] all ids are non-UUID" };
  const payloads = usable.map((m) => toPayload(T.materials, m, tenantId));
  try {
    const client = getClient();
    const { error } = await client.from(T.materials).upsert(payloads, { onConflict: "id" });
    if (error) return { ok: false, error: `[course_materials] upsert: ${error.message}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: `[course_materials] upsert: ${e?.message ?? String(e)}` };
  }
}

export async function deleteMaterialFromSupabase(id: string, tenantId: string): Promise<SyncResult> {
  return deleteDoc(T.materials, id, tenantId);
}

/**
 * Returns the course's cloud materials, or NULL when the fetch failed
 * (offline / network error) — materialDB treats null as "keep local data".
 */
export async function fetchCourseMaterialsFromSupabase(
  courseId: string,
  tenantId: string
): Promise<CourseMaterial[] | null> {
  try {
    const client = getClient();
    const { data, error } = await client
      .from(T.materials)
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId);
    if (error) {
      console.error("[supabaseCourseSync] fetch course_materials failed:", error.message);
      return null;
    }
    return (data ?? []).map((r: any) => r?.data as CourseMaterial).filter(Boolean);
  } catch (e: any) {
    console.error("[supabaseCourseSync] fetch course_materials threw:", e?.message ?? e);
    return null;
  }
}

/* ── 8. Schedules — silent style (scheduleDB calls them without try/catch) ── */

export async function pushScheduleToSupabase(schedule: Schedule, tenantId: string): Promise<void> {
  const res = await pushDoc(T.schedules, schedule, tenantId);
  if (!res.ok) console.warn("[supabaseCourseSync] schedule push failed (kept locally):", res.error);
}

/** v3: optional tenantId scopes the delete explicitly when given; without
 *  it, tenant scoping relies on RLS (as before). Never throws — scheduleDB
 *  has no catch around this call. */
export async function deleteScheduleFromSupabase(scheduleId: string, tenantId?: string): Promise<void> {
  try {
    const client = getClient();
    let query: any = client.from(T.schedules).delete().eq("id", scheduleId);
    if (tenantId) query = query.eq("tenant_id", tenantId);
    const { error } = await query;
    if (error) console.warn("[supabaseCourseSync] schedule cloud delete failed:", error.message);
  } catch (e: any) {
    console.warn("[supabaseCourseSync] schedule cloud delete threw:", e?.message ?? e);
  }
}
