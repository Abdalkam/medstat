// src/database/assignmentDb.ts — FIXED v4: Complete CRUD with tombstone protection

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
  // Tombstone check — don't re-add a locally-deleted assignment
  if (await isDeleted("assignment", assignment.id)) {
    console.warn(
      `Assignment ${assignment.id} is tombstoned. Removing tombstone to allow re-creation.`
    );
    await unmarkDeleted("assignment", assignment.id);
  }

  await db.assignments.add(assignment);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushAssignmentToSupabase(assignment, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push assignment to Supabase:", err);
      await db.assignments.update(assignment.id, { synced: false } as any);
    }
  } else {
    console.warn("[assignmentDb] Assignment saved locally only (no tenantId).");
    await db.assignments.update(assignment.id, { synced: false } as any);
  }
}

/* ================================================================
   UPDATE
   ================================================================ */
export async function updateAssignment(assignment: Assignment): Promise<void> {
  // Tombstone check — don't update a locally-deleted assignment
  if (await isDeleted("assignment", assignment.id)) {
    console.warn(
      `Cannot update assignment ${assignment.id} — it is tombstoned (locally deleted).`
    );
    return;
  }

  await db.assignments.put(assignment);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushAssignmentToSupabase(assignment, tenantId);
    } catch (err) {
      console.error("[assignmentDb] Failed to push assignment update to Supabase:", err);
      await db.assignments.update(assignment.id, { synced: false } as any);
    }
  } else {
    await db.assignments.update(assignment.id, { synced: false } as any);
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
      console.warn(
        `Tombstone will block re-insertion. Sync cycle will retry cloud delete.`
      );
      // Update tombstone status to "failed"
      await markDeleted("assignment", id, tenantId, "failed", msg);
    }
  }
}

/* ================================================================
   ASSIGNMENT FIELDS CRUD
   ================================================================ */
export async function getAssignmentFields(
  assignmentId: string
): Promise<AssignmentField[]> {
  return await db.assignmentFields
    .where("assignmentId")
    .equals(assignmentId)
    .toArray();
}

export async function addAssignmentField(field: AssignmentField): Promise<void> {
  await db.assignmentFields.add(field);
  const tenantId = getTenantId();
  if (tenantId) {
    try {
      await pushAssignmentFieldsToSupabase(field.assignmentId, tenantId, [field.id]);
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
    console.error(
      "[assignmentDb] Failed to delete assignment fields from Supabase:",
      err
    );
  }
}

/* ================================================================
   SUBMISSIONS CRUD
   ================================================================ */
export async function getSubmissions(
  assignmentId: string
): Promise<AssignmentSubmission[]> {
  return await db.assignmentSubmissions
    .where("assignmentId")
    .equals(assignmentId)
    .toArray();
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

export async function updateSubmission(
  submission: AssignmentSubmission
): Promise<void> {
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
