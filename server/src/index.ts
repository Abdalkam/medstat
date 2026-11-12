// index.ts
import path from "path";
import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const africastalking = require("africastalking");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// Render automatically provides process.env.PORT as a string. Coerce to number
// (Number(undefined) → NaN → falls back to 3001) so app.listen() typechecks.
const PORT = Number(process.env.PORT) || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "super_secret_temp_key_change_me";
const DAILY_API_KEY = process.env.DAILY_API_KEY;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ FATAL: Missing Supabase environment variables!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl!, supabaseKey!);

const at = africastalking({
  apiKey: process.env.AT_API_KEY || "",
  username: process.env.AT_USERNAME || "",
});

const smsService: any = at.SMS;
const otpStore = new Map<string, { code: string; expires: number }>();

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function formatPhoneNumber(phone: string): string {
  if (!phone) return "";
  // Remove all spaces, dashes, brackets
  let cleanPhone = phone.replace(/[\s\-\(\)]/g, "");
  
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


// ==========================================
// MTN MoMo PREPAID WALLET — CONFIG & HELPERS
// (Collections API: pulls money FROM the payer's MoMo account INTO the wallet.
//  Prepaid contract: usage debits the wallet; hard stop at zero.)
// ==========================================
const MTN_TARGET_ENV = process.env.MTN_TARGET_ENV || "sandbox"; // "sandbox" | "production" | country value
const MTN_IS_SANDBOX = MTN_TARGET_ENV === "sandbox";
// Base URL — overridable via MTN_BASE_URL because MTN migrated Uganda to the
// new MoMo platform (announcement 12 Oct 2026):
//   https://momoapi.momo.africa        NEW platform (Uganda live; credentials
//                                      come from the Partner Portal: User ID +
//                                      Credential Token)
//   https://proxy.momoapi.mtn.com      LEGACY platform (old API User UUID +
//                                      API Key; being phased out)
const MTN_BASE_URL = (
  process.env.MTN_BASE_URL ||
  (MTN_IS_SANDBOX
    ? "https://sandbox.momodeveloper.mtn.com"
    : "https://momoapi.momo.africa")
).replace(/\/+$/, "");
// X-Target-Environment header — country-specific in production. MTN Uganda's
// value is "mtnuganda"; a bare "production" is NOT accepted and would fail
// auth. Setting MTN_TARGET_ENV directly to a country value also works.
const MTN_TARGET_ENV_HEADER =
  MTN_TARGET_ENV === "sandbox"
    ? "sandbox"
    : MTN_TARGET_ENV === "production"
      ? "mtnuganda"
      : MTN_TARGET_ENV;
const MTN_SUBSCRIPTION_KEY = process.env.MTN_SUBSCRIPTION_KEY || "";
const MTN_API_USER = process.env.MTN_API_USER || "";
const MTN_API_KEY = process.env.MTN_API_KEY || "";
const MTN_CURRENCY = MTN_IS_SANDBOX ? "EUR" : "UGX"; // sandbox is EUR-only
const MIN_TOPUP_UGX = 1000;
const MAX_TOPUP_UGX = 10000000;

function momoConfigured(): boolean {
  return Boolean(MTN_SUBSCRIPTION_KEY && MTN_API_USER && MTN_API_KEY);
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
  if (!res.ok) throw new Error(`MTN token request failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
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

/** Bill the wallet: fn_record_usage prices the quantity and debits atomically.
 *  Throws/returns the Postgres error when the balance cannot cover it. */
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
// ==========================================
// MIDDLEWARE
// ==========================================
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok", message: "MedStat API is running" });
});

function requireAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const token = authHeader.replace("Bearer ", "");
    const decoded: any = jwt.verify(token, JWT_SECRET);
    req.body._auth = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token." });
  }
}

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
        properties: { enable_screenshare: true, enable_chat: true, autojoin: true, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 2 },
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
// AUTH - SEND CODE (WITH SENDER ID FALLBACK)
// ==========================================
app.post("/api/auth/send-code", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body;
  if (!rawPhone) return res.status(400).json({ error: "Phone is required" });

  const phone = formatPhoneNumber(rawPhone);

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });

  const message = `Your SmartPages verification code is ${code}`;

  let finalLogs: Array<{ phone: string; status: string }> = [];
  let numbersToRetry: string[] = [];

  try {
    // ---------------------------------------------------------
    // ATTEMPT 1: Send using MEDSTAT Sender ID
    // ---------------------------------------------------------
    try {
      const result1 = await smsService.send({ 
        to: [phone], 
        message: message, 
        from: "MEDSTAT" 
      });

      const atRecipients1 = result1?.SMSMessageData?.Recipients || [];
      
      atRecipients1.forEach((r: any) => {
        if (r.status === "Success") {
          finalLogs.push({ phone: r.number, status: "Success" });
        } else {
          // Failed with MEDSTAT, add to retry list
          numbersToRetry.push(r.number);
        }
      });
    } catch (err: any) {
      console.error("MEDSTAT Sender ID Error (Retrying with ATTech):", err.message);
      // If the whole request fails (e.g. Sender ID not approved at all), retry all
      numbersToRetry = [...[phone]];
    }

    // ---------------------------------------------------------
    // ATTEMPT 2: Fallback to ATTech for any failed numbers
    // ---------------------------------------------------------
    if (numbersToRetry.length > 0) {
      try {
        const result2 = await smsService.send({ 
          to: numbersToRetry, 
          message: message, 
          from: "ATTech" 
        });

        const atRecipients2 = result2?.SMSMessageData?.Recipients || [];
        
        atRecipients2.forEach((r: any) => {
          finalLogs.push({ phone: r.number, status: r.status || "Failed" });
        });
      } catch (err2: any) {
        console.error("ATTech Fallback Error:", err2.message);
        // If ATTech also fails, mark them all as failed
        numbersToRetry.forEach(p => finalLogs.push({ phone: p, status: "Failed" }));
      }
    }

    // ---------------------------------------------------------
    // RESPOND TO FRONTEND
    // ---------------------------------------------------------
    const successEntry = finalLogs.find(log => log.status === "Success");
    if (successEntry) {
      return res.json({ sent: true });
    }

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
// AUTH - VERIFY CODE
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
// AUTH - LOOKUP TENANT
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
// AUTH - REGISTER TENANT
// ==========================================
app.post("/api/auth/register-tenant", async (req: Request, res: Response) => {
  const { phone, tempToken, businessName, username, password } = req.body;
  try {
    const payload: any = jwt.verify(tempToken, JWT_SECRET);
    if (payload.phone !== phone || payload.purpose !== "otp-verified") return res.status(401).json({ error: "Invalid session" });
  } catch (err) {
    return res.status(401).json({ error: "Token expired." });
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const { data: newTenant, error: tenantError } = await supabase.from("tenants").insert([{ phone, business_name: businessName }]).select().single();
  if (tenantError) return res.status(400).json({ error: tenantError.message });
  const { data: newUser, error: userError } = await supabase.from("users").insert([{ tenant_id: newTenant.id, username, phone, password: passwordHash, role: "admin" }]).select().single();
  if (userError) return res.status(400).json({ error: userError.message });
  const authToken = jwt.sign({ userId: newUser.id, tenantId: newTenant.id, role: "admin" }, JWT_SECRET, { expiresIn: "7d" });
  res.json({ authToken, user: { id: newUser.id, username, phone, role: "admin", tenantId: newTenant.id } });
});

// ==========================================
// AUTH - LOGIN
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
  // still plaintext (bcrypt.compare always fails on those). Hash them with the
  // README's one-time SQL so this fallback can eventually be removed.
  const typed = String(password ?? "");
  const stored = String(user.password ?? "");
  const passwordOk =
    stored === typed || // legacy plaintext rows ("0987", "1234", …)
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
// 🚀 SMS BULK/CUSTOM SEND ENDPOINT (WITH SENDER ID FALLBACK)
// ==========================================
app.post("/api/sms/send", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { recipients, message } = req.body;

  if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: "Recipients array is required" });
  }
  if (!message) {
    return res.status(400).json({ error: "Message content is required" });
  }

  try {
    // Format all phone numbers
    const formattedRecipients = recipients.map((p: string) => formatPhoneNumber(p));

    // ===== PREPAID GATE — block sending when the wallet can't cover it =====
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
    
    let finalLogs: Array<{ phone: string; status: string }> = [];
    let numbersToRetry: string[] = [];

    // ---------------------------------------------------------
    // ATTEMPT 1: Send using MEDSTAT Sender ID
    // ---------------------------------------------------------
    try {
      const result1 = await smsService.send({ 
        to: formattedRecipients, 
        message: message, 
        from: "MEDSTAT" 
      });

      const atRecipients1 = result1?.SMSMessageData?.Recipients || [];
      
      atRecipients1.forEach((r: any) => {
        if (r.status === "Success") {
          finalLogs.push({ phone: r.number, status: "Success" });
        } else {
          // Failed with MEDSTAT, add to retry list
          numbersToRetry.push(r.number);
        }
      });
    } catch (err: any) {
      console.error("MEDSTAT Sender ID Error (Retrying with ATTech):", err.message);
      // If the whole request fails (e.g. Sender ID not approved at all), retry all
      numbersToRetry = [...formattedRecipients];
    }

    // ---------------------------------------------------------
    // ATTEMPT 2: Fallback to ATTech for any failed numbers
    // ---------------------------------------------------------
    if (numbersToRetry.length > 0) {
      try {
        const result2 = await smsService.send({ 
          to: numbersToRetry, 
          message: message, 
          from: "ATTech" 
        });

        const atRecipients2 = result2?.SMSMessageData?.Recipients || [];
        
        atRecipients2.forEach((r: any) => {
          finalLogs.push({ phone: r.number, status: r.status || "Failed" });
        });
      } catch (err2: any) {
        console.error("ATTech Fallback Error:", err2.message);
        // If ATTech also fails, mark them all as failed
        numbersToRetry.forEach(phone => finalLogs.push({ phone, status: "Failed" }));
      }
    }


    // ---------------------------------------------------------
    // PREPAID CHARGE — bill the wallet for delivered SMS (till zero)
    // ---------------------------------------------------------
    const delivered = finalLogs.filter((log) => log.status === "Success").length;
    if (delivered > 0 && unitPrice > 0) {
      const charge = await chargeWalletUsage(_auth.tenantId, "sms", delivered, `Bulk SMS — ${delivered} delivered`);
      if (!charge.ok) console.error("Wallet charge failed for SMS send:", charge.error);
    }

    // ---------------------------------------------------------
    // SAVE LOGS TO SUPABASE
    // ---------------------------------------------------------
    const logsToInsert = finalLogs.map((log) => {
      return {
        id: randomUUID(),
        tenant_id: _auth.tenantId,
        phone: log.phone,
        message: message,
        status: log.status,
        sent_at: new Date().toISOString(),
        sent_by: _auth.userId
      };
    });

    if (logsToInsert.length > 0) {
      const { error: logError } = await supabase.from("sms_logs").insert(logsToInsert);
      if (logError) console.error("Failed to save SMS logs to Supabase", logError);
    }

    // ---------------------------------------------------------
    // RESPOND TO FRONTEND
    // ---------------------------------------------------------
    const failedNumbers = logsToInsert.filter(log => log.status !== "Success");
    if (failedNumbers.length > 0) {
      const failList = failedNumbers.map(f => `${f.phone} (${f.status})`).join(", ");
      return res.status(400).json({ 
        error: `Some SMS failed: ${failList}`,
        logs: logsToInsert 
      });
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

// Public (no auth): lets the UI show sandbox banners / setup warnings
app.get("/api/wallet/config", (req: Request, res: Response) => {
  res.json({ environment: MTN_TARGET_ENV, currency: MTN_CURRENCY, configured: momoConfigured() });
});

app.get("/api/wallet/balance", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  try {
    const { data, error } = await supabase.from("wallets").select("*").eq("tenant_id", _auth.tenantId).maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "Wallet not initialized — run the prepaid wallet migration." });
    res.json({ wallet: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// Record usage manually (custom services) — bills the wallet, stops at zero
app.post("/api/wallet/usage", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { serviceCode, quantity, description, reference } = req.body;
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

// Start a top-up: MTN prompts the admin's phone; wallet credited on approval
app.post("/api/wallet/topup", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  if (_auth.role !== "admin") return res.status(403).json({ error: "Only admins can load the wallet." });
  if (!momoConfigured()) {
    return res.status(500).json({ error: "MTN MoMo is not configured on the server (missing MTN_* environment variables)." });
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

  // 1. Record the pending top-up in the ledger first
  const { data: tx, error: txError } = await supabase
    .from("wallet_transactions")
    .insert([{
      tenant_id: _auth.tenantId,
      direction: "credit",
      tx_type: "topup",
      amount_ugx: amount,
      status: "pending",
      provider: "mtn_momo",
      external_reference: referenceId,
      payer_msisdn: msisdn,
      description,
    }])
    .select()
    .single();
  if (txError) return res.status(400).json({ error: txError.message });

  // 2. Ask MTN to prompt the payer (Collections request-to-pay)
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
      await supabase.from("wallet_transactions")
        .update({ status: "failed", completed_at: new Date().toISOString(), description: `${description} — rejected by MTN: ${detail}` })
        .eq("id", tx.id);
      return res.status(502).json({ error: `MTN rejected the request (${momoRes.status}). ${detail}` });
    }
  } catch (e: any) {
    await supabase.from("wallet_transactions")
      .update({ status: "failed", completed_at: new Date().toISOString(), description: `${description} — error: ${String(e?.message || e).slice(0, 180)}` })
      .eq("id", tx.id);
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

// Poll top-up status (dashboard polls ~3s) — confirms the ledger exactly once
app.post("/api/wallet/topup/status", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const reference = String(req.body?.reference ?? "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(reference)) {
    return res.status(400).json({ error: "Invalid reference." });
  }

  // Scoped to the caller's tenant — nobody can confirm someone else's top-up
  const { data: rows, error: txError } = await supabase
    .from("wallet_transactions")
    .select("id, status, provider_tx_id")
    .eq("external_reference", reference)
    .eq("tenant_id", _auth.tenantId)
    .limit(1);
  if (txError) return res.status(400).json({ error: txError.message });
  if (!rows || rows.length === 0) return res.status(404).json({ error: "Unknown reference." });
  const tx = rows[0];

  // Already final (confirmed by an earlier poll) — just report it.
  if (tx.status !== "pending") {
    return res.json({ status: String(tx.status).toUpperCase(), providerTxId: tx.provider_tx_id ?? null });
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
      if (rpcError) return res.status(400).json({ error: rpcError.message });
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
// DATA API - SECURE ENDPOINTS
// ==========================================
app.get("/api/data/users", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, id } = req.query;
  try {
    let query = supabase.from("users").select("id, tenant_id, username, phone, email, role, assigned_courses, profile_pic, tuition, remuneration, created_at");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/courses", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, id } = req.query;
  try {
    let query = supabase.from("courses").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/enrollments", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, user_id, course_id, role } = req.query;
  try {
    let query = supabase.from("enrollments").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (user_id) query = query.eq("user_id", user_id);
    if (course_id) query = query.eq("course_id", course_id);
    if (role) query = query.eq("role", role);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/course_materials", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, course_id, id } = req.query;
  try {
    let query = supabase.from("course_materials").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (course_id) query = query.eq("course_id", course_id);
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/assignments", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, course_id, id } = req.query;
  try {
    let query = supabase.from("assignments").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (course_id) query = query.eq("course_id", course_id);
    if (id) query = query.eq("id", id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/assignment_fields", requireAuth, async (req: Request, res: Response) => {
  const { assignment_id } = req.query;
  try {
    let query = supabase.from("assignment_fields").select("*");
    if (assignment_id) query = query.eq("assignment_id", assignment_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/assignment_submissions", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { assignment_id, user_id } = req.query;
  try {
    let query = supabase.from("assignment_submissions").select("*");
    if (assignment_id) query = query.eq("assignment_id", assignment_id);
    if (user_id) query = query.eq("user_id", user_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/schedules", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, course_id } = req.query;
  try {
    let query = supabase.from("schedules").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (course_id) query = query.eq("course_id", course_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/live_presentations", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, course_id } = req.query;
  try {
    let query = supabase.from("live_presentations").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (course_id) query = query.eq("course_id", course_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/live_sessions", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, course_id } = req.query;
  try {
    let query = supabase.from("live_sessions").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (course_id) query = query.eq("course_id", course_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/data/allowed_speakers", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id, user_id } = req.query;
  try {
    let query = supabase.from("allowed_speakers").select("*");
    query = query.eq("tenant_id", tenant_id || _auth.tenantId);
    if (user_id) query = query.eq("user_id", user_id);
    const { data, error } = await query;
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// TRAINEE COURSE CONTENT ENDPOINT
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
  const targetTenantId = _auth.role === "admin" ? _auth.tenantId : tenant_id;
  if (!targetTenantId) return res.status(400).json({ error: "Tenant ID required" });
  try {
    const { data, error } = await supabase.from("users").select("id, tenant_id, username, phone, email, password, role, assigned_courses, profile_pic, tuition, remuneration, created_at").eq("tenant_id", targetTenantId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ users: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/users/create", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id, username, phone, email, password, role, assigned_courses, profile_pic, tuition, remuneration } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  try {
    if (phone) {
      const cleanPhone = formatPhoneNumber(phone);
      const { data: existingPhoneUser } = await supabase.from("users").select("id, username, tenant_id").eq("phone", cleanPhone).single();
      if (existingPhoneUser) {
        if (existingPhoneUser.tenant_id !== _auth.tenantId) return res.status(409).json({ error: "Phone registered to different business." });
        return res.status(409).json({ error: `Phone used by "${existingPhoneUser.username}".` });
      }
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from("users").insert([{ id, tenant_id: _auth.tenantId, username, phone: phone || null, email: email || null, password: passwordHash, role: role || "user", assigned_courses: assigned_courses || [], profile_pic: profile_pic || null, tuition: tuition || { expected: 0, paid: 0 }, remuneration: remuneration || { net_salary: 0, per_diem: 0 }, synced: true }]).select().single();
    if (error) {
      if (error.message.includes("duplicate")) return res.status(409).json({ error: "Username exists." });
      return res.status(400).json({ error: error.message });
    }
    res.json({ user: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/users/upsert", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id, username, phone, email, password, role, assigned_courses, profile_pic, tuition, remuneration } = req.body;
  if (!username) return res.status(400).json({ error: "Username required" });
  try {
    const userData: any = { id, tenant_id: _auth.tenantId, username, phone: phone || null, email: email || null, role: role || "user", assigned_courses: assigned_courses || [], profile_pic: profile_pic || null, tuition: tuition || { expected: 0, paid: 0 }, remuneration: remuneration || { net_salary: 0, per_diem: 0 }, synced: true };
    if (password) userData.password = await bcrypt.hash(password, 12);
    const { data, error } = await supabase.from("users").upsert(userData, { onConflict: "id" }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ user: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/users/change-password", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id, newPassword } = req.body;
  if (!id || !newPassword) return res.status(400).json({ error: "User ID and new password required" });
  try {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const { error } = await supabase.from("users").update({ password: passwordHash, synced: true }).eq("id", id).eq("tenant_id", _auth.tenantId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/users/delete", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id } = req.body;
  if (!id) return res.status(400).json({ error: "User ID required" });
  try {
    await supabase.from("enrollments").delete().eq("user_id", id);
    const { error } = await supabase.from("users").delete().eq("id", id).eq("tenant_id", _auth.tenantId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// ENROLLMENTS SYNC
// ==========================================
app.put("/api/enrollments/sync", requireAuth, async (req: Request, res: Response) => {
  const { _auth, enrollments } = req.body;
  if (!Array.isArray(enrollments)) return res.status(400).json({ error: "Enrollments array required" });
  try {
    let errors: string[] = [];
    for (const en of enrollments) {
      const userId = en.user_id || en.userId;
      const courseId = en.course_id || en.courseId;
      
      let userRole = en.role;
      if (!userRole && userId) {
        const { data: user } = await supabase.from("users").select("role").eq("id", userId).single();
        if (user) {
          userRole = user.role === "trainer" ? "trainer" : "trainee";
        } else {
          userRole = "trainee";
        }
      }

      const { error } = await supabase.from("enrollments").upsert({ 
        tenant_id: _auth.tenantId, 
        user_id: userId, 
        course_id: courseId, 
        role: userRole, 
        status: en.status || "active" 
      }, { onConflict: "user_id,course_id" });
      
      if (error) errors.push(error.message);
    }
    if (errors.length > 0) return res.status(500).json({ error: errors.join(", ") });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/enrollments/list", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id } = req.query;
  const targetTenantId = _auth.role === "admin" ? _auth.tenantId : tenant_id;
  if (!targetTenantId) return res.status(400).json({ error: "Tenant ID required" });
  try {
    const { data, error } = await supabase.from("enrollments").select("*").eq("tenant_id", targetTenantId);
    if (error) throw new Error(error.message);
    res.json({ enrollments: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// SETTINGS
// ==========================================
app.post("/api/settings/upsert", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { id, tenant_id, business_name, address, logo, login_background, phone, email, website } = req.body;
  try {
    const settingsId = id || tenant_id || "main";
    const { data, error } = await supabase.from("settings").upsert({ id: settingsId, tenant_id: tenant_id || _auth.tenantId, business_name, address, logo, login_background, phone, email, website }, { onConflict: "id" }).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ settings: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.get("/api/settings/public", async (req: Request, res: Response) => {
  const { tenant_id } = req.query;
  if (!tenant_id) return res.status(400).json({ error: "Tenant ID required" });
  try {
    const { data, error } = await supabase.from("settings").select("business_name, logo, login_background").eq("tenant_id", tenant_id).single();
    if (error) return res.status(404).json({ error: "No settings found" });
    res.json({ settings: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// COURSE CRUD
// ==========================================
app.post("/api/courses/create", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id, name, description, logo, tuition_type, amount, start_date, period } = req.body;
  if (!name) return res.status(400).json({ error: "Course name required" });
  try {
    const { data, error } = await supabase.from("courses").insert([{ id, tenant_id: _auth.tenantId, name, description: description || "", logo: logo || null, tuition_type: tuition_type || "free", amount: parseFloat(amount) || 0, start_date: start_date || null, period: period || null, synced: true }]).select().single();
    if (error) return res.status(400).json({ error: error.message });
    res.json({ course: data });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
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
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

app.post("/api/courses/delete", requireAuth, async (req: Request, res: Response) => {
  const { _auth, id } = req.body;
  if (!id) return res.status(400).json({ error: "Course ID required" });
  try {
    await supabase.from("schedules").delete().eq("course_id", id);
    await supabase.from("enrollments").delete().eq("course_id", id);
    const { error } = await supabase.from("courses").delete().eq("id", id).eq("tenant_id", _auth.tenantId);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true });
  } catch (error: any) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// DATA SYNC PULL
// ==========================================
app.get("/api/sync/pull", requireAuth, async (req: Request, res: Response) => {
  const { _auth } = req.body;
  const { tenant_id } = req.query;
  const targetTenantId = (tenant_id as string) || _auth.tenantId;

  try {
    const [usersRes, coursesRes, enrollmentsRes, materialsRes, assignmentsRes, schedulesRes, smsLogsRes] = await Promise.all([
      supabase.from("users").select("id, tenant_id, username, phone, email, role, assigned_courses, profile_pic, tuition, remuneration, created_at").eq("tenant_id", targetTenantId),
      supabase.from("courses").select("*").eq("tenant_id", targetTenantId),
      supabase.from("enrollments").select("*").eq("tenant_id", targetTenantId),
      supabase.from("course_materials").select("*").eq("tenant_id", targetTenantId),
      supabase.from("assignments").select("*").eq("tenant_id", targetTenantId),
      supabase.from("schedules").select("*").eq("tenant_id", targetTenantId),
      supabase.from("sms_logs").select("*").eq("tenant_id", targetTenantId) // ✅ NEW: Fetch SMS logs
    ]);

    res.json({
      users: usersRes.data || [],
      courses: coursesRes.data || [],
      enrollments: enrollmentsRes.data || [],
      course_materials: materialsRes.data || [],
      assignments: assignmentsRes.data || [],
      schedules: schedulesRes.data || [],
      smsLogs: smsLogsRes.data || [] // ✅ NEW: Include SMS logs in response
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SERVE REACT APP (mounted at /medstat)
// ==========================================
// Vite builds with base: "/medstat/", so all asset URLs in dist/index.html
// are already prefixed with /medstat/ (e.g. /medstat/assets/index-abc123.js).
// We mount express.static at /medstat so those URLs resolve directly — no
// path stripping is needed.
//
// In CommonJS mode (ts-node default), `__dirname` points to the directory
// containing this source file (<repo>/server/src). Going up TWO levels lands
// on the repo root, where the root Vite build outputs `dist/`. (Also correct
// if you ever compile with tsc and run server/dist/index.js.)
//
// Registered UNCONDITIONALLY — never gate static serving on NODE_ENV.
// Harmless in dev (the Vite dev server on :1420 handles the UI), essential
// in production. Gating it on NODE_ENV silently disables the frontend when
// the env var is missing — the cause of the blank /medstat page.
const distDir = path.join(__dirname, '..', '..', 'dist');

// 1. Static assets: /medstat/assets/... → dist/assets/...
//    Must be registered before the SPA catch-all so real files win.
app.use('/medstat', express.static(distDir));

// 2. SPA fallback: /medstat and any /medstat/* client route → index.html.
//    Lets React Router own all client-side routing (refresh-safe).
//    Express 5 (path-to-regexp v8): a bare '*' is ILLEGAL and throws
//    "Missing parameter name" at boot — wildcards must be named: '*splat'.
//    Regex alternative: app.get(/^\/medstat(\/.*)?$/, ...)
app.get(['/medstat', '/medstat/*splat'], (req: Request, res: Response) => {
  res.sendFile(path.join(distDir, 'index.html'), (err) => {
    if (err) {
      console.error('SPA fallback failed to serve index.html from', distDir, '-', err.message);
      res.status(500).send('Frontend build output not found. Did "vite build" run before start?');
    }
  });
});

// 3. Root redirect → /medstat (replaces the old Vercel "redirects" rule).
//    307 preserves method/body in case of POST to /.
app.get('/', (req: Request, res: Response) => {
  res.redirect(307, '/medstat');
});

// ==========================================
// START SERVER
// ==========================================
// Bind explicitly to 0.0.0.0 so Render's port scanner can detect the service.
// Without the explicit host, Node may bind to `::` (IPv6) or `127.0.0.1`,
// neither of which Render can reach — causing the "no open ports detected"
// timeout that fails the deploy.
app.listen(PORT, "0.0.0.0", () => console.log(`🚀 Server running on port ${PORT}`));
