// ============================================================================
// src/api/walletApi.ts — prepaid wallet data layer (Express backend edition)
// ----------------------------------------------------------------------------
// Talks to the MedStat Express API (/api/wallet/*) with your own JWT from the
// login flow — the MTN keys never touch the client. Exports are identical to
// the previous Supabase edition, so WalletDashboard.tsx needs no changes.
// ============================================================================

/* ---------------- Server base URL ----------------
 * 1. VITE_API_URL env var if set (Vercel → Settings → Environment Variables)
 * 2. Production builds fall back to the Render API, so the deployed app
 *    never points at localhost.
 * 3. Local dev falls back to http://localhost:3001.
 * ------------------------------------------------------------------ */

const API_BASE = (
  ((import.meta as any)?.env?.VITE_API_URL as string) ||
  (import.meta.env.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:3001")
).replace(/\/+$/, "");

/* ---------------- Auth token ----------------
 * Your login flow stores the JWT — by default we look in the places this app
 * uses: localStorage "authToken" / "token", or inside the currentUser object.
 * If your key differs, call setWalletAuthTokenProvider(() => yourToken) once
 * at startup (e.g. in main.tsx).
 * ------------------------------------------------------------------ */

function defaultAuthTokenProvider(): string | null {
  try {
    const direct = localStorage.getItem("authToken") || localStorage.getItem("token");
    if (direct) return direct;
    const me = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return me?.authToken || me?.token || null;
  } catch {
    return null;
  }
}

let authTokenProvider: () => string | null = defaultAuthTokenProvider;

export function setWalletAuthTokenProvider(provider: () => string | null): void {
  authTokenProvider = provider;
}

/* ---------------- Types ---------------- */

export interface Wallet {
  id: string;
  tenant_id: string;
  currency: string;
  balance_ugx: number;
  low_balance_threshold_ugx: number;
  updated_at: string;
}

export interface WalletTransaction {
  id: string;
  tenant_id: string;
  direction: "credit" | "debit";
  tx_type: "topup" | "usage" | "refund" | "adjustment";
  amount_ugx: number;
  status: "pending" | "successful" | "failed";
  provider: string;
  provider_tx_id: string | null;
  external_reference: string | null;
  payer_msisdn: string | null;
  description: string | null;
  balance_after_ugx: number | null;
  created_at: string;
  completed_at: string | null;
}

export interface UsageRecord {
  id: string;
  service_id: string;
  rate_id: string | null;
  quantity: number;
  unit_price_ugx: number;
  total_amount_ugx: number;
  description: string | null;
  reference: string | null;
  wallet_transaction_id: string | null;
  created_at: string;
  service?: { name: string; unit_label: string } | null;
}

export interface BillingRateRow {
  id: string;
  rate_ugx: number;
  valid_from: string;
  valid_to: string | null;
  is_active: boolean;
}

export interface BillingServiceRow {
  id: string;
  code: string;
  name: string;
  unit_label: string;
  description: string | null;
  is_active: boolean;
  rates?: BillingRateRow[];
}

export interface MtnConfigInfo {
  environment: string; // "sandbox" | "mtnuganda" | ...
  currency: string;    // "EUR" in sandbox | "UGX" in production
  configured: boolean;
}

export interface TopupInitResult {
  referenceId: string;
  transactionId: string;
  status: string;
  environment: string;
  currency: string;
  message: string;
}

export interface TopupStatusResult {
  status: "PENDING" | "SUCCESSFUL" | "FAILED" | string;
  providerTxId?: string | null;
  reason?: string | null;
}

/* ---------------- Fetch helper ---------------- */

async function walletFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const token = authTokenProvider();
  const res = await fetch(`${API_BASE}/api/wallet/${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as any)?.error || `Wallet request failed (${res.status}).`);
  }
  return payload as T;
}

/* ---------------- Reads (tenant is derived from the JWT server-side) ---------------- */

export async function fetchWallet(_tenantId?: string): Promise<Wallet | null> {
  try {
    const data = await walletFetch<{ wallet: Wallet }>("balance");
    return data?.wallet ?? null;
  } catch (e) {
    // A missing wallet just means the migration hasn't seeded this tenant yet
    if ((e as Error).message.toLowerCase().includes("not initialized")) return null;
    throw e;
  }
}

export async function fetchTransactions(_tenantId?: string, limit = 60): Promise<WalletTransaction[]> {
  const data = await walletFetch<{ transactions: WalletTransaction[] }>(`transactions?limit=${limit}`);
  return data?.transactions ?? [];
}

export async function fetchUsage(_tenantId?: string, limit = 25): Promise<UsageRecord[]> {
  const data = await walletFetch<{ usage: UsageRecord[] }>(`usage?limit=${limit}`);
  return data?.usage ?? [];
}

export async function fetchServices(_tenantId?: string): Promise<BillingServiceRow[]> {
  const data = await walletFetch<{ services: BillingServiceRow[] }>("services");
  return data?.services ?? [];
}

/** Latest rate valid today for a service (used by the services card). */
export function activeRate(service: BillingServiceRow): number | null {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (service.rates ?? [])
    .filter((r) => r.is_active && r.valid_from <= today && (!r.valid_to || r.valid_to >= today))
    .sort((a, b) => (a.valid_from < b.valid_from ? 1 : -1));
  return rows[0]?.rate_ugx ?? null;
}

/* ---------------- MTN MoMo top-up flow ---------------- */

export async function fetchWalletConfig(): Promise<MtnConfigInfo> {
  return walletFetch<MtnConfigInfo>("config");
}

export async function initiateMtnTopup(params: {
  amount: number;
  msisdn: string;
  description?: string;
}): Promise<TopupInitResult> {
  return walletFetch<TopupInitResult>("topup", { method: "POST", body: params });
}

export async function pollTopupStatus(reference: string): Promise<TopupStatusResult> {
  return walletFetch<TopupStatusResult>("topup/status", { method: "POST", body: { reference } });
}

/** Normalizes Ugandan input into MSISDN form (0772… / +256772… -> 256772…). */
export function normalizePhone(raw: string): string {
  let digits = (raw || "").replace(/\D/g, "");
  if (digits.startsWith("0")) digits = "256" + digits.slice(1);
  if (!digits.startsWith("256") && digits.length === 9) digits = "256" + digits;
  return digits;
}

/* ---------------- Live-ish updates ----------------
 * The Express backend is the source of truth, so instead of Supabase
 * Realtime we refresh periodically while the tab is visible. The dashboard
 * also refreshes immediately after every top-up status change.
 * ------------------------------------------------------------------ */

export function subscribeWalletChanges(_tenantId: string, onChange: () => void): () => void {
  const id = window.setInterval(() => {
    if (document.visibilityState !== "visible") return;
    try { onChange(); } catch { /* keep polling */ }
  }, 15_000);
  return () => window.clearInterval(id);
}

/* ---------------- Charging usage from app code ----------------
 * Usually you don't need this — /api/sms/send already charges the wallet for
 * delivered SMS. Use recordUsage for your own custom billable events:
 *
 *   import { recordUsage } from "../api/walletApi";
 *   await recordUsage("seat", 1, "New learner seat - Kampala campus");
 *
 * Throws INSUFFICIENT_FUNDS (HTTP 402) when the prepaid balance cannot
 * cover the charge — nothing is consumed in that case.
 * ------------------------------------------------------------------ */

export async function recordUsage(
  serviceCode: string,
  quantity: number,
  description?: string,
  reference?: string,
): Promise<void> {
  await walletFetch("usage", {
    method: "POST",
    body: { serviceCode, quantity, description, reference },
  });
}
