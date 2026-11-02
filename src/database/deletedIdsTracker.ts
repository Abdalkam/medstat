// src/database/deletedIdsTracker.ts — Permanent Dexie-backed tombstones
// Prevents deleted items from reappearing during sync cycles
//
// NOTE: This file is the CANONICAL definition of `Tombstone`.
// db.ts imports it (type-only) so the Dexie `tombstones` table is typed
// against this exact shape — do not redeclare Tombstone elsewhere.

import { db } from "./db";

export type EntityType =
  | "course"
  | "user"
  | "enrollment"
  | "assignment"
  | "material"
  | "schedule";

export interface Tombstone {
  id: string;           // composite: `${entityType}:${entityId}`
  entityType: EntityType;
  entityId: string;
  tenantId: string;
  status: "pending" | "failed" | "confirmed";
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

/* ================================================================
   MARK DELETED — Create or update a tombstone
   ================================================================ */
export async function markDeleted(
  entityType: EntityType,
  entityId: string,
  tenantId: string,
  status: "pending" | "failed" | "confirmed" = "pending",
  errorMessage?: string
): Promise<void> {
  const id = `${entityType}:${entityId}`;
  const now = new Date().toISOString();
  const existing = await db.tombstones.get(id);

  if (existing) {
    await db.tombstones.update(id, {
      status,
      errorMessage: errorMessage || existing.errorMessage,
      updatedAt: now,
    });
  } else {
    await db.tombstones.add({
      id,
      entityType,
      entityId,
      tenantId,
      status,
      errorMessage,
      createdAt: now,
      updatedAt: now,
    });
  }
}

/* ================================================================
   UNMARK DELETED — Remove a tombstone (cloud delete succeeded)
   ================================================================ */
export async function unmarkDeleted(
  entityType: EntityType,
  entityId: string
): Promise<void> {
  const id = `${entityType}:${entityId}`;
  await db.tombstones.delete(id);
}

/* ================================================================
   IS DELETED — Check if a specific item is tombstoned
   ================================================================ */
export async function isDeleted(
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  const id = `${entityType}:${entityId}`;
  return !!(await db.tombstones.get(id));
}

/* ================================================================
   GET DELETED IDS — Get all tombstoned IDs for an entity type
   ================================================================ */
export async function getDeletedIds(
  entityType: EntityType
): Promise<string[]> {
  const all = await db.tombstones
    .where("entityType")
    .equals(entityType)
    .toArray();
  return all.map((t) => t.entityId);
}

/* ================================================================
   PURGE DELETED FROM DEXIE — Remove tombstoned items that
   snuck back into Dexie tables (defensive cleanup)
   ================================================================ */
export async function purgeDeletedFromDexie(): Promise<number> {
  let purged = 0;

  const courseIds = await getDeletedIds("course");
  for (const id of courseIds) {
    const exists = await db.courses.get(id);
    if (exists) {
      await db.courses.delete(id);
      purged++;
    }
  }

  const userIds = await getDeletedIds("user");
  for (const id of userIds) {
    const exists = await db.users.get(id);
    if (exists) {
      await db.users.delete(id);
      purged++;
    }
  }

  const enrollmentIds = await getDeletedIds("enrollment");
  for (const id of enrollmentIds) {
    const exists = await db.enrollments.get(id);
    if (exists) {
      await db.enrollments.delete(id);
      purged++;
    }
  }

  const assignmentIds = await getDeletedIds("assignment");
  for (const id of assignmentIds) {
    const exists = await db.assignments.get(id);
    if (exists) {
      await db.assignments.delete(id);
      purged++;
    }
  }

  const materialIds = await getDeletedIds("material");
  for (const id of materialIds) {
    const exists = await db.materials.get(id);
    if (exists) {
      await db.materials.delete(id);
      purged++;
    }
  }

  const scheduleIds = await getDeletedIds("schedule");
  for (const id of scheduleIds) {
    const exists = await db.schedules.get(id);
    if (exists) {
      await db.schedules.delete(id);
      purged++;
    }
  }

  if (purged > 0) {
    console.log(
      `[deletedIdsTracker] Purged ${purged} tombstoned items from Dexie`
    );
  }

  return purged;
}

/* ================================================================
   RETRY FAILED CLOUD DELETES — Attempt to re-delete items
   whose cloud delete previously failed
   ================================================================ */
export async function retryFailedCloudDeletes(): Promise<void> {
  const failed = await db.tombstones
    .where("status")
    .equals("failed")
    .toArray();

  if (failed.length === 0) return;

  console.log(
    `[deletedIdsTracker] Retrying ${failed.length} failed cloud deletes…`
  );

  for (const tombstone of failed) {
    try {
      const { deleteCourseFromSupabase, deleteUserFromSupabase } = await import(
        "./supabaseCourseSync"
      );

      switch (tombstone.entityType) {
        case "course":
          await deleteCourseFromSupabase(tombstone.entityId, tombstone.tenantId);
          break;
        case "user":
          await deleteUserFromSupabase(tombstone.entityId, tombstone.tenantId);
          break;
        // Add more entity types as needed
        default:
          console.warn(
            `Retry not implemented for entity type: ${tombstone.entityType}`
          );
          continue;
      }

      // Success — remove the tombstone
      await unmarkDeleted(tombstone.entityType, tombstone.entityId);
      console.log(
        `[deletedIdsTracker] Successfully retried cloud delete for ${tombstone.id}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.warn(
        `[deletedIdsTracker] Retry failed for ${tombstone.id}: ${msg}`
      );
      // Keep the tombstone with updated error message
      await markDeleted(
        tombstone.entityType,
        tombstone.entityId,
        tombstone.tenantId,
        "failed",
        msg
      );
    }
  }
}

/* ================================================================
   CLEAR ALL TOMBSTONES — For testing/reset purposes
   ================================================================ */
export async function clearAllTombstones(): Promise<void> {
  await db.tombstones.clear();
  console.log("[deletedIdsTracker] All tombstones cleared");
}

/* ================================================================
   GET TOMBSTONE STATS — For debugging
   ================================================================ */
export async function getTombstoneStats(): Promise<{
  total: number;
  pending: number;
  failed: number;
  confirmed: number;
}> {
  const all = await db.tombstones.toArray();
  return {
    total: all.length,
    pending: all.filter((t) => t.status === "pending").length,
    failed: all.filter((t) => t.status === "failed").length,
    confirmed: all.filter((t) => t.status === "confirmed").length,
  };
}

/* ================================================================
   TOMBSTONE HELPERS FOR SYNC PULLS — used by supabaseCourseSync.ts
   isTombstoned   = isDeleted alias under the name the pull guards use
   purgeIfTombstoned = tombstone check + local row purge in one step
   ================================================================ */
export async function isTombstoned(
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  return isDeleted(entityType, entityId);
}

export async function purgeIfTombstoned(
  table: string,            // Dexie table name, e.g. "enrollments" — NOT an EntityType
  entityType: EntityType,
  entityId: string
): Promise<boolean> {
  if (!(await isDeleted(entityType, entityId))) return false;
  try {
    await (db as any)[table]?.delete(entityId);
  } catch { /* table may not exist — never abort the pull */ }
  return true;
}
