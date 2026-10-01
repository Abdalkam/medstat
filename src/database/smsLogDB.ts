// src/database/smsLogDB.ts
// Offline-first SMS log storage:
//   - Every log is written to local Dexie instantly (survives refresh, works offline)
//   - Pushed to Supabase best-effort; failures marked synced:false and retried silently
//   - Cloud logs are pulled and merged into Dexie so history + dashboard graph
//     survive app updates and work across every device of the tenant.
import { db } from "./db";
import { supabase } from "../auth/supabase";

export interface SmsLog {
  id: string;
  tenant_id?: string | null;
  phone: string;
  message: string;
  status: string;
  sent_by?: string | null;
  sentAt: string;   // ISO string (local field name used by Dexie)
  synced?: boolean; // has this row reached Supabase?
}

function normalize(log: any): SmsLog {
  return {
    id: log.id || crypto.randomUUID(),
    tenant_id: log.tenant_id ?? null,
    phone: log.phone ?? "",
    message: log.message || "",
    status: log.status || "Success",
    sent_by: log.sent_by ?? null,
    sentAt: log.sentAt || log.sent_at || new Date().toISOString(),
    synced: log.synced ?? true,
  };
}

// Write logs locally (instant) and push to Supabase in the background.
export async function recordSmsLogs(rawLogs: any[]): Promise<void> {
  if (!rawLogs || rawLogs.length === 0) return;
  const logs = rawLogs.map(normalize);

  // 1. Local write first — this is what history + the dashboard graph read
  try { await db.smsLogs.bulkPut(logs); }
  catch (e) { console.error("Local SMS log save failed (check db.ts schema includes smsLogs)", e); return; }

  // 2. Cloud write — on failure, flag for silent retry
  try {
    const { error } = await supabase.from("sms_logs").insert(
      logs.map((l) => ({
        id: l.id, tenant_id: l.tenant_id, phone: l.phone, message: l.message,
        status: l.status, sent_by: l.sent_by, sent_at: l.sentAt,
      }))
    );
    if (error) {
      await db.smsLogs.bulkPut(logs.map((l) => ({ ...l, synced: false })));
      console.warn("SMS log cloud save failed (will retry silently):", error.message);
    }
  } catch {
    await db.smsLogs.bulkPut(logs.map((l) => ({ ...l, synced: false })));
  }
}

// Push locally-saved-but-unsynced logs to Supabase. Returns how many synced.
export async function syncUnsyncedSmsLogs(): Promise<number> {
  let synced = 0;
  try {
    const unsynced = await db.smsLogs.filter((l: any) => l.synced === false).toArray();
    for (const log of unsynced) {
      try {
        const { error } = await supabase.from("sms_logs").upsert({
          id: log.id, tenant_id: log.tenant_id ?? null, phone: log.phone,
          message: log.message, status: log.status, sent_by: log.sent_by ?? null, sent_at: log.sentAt,
        }, { onConflict: "id" });
        if (error) throw error;
        await db.smsLogs.update(log.id, { synced: true });
        synced++;
      } catch { /* keep unsynced — retried next time */ }
    }
  } catch { /* local db unavailable */ }
  return synced;
}

// Pull cloud logs into local Dexie (merge, dedupe by id). Returns how many were new.
export async function pullRemoteSmsLogs(tenantId?: string | null): Promise<number> {
  if (!tenantId) return 0;
  try {
    const { data, error } = await supabase
      .from("sms_logs")
      .select("id, tenant_id, phone, message, status, sent_by, sent_at")
      .eq("tenant_id", tenantId)
      .order("sent_at", { ascending: false })
      .limit(1000);
    if (error || !data || data.length === 0) return 0;

    const remote: SmsLog[] = data.map((r: any) => normalize({ ...r, sentAt: r.sent_at, synced: true }));
    const existingIds = new Set((await db.smsLogs.toArray()).map((l: any) => l.id));
    const fresh = remote.filter((r) => !existingIds.has(r.id));
    if (fresh.length > 0) await db.smsLogs.bulkPut(fresh);
    return fresh.length;
  } catch { return 0; }
}