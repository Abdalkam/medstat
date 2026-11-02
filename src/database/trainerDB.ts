// src/database/trainerDB.ts — v3: cloud-synced, tombstone-aware trainer CRUD
//
// Changes vs v2 (trainers are users, so the flow now mirrors userDB exactly):
//  1. addTrainer()/updateTrainer() now PUSH to Supabase and manage the
//     synced flag. v2 wrote locally only — a trainer stayed invisible on
//     other devices (and in remote pulls) until some unrelated code path
//     happened to push it.
//  2. deleteTrainer() cascade extended to assignment submissions and chat
//     messages (v2 only removed schedules + enrollments), matching
//     userDB.deleteUser so no orphan rows survive either path.
//  3. getTenantId() guarded against corrupt localStorage; duplicate /
//     collision guards are now tenant-scoped and case-insensitive.

import { db } from "./db";
import type { User } from "../types";
import { deleteUserFromSupabase, pushUserToSupabase } from "./supabaseCourseSync";
import { markDeleted, unmarkDeleted, isDeleted } from "./deletedIdsTracker";
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
// =============================
export async function getTrainers(tenantId?: string): Promise<User[]> {
  const all = await db.users
    .filter((user) => user.role === "trainer")
    .toArray();
  return all.filter((u: any) => sameTenant(u, tenantId));
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
      await pushUserToSupabase(trainer, tenantId);
      await db.users.update(trainer.id, { synced: true });
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
      await pushUserToSupabase(trainer, tenantId);
      await db.users.update(trainer.id, { synced: true });
      noteUserPushed(trainer.id);
    } catch (e: any) {
      console.warn("Supabase trainer push failed (kept as pending, will retry):", e?.message || e);
    }
  }
}

// =============================
// DELETE TRAINER
// =============================
// Mirrors userDB.deleteUser: tombstone FIRST, then the full local cascade,
// then the cloud delete (unmark on success, keep tombstone on failure).
// v1 left no tombstone, so the next pull re-inserted the trainer; v2 left
// submission/chat orphans behind — both fixed here.
export async function deleteTrainer(id: string): Promise<void> {
  const tenantId = getTenantId();

  // Tombstone FIRST — closes the resurrection race window
  await markDeleted("user", id, tenantId, "pending");

  // Local cascade (each step guarded — a missing table must not abort)
  try { await db.enrollments.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.assignmentSubmissions.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.chatMessages.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
  try { await db.schedules.where("trainerId").equals(id).delete(); } catch { /* table may not exist */ }
  await db.users.delete(id);

  if (tenantId) {
    try {
      // deleteUserFromSupabase must verify the row actually went away
      // (see supabaseCourseSync) — a 0-rows RLS no-op must throw.
      await deleteUserFromSupabase(id, tenantId);
      await unmarkDeleted("user", id);
      console.log(`Trainer ${id} fully deleted (local + cloud)`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      console.warn(`Trainer ${id} deleted locally but cloud delete failed: ${msg}`);
      await markDeleted("user", id, tenantId, "failed", msg);
      throw new Error(`Trainer deleted locally but cloud delete failed: ${msg}. The cloud delete will be retried automatically.`);
    }
  }
}
