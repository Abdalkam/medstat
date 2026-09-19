import { db } from "./db";
import type { Assignment, AssignmentField, AssignmentSubmission } from "../types";
import { pushAssignmentToSupabase, deleteAssignmentFromSupabase, pushAssignmentFieldsToSupabase, deleteAssignmentFieldsFromSupabase, pushSubmissionToSupabase } from "./supabaseCourseSync";

// ✅ FIX: Changed "authUser" to "currentUser"
function getTenantId(): string {
  const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
  return user.tenantId || "";
}

export async function getAssignmentsByCourse(courseId: string): Promise<Assignment[]> {
  return await db.assignments.where("courseId").equals(courseId).toArray();
}

export async function getAssignment(id: string): Promise<Assignment | undefined> {
  return await db.assignments.get(id);
}

export async function addAssignment(assignment: Assignment): Promise<void> {
  await db.assignments.add(assignment);
  const tenantId = getTenantId();
  if (tenantId) pushAssignmentToSupabase(assignment, tenantId);
}

export async function updateAssignment(assignment: Assignment): Promise<void> {
  await db.assignments.put(assignment);
  const tenantId = getTenantId();
  if (tenantId) pushAssignmentToSupabase(assignment, tenantId);
}

export async function deleteAssignment(id: string): Promise<void> {
  await db.assignmentFields.where("assignmentId").equals(id).delete();
  await db.assignmentSubmissions.where("assignmentId").equals(id).delete();
  await db.assignments.delete(id);
  const tenantId = getTenantId();
  if (tenantId) deleteAssignmentFromSupabase(id, tenantId);
}

export async function getAssignmentFields(assignmentId: string): Promise<AssignmentField[]> {
  return await db.assignmentFields.where("assignmentId").equals(assignmentId).toArray();
}

export async function addAssignmentField(field: AssignmentField): Promise<void> {
  await db.assignmentFields.add(field);
  const tenantId = getTenantId();
  if (tenantId) pushAssignmentFieldsToSupabase(field.assignmentId, tenantId, [field.id]);
}

export async function deleteAssignmentFields(assignmentId: string): Promise<void> {
  await db.assignmentFields.where("assignmentId").equals(assignmentId).delete();
  deleteAssignmentFieldsFromSupabase(assignmentId);
}

export async function getSubmissions(assignmentId: string): Promise<AssignmentSubmission[]> {
  return await db.assignmentSubmissions.where("assignmentId").equals(assignmentId).toArray();
}

export async function addSubmission(submission: AssignmentSubmission): Promise<void> {
  await db.assignmentSubmissions.add(submission);
  const tenantId = getTenantId();
  if (tenantId) pushSubmissionToSupabase(submission, tenantId);
}

export async function updateSubmission(submission: AssignmentSubmission): Promise<void> {
  await db.assignmentSubmissions.put(submission);
  const tenantId = getTenantId();
  if (tenantId) pushSubmissionToSupabase(submission, tenantId);
}