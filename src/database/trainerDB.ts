// src/database/trainerDB.ts — v5: cloud-synced, tombstone-aware trainer CRUD
//
// Changes vs v4 (behavior hardening only — the API surface is identical):
//  • deleteTrainer reads the row BEFORE the local cascade. When the trainer
//    was never confirmed in the cloud (synced === false — created offline
//    with every push failing, or no institution linked), the cloud delete is
//    skipped and the tombstone lifted immediately: deleteUserRowFromSupabase
//    throws "Cloud delete matched no user row" for rows that never existed,
//    which used to strand an immortal "failed" tombstone that
//    retryFailedCloudDeletes chased on every sync tick.
//  • getTrainers filters tombstoned ids (defense in depth — the canonical
//    filter lives in getUsersDetailed; direct Dexie reads stay clean too).
//  Everything else (tombstone-first delete, guarded cascade, username
//  uniqueness, idempotent put, syncedAt stamping) is unchanged from v4.
//
// Changes vs v3 (preserved):
//  • Cloud pushes and soft-deletes go through supabaseUserSync — the
//    schema-exact helper for public.users (explicit column whitelist,
//    camelCase "assignedDepartments" column, snake_case remuneration jsonb,
//    CHECK-safe role). The old pushUserToSupabase from supabaseCourseSync
//    is no longer used here; its behavior is otherwise identical.
//  • Successful pushes also stamp syncedAt (local-only metadata, never
//    uploaded — the users table has no such column).

import { db } from "./db";
import type { User } from "../types";
import {
  deleteUserRowFromSupabase,
  pushUserRowToSupabase,
} from "./supabaseUserSync";
import {
  getDeletedIds,
  markDeleted,
  unmarkDeleted,
  isDeleted,
} from "./deletedIdsTracker";
import { noteUserPushed } from "./userDB";

// ============================= HELPERS =============================

function getTenantId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return user?.tenantId || user?.tenant_id || "";
  } catch {
    return "";
  }
}

// Tenant match that tolerates camelCase (local writes) and snake_case
// (rows mirrored straight from Supabase by the sync hooks).
function sameTenant(u: any, tenantId?: string): boolean {
  if (!tenantId) return true;
  return u?.tenantId === tenantId || u?.tenant_id === tenantId;
}

function tenantOf(u: any): string {
  return u?.tenantId || u?.tenant_id || getTenantId();
}

// =============================
// GET ALL TRAINERS
// Pass tenantId to scope to one institution (recommended — the local DB can
// hold users from more than one tenant after multi-tenant logins).
// v5: also filters tombstoned ids, so a deleted trainer that snuck back
// into Dexie between purge passes can never appear in a trainer list.
// =============================
export async function getTrainers(tenantId?: string): Promise<User[]> {
  let dead = new Set<string>();
  try {
    dead = new Set(await getDeletedIds("user"));
  } catch {
    // Tracker unavailable — filtering is skipped.
  }
  const all = await db.users
    .filter((user) => user.role === "trainer")
    .toArray();
  return all.filter((u: any) => !dead.has(u.id) && sameTenant(u, tenantId));
}

// =============================
// GET TRAINER BY ID
// =============================
export async function getTrainer(id: string): Promise<User | undefined> {
  return await db.users.get(id);
}

// =============================
// CREATE TRAINER
// =============================
export async function addTrainer(trainer: User): Promise<void> {
  // Usernames are CASE-SENSITIVE at login, but two users differing only by
  // capitalization would be a support trap — block them within the tenant,
  // mirroring addUser's duplicate guard.
  const uname = (trainer.username || "").trim().toLowerCase();
  if (uname) {
    const clash = await db.users
      .filter(
        (u: any) =>
          u.id !== trainer.id &&
          (u.username || "").trim().toLowerCase() === uname &&
          sameTenant(u, tenantOf(trainer))
      )
      .first();
    if (clash) {
      throw new Error("A user with this username already exists in this institution (names that differ only by capitalization are not allowed).");
    }
  }

  // Re-creating a previously deleted trainer is legitimate — lift the tombstone.
  if (await isDeleted("user", trainer.id)) {
    console.warn(`Trainer ${trainer.id} was tombstoned. Removing tombstone to allow re-creation.`);
    await unmarkDeleted("user", trainer.id);
  }

  // put (not add): idempotent when the sync hooks rewrite the same row;
  // add() throws a raw ConstraintError on a repeated id.
  // synced:false until the cloud confirms — the list merge keeps pending
  // rows visible so the trainer never blinks out of the UI.
  await db.users.put({ ...trainer, synced: false } as User);

  const tenantId = tenantOf(trainer);
  if (tenantId) {
    try {
      // Schema-exact push: whitelists columns to the public.users DDL
      // (incl. the camelCase "assignedDepartments" column and snake_case
      // remuneration jsonb) and throws with the PostgREST message on error.
      await pushUserRowToSupabase(trainer, tenantId);
      await db.users.update(trainer.id, {
        synced: true,
        syncedAt: new Date().toISOString(),
      } as any);
      noteUserPushed(trainer.id);
    } catch (e: any) {
      console.warn("Supabase trainer push failed (kept as pending, will retry):", e?.message || e);
    }
  }
}

// =============================
// UPDATE TRAINER
// =============================
export async function updateTrainer(trainer: User): Promise<void> {
  // Don't update a locally-deleted trainer.
  if (await isDeleted("user", trainer.id)) {
    console.warn(`Cannot update trainer ${trainer.id} — it is tombstoned (locally deleted).`);
    return;
  }

  // Block renaming into a collision with another user in the same tenant.
  if (trainer.username) {
    const uname = trainer.username.trim().toLowerCase();
    const clash = await db.users
      .filter(
        (u: any) =>
          u.id !== trainer.id &&
          (u.username || "").trim().toLowerCase() === uname &&
          sameTenant(u, tenantOf(trainer))
      )
      .first();
    if (clash) {
      throw new Error("That username is already taken by another user in this institution.");
    }
  }

  // An edit makes the row dirty until the cloud confirms it.
  await db.users.put({ ...trainer, synced: false } as User);

  const tenantId = tenantOf(trainer);
  if (tenantId) {
    try {
      // Schema-exact push — same helper as addTrainer (see above).
      await pushUserRowToSupabase(trainer, tenantId);
      await db.users.update(trainer.id, {
        synced: true,
        syncedAt: new Date().toISOString(),
      } as any);
      noteUserPushed(trainer.id);
    } catch (e: any) {
      console.warn("Supabase trainer push failed (kept as pending, will retry):", e?.message || e);
    }
  }
}

// =============================
// DELETE TRAINER
// =============================
// Tombstone FIRST, then the full local cascade, then the cloud delete.
// v5 adds the never-synced guard: the row's synced flag is read BEFORE the
// cascade. Rows that never reached the cloud (synced === false) skip the
// cloud delete and lift the tombstone — deleteUserRowFromSupabase throws
// "matched no user row" for cloud-absent rows, which previously left an
// immortal "failed" tombstone behind. Unmark on success, keep tombstone on
// failure (the retry loop picks it up). v1 left no tombstone, so the next
// pull re-inserted the trainer; v2 left submission/chat orphans behind —
// both fixed in earlier versions and preserved here.
export async function deleteTrainer(id: string): Promise<void> {
  const tenantId = getTenantId();

  // Read BEFORE the local cascade — whether this row was ever pushed decides
  // whether a cloud delete is meaningful at all (see header). Rows with no
  // synced flag (legacy rows) are presumed cloud-known and keep the old
  // cloud-delete behavior.
  const local: any = await db.users.get(id).catch(() => null);
  const everSynced = !local || local.synced !== false;

  // Tombstone FIRST — closes the resurrection race window
  await markDeleted("user", id, tenantId, "pending");

  // Local cascade (each step guarded — a missing table must not abort)
  try { await db.enrollments.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.assignmentSubmissions.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.chatMessages.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.schedules.where("trainerId").equals(id).delete(); } catch { /* table may not exist */ }
  await db.users.delete(id);

  if (tenantId && everSynced) {
    try {
      // deleteUserRowFromSupabase verifies the row actually went away
      // (0-rows RLS no-op throws — see supabaseUserSync) — an RLS-swallowed
      // update can no longer masquerade as success.
      await deleteUserRowFromSupabase(id, tenantId);
      await unmarkDeleted("user", id);
      console.log(`Trainer ${id} fully deleted (local + cloud)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.warn(`Trainer ${id} deleted locally but cloud delete failed: ${msg}`);
      await markDeleted("user", id, tenantId, "failed", msg);
      throw new Error(`Trainer deleted locally but cloud delete failed: ${msg}. The cloud delete will be retried automatically.`);
    }
  } else {
    // No institution linked, or the row never reached the cloud — there is
    // nothing to delete there. Lift the tombstone so the retry loop never
    // chases a row that cannot exist.
    await unmarkDeleted("user", id);
    console.log(`Trainer ${id} deleted locally (never synced — no cloud row to remove)`);
  }
}
