// src/database/supabaseUserSync.ts — v3: removes the "pending sync" footgun
//
// v3 change: adds syncUserRowToCloud — a wrapper that does the cloud upsert
// AND invokes a caller-supplied mark-synced callback in the SAME try/catch.
// v2 let a successful push leave the local row stranded as synced:false
// whenever the caller forgot to flip the flag afterwards (the exact cause of
// the "succeeded but still showing pending sync" UI state).
//
// v2 change: mapLocalUserToCloud now prefers the camelCase assignedCourses
// copy (row?.assignedCourses ?? row?.assigned_courses). types.ts documents
// that new local writes always use the camelCase key; rows that only carry
// the snake_case copy are untouched cloud mirrors, so nothing regresses—
// but a locally refreshed camelCase list can no longer be shadowed by a
// stale snake_case mirror (which let UserManagement re-save superseded
// assignments after AssignCourses changed them).
//
// Why this file exists — the actual Supabase table has three traps that a
// naive "push the whole Dexie row" approach trips over:
//
//   1. The departments column is literally named "assignedDepartments"
//      (camelCase, quoted in DDL) while courses is snake_case
//      (assigned_courses). Sending `assigned_departments` to PostgREST fails
//      with PGRST204 "Could not find the column" — which strands the user
//      row as synced:false forever.
//   2. The remuneration jsonb column is snake_case
//      ('{"per_diem": 0, "net_salary": 0}') while local Dexie rows keep
//      camelCase keys ({ netSalary, perDiem }). Mapping happens HERE so the
//      cloud jsonb always matches the column default's shape.
//   3. role has a CHECK constraint (admin | trainer | trainee) — a stray
//      'user' default or empty role would be rejected with 23514.
//
// Every payload is therefore built from an explicit column whitelist that
// mirrors the DDL exactly. Columns NOT in the whitelist (synced, deleted_at,
// updated_at/updatedAt, syncedAt, tenantId, profilePic, assigned_departments,
// assignedCourses mirror keys, etc.) are never sent: PostgREST upserts leave
// omitted columns untouched.
//
// The soft-delete verifies the row count — an RLS-silenced 0-rows update
// must THROW, not look like success (same contract the trainerDB comments
// already document for deleteUserFromSupabase).

import { supabase } from "../auth/supabase";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

const VALID_ROLES = ["admin", "trainer", "trainee"];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** text-or-null for the nullable text columns (phone, email, profile_pic). */
function toText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text === "" ? null : text;
}

/** uuid[] columns reject invalid uuid literals (22P02) — filter defensively. */
function toUuidList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const id = String(item ?? "").trim();
    if (UUID_RE.test(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* jsonb shapers                                                              */
/* -------------------------------------------------------------------------- */

/** tuition jsonb — camelCase on BOTH sides: the column default is
 *  '{"paid": 0, "expected": 0}'. */
export function shapeTuition(tuition: unknown): { expected: number; paid: number } {
  const src = tuition && typeof tuition === "object" ? (tuition as Record<string, unknown>) : {};
  return {
    expected: toNumber(src.expected),
    paid: toNumber(src.paid),
  };
}

/** remuneration jsonb — accepts either key spelling on the way IN and always
 *  emits the CLOUD shape { net_salary, per_diem }. */
export function shapeRemunerationCloud(remuneration: unknown): {
  net_salary: number;
  per_diem: number;
} {
  const src = remuneration && typeof remuneration === "object"
    ? (remuneration as Record<string, unknown>)
    : {};
  return {
    net_salary: toNumber(src.netSalary ?? src.net_salary),
    per_diem: toNumber(src.perDiem ?? src.per_diem),
  };
}

/** remuneration jsonb — emits the LOCAL (Dexie) shape { netSalary, perDiem };
 *  used by the pull mapper in sync.ts. */
export function shapeRemunerationLocal(remuneration: unknown): {
  netSalary: number;
  perDiem: number;
} {
  const src = remuneration && typeof remuneration === "object"
    ? (remuneration as Record<string, unknown>)
    : {};
  return {
    netSalary: toNumber(src.netSalary ?? src.net_salary),
    perDiem: toNumber(src.perDiem ?? src.per_diem),
  };
}

/* -------------------------------------------------------------------------- */
/* Local row → cloud payload                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds the exact PostgREST payload for public.users from any local row
 * shape (Dexie write, Supabase mirror, legacy camel/snake mix).
 * Throws a clear error when a required column would be missing, so callers
 * keep the row as synced:false instead of firing a doomed request.
 */
export function mapLocalUserToCloud(row: any, fallbackTenantId?: string): Record<string, unknown> {
  const id = String(row?.id ?? "").trim();
  if (!id) throw new Error("Cannot sync user: missing id.");

  const tenantId = String(
    row?.tenant_id ?? row?.tenantId ?? fallbackTenantId ?? "",
  ).trim();
  if (!tenantId) throw new Error("Cannot sync user: missing tenant_id.");

  const username = String(row?.username ?? "").trim();
  if (!username) throw new Error("Cannot sync user: missing username.");

  const role = String(row?.role ?? "").trim().toLowerCase();
  if (!VALID_ROLES.includes(role)) {
    throw new Error(
      `Cannot sync user: role "${role}" is not allowed by the users table (admin | trainer | trainee).`,
    );
  }

  const payload: Record<string, unknown> = {
    id,
    tenant_id: tenantId,
    username,
    phone: toText(row?.phone),
    email: toText(row?.email),
    // NOT NULL column — an empty string is legal, null is not.
    password: String(row?.password ?? ""),
    role,
    // v2: camelCase FIRST. New local writes always use assignedCourses
    // (types.ts); the snake_case copy is only authoritative on rows that
    // were mirrored straight from the cloud and never edited locally.
    assigned_courses: toUuidList(row?.assignedCourses ?? row?.assigned_courses),
    // Exact column name from the DDL — camelCase, quoted.
    assignedDepartments: toUuidList(row?.assignedDepartments ?? row?.assigned_departments),
    profile_pic: toText(row?.profile_pic ?? row?.profilePic),
    tuition: shapeTuition(row?.tuition),
    remuneration: shapeRemunerationCloud(row?.remuneration),
  };

  const createdAt = row?.created_at ?? row?.createdAt;
  if (createdAt) payload.created_at = String(createdAt);

  return payload;
}

/* -------------------------------------------------------------------------- */
/* Push (upsert) — LOW LEVEL                                                  */
/* -------------------------------------------------------------------------- */

/**
 * LOW-LEVEL cloud-only upsert into public.users. Local rows are NEVER
 * mutated here.
 *
 * ⚠️ Prefer syncUserRowToCloud below. It wraps this call AND invokes your
 * local mark-synced callback in the same try/catch, so a successful push
 * can no longer strand a row as "pending sync". Direct use of this function
 * requires the caller to flip synced:true + syncedAt themselves afterwards —
 * which is the exact footgun that produced the stuck "pending sync" UI
 * state (push returns 200, cloud row is correct, but the local Dexie row's
 * synced flag was never written back, so the badge never clears).
 *
 * Kept exported for callers that genuinely want cloud-only behaviour (e.g.
 * a bulk push that marks rows in a separate batched transaction).
 */
export async function pushUserRowToSupabase(
  row: any,
  fallbackTenantId?: string,
): Promise<void> {
  const payload = mapLocalUserToCloud(row, fallbackTenantId);
  const { error } = await supabase
    .from("users")
    .upsert([payload], { onConflict: "id" });
  if (error) throw new Error(error.message);
}

/* -------------------------------------------------------------------------- */
/* All-in-one sync (push + local mark-synced) — v3                            */
/* -------------------------------------------------------------------------- */

/**
 * Callback a caller provides to flip the LOCAL row's sync flag after the
 * cloud upsert succeeds. Typical implementation:
 *
 *   async (id, syncedAt) => {
 *     await db.users.update(id, { synced: true, syncedAt });
 *   }
 *
 * If this throws (e.g. Dexie write fails), syncUserRowToCloud re-throws —
 * the row stays synced:false, the next retry re-pushes (idempotent via
 * onConflict:"id") and re-marks. Self-healing, no half-success state.
 */
export type OnUserSynced = (id: string, syncedAt: string) => Promise<void> | void;

/**
 * The recommended entry point for pushing one user to public.users.
 *
 * Why this exists: pushUserRowToSupabase only writes to the CLOUD and
 * deliberately never touches the local row. That design is what lets a row
 * show "pending sync" forever even though Supabase already has it — a
 * caller pushes successfully and then forgets (or only updates React
 * state, not Dexie) to flip synced:true. The badge then never clears
 * because nothing ever wrote `synced: true, syncedAt: <now>` back to the
 * local store.
 *
 * This wrapper closes that gap. It runs, in one try/catch:
 *   1. builds the payload (throws early on bad data — row stays pending),
 *   2. upserts to public.users (throws on PostgREST error — row stays pending),
 *   3. on success, invokes onSynced(id, syncedAt) so the LOCAL row is
 *      flipped in the same code path that confirmed the cloud write.
 *
 * If any step throws, the row remains synced:false and the sync job
 * retries — a successful cloud push with a stale local flag is no longer
 * possible.
 *
 * @returns { syncedAt } so callers can surface the timestamp in the UI.
 */
export async function syncUserRowToCloud(
  row: any,
  onSynced: OnUserSynced,
  fallbackTenantId?: string,
): Promise<{ syncedAt: string }> {
  // 1 + 2: build payload + upsert. Throws on bad data or PostgREST error.
  await pushUserRowToSupabase(row, fallbackTenantId);

  // 3: cloud write confirmed — flip the local row NOW, before anything else
  //    can interrupt. If onSynced throws, we re-throw so the caller's
  //    catch keeps the row as synced:false and the retry loop re-pushes
  //    (idempotent) + re-marks.
  const syncedAt = new Date().toISOString();
  await onSynced(String(row?.id ?? "").trim(), syncedAt);

  return { syncedAt };
}

/* -------------------------------------------------------------------------- */
/* Soft delete                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Soft-deletes one user (deleted_at = now), tenant-scoped. Verifies that a
 * row was actually updated: an RLS-silenced no-op or a wrong id throws, so
 * the tombstone stays and the sync job retries — silent success here would
 * let the pull resurrect the user forever.
 * Already-deleted rows count as success (idempotent retry).
 * NOTE: a row that NEVER reached the cloud also throws here ("matched no
 * user row") — deleteTrainer / UserManagement.handleDelete guard against
 * that by checking the local synced flag BEFORE calling this.
 */
export async function deleteUserRowFromSupabase(
  id: string,
  tenantId: string,
): Promise<void> {
  const now = new Date().toISOString();

  const { error, count } = await supabase
    .from("users")
    .update({ deleted_at: now }, { count: "exact" })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  if (error) throw new Error(error.message);
  if ((count ?? 0) > 0) return;

  // 0 rows updated — was it already deleted, or did RLS swallow the update?
  const { data: existing, error: selectError } = await supabase
    .from("users")
    .select("deleted_at")
    .eq("id", id)
    .maybeSingle();

  if (selectError) throw new Error(selectError.message);
  if (!existing) {
    throw new Error("Cloud delete matched no user row (wrong id or hidden by RLS).");
  }
  if (existing?.deleted_at) return; // already soft-deleted — success

  throw new Error(
    "Cloud delete was silently skipped — check the RLS policies on public.users.",
  );
}

