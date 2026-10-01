// src/database/formDB.ts
// Offline-first forms storage for ADMIN pages:
//   - Lists/builder read Dexie instantly, then refresh from Supabase when online
//   - Every cloud write is attempted; on failure the intent is queued in
//     localStorage and retried silently on load / reconnect (flushPendingFormOps)
import { db, type FormCache } from "./db";
import { supabase } from "../auth/supabase";

const OPS_KEY = "pendingFormOps";

type PendingOp =
  | { kind: "upsert_form"; payload: any; fields?: any[] }
  | { kind: "delete_form"; formId: string };

function readOps(): PendingOp[] {
  try { const q = JSON.parse(localStorage.getItem(OPS_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeOps(ops: PendingOp[]) {
  try { localStorage.setItem(OPS_KEY, JSON.stringify(ops)); } catch { /* quota — ignore */ }
}

export function queueFormOp(op: PendingOp) {
  writeOps([...readOps(), op]);
}

// Push all queued form writes to Supabase. Returns how many succeeded.
export async function flushPendingFormOps(): Promise<number> {
  const ops = readOps();
  if (ops.length === 0) return 0;
  const remaining: PendingOp[] = [];
  let done = 0;
  for (const op of ops) {
    try {
      if (op.kind === "upsert_form") {
        const { error } = await supabase.from("forms").upsert(op.payload, { onConflict: "id" });
        if (error) throw error;
        if (op.fields) {
          await supabase.from("form_fields").delete().eq("form_id", op.payload.id);
          if (op.fields.length > 0) {
            const { error: ffErr } = await supabase.from("form_fields").upsert(op.fields, { onConflict: "id" });
            if (ffErr) throw ffErr;
          }
        }
        try { await db.formCache.update(op.payload.id, { synced: true }); } catch {}
      } else if (op.kind === "delete_form") {
        await supabase.from("form_fields").delete().eq("form_id", op.formId);
        await supabase.from("form_submissions").delete().eq("form_id", op.formId);
        const { error } = await supabase.from("forms").delete().eq("id", op.formId);
        if (error) throw error;
        try { await db.formCache.delete(op.formId); } catch {}
      }
      done++;
    } catch { remaining.push(op); /* keep unsynced — retried next time */ }
  }
  writeOps(remaining);
  return done;
}

// Cache ALL forms (with full field lists) for offline admin access
export async function cacheForms(tenantId: string): Promise<void> {
  try {
    const { data: forms, error } = await supabase
      .from("forms").select("*").eq("tenant_id", tenantId).order("updated_at", { ascending: false });
    if (error || !forms) return;

    const { data: allFields } = await supabase
      .from("form_fields").select("*").eq("tenant_id", tenantId).order("sort_order", { ascending: true });

    const byForm: Record<string, any[]> = {};
    (allFields || []).forEach((f: any) => { (byForm[f.form_id] ||= []).push(f); });

    const rows: FormCache[] = forms.map((f: any) => ({
      ...f,
      fields: byForm[f.id] || [],
      synced: true,
    }));
    await db.formCache.clear();
    await db.formCache.bulkPut(rows);
  } catch { /* offline — cache untouched */ }
}

export async function getFormFromCache(formId: string): Promise<FormCache | undefined> {
  try { return await db.formCache.get(formId); } catch { return undefined; }
}

// Offline-aware save: mirrors to local cache always, writes to Supabase when
// possible, queues the whole form+fields when not. Returns true if it reached the cloud.
export async function saveFormOnlineFirst(payload: any, fields?: any[]): Promise<boolean> {
  try {
    await db.formCache.put({ ...payload, fields: fields || [], synced: navigator.onLine });
  } catch { /* cache write failed — still try cloud */ }

  if (navigator.onLine) {
    try {
      const { error } = await supabase.from("forms").upsert(payload, { onConflict: "id" });
      if (!error) {
        if (fields) {
          await supabase.from("form_fields").delete().eq("form_id", payload.id);
          if (fields.length > 0) {
            const { error: ffErr } = await supabase.from("form_fields").upsert(fields, { onConflict: "id" });
            if (ffErr) throw ffErr;
          }
        }
        try { await db.formCache.update(payload.id, { synced: true }); } catch {}
        return true;
      }
    } catch { /* fall through to queue */ }
  }
  queueFormOp({ kind: "upsert_form", payload, fields });
  return false;
}

// Offline-aware delete: local cache delete always, cloud delete or queued.
export async function deleteFormOnlineFirst(formId: string): Promise<boolean> {
  try { await db.formCache.delete(formId); } catch {}
  if (navigator.onLine) {
    try {
      await supabase.from("form_fields").delete().eq("form_id", formId);
      await supabase.from("form_submissions").delete().eq("form_id", formId);
      const { error } = await supabase.from("forms").delete().eq("id", formId);
      if (!error) return true;
    } catch { /* queue */ }
  }
  queueFormOp({ kind: "delete_form", formId });
  return false;
}