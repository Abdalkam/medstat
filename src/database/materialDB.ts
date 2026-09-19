// src/database/materialDB.ts
import { db } from "./db";
import type { CourseMaterial } from "../types";
import { pushMaterialToSupabase, deleteMaterialFromSupabase } from "./supabaseCourseSync";

// ✅ FIX: Changed "authUser" to "currentUser"
function getTenantId(): string {
  const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
  return user.tenantId || "";
}

export async function addMaterial(material: CourseMaterial): Promise<void> {
  await db.materials.add(material);
  const tenantId = getTenantId();
  if (tenantId) pushMaterialToSupabase(material, tenantId);
}

export async function updateMaterial(material: CourseMaterial): Promise<void> {
  await db.materials.put(material);
  const tenantId = getTenantId();
  if (tenantId) pushMaterialToSupabase(material, tenantId);
}

export async function getMaterials(): Promise<CourseMaterial[]> {
  return await db.materials.toArray();
}

export async function getCourseMaterials(courseId: string): Promise<CourseMaterial[]> {
  return await db.materials.where("courseId").equals(courseId).toArray();
}

export async function getMaterialById(id: string): Promise<CourseMaterial | undefined> {
  return await db.materials.get(id);
}

export async function deleteMaterial(id: string): Promise<void> {
  await db.materials.delete(id);
  deleteMaterialFromSupabase(id);
}