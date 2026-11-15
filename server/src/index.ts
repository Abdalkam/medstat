// index.ts — MedStat API
// Express + Supabase (Postgres) + Africa's Talking SMS + MTN MoMo prepaid wallet.
// Deployed on Render. Pairs with wallet_fix.sql v3 (run once in the Supabase SQL
// Editor): it guarantees every tenant has a wallet, backfills wallet_id,
// mirrors the legacy transaction_type <-> tx_type columns, installs self-healing
// triggers, and provides fn_confirm_topup (idempotent wallet credit).
//
// The server itself is SCHEMA-ADAPTIVE: every wallet_transactions write maps
// onto the column names the LIVE table actually uses (introspected once via
// Supabase's OpenAPI endpoint) and self-corrects on 42703/23502 errors — so
// top-ups survive column-name drift (tx_type vs transaction_type,
// amount_ugx vs amount, ...) even before the SQL patch has been re-applied.

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

// africastalking ships without TypeScript types; require() keeps it untyped.
const africastalking = require("africastalking");

dotenv.config();

// ==========================================
// CONFIG
// ==========================================
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// Render provides process.env.PORT as a string. Coerce to number
// (Number(undefined) -> NaN -> falls back to 3001) so app.listen() typechecks.
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_temp_key_change_me";
const DAILY_API_KEY = process.env.DAILY_API_KEY;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
    console.error("FATAL: Missing Supabase environment variables!");
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const at = africastalking({
    apiKey: process.env.AT_API_KEY || "",
    username: process.env.AT_USERNAME || "",
});
const smsService: any = at.SMS;

// Sender IDs tried in order; the first one that delivers a number wins.
const SMS_SENDER_IDS = ["MEDSTAT", "ATTech"] as const;

// Phone-verified but not-yet-registered users get a short-lived code here.
const otpStore = new Map<string, { code: string; expires: number }>();

// Housekeeping: drop expired OTP codes every 10 minutes.
setInterval(() => {
    const now = Date.now();
    for (const [key, value] of otpStore) {
        if (value.expires < now) otpStore.delete(key);
    }
}, 10 * 60 * 1000).unref();

// ==========================================
// MTN MoMo PREPAID WALLET — CONFIG & HELPERS
// (Collections API: pulls money FROM the payer's MoMo account INTO the wallet.
//  Prepaid contract: usage debits the wallet; hard stop at zero.)
// ==========================================

// MTN_TARGET_ENV accepts the MTN_MOMO_TARGET_ENV alias too.
const MTN_TARGET_ENV = process.env.MTN_TARGET_ENV || process.env.MTN_MOMO_TARGET_ENV || "sandbox"; // "sandbox" | "production" | country value
const MTN_IS_SANDBOX = MTN_TARGET_ENV === "sandbox";

// Base URL — overridable via MTN_BASE_URL because MTN migrated Uganda to the
// new MoMo platform (announcement 12 Oct 2026):
//   https://momoapi.momo.africa        NEW platform (Uganda live; credentials
//                                      come from the Partner Portal: User ID +
//                                      Credential Token)
//   https://proxy.momoapi.mtn.com      LEGACY platform (old API User UUID +
//                                      API Key; being phased out)
const MTN_BASE_URL = (process.env.MTN_BASE_URL || process.env.MTN_MOMO_BASE_URL ||
    (MTN_IS_SANDBOX
        ? "https://sandbox.momodeveloper.mtn.com"
        : "https://momoapi.momo.africa")).replace(/\/+$/, "");

// X-Target-Environment header — country-specific in production. MTN Uganda's
// value is "mtnuganda"; a bare "production" is NOT accepted and would fail
// auth. Setting MTN_TARGET_ENV directly to a country value also works.
const MTN_TARGET_ENV_HEADER = MTN_TARGET_ENV === "sandbox"
    ? "sandbox"
    : MTN_TARGET_ENV === "production"
        ? "mtnuganda"
        : MTN_TARGET_ENV;

// Credential variables accept BOTH naming schemes so Render can be configured
// with either: MTN_* (primary) or MTN_MOMO_* (alias).
const MTN_SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY || process.env.MTN_MOMO_SUBSCRIPTION_KEY || "";
const MTN_API_USER = process.env.MTN_API_USER || process.env.MTN_MOMO_USER_ID || "";
const MTN_API_KEY = process.env.MTN_API_KEY || process.env.MTN_MOMO_API_KEY || "";
const MTN_CURRENCY = MTN_IS_SANDBOX ? "EUR" : "UGX"; // sandbox is EUR-only

const MIN_TOPUP_UGX = 1000;
const MAX_TOPUP_UGX = 10000000;

function momoConfigured(): boolean {
    return Boolean(MTN_SUBSCRIPTION_KEY && MTN_API_USER && MTN_API_KEY);
}

/** Names of the MTN MoMo variables still missing (used for setup hints). */
function momoMissingVars(): string[] {
    const missing: string[] = [];
    if (!MTN_SUBSCRIPTION_KEY) missing.push("MTN_SUBSCRIPTION_KEY");
    if (!MTN_API_USER) missing.push("MTN_API_USER");
    if (!MTN_API_KEY) missing.push("MTN_API_KEY");
    return missing;
}

// Startup banner: makes a misconfigured wallet obvious in the Render logs
// immediately, instead of surfacing only when an admin tries a top-up.
if (momoConfigured()) {
    console.log(`MTN MoMo wallet ready (environment: ${MTN_TARGET_ENV}, currency: ${MTN_CURRENCY})`);
} else {
    console.warn(`MTN MoMo wallet DISABLED - missing environment variables: ${momoMissingVars().join(", ")}. `
        + "Set them in Render > Environment > Environment Variables (MTN_MOMO_* aliases are also accepted), then redeploy. "
        + "Wallet top-ups will fail until then.");
}

let momoTokenCache: { value: string; expiresAt: number } | null = null;

async function getMomoToken(): Promise<string> {
    if (momoTokenCache && momoTokenCache.expiresAt > Date.now() + 30000) {
        return momoTokenCache.value;
    }
    const basic = Buffer.from(`${MTN_API_USER}:${MTN_API_KEY}`).toString("base64");
    // Sandbox portal documents /collection/token/ (trailing slash); the new
    // platform docs use /collection/token — match each platform exactly.
    const res = await fetch(`${MTN_BASE_URL}/collection/token${MTN_IS_SANDBOX ? "/" : ""}`, {
        method: "POST",
        headers: {
            "Authorization": `Basic ${basic}`,
            "X-Reference-Id": MTN_API_USER,
            // Mandatory since the Oct 2026 "One API" MoMo platform upgrade
            "X-Target-Environment": MTN_TARGET_ENV_HEADER,
            "Ocp-Apim-Subscription-Key": MTN_SUBSCRIPTION_KEY,
        },
    });
    if (!res.ok) {
        throw new Error(`MTN token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    const data: any = await res.json();
    momoTokenCache = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
    return momoTokenCache.value;
}

// MoMo MSISDN: digits only — 0772123456 / +256772123456 -> 256772123456
function normalizeMsisdn(raw: string): string {
    let digits = (raw || "").replace(/\D/g, "");
    if (digits.startsWith("0")) digits = "256" + digits.slice(1);
    if (!digits.startsWith("256") && digits.length === 9) digits = "256" + digits;
    return digits;
}

// ==========================================
// SHARED HELPERS
// ==========================================

function formatPhoneNumber(phone: string): string {
    if (!phone) return "";
    // Remove all spaces, dashes, brackets
    let cleanPhone = phone.replace(/[\s()-]/g, "");
    // Convert local Ugandan numbers starting with '0' to international '+256'
    if (cleanPhone.startsWith("0")) {
        cleanPhone = "+256" + cleanPhone.substring(1);
    }
    // If it starts with '256' without the '+', add the '+'
    else if (cleanPhone.startsWith("256")) {
        cleanPhone = "+" + cleanPhone;
    }
    // If it has no '+' but has other digits, assume it's international and prepend '+'
    else if (!cleanPhone.startsWith("+")) {
        cleanPhone = "+" + cleanPhone;
    }
    return cleanPhone;
}

/**
 * Send SMS with sender-ID fallback: try each sender ID in order until every
 * recipient is delivered. Returns one status entry per recipient (the shape
 * used by sms_logs and by the OTP flow's success check).
 */
async function sendSmsWithFallback(to: string[], message: string): Promise<Array<{ phone: string; status: string }>> {
    const logs: Array<{ phone: string; status: string }> = [];
    let pending = [...to];

    for (const sender of SMS_SENDER_IDS) {
        if (pending.length === 0) break;
        const isLastSender = sender === SMS_SENDER_IDS[SMS_SENDER_IDS.length - 1];
        try {
            const result = await smsService.send({ to: pending, message, from: sender });
            const recipients: any[] = result?.SMSMessageData?.Recipients || [];
            const delivered = new Set<string>();
            for (const r of recipients) {
                if (r.status === "Success") {
                    logs.push({ phone: r.number, status: "Success" });
                    delivered.add(r.number);
                } else if (isLastSender) {
                    // No sender left to retry with — record the failure as-is.
                    logs.push({ phone: r.number, status: r.status || "Failed" });
                }
            }
            pending = pending.filter((n) => !delivered.has(n));
        } catch (err: any) {
            console.error(`SMS send via "${sender}" failed:`, err?.message || err);
        }
    }

    // Numbers no sender could handle (or requests that threw outright).
    for (const n of pending) logs.push({ phone: n, status: "Failed" });
    return logs;
}

/** Latest active UGX rate for a tenant + service code (0 = free / unpriced). */
async function getActiveUnitPrice(tenantId: string, serviceCode: string): Promise<number> {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const { data: svc } = await supabase
            .from("billing_services")
            .select("id")
            .eq("tenant_id", tenantId)
            .eq("code", serviceCode)
            .eq("is_active", true)
            .maybeSingle();
        if (!svc) return 0;

        const { data: rate } = await supabase
            .from("billing_rates")
            .select("rate_ugx")
            .eq("service_id", svc.id)
            .eq("is_active", true)
            .lte("valid_from", today)
            .or(`valid_to.is.null,valid_to.gte.${today}`)
            .order("valid_from", { ascending: false })
            .limit(1)
            .maybeSingle();
        return rate?.rate_ugx ?? 0;
    } catch (e: any) {
        console.error("Wallet pricing lookup failed (continuing unpriced):", e?.message);
        return 0; // pricing lookup must never block business flows
    }
}

/**
 * Bill the wallet: fn_record_usage prices the quantity and debits atomically.
 * Throws/returns the Postgres error when the balance cannot cover it.
 */
async function chargeWalletUsage(tenantId: string, serviceCode: string, quantity: number, description?: string): Promise<{ ok: boolean; error?: string }> {
    try {
        const { error } = await supabase.rpc("fn_record_usage", {
            p_tenant_id: tenantId,
            p_service_code: serviceCode,
            p_quantity: quantity,
            p_description: description ?? null,
            p_reference: null,
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true };
    } catch (e: any) {
        return { ok: false, error: e?.message || "Wallet charge failed" };
    }
}

// ============================================================
// <<LEDGER_ADAPTATION_BEGIN>>
// WALLET LEDGER — SCHEMA-ADAPTIVE WRITER
//
// The LIVE wallet_transactions table may spell its columns differently
// from this file: the deployed one carries a legacy NOT NULL
// transaction_type beside tx_type (the "null value in column
// \"transaction_type\" ... violates not-null constraint" -> 400 crash),
// and other builds name the amount column amount instead of amount_ugx.
// Rather than hard-coding one spelling, every ledger write:
//   1. reads the real column list once from Supabase's OpenAPI
//      introspection endpoint (cached for 5 minutes),
//   2. maps each logical field onto the columns that actually exist,
//      writing BOTH tx_type AND transaction_type when the table has
//      both (this is what kills the 400 "transaction_type" crash even
//      before wallet_fix.sql has been re-applied),
//   3. self-corrects on the two survivable Postgres errors:
//        42703 undefined column -> drop that column and retry
//        23502 null in column   -> fill a known alias and retry
// ============================================================

const LEDGER_TABLE = "wallet_transactions";

// Logical field names callers use (e.g. buildLedgerRow({ txType: "topup", ... })),
// mapped onto whatever the LIVE table actually calls them.
type LedgerField =
    | "walletId" | "tenantId" | "direction" | "txType" | "amount" | "status"
    | "provider" | "externalReference" | "providerTxId" | "payerMsisdn"
    | "description" | "completedAt" | "currency" | "internalReference";
type LedgerFields = Partial<Record<LedgerField, any>>;
type LedgerRow = Record<string, any>;

// Logical field -> column-name candidates, highest priority first.
const LEDGER_COLUMN_ALIASES: Record<string, string[]> = {
    walletId:          ["wallet_id"],
    tenantId:          ["tenant_id"],
    direction:         ["direction", "flow", "tx_direction"],
    txType:            ["tx_type", "transaction_type", "type", "transaction_kind", "kind"],
    amount:            ["amount_ugx", "amount", "transaction_amount", "value"],
    status:            ["status", "state", "transaction_status"],
    provider:          ["provider", "gateway", "source", "channel"],
    externalReference: ["external_reference", "momo_reference_id", "provider_reference", "reference_id", "reference", "request_id"],
    providerTxId:      ["provider_tx_id", "financial_transaction_id", "provider_transaction_id", "momo_transaction_id", "provider_ref"],
    payerMsisdn:       ["payer_msisdn", "msisdn", "payer_phone", "customer_msisdn", "phone_number", "phone"],
    description:       ["description", "narration", "notes", "memo", "reason"],
    completedAt:       ["completed_at", "completed_on", "finished_at", "updated_at"],
    currency:          ["currency"],
    internalReference: ["internal_reference"],
};

// Mirror groups: when the table carries several spellings of the same
// concept, the value is written to ALL of them.
const LEDGER_MIRROR_COLUMNS: Record<string, string[]> = {
    txType: ["tx_type", "transaction_type"],
};

let ledgerColumnsCache: string[] | null = null;
let ledgerColumnsCacheAt: number = 0;
const LEDGER_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Real column names of wallet_transactions, via Supabase's OpenAPI
 * introspection endpoint. Returns null when introspection is unavailable —
 * callers then fall back to the legacy hard-coded spellings.
 */
async function getLedgerColumns(): Promise<string[] | null> {
    const now = Date.now();
    if (ledgerColumnsCache && now - ledgerColumnsCacheAt < LEDGER_CACHE_TTL_MS) return ledgerColumnsCache;
    if (!supabaseUrl || !supabaseKey) return null;
    try {
        const res = await fetch(String(supabaseUrl).replace(/\/+$/, "") + "/rest/v1/", {
            headers: { apikey: supabaseKey, Authorization: "Bearer " + supabaseKey },
        });
        if (!res.ok) return null;
        const spec = await res.json();
        const props = spec && spec.definitions && spec.definitions[LEDGER_TABLE] && spec.definitions[LEDGER_TABLE].properties;
        if (!props) return null;
        ledgerColumnsCache = Object.keys(props);
        ledgerColumnsCacheAt = now;
        return ledgerColumnsCache;
    } catch (e) {
        return null;
    }
}

function pickLedgerColumns(logical: string, colSet: Set<string> | null): string[] {
    const candidates = LEDGER_COLUMN_ALIASES[logical] || [];
    if (!colSet) return candidates.length ? [candidates[0]] : [];
    return candidates.filter(function (c) { return colSet.has(c); });
}

/**
 * Map logical ledger fields onto the columns the live table actually has.
 * cols === null -> schema unknown: legacy first-candidate behaviour.
 */
function buildLedgerRow(fields: LedgerFields, cols: string[] | null): LedgerRow {
    const colSet = cols ? new Set(cols) : null;
    const row: LedgerRow = {};
    for (const logical of Object.keys(fields) as LedgerField[]) {
        const value = fields[logical];
        if (value === undefined) continue;
        const mirrors = LEDGER_MIRROR_COLUMNS[logical];
        if (mirrors) {
            for (const col of mirrors) {
                if (!colSet || colSet.has(col)) row[col] = value;
            }
            continue;
        }
        const hits = pickLedgerColumns(logical, colSet);
        if (hits.length) row[hits[0]] = value;
    }
    return row;
}

/** Pull the offending column name out of a Postgres/PostgREST error. */
function extractConstraintColumn(message: unknown): string | null {
    if (!message) return null;
    const msg = String(message);
    let m = msg.match(/null value in column\s+"?([^"\s,]+)"?/i);           // 23502
    if (m) return m[1];
    m = msg.match(/Could not find the '([^']+)' column/i);                  // PostgREST 42703
    if (m) return m[1];
    m = msg.match(/column\s+(?:[a-zA-Z0-9_]+\.)?"?([a-zA-Z0-9_]+)"?\s+does not exist/i); // raw 42703
    if (m) return m[1];
    return null;
}

/** Best safe value for a NOT NULL column the insert payload missed. */
function ledgerFallbackValue(column: string | null | undefined, fields: LedgerFields): any {
    const c = String(column || "").toLowerCase();
    if (c === "transaction_type" || c === "tx_type" || c === "type" || c === "kind" || c === "transaction_kind") return fields.txType;
    if (c === "amount" || c === "amount_ugx" || c === "transaction_amount" || c === "value") return fields.amount;
    if (c === "tenant_id") return fields.tenantId;
    if (c === "wallet_id") return fields.walletId;
    if (c === "status" || c === "state" || c === "transaction_status") return fields.status !== undefined ? fields.status : "pending";
    if (c === "direction" || c === "flow" || c === "tx_direction") return fields.direction;
    if (c === "currency") return fields.currency !== undefined ? fields.currency : "UGX";
    if (c === "provider" || c === "gateway" || c === "source" || c === "channel") return fields.provider;
    if (c === "external_reference" || c === "reference" || c === "momo_reference_id" || c === "provider_reference") return fields.externalReference;
    if (c === "payer_msisdn" || c === "msisdn" || c === "phone" || c === "phone_number") return fields.payerMsisdn;
    if (c === "description" || c === "narration" || c === "notes" || c === "memo") return fields.description;
    if (c === "completed_at" || c === "completed_on" || c === "finished_at") return fields.completedAt;
    if (c === "created_at" || c === "updated_at") return new Date().toISOString();
    return undefined;
}

/** Read a logical field back out of a ledger row, whatever it is called. */
function readLedgerField(tx: any, logical: string): any {
    const candidates = LEDGER_COLUMN_ALIASES[logical] || [];
    for (const c of candidates) {
        if (tx && Object.prototype.hasOwnProperty.call(tx, c) && tx[c] !== null && tx[c] !== undefined) return tx[c];
    }
    return null;
}

/**
 * Guarantee that a wallet row exists for the tenant and return it.
 * Preferred path: fn_ensure_wallet() from wallet_fix.sql (atomic, creates the
 * row when missing). Falls back to a plain lookup so the server still works
 * before the SQL patch has been applied — in that case the BEFORE INSERT
 * trigger from wallet_fix.sql fills wallet_id on the next write anyway.
 */
async function ensureWallet(tenantId: string, client: any = supabase): Promise<{ id: string } | null> {
    try {
        const { data: rpcData, error: rpcError } = await client.rpc("fn_ensure_wallet", { p_tenant_id: tenantId });
        if (!rpcError && rpcData) {
            const id = typeof rpcData === "string" ? rpcData : (rpcData && rpcData.fn_ensure_wallet);
            if (id) return { id: id };
        }
    } catch (e) {
        // RPC not deployed yet — fall through to the read-only lookup.
    }
    const { data: wallet } = await client.from("wallets").select("id").eq("tenant_id", tenantId).maybeSingle();
    return wallet ? { id: wallet.id } : null;
}

/** INSERT with schema adaptation + self-healing retries. */
async function insertLedgerRow(fields: LedgerFields, client: any = supabase, knownCols?: string[] | null): Promise<{ row: any; error: string | null }> {
    let cols: string[] | null;
    if (knownCols === undefined) {
        cols = await getLedgerColumns();
    } else {
        cols = knownCols;
    }
    const row: LedgerRow = buildLedgerRow(fields, cols);
    let lastMessage: string = "wallet_transactions insert failed";
    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await client.from(LEDGER_TABLE).insert([row]).select().single();
        if (!result.error) return { row: result.data, error: null };
        const message = String((result.error && result.error.message) || "");
        const code = String((result.error && result.error.code) || "");
        lastMessage = message || lastMessage;
        const column = extractConstraintColumn(message);
        const undefinedColumn = code === "42703" || /does not exist|Could not find the/i.test(message);
        const nullViolation = code === "23502" || /violates not-null constraint/i.test(message);
        if (column && undefinedColumn && Object.prototype.hasOwnProperty.call(row, column)) {
            delete row[column]; // wrong spelling for this table — drop it and retry
            continue;
        }
        if (column && nullViolation && !Object.prototype.hasOwnProperty.call(row, column)) {
            const fill = ledgerFallbackValue(column, fields);
            if (fill !== undefined) {
                row[column] = fill;
                continue;
            }
        }
        return { row: null, error: message || lastMessage };
    }
    return { row: null, error: lastMessage };
}

/** UPDATE with the same 42703 drop-and-retry self-healing. */
async function updateLedgerRow(id: string, fields: LedgerFields, client: any = supabase, knownCols?: string[] | null): Promise<string | null> {
    let cols: string[] | null;
    if (knownCols === undefined) {
        cols = await getLedgerColumns();
    } else {
        cols = knownCols;
    }
    const row: LedgerRow = buildLedgerRow(fields, cols);
    let lastMessage: string = "wallet_transactions update failed";
    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await client.from(LEDGER_TABLE).update(row).eq("id", id);
        if (!result.error) return null;
        const message = String((result.error && result.error.message) || "");
        const code = String((result.error && result.error.code) || "");
        lastMessage = message || lastMessage;
        const column = extractConstraintColumn(message);
        const undefinedColumn = code === "42703" || /does not exist|Could not find the/i.test(message);
        if (column && undefinedColumn && Object.prototype.hasOwnProperty.call(row, column)) {
            delete row[column];
            continue;
        }
        return message || lastMessage;
    }
    return lastMessage;
}

/**
 * Direct confirm path used when the fn_confirm_topup RPC is not deployed:
 * flips the pending row (at most once — guarded by status='pending') and
 * credits the tenant wallet exactly once. Returns null on success, else an
 * error message.
 */
async function fallbackConfirmTopup(tx: any, status: string | null | undefined, providerTxId: string | null | undefined, client: any = supabase): Promise<string | null> {
    const finalStatus = String(status || "").toLowerCase(); // "successful" | "failed"
    const cols = await getLedgerColumns();
    const colSet = cols ? new Set(cols) : null;
    const statusCol = pickLedgerColumns("status", colSet)[0] || "status";
    const claim = buildLedgerRow({
        status: finalStatus,
        providerTxId: providerTxId || undefined,
        completedAt: new Date().toISOString(),
    }, cols);
    let claimed: any[] | null = null;
    let claimError: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        const result = await client.from(LEDGER_TABLE).update(claim).eq("id", tx.id).eq(statusCol, "pending").select();
        if (!result.error) { claimed = result.data; claimError = null; break; }
        const message = String((result.error && result.error.message) || "");
        const column = extractConstraintColumn(message);
        if (column && Object.prototype.hasOwnProperty.call(claim, column)) {
            delete claim[column];
            continue;
        }
        claimError = message;
        break;
    }
    if (claimError) return claimError;
    if (!claimed || !claimed.length) return null; // not pending anymore — a concurrent poll already confirmed it
    if (finalStatus !== "successful") return null;
    const amount = readLedgerField(tx, "amount");
    if (!(Number(amount) > 0)) return null;
    const wallet = await ensureWallet(String(tx.tenant_id), client);
    if (!wallet) return "Wallet row missing — run wallet_fix.sql in the Supabase SQL Editor.";
    const walletRes = await client.from("wallets").select("*").eq("id", wallet.id).maybeSingle();
    if (walletRes.error) return String((walletRes.error && walletRes.error.message) || "wallet lookup failed");
    const w = walletRes.data;
    if (!w) return "Wallet row missing — run wallet_fix.sql in the Supabase SQL Editor.";
    const balanceCol = Object.prototype.hasOwnProperty.call(w, "balance_ugx") ? "balance_ugx" : "balance";
    const increment: Record<string, number> = {};
    increment[balanceCol] = Number(w[balanceCol] || 0) + Number(amount);
    const updateRes = await client.from("wallets").update(increment).eq("id", wallet.id);
    if (updateRes.error) return String((updateRes.error && updateRes.error.message) || "wallet credit failed");
    return null;
}
// <<LEDGER_ADAPTATION_END>>

// ==========================================
// MIDDLEWARE
// ==========================================

function requireAuth(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({ error: "No token provided" });
    }
    try {
        const token = authHeader.replace("Bearer ", "");
        const decoded: any = jwt.verify(token, JWT_SECRET);
        req.body = req.body ?? {};
        req.body._auth = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Invalid or expired token." });
    }
}

/**
 * Tenant scope for list endpoints. Admins may target another tenant via
 * ?tenant_id=...; everyone else is pinned to their own tenant (the previous
 * `tenant_id || _auth.tenantId` pattern let ANY authenticated user read any
 * other tenant's data by passing a foreign tenant_id).
 */
function resolveTenantScope(_auth: any, requestedTenantId?: unknown): string {
    const requested = typeof requestedTenantId === "string" && requestedTenantId ? requestedTenantId : null;
    return _auth.role === "admin" && requested ? requested : _auth.tenantId;
}

app.get("/api/health", (req: Request, res: Response) => {
    res.status(200).json({ status: "ok", message: "MedStat API is running" });
});

// ==========================================
// DAILY ROOM
// ==========================================
app.post("/api/create-daily-room", async (req: Request, res: Response) => {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ error: "Course ID is required" });
    const roomName = `course-${courseId}`;
    try {
        const checkResponse = await fetch(`https://api.daily.co/v1/rooms/${roomName}`, {
            method: "GET",
            headers: { Authorization: `Bearer ${DAILY_API_KEY}`, "Content-Type": "application/json" },
        });
        if (checkResponse.ok) {
            const existingRoom: any = await checkResponse.json();
            return res.status(200).json({ url: existingRoom.url });
        }
        const createResponse = await fetch("https://api.daily.co/v1/rooms", {
            method: "POST",
            headers: { Authorization: `Bearer ${DAILY_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                name: roomName,
                properties: {
                    enable_screenshare: true,
                    enable_chat: true,
                    autojoin: true,
                    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2,
                },
            }),
        });
        const newRoom: any = await createResponse.json();
        if (!createResponse.ok) throw new Error(newRoom?.info || "Failed to create room");
        res.status(200).json({ url: newRoom.url });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// AUTH — SEND CODE (OTP)
// ==========================================
app.post("/api/auth/send-code", async (req: Request, res: Response) => {
    const { phone: rawPhone } = req.body;
    if (!rawPhone) return res.status(400).json({ error: "Phone is required" });

    const phone = formatPhoneNumber(rawPhone);
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });

    const message = `Your SmartPages verification code is ${code}`;
    try {
        const finalLogs = await sendSmsWithFallback([phone], message);
        const successEntry = finalLogs.find((log) => log.status === "Success");
        if (successEntry) return res.json({ sent: true });

        const atError = finalLogs[0]?.status || "Failed to send verification SMS.";
        return res.status(500).json({ error: atError });
    } catch (error: any) {
        console.error("Verification SMS Error:", error);
        if (error?.message && error.message.includes("Unsupported")) {
            return res.status(400).json({ error: "Unsupported phone number format. Please use international format (e.g., +256...)." });
        }
        res.status(500).json({ error: error.message || "Failed to send SMS." });
    }
});

// ==========================================
// AUTH — VERIFY CODE
// ==========================================
app.post("/api/auth/verify-code", async (req: Request, res: Response) => {
    const { phone: rawPhone, code } = req.body;
    if (!rawPhone || !code) return res.status(400).json({ error: "Missing fields" });

    const phone = formatPhoneNumber(rawPhone);
    const storedOtp = otpStore.get(phone);
    if (!storedOtp) return res.status(400).json({ error: "No code requested or number format mismatch." });
    if (Date.now() > storedOtp.expires) {
        otpStore.delete(phone);
        return res.status(400).json({ error: "Code expired." });
    }
    if (storedOtp.code !== code) return res.status(400).json({ error: "Invalid code" });

    otpStore.delete(phone);
    try {
        const { data: tenant } = await supabase.from("tenants").select("id").eq("phone", phone).single();
        const tempToken = jwt.sign({ phone, purpose: "otp-verified" }, JWT_SECRET, { expiresIn: "5m" });
        res.json({ tenantExists: !!tenant, tempToken });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// AUTH — LOOKUP TENANT
// ==========================================
app.post("/api/auth/lookup-tenant", async (req: Request, res: Response) => {
    const { phone, business_name } = req.body;
    try {
        let query = supabase.from("tenants").select("id, business_name, phone");
        if (phone) {
            const cleanPhone = formatPhoneNumber(phone);
            query = query.eq("phone", cleanPhone);
        } else if (business_name) {
            query = query.ilike("business_name", `%${business_name}%`);
        } else {
            return res.status(400).json({ error: "Phone or business name is required" });
        }
        const { data: tenant, error } = await query.single();
        if (error || !tenant) return res.status(404).json({ error: "Tenant not found" });
        res.json({ tenant });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// AUTH — REGISTER TENANT
// ==========================================
app.post("/api/auth/register-tenant", async (req: Request, res: Response) => {
    const { phone, tempToken, businessName, username, password } = req.body;
    try {
        const payload: any = jwt.verify(tempToken, JWT_SECRET);
        if (payload.phone !== phone || payload.purpose !== "otp-verified") {
            return res.status(401).json({ error: "Invalid session" });
        }
    } catch (err) {
        return res.status(401).json({ error: "Token expired." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const { data: newTenant, error: tenantError } = await supabase
        .from("tenants")
        .insert([{ phone, business_name: businessName }])
        .select()
        .single();
    if (tenantError) return res.status(400).json({ error: tenantError.message });

    const { data: newUser, error: userError } = await supabase
        .from("users")
        .insert([{ tenant_id: newTenant.id, username, phone, password: passwordHash, role: "admin" }])
        .select()
        .single();
    if (userError) return res.status(400).json({ error: userError.message });

    const authToken = jwt.sign({ userId: newUser.id, tenantId: newTenant.id, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
    res.json({ authToken, user: { id: newUser.id, username, phone, role: "admin", tenantId: newTenant.id } });
});

// ==========================================
// AUTH — LOGIN
// ==========================================
app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { phone, tenantId: clientTenantId, business_name, username, password } = req.body;

    let finalTenantId: string | null = clientTenantId || null;
    if (!finalTenantId && phone) {
        const cleanPhone = formatPhoneNumber(phone);
        const { data: tenant } = await supabase.from("tenants").select("id").eq("phone", cleanPhone).single();
        if (!tenant) return res.status(404).json({ error: "Business not found" });
        finalTenantId = tenant.id;
    }
    if (!finalTenantId && business_name) {
        const { data: tenant } = await supabase.from("tenants").select("id").ilike("business_name", `%${business_name}%`).single();
        if (!tenant) return res.status(404).json({ error: "Business not found" });
        finalTenantId = tenant.id;
    }
    if (!finalTenantId) return res.status(400).json({ error: "Could not identify business." });

    const { data: user } = await supabase.from("users").select("*").eq("tenant_id", finalTenantId).eq("username", username).single();
    if (!user) return res.status(401).json({ error: "Invalid credentials" });

    // bcrypt for hashed passwords, plus a legacy fallback for rows that are
    // still plaintext (bcrypt.compare always fails on those). Hash them with
    // the README's one-time SQL so this fallback can eventually be removed.
    const typed = String(password ?? "");
    const stored = String(user.password ?? "");
    const passwordOk = stored === typed || // legacy plaintext rows ("0987", "1234", ...)
        (/^\$2[abxy]\$/.test(stored) && (await bcrypt.compare(typed, stored)));
    if (!passwordOk) return res.status(401).json({ error: "Invalid credentials" });

    const authToken = jwt.sign({ userId: user.id, tenantId: user.tenant_id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    res.json({
        authToken,
        user: {
            id: user.id,
            username: user.username,
            phone: user.phone,
            email: user.email,
            role: user.role,
            tenant_id: user.tenant_id,
            tenantId: user.tenant_id,
            assigned_courses: user.assigned_courses || [],
            profile_pic: user.profile_pic,
        },
    });
});

// ==========================================
// SMS — BULK/CUSTOM SEND (prepaid-gated)
// ==========================================
app.post("/api/sms/send", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { recipients, message } = req.body;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
        return res.status(400).json({ error: "Recipients array is required" });
    }
    if (!message) return res.status(400).json({ error: "Message content is required" });

    try {
        const formattedRecipients = recipients.map((p: string) => formatPhoneNumber(p));

        // PREPAID GATE — block sending when the wallet can't cover it.
        const unitPrice = await getActiveUnitPrice(_auth.tenantId, "sms");
        if (unitPrice > 0) {
            const { data: walletRow } = await supabase
                .from("wallets")
                .select("balance_ugx")
                .eq("tenant_id", _auth.tenantId)
                .maybeSingle();
            const balance = walletRow?.balance_ugx ?? 0;
            const estimatedCost = formattedRecipients.length * unitPrice;
            if (balance < estimatedCost) {
                return res.status(402).json({
                    error: `Insufficient wallet balance: UGX ${balance.toLocaleString("en-US")} available, UGX ${estimatedCost.toLocaleString("en-US")} needed for ${formattedRecipients.length} SMS. Load money via MTN MoMo in the Wallet dashboard.`,
                });
            }
        }

        // Send with sender-ID fallback (MEDSTAT first, then ATTech).
        const finalLogs = await sendSmsWithFallback(formattedRecipients, message);

        // PREPAID CHARGE — bill the wallet for delivered SMS (till zero).
        const delivered = finalLogs.filter((log) => log.status === "Success").length;
        if (delivered > 0 && unitPrice > 0) {
            const charge = await chargeWalletUsage(_auth.tenantId, "sms", delivered, `Bulk SMS — ${delivered} delivered`);
            if (!charge.ok) console.error("Wallet charge failed for SMS send:", charge.error);
        }

        // SAVE LOGS TO SUPABASE
        const logsToInsert = finalLogs.map((log) => ({
            id: randomUUID(),
            tenant_id: _auth.tenantId,
            phone: log.phone,
            message: message,
            status: log.status,
            sent_at: new Date().toISOString(),
            sent_by: _auth.userId,
        }));
        if (logsToInsert.length > 0) {
            const { error: logError } = await supabase.from("sms_logs").insert(logsToInsert);
            if (logError) console.error("Failed to save SMS logs to Supabase", logError);
        }

        // RESPOND TO FRONTEND
        const failedNumbers = logsToInsert.filter((log) => log.status !== "Success");
        if (failedNumbers.length > 0) {
            const failList = failedNumbers.map((f) => `${f.phone} (${f.status})`).join(", ");
            return res.status(400).json({ error: `Some SMS failed: ${failList}`, logs: logsToInsert });
        }
        res.json({ success: true, logs: logsToInsert });
    } catch (error: any) {
        console.error("Bulk SMS Error:", error);
        res.status(500).json({ error: error.message || "Failed to send SMS" });
    }
});

// ==========================================
// PREPAID WALLET — MTN MoMo TOP-UP & LEDGER (ADMIN)
// ==========================================

// Public (no auth): lets the UI show sandbox banners / setup warnings.
app.get("/api/wallet/config", (req: Request, res: Response) => {
    // missingVars = variable NAMES only (never values) so the UI can show a
    // precise setup banner; safe to expose publicly.
    res.json({ environment: MTN_TARGET_ENV, currency: MTN_CURRENCY, configured: momoConfigured(), missingVars: momoMissingVars() });
});

app.get("/api/wallet/balance", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    try {
        // Auto-initialize the wallet when the fn_ensure_wallet RPC is deployed.
        await ensureWallet(_auth.tenantId);
        const { data, error } = await supabase.from("wallets").select("*").eq("tenant_id", _auth.tenantId).maybeSingle();
        if (error) return res.status(400).json({ error: error.message });
        if (!data) return res.status(404).json({ error: "Wallet not initialized — run wallet_fix.sql in the Supabase SQL Editor." });
        res.json({ wallet: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/wallet/transactions", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    try {
        const { data, error } = await supabase
            .from("wallet_transactions")
            .select("*")
            .eq("tenant_id", _auth.tenantId)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ transactions: data || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/wallet/usage", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    try {
        const { data, error } = await supabase
            .from("usage_records")
            .select("*, service:billing_services(name, unit_label)")
            .eq("tenant_id", _auth.tenantId)
            .order("created_at", { ascending: false })
            .limit(limit);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ usage: data || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/wallet/services", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    try {
        const { data, error } = await supabase
            .from("billing_services")
            .select("*, rates:billing_rates(rate_ugx, valid_from, valid_to, is_active)")
            .eq("tenant_id", _auth.tenantId)
            .eq("is_active", true)
            .order("name", { ascending: true });
        if (error) return res.status(400).json({ error: error.message });
        res.json({ services: data || [] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Record usage manually (custom services) — bills the wallet, stops at zero.
app.post("/api/wallet/usage", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { serviceCode, quantity, description } = req.body;
    if (!serviceCode || !quantity || Number(quantity) <= 0) {
        return res.status(400).json({ error: "serviceCode and a positive quantity are required" });
    }
    const result = await chargeWalletUsage(_auth.tenantId, String(serviceCode), Number(quantity), description ? String(description) : undefined);
    if (!result.ok) {
        const insufficient = (result.error || "").includes("INSUFFICIENT_FUNDS");
        return res.status(insufficient ? 402 : 400).json({ error: result.error });
    }
    res.json({ success: true });
});

// Start a top-up: MTN prompts the admin's phone; wallet credited on approval.
app.post("/api/wallet/topup", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    if (_auth.role !== "admin") return res.status(403).json({ error: "Only admins can load the wallet." });
    if (!momoConfigured()) {
        return res.status(500).json({
            error: `MTN MoMo is not configured on the server (missing: ${momoMissingVars().join(", ")}). `
                + "Add them in Render > Environment > Environment Variables (MTN_MOMO_* aliases are also accepted), then redeploy.",
        });
    }

    const amount = Math.round(Number(req.body?.amount));
    const msisdn = normalizeMsisdn(String(req.body?.msisdn ?? ""));
    const description = String(req.body?.description ?? "Wallet top-up").slice(0, 120);

    if (!Number.isFinite(amount) || amount < MIN_TOPUP_UGX) {
        return res.status(400).json({ error: `Minimum top-up is UGX ${MIN_TOPUP_UGX.toLocaleString("en-US")}.` });
    }
    if (amount > MAX_TOPUP_UGX) {
        return res.status(400).json({ error: `Maximum single top-up is UGX ${MAX_TOPUP_UGX.toLocaleString("en-US")}.` });
    }
    // Production: strictly MTN Uganda mobile numbers. Sandbox: lenient (MTN's
    // documented test payer, e.g. 46733123450, is not a Ugandan number).
    if (MTN_IS_SANDBOX) {
        if (msisdn.length < 8) return res.status(400).json({ error: "Enter a valid payer phone number." });
    } else if (!/^2567\d{8}$/.test(msisdn)) {
        return res.status(400).json({ error: "Enter a valid MTN Uganda number, e.g. 0772123456." });
    }

    const referenceId = randomUUID();

    // 0. Make sure the tenant HAS a wallet (fixes the NULL wallet_id crash:
    //    "null value in column wallet_id of relation wallet_transactions").
    //    belt-and-braces: the SQL trigger from wallet_fix.sql would fill
    //    wallet_id anyway, but passing it explicitly keeps the ledger clean.
    const wallet = await ensureWallet(_auth.tenantId);

    // 1. Record the pending top-up in the ledger first.
    //    Schema-adaptive insert: maps onto the LIVE table's column names and
    //    writes BOTH tx_type and transaction_type when both exist — this is
    //    the fix for the 400 "null value in column transaction_type" crash.
    const ledgerInsert = await insertLedgerRow({
        walletId: wallet?.id,
        tenantId: _auth.tenantId,
        direction: "credit",
        txType: "topup",
        amount: amount,
        status: "pending",
        provider: "mtn_momo",
        externalReference: referenceId,
        payerMsisdn: msisdn,
        description,
    });
    if (ledgerInsert.error || !ledgerInsert.row) {
        const msg = ledgerInsert.error || "Could not record the top-up.";
        console.error("[topup] wallet_transactions insert failed:", msg);
        const hint = /violates not-null constraint|does not exist|Could not find/i.test(msg)
            ? " — run the latest wallet_fix.sql in the Supabase SQL Editor (it backfills wallets, mirrors tx_type/transaction_type and installs self-healing triggers)."
            : "";
        return res.status(400).json({ error: msg + hint });
    }
    const tx = ledgerInsert.row;

    // 2. Ask MTN to prompt the payer (Collections request-to-pay).
    try {
        const token = await getMomoToken();
        const momoRes = await fetch(`${MTN_BASE_URL}/collection/v1_0/requesttopay`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${token}`,
                "X-Reference-Id": referenceId, // becomes the status key
                "X-Target-Environment": MTN_TARGET_ENV_HEADER,
                "Ocp-Apim-Subscription-Key": MTN_SUBSCRIPTION_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                amount: String(amount), // sandbox: EUR, prod: UGX
                currency: MTN_CURRENCY,
                externalId: String(tx.id),
                payer: { partyIdType: "MSISDN", partyId: msisdn },
                payerMessage: description,
                payeeNote: "Prepaid wallet top-up",
            }),
        });
        if (momoRes.status !== 202) {
            const detail = (await momoRes.text()).slice(0, 200);
            await updateLedgerRow(tx.id, { status: "failed", completedAt: new Date().toISOString(), description: `${description} — rejected by MTN: ${detail}` });
            return res.status(502).json({ error: `MTN rejected the request (${momoRes.status}). ${detail}` });
        }
    } catch (e: any) {
        await updateLedgerRow(tx.id, { status: "failed", completedAt: new Date().toISOString(), description: `${description} — error: ${String(e?.message || e).slice(0, 180)}` });
        return res.status(502).json({ error: `Could not reach MTN: ${e?.message || e}` });
    }

    res.json({
        referenceId,
        transactionId: tx.id,
        status: "PENDING",
        environment: MTN_TARGET_ENV,
        currency: MTN_CURRENCY,
        message: `Approval prompt sent to ${msisdn}. Enter your MoMo PIN to approve.`,
    });
});

// Poll top-up status (dashboard polls ~3s) — confirms the ledger exactly once.
app.post("/api/wallet/topup/status", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const reference = String(req.body?.reference ?? "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) {
        return res.status(400).json({ error: "Invalid reference." });
    }

    // Scoped to the caller's tenant — nobody can confirm someone else's top-up.
    // select("*") + alias-aware reads: no 400 when the table spells
    // provider_tx_id differently (financial_transaction_id etc.).
    const ledgerCols = await getLedgerColumns().catch(() => null);
    const refColumn = pickLedgerColumns("externalReference", ledgerCols ? new Set(ledgerCols) : null)[0] || "external_reference";
    const { data: rows, error: txError } = await supabase
        .from("wallet_transactions")
        .select("*")
        .eq(refColumn, reference)
        .eq("tenant_id", _auth.tenantId)
        .limit(1);
    if (txError) return res.status(400).json({ error: txError.message });
    if (!rows || rows.length === 0) return res.status(404).json({ error: "Unknown reference." });

    const tx = rows[0];
    // Already final (confirmed by an earlier poll) — just report it.
    const currentStatus = String(readLedgerField(tx, "status") ?? "").toLowerCase();
    if (currentStatus && currentStatus !== "pending") {
        return res.json({ status: currentStatus.toUpperCase(), providerTxId: readLedgerField(tx, "providerTxId") });
    }
    if (!momoConfigured()) return res.json({ status: "PENDING" });

    try {
        const token = await getMomoToken();
        const momoRes = await fetch(`${MTN_BASE_URL}/collection/v1_0/requesttopay/${reference}`, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "X-Target-Environment": MTN_TARGET_ENV_HEADER,
                "Ocp-Apim-Subscription-Key": MTN_SUBSCRIPTION_KEY,
            },
        });
        if (!momoRes.ok) return res.status(502).json({ error: `MTN status check failed (${momoRes.status}).` });

        const st: any = await momoRes.json();
        // st: { status: "PENDING" | "SUCCESSFUL" | "FAILED", reason?, financialTransactionId? }
        if (st.status === "SUCCESSFUL" || st.status === "FAILED") {
            const { error: rpcError } = await supabase.rpc("fn_confirm_topup", {
                p_reference: reference,
                p_status: st.status,
                p_provider_tx_id: st.financialTransactionId ?? null,
            });
            if (rpcError) {
                const rpcMsg = String(rpcError.message || "");
                // fn_confirm_topup not deployed yet? Confirm directly so the
                // approval never dead-ends in a 400 after the payer has paid.
                if (/does not exist|PGRST202|Could not find the function|schema cache/i.test(rpcMsg)) {
                    const fbError = await fallbackConfirmTopup(tx, st.status, st.financialTransactionId ?? null);
                    if (fbError) return res.status(400).json({ error: fbError });
                    return res.json({
                        status: st.status,
                        providerTxId: st.financialTransactionId ?? null,
                        reason: st.reason?.code ?? null,
                    });
                }
                return res.status(400).json({ error: rpcError.message });
            }
            return res.json({
                status: st.status,
                providerTxId: st.financialTransactionId ?? null,
                reason: st.reason?.code ?? null,
            });
        }
        return res.json({ status: st.status ?? "PENDING" });
    } catch (e: any) {
        return res.status(502).json({ error: `Could not reach MTN: ${e?.message || e}` });
    }
});

// ==========================================
// DATA API — SECURE LIST ENDPOINTS
// ==========================================
// One factory for all "list rows with optional eq() filters" GET endpoints;
// keeps the query shapes and raw-array responses identical to the originals.

const USERS_COLUMNS = "id, tenant_id, username, phone, email, role, assigned_courses, profile_pic, tuition, remuneration, created_at";

interface ListRouteOptions {
    columns?: string;   // select list; defaults to "*"
    filters: string[];  // query params mapped to .eq(column, value) when present
    tenantScoped: boolean; // force .eq("tenant_id", <scope>) — admins may override via ?tenant_id=
}

function registerListRoute(route: string, table: string, options: ListRouteOptions) {
    app.get(route, requireAuth, async (req: Request, res: Response) => {
        const { _auth } = req.body;
        try {
            let query = supabase.from(table).select(options.columns || "*");
            if (options.tenantScoped) {
                query = query.eq("tenant_id", resolveTenantScope(_auth, req.query.tenant_id));
            }
            for (const filter of options.filters) {
                const value = req.query[filter];
                if (value) query = query.eq(filter, value as string);
            }
            const { data, error } = await query;
            if (error) return res.status(400).json({ error: error.message });
            res.json(data ?? []);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });
}

registerListRoute("/api/data/users", "users", { columns: USERS_COLUMNS, filters: ["id"], tenantScoped: true });
registerListRoute("/api/data/courses", "courses", { filters: ["id"], tenantScoped: true });
registerListRoute("/api/data/enrollments", "enrollments", { filters: ["user_id", "course_id", "role"], tenantScoped: true });
registerListRoute("/api/data/course_materials", "course_materials", { filters: ["course_id", "id"], tenantScoped: true });
registerListRoute("/api/data/assignments", "assignments", { filters: ["course_id", "id"], tenantScoped: true });
registerListRoute("/api/data/assignment_fields", "assignment_fields", { filters: ["assignment_id"], tenantScoped: false });
registerListRoute("/api/data/assignment_submissions", "assignment_submissions", { filters: ["assignment_id", "user_id"], tenantScoped: false });
registerListRoute("/api/data/schedules", "schedules", { filters: ["course_id"], tenantScoped: true });
registerListRoute("/api/data/live_presentations", "live_presentations", { filters: ["course_id"], tenantScoped: true });
registerListRoute("/api/data/live_sessions", "live_sessions", { filters: ["course_id"], tenantScoped: true });
registerListRoute("/api/data/allowed_speakers", "allowed_speakers", { filters: ["user_id"], tenantScoped: true });

// ==========================================
// TRAINEE COURSE CONTENT
// ==========================================
app.get("/api/data/trainee-course-contents", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { course_id } = req.query;
    if (!course_id) return res.status(400).json({ error: "Course ID is required" });
    try {
        const { data: enrollment, error: enError } = await supabase
            .from("enrollments")
            .select("id")
            .eq("user_id", _auth.userId)
            .eq("course_id", course_id)
            .eq("tenant_id", _auth.tenantId)
            .single();
        if (enError || !enrollment) {
            return res.status(403).json({ error: "Not enrolled in this course" });
        }
        const [materialsRes, assignmentsRes] = await Promise.all([
            supabase.from("course_materials").select("*").eq("course_id", course_id).eq("tenant_id", _auth.tenantId),
            supabase.from("assignments").select("*").eq("course_id", course_id).eq("tenant_id", _auth.tenantId),
        ]);
        res.json({
            materials: materialsRes.data || [],
            assignments: assignmentsRes.data || [],
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// USER CRUD
// ==========================================
app.get("/api/users/list", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { tenant_id } = req.query;
    try {
        const { data, error } = await supabase
            .from("users")
            .select(USERS_COLUMNS)
            .eq("tenant_id", resolveTenantScope(_auth, tenant_id));
        if (error) return res.status(400).json({ error: error.message });
        res.json({ users: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/users/create", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, username, phone, email, password, role, assigned_courses, profile_pic, tuition, remuneration } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password required" });
    try {
        if (phone) {
            const cleanPhone = formatPhoneNumber(phone);
            const { data: existingPhoneUser } = await supabase.from("users").select("id, username, tenant_id").eq("phone", cleanPhone).single();
            if (existingPhoneUser) {
                if (existingPhoneUser.tenant_id !== _auth.tenantId) {
                    return res.status(409).json({ error: "Phone registered to different business." });
                }
                return res.status(409).json({ error: `Phone used by "${existingPhoneUser.username}".` });
            }
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const { data, error } = await supabase
            .from("users")
            .insert([{
                id,
                tenant_id: _auth.tenantId,
                username,
                phone: phone || null,
                email: email || null,
                password: passwordHash,
                role: role || "user",
                assigned_courses: assigned_courses || [],
                profile_pic: profile_pic || null,
                tuition: tuition || { expected: 0, paid: 0 },
                remuneration: remuneration || { net_salary: 0, per_diem: 0 },
                synced: true,
            }])
            .select()
            .single();
        if (error) {
            if (error.message.includes("duplicate")) return res.status(409).json({ error: "Username exists." });
            return res.status(400).json({ error: error.message });
        }
        res.json({ user: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/users/upsert", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, username, phone, email, password, role, assigned_courses, profile_pic, tuition, remuneration } = req.body;
    if (!username) return res.status(400).json({ error: "Username required" });
    try {
        const userData: any = {
            id,
            tenant_id: _auth.tenantId,
            username,
            phone: phone || null,
            email: email || null,
            role: role || "user",
            assigned_courses: assigned_courses || [],
            profile_pic: profile_pic || null,
            tuition: tuition || { expected: 0, paid: 0 },
            remuneration: remuneration || { net_salary: 0, per_diem: 0 },
            synced: true,
        };
        if (password) userData.password = await bcrypt.hash(password, 12);
        const { data, error } = await supabase.from("users").upsert(userData, { onConflict: "id" }).select().single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ user: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/api/users/update", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: "User ID required" });
    try {
        const cleanUpdates: any = { synced: true };
        if (updates.username !== undefined) cleanUpdates.username = updates.username;
        if (updates.phone !== undefined) cleanUpdates.phone = updates.phone;
        if (updates.email !== undefined) cleanUpdates.email = updates.email;
        if (updates.assigned_courses !== undefined) cleanUpdates.assigned_courses = updates.assigned_courses;
        if (updates.profile_pic !== undefined) cleanUpdates.profile_pic = updates.profile_pic;
        if (updates.tuition !== undefined) cleanUpdates.tuition = updates.tuition;
        if (updates.remuneration !== undefined) cleanUpdates.remuneration = updates.remuneration;
        if (updates.role !== undefined) cleanUpdates.role = updates.role;
        if (updates.password) cleanUpdates.password = await bcrypt.hash(updates.password, 12);
        const { data, error } = await supabase.from("users").update(cleanUpdates).eq("id", id).eq("tenant_id", _auth.tenantId).select();
        if (error) return res.status(400).json({ error: error.message });
        if (!data || data.length === 0) return res.status(404).json({ error: "User not found" });
        res.json({ user: data[0] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/users/change-password", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, newPassword } = req.body;
    if (!id || !newPassword) return res.status(400).json({ error: "User ID and new password required" });
    try {
        const passwordHash = await bcrypt.hash(newPassword, 12);
        const { error } = await supabase.from("users").update({ password: passwordHash, synced: true }).eq("id", id).eq("tenant_id", _auth.tenantId);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/users/delete", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id } = req.body;
    if (!id) return res.status(400).json({ error: "User ID required" });
    try {
        // Scope the enrollment cleanup to the caller's tenant so a stray id
        // from another business can never be cascaded away.
        await supabase.from("enrollments").delete().eq("user_id", id).eq("tenant_id", _auth.tenantId);
        const { error } = await supabase.from("users").delete().eq("id", id).eq("tenant_id", _auth.tenantId);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// ENROLLMENTS SYNC
// ==========================================
app.put("/api/enrollments/sync", requireAuth, async (req: Request, res: Response) => {
    const { _auth, enrollments } = req.body;
    if (!Array.isArray(enrollments)) return res.status(400).json({ error: "Enrollments array required" });
    try {
        const errors: string[] = [];
        for (const en of enrollments) {
            const userId = en.user_id || en.userId;
            const courseId = en.course_id || en.courseId;
            let userRole = en.role;
            if (!userRole && userId) {
                const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
                userRole = user?.role === "trainer" ? "trainer" : "trainee";
            }
            const { error } = await supabase.from("enrollments").upsert({
                tenant_id: _auth.tenantId,
                user_id: userId,
                course_id: courseId,
                role: userRole,
                status: en.status || "active",
            }, { onConflict: "user_id,course_id" });
            if (error) errors.push(error.message);
        }
        if (errors.length > 0) return res.status(500).json({ error: errors.join(", ") });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/enrollments/list", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { tenant_id } = req.query;
    try {
        const { data, error } = await supabase
            .from("enrollments")
            .select("*")
            .eq("tenant_id", resolveTenantScope(_auth, tenant_id));
        if (error) throw new Error(error.message);
        res.json({ enrollments: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// SETTINGS
// ==========================================
app.post("/api/settings/upsert", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { id, tenant_id, business_name, address, logo, login_background, phone, email, website } = req.body;
    try {
        const settingsId = id || tenant_id || "main";
        const { data, error } = await supabase
            .from("settings")
            .upsert({
                id: settingsId,
                tenant_id: tenant_id || _auth.tenantId,
                business_name,
                address,
                logo,
                login_background,
                phone,
                email,
                website,
            }, { onConflict: "id" })
            .select()
            .single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ settings: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.get("/api/settings/get", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { tenant_id } = req.query;
    const targetTenantId = tenant_id || _auth.tenantId;
    if (!targetTenantId) return res.status(400).json({ error: "Tenant ID required" });
    try {
        const { data, error } = await supabase.from("settings").select("*").eq("tenant_id", targetTenantId).single();
        if (error) return res.status(404).json({ error: "No settings found" });
        res.json({ settings: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// Public branding for the login screen (before the user is authenticated).
app.get("/api/settings/public", async (req: Request, res: Response) => {
    const { tenant_id } = req.query;
    if (!tenant_id) return res.status(400).json({ error: "Tenant ID required" });
    try {
        const { data, error } = await supabase.from("settings").select("business_name, logo, login_background").eq("tenant_id", tenant_id).single();
        if (error) return res.status(404).json({ error: "No settings found" });
        res.json({ settings: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// COURSE CRUD
// ==========================================
app.post("/api/courses/create", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, name, description, logo, tuition_type, amount, start_date, period } = req.body;
    if (!name) return res.status(400).json({ error: "Course name required" });
    try {
        const { data, error } = await supabase
            .from("courses")
            .insert([{
                id,
                tenant_id: _auth.tenantId,
                name,
                description: description || "",
                logo: logo || null,
                tuition_type: tuition_type || "free",
                amount: parseFloat(amount) || 0,
                start_date: start_date || null,
                period: period || null,
                synced: true,
            }])
            .select()
            .single();
        if (error) return res.status(400).json({ error: error.message });
        res.json({ course: data });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.put("/api/courses/update", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id, ...updates } = req.body;
    if (!id) return res.status(400).json({ error: "Course ID required" });
    try {
        const cleanUpdates: any = { synced: true };
        if (updates.name !== undefined) cleanUpdates.name = updates.name;
        if (updates.description !== undefined) cleanUpdates.description = updates.description;
        if (updates.logo !== undefined) cleanUpdates.logo = updates.logo;
        if (updates.tuition_type !== undefined) cleanUpdates.tuition_type = updates.tuition_type;
        if (updates.amount !== undefined) cleanUpdates.amount = parseFloat(updates.amount) || 0;
        if (updates.start_date !== undefined) cleanUpdates.start_date = updates.start_date;
        if (updates.period !== undefined) cleanUpdates.period = updates.period;
        const { data, error } = await supabase.from("courses").update(cleanUpdates).eq("id", id).eq("tenant_id", _auth.tenantId).select();
        if (error) return res.status(400).json({ error: error.message });
        if (!data || data.length === 0) return res.status(404).json({ error: "Course not found" });
        res.json({ course: data[0] });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

app.post("/api/courses/delete", requireAuth, async (req: Request, res: Response) => {
    const { _auth, id } = req.body;
    if (!id) return res.status(400).json({ error: "Course ID required" });
    try {
        // Tenant-scoped cascades: never delete another business's rows.
        await supabase.from("schedules").delete().eq("course_id", id).eq("tenant_id", _auth.tenantId);
        await supabase.from("enrollments").delete().eq("course_id", id).eq("tenant_id", _auth.tenantId);
        const { error } = await supabase.from("courses").delete().eq("id", id).eq("tenant_id", _auth.tenantId);
        if (error) return res.status(400).json({ error: error.message });
        res.json({ success: true });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// DATA SYNC PULL
// ==========================================
app.get("/api/sync/pull", requireAuth, async (req: Request, res: Response) => {
    const { _auth } = req.body;
    const { tenant_id } = req.query;
    const targetTenantId = resolveTenantScope(_auth, tenant_id);
    try {
        const [usersRes, coursesRes, enrollmentsRes, materialsRes, assignmentsRes, schedulesRes, smsLogsRes] = await Promise.all([
            supabase.from("users").select(USERS_COLUMNS).eq("tenant_id", targetTenantId),
            supabase.from("courses").select("*").eq("tenant_id", targetTenantId),
            supabase.from("enrollments").select("*").eq("tenant_id", targetTenantId),
            supabase.from("course_materials").select("*").eq("tenant_id", targetTenantId),
            supabase.from("assignments").select("*").eq("tenant_id", targetTenantId),
            supabase.from("schedules").select("*").eq("tenant_id", targetTenantId),
            supabase.from("sms_logs").select("*").eq("tenant_id", targetTenantId),
        ]);
        res.json({
            users: usersRes.data || [],
            courses: coursesRes.data || [],
            enrollments: enrollmentsRes.data || [],
            course_materials: materialsRes.data || [],
            assignments: assignmentsRes.data || [],
            schedules: schedulesRes.data || [],
            smsLogs: smsLogsRes.data || [],
        });
    } catch (error: any) {
        res.status(500).json({ error: error.message });
    }
});

// ==========================================
// API NOT FOUND
// ==========================================
app.use((req: Request, res: Response) => {
    res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// ==========================================
// START SERVER
// ==========================================
// Bind explicitly to 0.0.0.0 so Render's port scanner can detect the service.
// Without the explicit host, Node may bind to `::` (IPv6) or `127.0.0.1`,
// neither of which Render can reach — causing the "no open ports detected"
// timeout that fails the deploy.
app.listen(PORT, "0.0.0.0", () => console.log(`Server running on port ${PORT}`));
