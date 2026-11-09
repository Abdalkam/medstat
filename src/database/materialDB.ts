// src/database/materialDB.ts
// ─────────────────────────────────────────────────────────────────────────────
// SINGLE CRUD GATEWAY for course materials (Dexie + Supabase).
//
// Rules that make CRUD reliable:
//   1. Every write goes LOCAL-FIRST (Dexie), then syncs to Supabase ONCE.
//   2. Sync is AWAITED and returns a SyncResult so the UI can show real
//      errors instead of failing silently.
//   3. Failed pushes are retried automatically on the next load
//      (`pendingSync` flag — a small offline queue, no new Dexie table needed).
//   4. Deletions are recorded as tombstones in localStorage, so a delete made
//      offline is replayed against the cloud later and is never undone by a
//      reconcile that re-downloads the row.
//   5. Reconcile NEVER deletes a local row that is still queued for push —
//      this fixes the old bug where loadData() wiped a just-added material
//      because its cloud push had not landed yet.
// ─────────────────────────────────────────────────────────────────────────────

import { db } from "./db";
import type { CourseMaterial } from "../types";
import {
  pushMaterialToSupabase,
  pushMaterialsToSupabase,
  deleteMaterialFromSupabase,
  fetchCourseMaterialsFromSupabase,
  isUuid,
  type SyncResult,
} from "./supabaseCourseSync";

/** CourseMaterial plus local-only bookkeeping (stored in Dexie, never synced). */
export type StoredMaterial = CourseMaterial & { pendingSync?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// Tenant helpers
// ─────────────────────────────────────────────────────────────────────────────

function getTenantId(): string {
  try {
    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return user.tenantId || user.tenant_id || "";
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Delete tombstones (localStorage — avoids a schema bump in db.ts)
// ─────────────────────────────────────────────────────────────────────────────

const TOMBSTONES_KEY = "medstat_material_tombstones";
const TOMBSTONE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const TOMBSTONE_MAX_COUNT = 500;

function readTombstones(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(TOMBSTONES_KEY) || "{}");
  } catch {
    return {};
  }
}

function writeTombstones(map: Record<string, number>): void {
  try {
    localStorage.setItem(TOMBSTONES_KEY, JSON.stringify(map));
  } catch {
    /* storage full — tombstones are best-effort */
  }
}

function addTombstone(id: string): void {
  const map = readTombstones();
  const now = Date.now();
  // prune stale entries
  for (const key of Object.keys(map)) {
    if (now - map[key] > TOMBSTONE_MAX_AGE_MS) delete map[key];
  }
  map[id] = now;
  // cap the count (drop the oldest)
  const entries = Object.entries(map).sort((a, b) => a[1] - b[1]);
  const capped = Object.fromEntries(entries.slice(-TOMBSTONE_MAX_COUNT));
  writeTombstones(capped);
}

function removeTombstone(id: string): void {
  const map = readTombstones();
  if (map[id] !== undefined) {
    delete map[id];
    writeTombstones(map);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function sortMaterials(list: CourseMaterial[]): CourseMaterial[] {
  return [...list].sort(
    (a, b) =>
      (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0) ||
      String(a.uploadedAt || "").localeCompare(String(b.uploadedAt || ""))
  );
}

function stripPending(m: StoredMaterial): CourseMaterial {
  const { pendingSync, ...rest } = m as any;
  return rest as CourseMaterial;
}

/** Legacy rows may carry non-UUID ids, which PostgREST rejects (22P02).
 *  Migrate them to a fresh UUID locally before the first push. */
async function ensureUuidId(material: StoredMaterial): Promise<StoredMaterial> {
  if (isUuid(material.id)) return material;
  const fixed: StoredMaterial = { ...material, id: crypto.randomUUID() };
  await db.materials.delete(material.id);
  await db.materials.put(fixed);
  console.info(`[materials] Migrated legacy material id ${material.id} → ${fixed.id}`);
  return fixed;
}

async function markSynced(material: CourseMaterial): Promise<void> {
  await db.materials.put({ ...material, pendingSync: false } as StoredMaterial);
}

/** Write locally as pending, push once, mark synced on success. */
async function syncOne(material: CourseMaterial): Promise<SyncResult> {
  const tenantId = getTenantId();
  if (!tenantId) {
    console.warn("[materials] No tenant id in currentUser — kept locally only");
    return { ok: false, error: "No business (tenant) id in your session — please log out and back in" };
  }
  let m: StoredMaterial = { ...material, pendingSync: true };
  m = await ensureUuidId(m);
  const res = await pushMaterialToSupabase(m, tenantId);
  if (res.ok) {
    await markSynced(m);
  } else {
    // row stays in Dexie with pendingSync=true → retried on next reconcile
    console.warn("[materials] Cloud sync failed (kept locally, will retry):", res.error);
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public CRUD API
// ─────────────────────────────────────────────────────────────────────────────

/** CREATE — local first, then one awaited cloud push. Returns sync status. */
export async function addMaterial(material: CourseMaterial): Promise<SyncResult> {
  await db.materials.put({ ...material, pendingSync: true } as StoredMaterial);
  return syncOne(material);
}

/** UPDATE — local first, then one awaited cloud push. Returns sync status. */
export async function updateMaterial(material: CourseMaterial): Promise<SyncResult> {
  await db.materials.put({ ...material, pendingSync: true } as StoredMaterial);
  return syncOne(material);
}

/** BATCH UPDATE — one local bulk write + ONE batched cloud request (reorder). */
export async function updateMaterials(materials: CourseMaterial[]): Promise<SyncResult> {
  if (materials.length === 0) return { ok: true };
  await db.materials.bulkPut(materials.map((m) => ({ ...m, pendingSync: true })) as StoredMaterial[]);
  const tenantId = getTenantId();
  if (!tenantId) {
    console.warn("[materials] No tenant id in currentUser — order kept locally only");
    return { ok: false, error: "No business (tenant) id in your session — please log out and back in" };
  }
  const fixed: StoredMaterial[] = [];
  for (const m of materials) {
    fixed.push(await ensureUuidId({ ...m, pendingSync: true }));
  }
  const res = await pushMaterialsToSupabase(fixed, tenantId);
  if (res.ok) {
    await db.materials.bulkPut(fixed.map((m) => ({ ...m, pendingSync: false })) as StoredMaterial[]);
  } else {
    console.warn("[materials] Batch sync failed (kept locally, will retry):", res.error);
  }
  return res;
}

/**
 * DELETE — tombstone + local delete immediately, then cloud delete.
 * If the cloud delete fails (offline, RLS…) the tombstone stays and the
 * delete is retried automatically on the next reconcile.
 */
export async function deleteMaterial(id: string): Promise<SyncResult> {
  addTombstone(id);
  await db.materials.delete(id);
  const tenantId = getTenantId();
  if (!tenantId) {
    console.warn("[materials] No tenant id in currentUser — deleted locally only");
    return { ok: false, error: "No business (tenant) id in your session — please log out and back in" };
  }
  const res = await deleteMaterialFromSupabase(id, tenantId);
  if (res.ok) {
    removeTombstone(id);
  } else {
    console.warn("[materials] Cloud delete failed (will retry on next load):", res.error);
  }
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function getMaterials(): Promise<CourseMaterial[]> {
  const rows = (await db.materials.toArray()) as StoredMaterial[];
  return sortMaterials(rows.map(stripPending));
}

export async function getCourseMaterials(courseId: string): Promise<CourseMaterial[]> {
  const rows = (await db.materials.where("courseId").equals(courseId).toArray()) as StoredMaterial[];
  return sortMaterials(rows.map(stripPending));
}

export async function getMaterialById(id: string): Promise<CourseMaterial | undefined> {
  const m = (await db.materials.get(id)) as StoredMaterial | undefined;
  return m ? stripPending(m) : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconcile — merge the cloud into the local store, safely
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Call after (or instead of) a raw Supabase select when opening a course:
 *   1. retries queued pushes from previous offline sessions,
 *   2. fetches the cloud list (null on failure → local data returned untouched),
 *   3. retries pending cloud deletes (tombstones) and filters ghost rows,
 *   4. upserts all cloud rows into Dexie,
 *   5. deletes local rows the cloud has never seen — EXCEPT rows still queued
 *      for push, so offline work and in-flight adds are never wiped.
 * Always returns the merged, sorted list for the UI.
 */
export async function reconcileCourseMaterials(courseId: string, tenantId: string): Promise<CourseMaterial[]> {
  const localRows = (await db.materials.where("courseId").equals(courseId).toArray()) as StoredMaterial[];

  // 1) retry queued pushes so the fetch below sees them
  for (const row of localRows) {
    if (!row.pendingSync) continue;
    const fixed = await ensureUuidId(row);
    const res = await pushMaterialToSupabase(fixed, tenantId);
    if (res.ok) await markSynced(fixed);
  }

  // 2) fetch remote
  const remote = await fetchCourseMaterialsFromSupabase(courseId, tenantId);
  if (!remote) {
    // offline / failed — never touch local data
    return getCourseMaterials(courseId);
  }

  // 3) tombstone reconciliation
  const tombstones = readTombstones();
  const remoteUsable: CourseMaterial[] = [];
  for (const row of remote) {
    if (tombstones[row.id] !== undefined) {
      const res = await deleteMaterialFromSupabase(row.id, tenantId);
      if (res.ok) removeTombstone(row.id);
      continue; // never re-add a tombstoned row locally
    }
    remoteUsable.push(row);
  }

  // 4) merge remote rows into Dexie
  if (remoteUsable.length > 0) {
    await db.materials.bulkPut(remoteUsable.map((r) => ({ ...r, pendingSync: false })) as StoredMaterial[]);
  }

  // 5) drop local rows the cloud has never seen — but keep queued ones
  const remoteIds = new Set(remoteUsable.map((r) => r.id));
  const after = (await db.materials.where("courseId").equals(courseId).toArray()) as StoredMaterial[];
  for (const row of after) {
    if (!remoteIds.has(row.id) && !row.pendingSync) {
      await db.materials.delete(row.id);
    }
  }

  return getCourseMaterials(courseId);
}
