// src/database/formDB.ts
// ============================================================================
// SHARED OFFLINE-FIRST ENGINE FOR THE FORMS FEATURE (admin + user side)
// ----------------------------------------------------------------------------
// One place that owns every write path for forms:
//
//   AdminForms.tsx           → getCachedForms / cacheForms / deleteFormOnlineFirst
//   AdminFormBuilder.tsx     → saveFormOfflineFirst / flushPendingFormOps /
//                              countPendingFormOps / queueFormOp / upsertRows
//   AdminFormSubmissions.tsx → setAllowDownloadOfflineFirst
//
// Guarantees:
//   • A save NEVER blocks on the network. Local caches (Dexie `formCache` +
//     localStorage mirrors + per-form `cachedFormMeta_/_Fields_` keys) update
//     instantly; the cloud write is attempted only when online; any offline or
//     failed write is queued and replayed automatically (on page load, on
//     save, and when the device reconnects).
//   • A form that exists locally but is not yet readable on the cloud is NEVER
//     dropped from the admin list — this is what stops freshly created forms
//     from "flashing on and off" while sync catches up.
//   • Deletes are tombstoned locally, so a stale cache or a cloud refetch can
//     never resurrect a deleted form before the delete reaches the cloud.
//   • Every storage access is guarded: if the Dexie table is missing, a
//     localStorage mirror keeps offline mode fully working.
// ============================================================================

import { supabase } from "../auth/supabase";
import { db as localDb } from "./db";

// ---------------------------- small utilities ------------------------------

export function isOnline(): boolean {
  try { return typeof navigator === "undefined" ? true : navigator.onLine !== false; } catch { return true; }
}

function withTimeout<T = any>(p: any, ms = 8000): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("supabase-timeout")), ms))]);
}

function lsGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } }
function lsSet(key: string, val: string): void { try { localStorage.setItem(key, val); } catch { /* quota — ignore */ } }
function lsRemove(key: string): void { try { localStorage.removeItem(key); } catch { /* ignore */ } }

// ------------------------------ storage keys -------------------------------

const OPS_KEY = "pendingFormOps";        // queued cloud writes (FIFO)
const TOMB_KEY = "deletedFormIds";       // locally deleted, cloud delete pending
const MIRROR_KEY = "cachedFormsMirror";  // localStorage mirror of Dexie formCache

// ------------------------------ pending ops --------------------------------

export interface FormOp {
  kind: "upsert_form" | "patch_form" | "delete_form";
  payload: any;
  fields?: any[];
  removedFieldIds?: string[];
  queuedAt?: string;
}

export function readPendingFormOps(): FormOp[] {
  try { const v = JSON.parse(lsGet(OPS_KEY) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
function writePendingFormOps(ops: FormOp[]): void { lsSet(OPS_KEY, JSON.stringify(ops)); }

export function countPendingFormOps(): number { return readPendingFormOps().length; }

export function queueFormOp(op: FormOp): void {
  const ops = readPendingFormOps();
  ops.push({ ...op, queuedAt: op.queuedAt || new Date().toISOString() });
  writePendingFormOps(ops);
}

// ------------------------------- tombstones --------------------------------

export function getDeletedFormIds(): string[] {
  try { const v = JSON.parse(lsGet(TOMB_KEY) || "[]"); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
}
function addTombstone(id: string): void {
  const ids = Array.from(new Set([...getDeletedFormIds(), id]));
  lsSet(TOMB_KEY, JSON.stringify(ids));
}
function clearTombstone(id: string): void {
  lsSet(TOMB_KEY, JSON.stringify(getDeletedFormIds().filter((x) => x !== id)));
}

// --------------------- local cache (Dexie + mirror) ------------------------
// Primary store is the Dexie `formCache` table; a localStorage mirror keeps
// offline mode working even if the table isn't in the schema yet.

function formTable(): any {
  try { return (localDb as any)?.formCache ?? null; } catch { return null; }
}

function mirrorMerge(row: any): void {
  try {
    const arr = JSON.parse(lsGet(MIRROR_KEY) || "[]");
    const list: any[] = Array.isArray(arr) ? arr : [];
    const i = list.findIndex((r) => r?.id === row.id);
    if (i >= 0) list[i] = { ...list[i], ...row };
    else list.push(row);
    lsSet(MIRROR_KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

function mirrorRemove(id: string): void {
  try {
    const arr = JSON.parse(lsGet(MIRROR_KEY) || "[]");
    lsSet(MIRROR_KEY, JSON.stringify((Array.isArray(arr) ? arr : []).filter((r) => r?.id !== id)));
  } catch { /* ignore */ }
}

export async function putCachedForm(row: any): Promise<void> {
  if (!row?.id) return;
  const t = formTable();
  let prev: any = null;
  try { if (t?.get) prev = await t.get(row.id); } catch { /* ignore */ }
  const merged = { ...(prev || {}), ...row, submission_count: row.submission_count ?? prev?.submission_count ?? 0 };
  try { if (t?.put) await t.put(merged); } catch { /* ignore */ }
  mirrorMerge(merged);
}

export async function removeCachedForm(id: string): Promise<void> {
  const t = formTable();
  try { if (t?.delete) await t.delete(id); } catch { /* ignore */ }
  mirrorRemove(id);
}

/** Rows currently cached locally (offline-safe), tombstones filtered, newest first. */
export async function getCachedForms(tenantId?: string | null): Promise<any[]> {
  let rows: any[] = [];
  const t = formTable();
  try { if (t?.toArray) rows = await t.toArray(); } catch { rows = []; }
  if (!Array.isArray(rows) || rows.length === 0) {
    try {
      const m = JSON.parse(lsGet(MIRROR_KEY) || "[]");
      if (Array.isArray(m)) rows = m;
    } catch { /* ignore */ }
  }
  const tombstones = new Set(getDeletedFormIds());
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.id && !tombstones.has(r.id))
    .filter((r) => !tenantId || !r.tenant_id || r.tenant_id === tenantId)
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")));
}

/** Replace this tenant's cached rows (removes rows deleted elsewhere), tombstone-aware. */
async function cacheReplaceTenant(tenantId: string, rows: any[]): Promise<void> {
  const newIds = new Set(rows.map((r) => r.id));
  const t = formTable();
  try {
    if (t?.toArray && t?.bulkPut) {
      const all = await t.toArray();
      const stale = (Array.isArray(all) ? all : [])
        .filter((r: any) => r?.tenant_id === tenantId && !newIds.has(r.id))
        .map((r: any) => r.id);
      await t.bulkPut(rows);
      if (stale.length > 0 && t?.bulkDelete) await t.bulkDelete(stale);
    }
  } catch { /* ignore */ }
  try {
    const arr = JSON.parse(lsGet(MIRROR_KEY) || "[]");
    const others = (Array.isArray(arr) ? arr : []).filter((r: any) => r?.tenant_id !== tenantId);
    lsSet(MIRROR_KEY, JSON.stringify([...others, ...rows]));
  } catch { /* ignore */ }
}

// --------------------------- cloud helpers ---------------------------------

export async function upsertRows(table: string, rows: any[]): Promise<boolean> {
  if (!Array.isArray(rows) || rows.length === 0) return true;
  try {
    const { error } = await withTimeout(supabase.from(table).upsert(rows), 8000);
    return !error;
  } catch { return false; }
}

/** Deletes children first, then the form row. Throws on the first failure. */
async function cloudDeleteForm(id: string): Promise<void> {
  const { error: e1 } = await withTimeout(supabase.from("form_submissions").delete().eq("form_id", id));
  if (e1) throw e1;
  const { error: e2 } = await withTimeout(supabase.from("form_fields").delete().eq("form_id", id));
  if (e2) throw e2;
  const { error: e3 } = await withTimeout(supabase.from("forms").delete().eq("id", id));
  if (e3) throw e3;
}

function fieldRowsFor(form: any, fields: any[]): any[] {
  return (fields || []).map((f: any, i: number) => ({
    id: f.id,
    form_id: form.id,
    tenant_id: form.tenant_id ?? null,
    type: f.type,
    label: f.label,
    options: Array.isArray(f.options) ? f.options : null,
    config: f.config && typeof f.config === "object" ? f.config : {},
    sort_order: i,
  }));
}

// --------------------------- public write API ------------------------------

/**
 * OFFLINE-FIRST SAVE (AdminFormBuilder).
 * Local caches update instantly; the cloud write happens when online and is
 * queued automatically on failure. Returns true only when the cloud write
 * fully succeeded.
 */
export async function saveFormOfflineFirst(
  form: any,
  fields: any[] = [],
  removedFieldIds: string[] = [],
  _isExisting = true
): Promise<boolean> {
  const stamped = { ...form, updated_at: form?.updated_at || new Date().toISOString() };

  // 1. Local, instantly — the UI and the Forms list see the change immediately.
  await putCachedForm(stamped);
  lsSet(`cachedFormMeta_${stamped.id}`, JSON.stringify(stamped));
  lsSet(`cachedFormFields_${stamped.id}`, JSON.stringify(fields || []));
  clearTombstone(stamped.id); // re-creating overrides a local delete

  // 2. Cloud when possible; queued otherwise.
  if (!isOnline()) {
    queueFormOp({ kind: "upsert_form", payload: stamped, fields, removedFieldIds });
    return false;
  }
  try {
    const ok = await upsertRows("forms", [stamped]);
    if (!ok) throw new Error("forms upsert failed");
    if ((fields || []).length > 0) {
      const okF = await upsertRows("form_fields", fieldRowsFor(stamped, fields));
      if (!okF) throw new Error("form_fields upsert failed");
    }
    if (Array.isArray(removedFieldIds) && removedFieldIds.length > 0) {
      const { error } = await withTimeout(supabase.from("form_fields").delete().in("id", removedFieldIds));
      if (error) throw error;
    }
    return true;
  } catch {
    // Cloud unavailable/rejected — keep the full intent queued (upserts are idempotent).
    queueFormOp({ kind: "upsert_form", payload: stamped, fields, removedFieldIds });
    return false;
  }
}

/**
 * OFFLINE-FIRST DELETE (AdminForms).
 * Local caches are purged immediately and the form is tombstoned, so neither
 * the cached list nor a cloud refetch can bring it back before the delete
 * reaches Supabase. Returns true only when the cloud delete succeeded.
 */
export async function deleteFormOnlineFirst(id: string): Promise<boolean> {
  await removeCachedForm(id);
  lsRemove(`cachedFormMeta_${id}`);
  lsRemove(`cachedFormFields_${id}`);

  if (!isOnline()) {
    addTombstone(id);
    queueFormOp({ kind: "delete_form", payload: { id } });
    return false;
  }
  try {
    await cloudDeleteForm(id);
    clearTombstone(id);
    return true;
  } catch {
    addTombstone(id);
    queueFormOp({ kind: "delete_form", payload: { id } });
    return false;
  }
}

/**
 * OFFLINE-FIRST SETTING FLIP (AdminFormSubmissions — "User downloads" gate).
 * Local caches flip instantly; cloud write queued on failure.
 * Returns true only when the cloud write succeeded.
 */
export async function setAllowDownloadOfflineFirst(formId: string, next: boolean): Promise<boolean> {
  const patch = { id: formId, allow_download: next, updated_at: new Date().toISOString() };

  // Local, instantly (meta JSON used by the builder/responses pages + list cache).
  try {
    const m = JSON.parse(lsGet(`cachedFormMeta_${formId}`) || "null");
    lsSet(`cachedFormMeta_${formId}`, JSON.stringify({ ...(m || {}), ...patch }));
  } catch { lsSet(`cachedFormMeta_${formId}`, JSON.stringify(patch)); }
  await putCachedForm(patch);

  if (!isOnline()) {
    queueFormOp({ kind: "patch_form", payload: patch });
    return false;
  }
  try {
    const { id, ...cols } = patch;
    const { error } = await withTimeout(supabase.from("forms").update(cols).eq("id", id));
    if (error) throw error;
    return true;
  } catch {
    queueFormOp({ kind: "patch_form", payload: patch });
    return false;
  }
}

/**
 * Refresh the local forms cache from the cloud (AdminForms).
 * Tombstoned forms are never written back; queued upserts for this tenant are
 * overlaid so offline-created forms survive a cache refresh before their
 * cloud write completes. Pass `prefetched` to reuse rows already fetched by
 * the caller (avoids a duplicate query).
 */
export async function cacheForms(
  tenantId: string,
  prefetched?: { rows?: any[]; counts?: Record<string, number> }
): Promise<void> {
  try {
    let rawRows: any[] = [];
    let counts: Record<string, number> = {};
    if (prefetched?.rows) {
      rawRows = prefetched.rows;
      counts = prefetched.counts || {};
    } else {
      if (!isOnline()) return;
      const { data, error } = await withTimeout(
        supabase.from("forms")
          .select("id, tenant_id, title, description, status, updated_at, visible_to")
          .eq("tenant_id", tenantId),
        8000
      );
      if (error) throw error;
      rawRows = data || [];
      try {
        const { data: subs } = await withTimeout(
          supabase.from("form_submissions").select("form_id").eq("tenant_id", tenantId),
          8000
        );
        counts = (subs || []).reduce((acc: Record<string, number>, s: any) => {
          acc[s.form_id] = (acc[s.form_id] || 0) + 1;
          return acc;
        }, {});
      } catch { /* counts are cosmetic */ }
    }

    const tombstones = new Set(getDeletedFormIds());
    const byId = new Map<string, any>();
    (rawRows || [])
      .filter((f: any) => f?.id && !tombstones.has(f.id))
      .forEach((f: any) => byId.set(f.id, { ...f, submission_count: counts[f.id] || 0 }));

    readPendingFormOps()
      .filter((op) => op.kind === "upsert_form" && op.payload?.tenant_id === tenantId)
      .forEach((op) => {
        const p = op.payload;
        if (!p?.id || tombstones.has(p.id)) return;
        const prev = byId.get(p.id);
        byId.set(p.id, { ...prev, ...p, submission_count: prev?.submission_count ?? 0 });
      });

    await cacheReplaceTenant(tenantId, Array.from(byId.values()));
  } catch { /* keep the previous cache on any failure */ }
}

// ------------------------------ flush (replay) -----------------------------

let flushing: Promise<number> | null = null;

/** Replays queued writes against Supabase. Returns how many ops synced. */
export function flushPendingFormOps(): Promise<number> {
  if (flushing) return flushing;
  flushing = doFlush().finally(() => { flushing = null; });
  return flushing;
}

async function doFlush(): Promise<number> {
  const ops = readPendingFormOps();
  if (ops.length === 0 || !isOnline()) return 0;

  const remaining: FormOp[] = [];
  let synced = 0;

  for (const op of ops) {
    try {
      if (op.kind === "upsert_form") {
        const payload = { ...op.payload, updated_at: op.payload?.updated_at || new Date().toISOString() };
        const ok = await upsertRows("forms", [payload]);
        if (!ok) throw new Error("forms upsert failed");
        if (Array.isArray(op.fields) && op.fields.length > 0) {
          const okF = await upsertRows("form_fields", fieldRowsFor(payload, op.fields));
          if (!okF) throw new Error("form_fields upsert failed");
        }
        if (Array.isArray(op.removedFieldIds) && op.removedFieldIds.length > 0) {
          const { error } = await withTimeout(supabase.from("form_fields").delete().in("id", op.removedFieldIds));
          if (error) throw error;
        }
        await putCachedForm(payload);
        synced++;
      } else if (op.kind === "patch_form") {
        const { id, ...cols } = op.payload;
        if (!id) throw new Error("patch_form without id");
        const stamped = { ...cols, updated_at: new Date().toISOString() };
        const { error } = await withTimeout(supabase.from("forms").update(stamped).eq("id", id));
        if (error) throw error;
        await putCachedForm({ ...op.payload, updated_at: stamped.updated_at });
        synced++;
      } else if (op.kind === "delete_form") {
        const id = op.payload?.id;
        if (!id) throw new Error("delete_form without id");
        await cloudDeleteForm(id);
        await removeCachedForm(id);
        clearTombstone(id);
        synced++;
      }
    } catch {
      remaining.push(op); // still failing — retry on the next flush
    }
  }

  writePendingFormOps(remaining);
  return synced;
}
