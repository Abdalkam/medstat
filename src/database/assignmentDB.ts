/* ================================================================
   COURSE-CONTENT SYNC (v2) — the complete course-content section
   for src/database/supabaseCourseSync.ts
   ================================================================
   WHAT CHANGED IN v2 (fixes TS2304 "Cannot find name 'supabase'"):
   v1 ended with `const SUPABASE_CLIENT = supabase;` and assumed your
   file already declared a client named `supabase`. Yours doesn't, so
   v2 is SELF-CONTAINED: it builds its own client lazily on the first
   sync call, resolving credentials in this order:
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

   v2.1 — TS2345 fix at line 265: AssignmentField.id is optional in
   ../types, so the field-row filter now guards `r.id != null` before
   calling isUuid(id: string). The materials filter got the same guard.

   You may APPEND this whole file to the end of your existing
   supabaseCourseSync.ts (keeping your user-row sync) or REPLACE that
   file's content with it — both compile, because nothing below
   depends on the rest of the file.

   Exports added (all 15 missing members):
     • courseDB.ts      → pushCourseToSupabase, deleteCourseFromSupabase
     • assignmentDB.ts  → pushAssignmentToSupabase, deleteAssignmentFromSupabase,
                          pushAssignmentFieldsToSupabase,
                          deleteAssignmentFieldsFromSupabase, pushSubmissionToSupabase
     • materialDB.ts    → pushMaterialToSupabase, pushMaterialsToSupabase,
                          deleteMaterialFromSupabase, fetchCourseMaterialsFromSupabase,
                          isUuid, SyncResult
     • scheduleDB.ts    → pushScheduleToSupabase, deleteScheduleFromSupabase

   Failure styles match each call site's error handling (see FIXES.md):
     course/assignment/submission → THROW on failure (callers use try/catch)
     materials                    → return SyncResult (materialDB reads res.ok)
     fetchCourseMaterials         → return null on failure (materialDB keeps local)
     schedules                    → log only, never throw (scheduleDB has no catch)
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

/* ── 3. Supabase client — self-contained (v2) ─────────────────────────────── */

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

/* ── 4. Generic doc-store helpers ─────────────────────────────────────────── */

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

/* ── 5. Courses ───────────────────────────────────────────────────────────── */

/** courseDB.addCourse/updateCourse call this via .catch() → REJECTS on failure. */
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  await pushDocOrThrow(T.courses, course, tenantId);
}

/** courseDB.deleteCourse keeps the tombstone (status "failed") on rejection → REJECTS. */
export async function deleteCourseFromSupabase(id: string, tenantId: string): Promise<void> {
  await deleteDocOrThrow(T.courses, id, tenantId);
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

/** Deletes ALL cloud field rows of an assignment (tenant scoping via RLS). */
export async function deleteAssignmentFieldsFromSupabase(assignmentId: string): Promise<void> {
  try {
    const client = getClient();
    const { error } = await client
      .from(T.assignmentFields)
      .delete()
      .eq("assignment_id", assignmentId);
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

export async function deleteScheduleFromSupabase(scheduleId: string): Promise<void> {
  try {
    const client = getClient();
    const { error } = await client.from(T.schedules).delete().eq("id", scheduleId);
    if (error) console.warn("[supabaseCourseSync] schedule cloud delete failed:", error.message);
  } catch (e: any) {
    console.warn("[supabaseCourseSync] schedule cloud delete threw:", e?.message ?? e);
  }
}