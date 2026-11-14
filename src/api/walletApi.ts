// ============================================================================
// src/api/walletApi.ts — prepaid wallet data layer (Express backend edition)
// v2 — self-discovering auth token (fixes the 401 on /api/wallet/*)
// ----------------------------------------------------------------------------
// Talks to the MedStat Express API (/api/wallet/*) with your own JWT from the
// login flow — the MTN keys never touch the client. Exports are identical to
// the previous edition, so WalletDashboard.tsx needs NO changes.
//
// WHAT'S NEW IN v2:
//   • The token provider now searches everywhere your login JWT could hide:
//       1. localStorage / sessionStorage under common key names
//          (authToken, token, jwt, accessToken, ... , medstat_token, ...)
//       2. inside the "currentUser" object (any field, any nesting level)
//       3. a wide scan of every storage entry for a JWT-shaped string
//          (Supabase "sb-..." keys and refresh tokens are skipped)
//       4. cookies named like *token* / *auth* / *session* (last resort)
//   • Clear 401 error messages that tell you whether a token was even found.
//   • debugWalletAuth() — run it in the browser console (F12) on the deployed
//     site to see exactly what the provider finds (JWT payload included).
// ============================================================================

/* ---------------- Server base URL ----------------
 * 1. VITE_API_URL env var if set (Vercel → Settings → Environment Variables)
 * 2. Production builds fall back to the Render API, so the deployed app
 *    never points at localhost.
 * 3. Local dev falls back to http://localhost:3001.
 * ------------------------------------------------------------------ */

const ENV = ((import.meta as any)?.env ?? {}) as {
  PROD?: boolean;
  VITE_API_URL?: string;
};

const API_BASE = (
  ENV.VITE_API_URL ||
  (ENV.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:3001")
).replace(/\/+$/, "");

/* ---------------- Auth token (v2: find it wherever it lives) ----------------
 * If your login flow stores the JWT somewhere unusual, you can still wire it
 * manually — call this ONCE at startup (e.g. in main.tsx):
 *
 *   import { setWalletAuthTokenProvider } from "./api/walletApi";
 *   setWalletAuthTokenProvider(() => authContext.token);
 *
 * ------------------------------------------------------------------ */

const TOKEN_KEY_CANDIDATES = [
  "authToken", "token", "jwt", "accessToken", "access_token",
  "auth_token", "idToken", "id_token", "sessionToken", "session_token",
  "medstat_token", "medstat_auth", "medstat:token", "auth",
];

/** Any non-empty, whitespace-free string that could be a token. */
function plausibleToken(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 16 && trimmed.length <= 2000 && !/\s/.test(trimmed);
}

/** Three dot-separated base64 segments — the classic JWT shape. */
function looksLikeJwt(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 40 &&
    !/\s/.test(value) &&
    value.split(".").length === 3
  );
}

/** "Bearer abc.def.gh" -> "abc.def.gh" */
function stripBearer(value: string): string {
  return value.replace(/^Bearer\s+/i, "").trim();
}

/** Decode a JWT payload without external libraries (browser-safe base64url). */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    let b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    b64 += "=".repeat((4 - (b64.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function listKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k) keys.push(k);
  }
  return keys;
}

/**
 * Deep-search any object for a token string. Token-ish key names win first;
 * after that, any JWT-shaped string; after that, nested objects (e.g.
 * { session: { access_token: "..." } }).
 */
function jwtFromObjectDeep(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== "object" || depth > 2) return null;
  const entries = Object.entries(obj as Record<string, unknown>);

  const named = entries.filter(
    ([k]) => /token|jwt|auth|session/i.test(k) && !/refresh|csrf/i.test(k),
  );
  for (const [, v] of named) {
    if (typeof v === "string") {
      const stripped = stripBearer(v);
      if (plausibleToken(stripped)) return stripped;
    }
  }
  for (const [, v] of entries) {
    if (looksLikeJwt(v)) return v;
  }
  for (const [, v] of entries) {
    const nested = jwtFromObjectDeep(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

/** Wide scan of one storage area for a JWT-shaped value. */
function scanStorageForJwt(storage: Storage): string | null {
  for (const key of listKeys(storage)) {
    const lower = key.toLowerCase();
    // Skip Supabase client keys and anything refresh-related.
    if (
      lower.startsWith("sb-") ||
      lower.includes("refresh") ||
      lower.includes("verifier") ||
      lower.includes("nonce")
    ) {
      continue;
    }
    const value = storage.getItem(key);
    if (!value) continue;

    const stripped = stripBearer(value);
    if (looksLikeJwt(stripped)) return stripped;

    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        const found = jwtFromObjectDeep(JSON.parse(trimmed));
        if (found) return found;
      } catch {
        /* not JSON — ignore */
      }
    }
  }
  return null;
}

function tokenFromDirectKeys(): string | null {
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of TOKEN_KEY_CANDIDATES) {
      try {
        const value = storage.getItem(key);
        if (!value) continue;
        const stripped = stripBearer(value);
        if (plausibleToken(stripped)) return stripped;
      } catch {
        /* storage unavailable */
      }
    }
  }
  return null;
}

function tokenFromUserObject(): string | null {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const raw =
        storage.getItem("currentUser") ||
        storage.getItem("user") ||
        storage.getItem("auth");
      if (!raw) continue;
      const found = jwtFromObjectDeep(JSON.parse(raw));
      if (found) return found;
    } catch {
      /* not JSON — ignore */
    }
  }
  return null;
}

function tokenFromCookies(): string | null {
  try {
    for (const pair of document.cookie.split(";")) {
      const idx = pair.indexOf("=");
      if (idx < 0) continue;
      const name = pair.slice(0, idx).trim();
      const value = decodeURIComponent(pair.slice(idx + 1).trim());
      if (!/token|jwt|auth|session/i.test(name)) continue;
      if (/refresh|csrf/i.test(name)) continue;
      const stripped = stripBearer(value);
      if (plausibleToken(stripped)) return stripped;
    }
  } catch {
    /* ignore */
  }
  return null;
}

let warnedNoToken = false;
function warnNoTokenOnce(): void {
  if (warnedNoToken) return;
  warnedNoToken = true;
  try {
    console.warn(
      "[walletApi] No auth token found on this device. localStorage keys:",
      listKeys(localStorage),
      "\nIf your login JWT is kept elsewhere, call setWalletAuthTokenProvider(() => yourToken) " +
        "once at startup, or run debugWalletAuth() in the console for details.",
    );
  } catch {
    /* ignore */
  }
}

function defaultAuthTokenProvider(): string | null {
  const direct = tokenFromDirectKeys();
  if (direct) return direct;

  const fromUser = tokenFromUserObject();
  if (fromUser) return fromUser;

  try {
    const scanned =
      scanStorageForJwt(localStorage) || scanStorageForJwt(sessionStorage);
    if (scanned) return scanned;
  } catch {
    /* storage unavailable */
  }

  const fromCookie = tokenFromCookies();
  if (fromCookie) return fromCookie;

  warnNoTokenOnce();
  return null;
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
  const payload = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(
        token
          ? "Your session has expired or is no longer valid (401). Please sign out and sign in again, then retry."
          : "You are not signed in on this device (401) — no auth token was found. " +
            "Please sign in, then retry. (Run debugWalletAuth() in the browser console for details.)",
      );
    }
    throw new Error(
      payload?.error || payload?.message || `Wallet request failed (${res.status}).`,
    );
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

/* ---------------- Console diagnostic ----------------
 * On the deployed site: press F12 → Console, type  debugWalletAuth()  and
 * press Enter. It prints whether a token was found, decodes the JWT payload
 * (sub / email / exp) and lists every storage key — a mismatch is obvious
 * in seconds.
 * ------------------------------------------------------------------ */

export function debugWalletAuth(): void {
  console.log(
    "[walletApi] provider mode:",
    authTokenProvider === defaultAuthTokenProvider
      ? "auto-discover (default)"
      : "custom (setWalletAuthTokenProvider was used)",
  );

  const token = authTokenProvider();
  console.log(
    "[walletApi] token found:",
    token ? `yes (${token.length} chars)` : "NO — nothing that looks like a token",
  );

  if (token) {
    const payload = decodeJwtPayload(token);
    if (payload) {
      const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
      console.log("[walletApi] JWT payload:", {
        sub: payload.sub,
        email: payload.email ?? payload.username,
        issuedAt: typeof payload.iat === "number" ? new Date(payload.iat * 1000).toString() : null,
        expiresAt: exp ? exp.toString() : null,
        expired: exp ? exp.getTime() < Date.now() : "unknown",
        tenantId: (payload as any).tenantId ?? (payload as any).tenant_id ?? null,
        role: payload.role ?? null,
      });
    } else {
      console.log(
        "[walletApi] token is not a JWT (opaque session token?) — payload not decodable in the browser.",
      );
    }
  }

  console.groupCollapsed("[walletApi] localStorage keys");
  try {
    console.table(listKeys(localStorage).map((k) => ({ key: k })));
  } catch (e) {
    console.warn("unavailable", e);
  }
  console.groupEnd();

  console.groupCollapsed("[walletApi] sessionStorage keys");
  try {
    console.table(listKeys(sessionStorage).map((k) => ({ key: k })));
  } catch (e) {
    console.warn("unavailable", e);
  }
  console.groupEnd();

  console.groupCollapsed("[walletApi] currentUser object");
  try {
    for (const storage of [localStorage, sessionStorage]) {
      const raw = storage.getItem("currentUser");
      if (raw) {
        console.log(
          `from ${storage === localStorage ? "localStorage" : "sessionStorage"}:`,
          JSON.parse(raw),
        );
      }
    }
  } catch (e) {
    console.warn("not JSON / not present", e);
  }
  console.groupEnd();
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
