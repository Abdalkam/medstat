// src/database/assignmentDB.ts — v5.1: type-safe ids, tombstone protection, cloud sync
//
// Changes vs v4 (tsc fixes only — behavior and flow unchanged):
//   1. addAssignment() now GENERATES an id when missing (Assignment.id is
//      optional in ../types), so isDeleted/unmarkDeleted/Dexie/cloud push all
//      receive a real string. Fixes TS2345 at lines 45/49/59/63.
//   2. updateAssignment() bails out early when the id is missing instead of
//      feeding `string | undefined` into isDeleted() and Dexie.update().
//      Fixes TS2345 at lines 72/86/89.
//   3. Both functions capture a narrowed local `id` for tombstone + Dexie calls.
//   4. addAssignmentField() passes the FIELD ROWS to pushAssignmentFieldsToSupabase
//      (the sync layer needs the data to upsert, not just ids).
//   5. The five supabaseCourseSync imports now exist — see
//      supabaseCourseSync_additions.ts (append it to supabaseCourseSync.ts).
//   6. v5.1: addAssignmentField() generates a missing field.id (AssignmentField.id
//      is optional in ../types) and skips the cloud push with a warning when the
//      field has no assignmentId (a cloud row without it can never be linked
//      back to its assignment). Fixes TS2345 at line 171.

import { db } from "./db";
import type { Assignment, AssignmentField, AssignmentSubmission } from "../types";
import {
  pushAssignmentToSupabase,
  deleteAssignmentFromSupabase,
  pushAssignmentFieldsToSupabase,
  deleteAssignmentFieldsFromSupabase,
  pushSubmissionToSupabase,
} from "./supabaseCourseSync";
import { markDeleted, unmarkDeleted, isDeleted } from "./deletedIdsTracker";

function getTenantId(): string | null {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tid = user.tenantId;
    if (!tid || typeof tid !== "string" || tid.trim() === "") {
      console.warn("[assignmentDb] No valid tenantId found in localStorage.");
      return null;
    }
    return tid;
  } catch (e) {
    console.error("[assignmentDb] Failed to parse currentUser from localStorage:", e);
    return null;
  }
}

/** crypto.randomUUID with a fallback for older browsers (same as courseDB). */
function newId(): string {
  return (
    crypto.randomUUID?.() ||
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })
  );
}

/* ================================================================
   READ
   ================================================================ */
export async function getAssignmentsByCourse(courseId: string): Promise<Assignment[]> {
  return await db.assignments.where("courseId").equals(courseId).toArray();
}

export async function getAssignment(id: string): Promise<Assignment | undefined> {
  return await db.assignments.get(id);
}

/* ================================================================
   CREATE
   ================================================================ */
export async function addAssignment(assignment: Assignment): Promise<void> {
  // Assignment.id is optional in ../types — make sure one exists BEFORE the
  // tombstone check, the Dexie write and the cloud push.
  if (!assignment.id) assignment.id = newId();
  const id: string = assignment.id;

  // Tombstone check — don't re-add a locally-deleted assignment
  if (await isDeleted("assignment", id)) {
    console.warn(`Assignment ${id} is tombstoned. Removing tombstone to allow re-creation.`);
    await unmarkDeleted("assignment", id);
  }

  await db.assignments.add(assignment);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushAssignmentToSupabase(assignment, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push assignment to Supabase:", err);
      await db.assignments.update(id, { synced: false } as any);
    }
  } else {
    console.warn("[assignmentDb] Assignment saved locally only (no tenantId).");
    await db.assignments.update(id, { synced: false } as any);
  }
}

/* ================================================================
   UPDATE
   ================================================================ */
export async function updateAssignment(assignment: Assignment): Promise<void> {
  if (!assignment.id) {
    console.error("[assignmentDb] Cannot update an assignment without an id.");
    return;
  }
  const id: string = assignment.id;

  // Tombstone check — don't update a locally-deleted assignment
  if (await isDeleted("assignment", id)) {
    console.warn(`Cannot update assignment ${id} — it is tombstoned (locally deleted).`);
    return;
  }

  await db.assignments.put(assignment);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushAssignmentToSupabase(assignment, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push assignment update to Supabase:", err);
      await db.assignments.update(id, { synced: false } as any);
    }
  } else {
    await db.assignments.update(id, { synced: false } as any);
  }
}

/* ================================================================
   DELETE (with tombstone + cloud sync)
   ================================================================ */
export async function deleteAssignment(id: string): Promise<void> {
  const tenantId = getTenantId();

  // 1. Delete related fields and submissions locally
  await db.assignmentFields.where("assignmentId").equals(id).delete();
  await db.assignmentSubmissions.where("assignmentId").equals(id).delete();
  await db.assignments.delete(id);

  // 2. Create tombstone to block re-insertion
  if (tenantId) {
    await markDeleted("assignment", id, tenantId, "pending");
  }

  // 3. Try to delete from Supabase
  if (tenantId) {
    try {
      await deleteAssignmentFromSupabase(id, tenantId);
      // SUCCESS: Remove the tombstone
      await unmarkDeleted("assignment", id);
      console.log(`Assignment ${id} fully deleted (local + cloud)`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[assignmentDb] Failed to delete assignment from Supabase:", msg);
      console.warn(`Tombstone will block re-insertion. Sync cycle will retry cloud delete.`);
      // Update tombstone status to "failed"
      await markDeleted("assignment", id, tenantId, "failed", msg);
    }
  }
}

/* ================================================================
   ASSIGNMENT FIELDS CRUD
   ================================================================ */
export async function getAssignmentFields(assignmentId: string): Promise<AssignmentField[]> {
  return await db.assignmentFields.where("assignmentId").equals(assignmentId).toArray();
}

export async function addAssignmentField(field: AssignmentField): Promise<void> {
  // AssignmentField.id is optional in ../types — generate one BEFORE the
  // Dexie write and the cloud push (same pattern as addAssignment).
  if (!field.id) field.id = newId();
  await db.assignmentFields.add(field);
  const tenantId = getTenantId();
  if (tenantId) {
    // AssignmentField.assignmentId is optional in ../types. A cloud row
    // without it can never be linked to its assignment (assignment_id
    // column), so keep the field locally and skip the cloud push.
    if (!field.assignmentId) {
      console.warn("[assignmentDb] Field has no assignmentId — kept locally only, not synced.");
      return;
    }
    try {
      // The sync layer upserts ROWS — pass the field object, not [field.id].
      await pushAssignmentFieldsToSupabase(field.assignmentId, tenantId, [field]);
    } catch (err) {
      console.error("[assignmentDb] Failed to push assignment field to Supabase:", err);
    }
  }
}

export async function deleteAssignmentFields(assignmentId: string): Promise<void> {
  await db.assignmentFields.where("assignmentId").equals(assignmentId).delete();
  try {
    await deleteAssignmentFieldsFromSupabase(assignmentId);
  } catch (err) {
    console.error("[assignmentDb] Failed to delete assignment fields from Supabase:", err);
  }
}

/* ================================================================
   SUBMISSIONS CRUD
   ================================================================ */
export async function getSubmissions(assignmentId: string): Promise<AssignmentSubmission[]> {
  return await db.assignmentSubmissions.where("assignmentId").equals(assignmentId).toArray();
}

export async function addSubmission(submission: AssignmentSubmission): Promise<void> {
  await db.assignmentSubmissions.add(submission);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushSubmissionToSupabase(submission, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push submission to Supabase:", err);
    }
  }
}

export async function updateSubmission(submission: AssignmentSubmission): Promise<void> {
  await db.assignmentSubmissions.put(submission);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushSubmissionToSupabase(submission, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push submission update to Supabase:", err);
    }
  }
}
