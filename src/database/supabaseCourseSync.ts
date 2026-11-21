/* ================================================================
   src/database/supabaseCourseSync.ts — v5: OFFLINE-FIRST guards
   (v4: shape-aware courses + doc-store course-content sync)
   ================================================================

   WHAT CHANGED IN v5 (offline-first):

   • pushCourseToSupabase / deleteCourseFromSupabase throw INSTANTLY when
     navigator.onLine is false ("Offline — queued"). Callers keep the row
     at synced:false / the tombstone queued, so nothing is lost — and no
     request ever hangs waiting on a dead network stack.
   • fetchCoursesFromSupabase returns null immediately when offline — the
     caller keeps its local Dexie data on screen.
   • The table-shape cache (memory + localStorage) survives restarts, so
     the working shape is reused the moment we are back online.

   WHAT CHANGED IN v4 (the course-CRUD fix):

   The REAL public.courses DDL is the DOC-STORE shape:

     create table public.courses (
       id uuid primary key,
       tenant_id text not null,
       course_id text null,
       assignment_id text null,
       data jsonb not null default '{}'::jsonb,
       updated_at timestamptz not null default now()
     );
     create index courses_tenant_idx on public.courses (tenant_id, course_id);

   ... i.e. it has NO relational course columns (name, tuition_type,
   amount, start_date, logo) and NO deleted_at column. v3 pushed a
   relational payload at that table, so every course push failed with
   PGRST204 "Could not find the 'name' column" — courseDB caught the
   failure and the row silently stayed unsynced forever — and the soft
   delete updated a column that does not exist. Cloud course CRUD simply
   never worked. v4 makes course sync SHAPE-AWARE:

   • One cheap probe (select * limit 1) decides the live shape:
       - "docstore"   → rows carry a `data` jsonb column (the pasted DDL)
       - "relational" → rows carry real course columns (name, …)
     The result is cached in-module AND in localStorage
     ("medstat.coursesTableShape") so the probe runs once per device.
     An empty/unprovable table defaults to "docstore" (the pasted DDL).

   • Push: doc-store rows are written as
       { id, tenant_id, course_id: <course id>, assignment_id: null,
         data: <full local course>, updated_at: now }
     relational rows keep the v3 column-exact payload. A PGRST204 column
     mismatch flips the cached shape once and retries, then re-caches.

   • Soft delete (both shapes, count-verified, idempotent):
       - docstore:    deleted_at merged INTO the existing data jsonb
                      (PostgREST replaces the whole jsonb on update, so
                      the row is read first, merged, then written)
       - relational:  deleted_at = now (v3 behavior)
     Other devices hide the row through their pull filters — zero DDL
     change needed.

   • fetchCoursesFromSupabase(tenantId): shape-aware pull that returns
     LOCAL-SHAPE courses (camelCase, synced:true) or null on failure.
     sync.ts and the admin screens consume this, so no caller needs to
     know which shape the cloud table happens to be.

   UNCHANGED from v3 — the doc-store pattern still drives assignments /
   assignment_fields / assignment_submissions / course_materials /
   schedules, the self-contained lazy Supabase client, the per-table
   failure styles:
     course/assignment/submission → THROW on failure (callers use try/catch)
     materials                    → return SyncResult (materialDB reads res.ok)
     fetchCourseMaterials         → return null on failure (materialDB keeps local)
     schedules                    → log only, never throw (scheduleDB has no catch)
   and the credential resolution order (env ①, import.meta ②, fallbacks ③).

   Exports (callers):
     courseDB.ts       → pushCourseToSupabase, deleteCourseFromSupabase
     sync.ts           → fetchCoursesFromSupabase            (NEW in v4)
     assignmentDB.ts   → pushAssignmentToSupabase, deleteAssignmentFromSupabase,
                          pushAssignmentFieldsToSupabase,
                          deleteAssignmentFieldsFromSupabase, pushSubmissionToSupabase
     materialDB.ts     → pushMaterialToSupabase, pushMaterialsToSupabase,
                          deleteMaterialFromSupabase, fetchCourseMaterialsFromSupabase,
                          isUuid, SyncResult
     scheduleDB.ts     → pushScheduleToSupabase, deleteScheduleFromSupabase
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

/** Offline sign-in placeholder token (database/sync.ts). While it is the
 *  stored authToken there is NO valid Supabase session — every REST call can
 *  only answer 401. The helpers below fail fast instead of hammering the
 *  API; queued work syncs after the first real online login. */
function isOfflineLoginSession(): boolean {
  try {
    return typeof localStorage !== "undefined" &&
      localStorage.getItem("authToken") === "offline-mode-pending-sync";
  } catch {
    return false;
  }
}

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
  cachedClient = SupabaseJS.createClient(creds.url, creds.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return cachedClient;
}

/* ── 4. Generic doc-store helpers (assignments, fields, submissions,
        materials, schedules — NOT courses, see section 5) ─────────────────── */

/** Dexie-only bookkeeping keys that must never be written to the cloud. */
const LOCAL_ONLY_KEYS = new Set(["pendingSync", "synced", "syncedAt", "synced_at"]);

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
  if (isOfflineLoginSession()) {
    return { ok: false, error: "Signed in offline — the change is saved locally and will sync after a real online login" };
  }
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
  if (isOfflineLoginSession()) {
    return { ok: false, error: "Signed in offline — the delete is tombstoned locally and will sync after a real online login" };
  }
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

/* ── 5. Courses — SHAPE-AWARE (v4) ──────────────────────────────────────────
 * The live table is either the doc-store DDL (data jsonb) or a relational
 * courses table (name, tuition_type, …). Everything below detects, caches
 * and self-heals the shape, so course push / delete / pull work on BOTH
 * without any code change or migration.
 * ------------------------------------------------------------------------- */

export type CoursesTableShape = "docstore" | "relational";

const SHAPE_PREF_KEY = "medstat.coursesTableShape";
let coursesShape: CoursesTableShape | null = null;

function readShapePref(): CoursesTableShape | null {
  try {
    const v = localStorage.getItem(SHAPE_PREF_KEY);
    return v === "docstore" || v === "relational" ? v : null;
  } catch {
    return null;
  }
}

function writeShapePref(shape: CoursesTableShape): void {
  try {
    localStorage.setItem(SHAPE_PREF_KEY, shape);
  } catch {
    /* storage unavailable — the in-memory cache still applies */
  }
}

/** PostgREST names a missing column: PGRST204 / "Could not find the 'x'
 *  column of 'courses' …". Either signature means we aimed at the wrong shape. */
function isColumnMismatch(error: any): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" || /could not find the/i.test(String(error.message ?? ""))
  );
}

function flipShape(shape: CoursesTableShape): CoursesTableShape {
  return shape === "docstore" ? "relational" : "docstore";
}

/** Detects the live public.courses shape once per device:
 *  1. in-module cache, 2. localStorage preference from a previous probe,
 *  3. one `select * limit 1` — a row containing a `data` object key (and no
 *     `name` column) is doc-store; anything else is relational,
 *  4. empty/unprovable table → "docstore" (the pasted DDL). */
async function detectCoursesShape(): Promise<CoursesTableShape> {
  if (coursesShape) return coursesShape;
  const pref = readShapePref();
  if (pref) {
    coursesShape = pref;
    return pref;
  }
  try {
    const client = getClient();
    const { data, error } = await client.from(T.courses).select("*").limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      const row: any = data[0];
      coursesShape =
        row && typeof row === "object" && "data" in row && !("name" in row)
          ? "docstore"
          : "relational";
      writeShapePref(coursesShape);
      return coursesShape;
    }
  } catch {
    /* offline / no client yet — caller decides the fallback shape */
  }
  coursesShape = "docstore";
  return coursesShape;
}

/* ── 5a. Payload builders ─────────────────────────────────────────────────── */

/** Full local course → the jsonb stored inside a doc-store row. */
function courseDataPayload(course: any): Record<string, any> {
  const data: Record<string, any> = {};
  for (const [k, v] of Object.entries(course)) {
    if (!LOCAL_ONLY_KEYS.has(k)) data[k] = v;
  }
  return data;
}

function courseDocStorePayload(course: any, tenantId: string) {
  const id = String(course.id);
  return {
    id,
    tenant_id: String(course.tenantId || course.tenant_id || tenantId),
    // Self-key so the (tenant_id, course_id) index stays meaningful.
    course_id: id,
    assignment_id: null,
    data: courseDataPayload(course),
    updated_at: new Date().toISOString(),
  };
}

function courseRelationalPayload(course: any, tenantId: string) {
  const payload: Record<string, unknown> = {
    id: String(course.id),
    tenant_id: String(course.tenantId || course.tenant_id || tenantId),
    name: String(course.name || course.title || "").trim(),
    tuition_type: course.tuitionType === "paid" ? "paid" : "free",
    amount: Number(course.amount) || 0,
    start_date: course.startDate ? String(course.startDate) : null,
    logo: course.logo ? String(course.logo) : null,
  };
  // Optional columns — remove any line your relational table does not have.
  const description = String(course.description ?? "").trim();
  if (description) payload.description = description;
  if (course.createdBy) payload.created_by = String(course.createdBy);
  if (course.createdAt || course.created_at) {
    payload.created_at = String(course.createdAt || course.created_at);
  }
  return payload;
}

/* ── 5b. Push (upsert) ────────────────────────────────────────────────────── */

/** courseDB.addCourse/updateCourse call this via try/catch → REJECTS on
 *  failure. Doc-store first (the pasted DDL); a PGRST204 mismatch flips the
 *  shape once and retries, then the working shape is re-cached. */
export async function pushCourseToSupabase(course: Course, tenantId: string): Promise<void> {
  if (!tenantId) throw new Error("[courses] No tenant id");
  // ✅ OFFLINE-FIRST: fail fast and stay pending — the request itself would
  //    just die, and a queued row syncs via retryPendingCoursePushes later.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Offline — course queued locally and will sync when you reconnect");
  }
  // Offline sign-in (placeholder token) → no valid session; same treatment.
  if (isOfflineLoginSession()) {
    throw new Error("Signed in offline — course queued locally and will sync after a real online login");
  }
  const c: any = course;
  const id = String(c?.id ?? "").trim();
  if (!id) throw new Error("[courses] row has no id");
  if (!isUuid(id)) {
    throw new Error(`[courses] non-UUID id "${id}" — migrate the local id first`);
  }
  const name = String(c?.name || c?.title || "").trim();
  if (!name) throw new Error("[courses] row has no name/title");

  const client = getClient(); // throws the descriptive credentials error when unset
  let shape = await detectCoursesShape();

  for (let attempt = 0; attempt < 2; attempt++) {
    const payload =
      shape === "docstore"
        ? courseDocStorePayload(c, tenantId)
        : courseRelationalPayload(c, tenantId);
    const { error } = await client.from(T.courses).upsert([payload], { onConflict: "id" });
    if (!error) {
      coursesShape = shape;
      writeShapePref(shape);
      return;
    }
    if (attempt === 0 && isColumnMismatch(error)) {
      console.warn(
        `[courses] live table rejected the ${shape} payload (${error.message}) — retrying as ${flipShape(shape)}`
      );
      shape = flipShape(shape);
      continue;
    }
    throw new Error(`[courses] upsert: ${error.message}`);
  }
  throw new Error("[courses] upsert failed against both table shapes");
}

/* ── 5c. Soft delete (count-verified, idempotent) ─────────────────────────── */

/** courseDB.deleteCourse keeps the tombstone (status "failed") on rejection
 *  → REJECTS. v4: works on both shapes —
 *    docstore:    deleted_at is merged into the existing data jsonb
 *                 (read row → merge → write; PostgREST would otherwise
 *                 REPLACE the whole jsonb and wipe the course fields)
 *    relational:  deleted_at = now (v3 behavior)
 *  Same verify-or-throw contract as deleteUserRowFromSupabase; courseDB
 *  checks the local synced flag first, so a course that never reached the
 *  cloud never gets here. */
export async function deleteCourseFromSupabase(id: string, tenantId: string): Promise<void> {
  // A non-UUID id can never exist in the cloud (uuid PK) → nothing to delete.
  if (!isUuid(id)) return;
  // ✅ OFFLINE-FIRST: same instant-fail contract as the push — the tombstone
  //    stays queued and retryFailedCloudDeletes finishes the job on reconnect.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Offline — cloud delete queued for retry when you reconnect");
  }
  const client = getClient();
  const now = new Date().toISOString();
  let shape = await detectCoursesShape();

  for (let attempt = 0; attempt < 2; attempt++) {
    if (shape === "relational") {
      const { error, count } = await client
        .from(T.courses)
        .update({ deleted_at: now }, { count: "exact" })
        .eq("id", id)
        .eq("tenant_id", tenantId);

      if (error) {
        if (attempt === 0 && isColumnMismatch(error)) {
          shape = flipShape(shape);
          continue;
        }
        throw new Error(error.message);
      }
      if ((count ?? 0) > 0) return; // soft-deleted

      // 0 rows updated — was it already deleted, or did RLS swallow it?
      const { data: existing, error: selectError } = await client
        .from(T.courses)
        .select("deleted_at")
        .eq("id", id)
        .maybeSingle();
      if (selectError) throw new Error(selectError.message);
      if (!existing) {
        throw new Error(
          "Cloud course delete matched no row (never synced, or hidden by RLS)."
        );
      }
      if (existing?.deleted_at) return; // already soft-deleted — success
      throw new Error(
        "Cloud course delete was silently skipped — check the RLS policies on public.courses."
      );
    }

    // docstore — read the row first so the rest of the jsonb survives.
    const { data: rows, error: selErr } = await client
      .from(T.courses)
      .select("id, tenant_id, data")
      .eq("id", id)
      .eq("tenant_id", tenantId)
      .limit(1);
    if (selErr) {
      if (attempt === 0 && isColumnMismatch(selErr)) {
        shape = flipShape(shape);
        continue;
      }
      throw new Error(selErr.message);
    }
    const row: any = rows && rows.length > 0 ? rows[0] : null;
    if (!row) {
      throw new Error(
        "Cloud course delete matched no row (never synced, or hidden by RLS)."
      );
    }
    const data: any = { ...(row.data ?? {}) };
    if (data.deleted_at) return; // already soft-deleted — idempotent success
    data.deleted_at = now;
    const { error: updErr, count } = await client
      .from(T.courses)
      .update({ data, updated_at: now }, { count: "exact" })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (updErr) throw new Error(updErr.message);
    if ((count ?? 0) > 0) return; // soft-deleted

    // 0 rows updated — re-read: another device may have deleted it meanwhile.
    const { data: after, error: afterErr } = await client
      .from(T.courses)
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (afterErr) throw new Error(afterErr.message);
    if (after?.data?.deleted_at) return; // already soft-deleted — success
    throw new Error(
      "Cloud course delete was silently skipped — check the RLS policies on public.courses."
    );
  }
  throw new Error("[courses] delete failed against both table shapes");
}

/* ── 5d. Shape-aware pull (NEW in v4) ─────────────────────────────────────── */

/** Cloud row (either shape) → local Course. Tolerates camelCase and
 *  snake_case inside the data jsonb (old writers / Express-written rows)
 *  and the relational columns. */
function mapCloudCourseToLocal(raw: any, src: any, tenantId: string): Course {
  const course: any = {
    id: String(src?.id ?? raw?.id),
    name: String(src?.name ?? src?.title ?? ""),
    description: String(src?.description ?? ""),
    tuitionType: src?.tuitionType ?? src?.tuition_type ?? "free",
    amount: Number(src?.amount) || 0,
    startDate: src?.startDate ?? src?.start_date ?? "",
    period: String(src?.period ?? ""),
    trainerId: String(src?.trainerId ?? src?.trainer_id ?? ""),
    tenantId: String(src?.tenantId ?? src?.tenant_id ?? raw?.tenant_id ?? tenantId),
    createdAt: src?.createdAt ?? src?.created_at ?? new Date().toISOString(),
    synced: true,
  };
  if (src?.logo) course.logo = String(src.logo);
  return course as Course;
}

/**
 * Shape-aware pull of this tenant's live courses, mapped to the LOCAL course
 * shape (camelCase, synced:true) so callers can put() rows straight into
 * Dexie. Soft-deleted rows (relational deleted_at OR data.deleted_at) are
 * filtered out. Returns NULL when the fetch failed (offline / no
 * credentials) — callers keep their local data, exactly like
 * fetchCourseMaterialsFromSupabase. Never throws.
 */
export async function fetchCoursesFromSupabase(tenantId: string): Promise<Course[] | null> {
  if (!tenantId) return null;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return null; // ✅ offline — local data stays authoritative
  if (isOfflineLoginSession()) return null; // no valid session — skip the doomed 401
  try {
    const client = getClient();
    const { data, error } = await client.from(T.courses).select("*").eq("tenant_id", tenantId);
    if (error) {
      console.error("[supabaseCourseSync] fetch courses failed:", error.message);
      return null;
    }
    const out: Course[] = [];
    for (const raw of (data ?? []) as any[]) {
      // Doc-store rows carry the course inside `data`; relational rows ARE
      // the course. `name` disambiguates when both keys somehow exist.
      const isDoc = raw && typeof raw === "object" && "data" in raw && !raw.name;
      const src: any = isDoc ? raw.data ?? {} : raw;
      if (raw?.deleted_at || src?.deleted_at || src?.deletedAt) continue; // soft-deleted
      if (!src || !src.id) continue;
      out.push(mapCloudCourseToLocal(raw, src, tenantId));
    }
    return out;
  } catch (e: any) {
    console.error("[supabaseCourseSync] fetch courses threw:", e?.message ?? e);
    return null;
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
  if (isOfflineLoginSession()) return null; // no valid session — skip the doomed 401
  try {
    const client = getClient();
    // Doc-store first: the material lives in row.data (local camelCase shape).
    const first = await client
      .from(T.materials)
      .select("data")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId);
    if (!first.error) {
      return ((first.data ?? []) as any[])
        .map((r: any) => r?.data as CourseMaterial)
        .filter(Boolean);
    }
    // Fallback: a RELATIONAL course_materials table has no `data` column
    // (PGRST204/42703) — read the columns and map to the local shape.
    console.warn(
      `[supabaseCourseSync] course_materials "data" fetch failed (${first.error.message}) — trying relational columns`
    );
    const second = await client
      .from(T.materials)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("course_id", courseId);
    if (second.error) {
      console.error("[supabaseCourseSync] fetch course_materials failed:", second.error.message);
      return null;
    }
    return ((second.data ?? []) as any[]).map((r: any): CourseMaterial => ({
      id: String(r.id ?? ""),
      courseId: String(r.courseId ?? r.course_id ?? ""),
      tenantId: String(r.tenantId ?? r.tenant_id ?? tenantId),
      title: String(r.title ?? "Untitled"),
      description: String(r.description ?? ""),
      fileUrl: String(r.fileUrl ?? r.file_data ?? r.file_url ?? ""),
      fileName: String(r.fileName ?? r.file_name ?? r.title ?? "Untitled"),
      fileType: String(r.fileType ?? r.file_type ?? "application/octet-stream"),
      allowDownload: (r.allowDownload ?? r.allow_download) ?? true,
      uploadedBy: String(r.uploadedBy ?? r.uploaded_by ?? ""),
      uploadedAt: String(r.uploadedAt ?? r.uploaded_at ?? r.created_at ?? ""),
      isPresentation: (r.isPresentation ?? r.is_presentation) ?? false,
      presentationOrder: Number(r.presentationOrder ?? r.presentation_order ?? 0) || 0,
    }));
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
