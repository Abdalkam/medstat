// index.ts
import path from "path";
import express, { Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { createClient } from "@supabase/supabase-js";

const africastalking = require("africastalking");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ limit: "5mb", extended: true }));

// Render automatically provides process.env.PORT. Fallback to 3001 for local dev.
const PORT = process.env.PORT || 3001;
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
      const existingRoom = await checkResponse.json();
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
    const newRoom = await createResponse.json();
    if (!createResponse.ok) throw new Error(newRoom?.info || "Failed to create room");
    res.status(200).json({ url: newRoom.url });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// AUTH - SEND CODE
// ==========================================
app.post("/api/auth/send-code", async (req: Request, res: Response) => {
  const { phone: rawPhone } = req.body;
  if (!rawPhone) return res.status(400).json({ error: "Phone is required" });
  
  const phone = formatPhoneNumber(rawPhone);

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 });

  try {
    const result = await smsService.send({ 
      to: [phone], 
      message: `Your MEDSTAT verification code is: ${code}`, 
      from: "ATTech" 
    });
    
    const recipients = result?.SMSMessageData?.Recipients;
    if (recipients && recipients.length > 0 && recipients[0].status === "Success") {
      return res.json({ sent: true });
    }
    
    const atError = recipients?.[0]?.status || "Failed to send SMS.";
    return res.status(500).json({ error: atError });
  } catch (error: any) {
    console.error("AT SMS Error:", error);
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
  if (!(await bcrypt.compare(password, user.password))) return res.status(401).json({ error: "Invalid credentials" });

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
// 🚀 SMS BULK/CUSTOM SEND ENDPOINT
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

    // Send via Africa's Talking
    const result = await smsService.send({ 
      to: formattedRecipients, 
      message: message, 
      from: "ATTech" 
    });

    const atRecipients = result?.SMSMessageData?.Recipients || [];
    
    // Prepare logs to insert into Supabase
    const logsToInsert = formattedRecipients.map((phone: string) => {
      // Match the number to the AT response to get the status
      const atResult = atRecipients.find((r: any) => r.number === phone || r.number === phone.replace("+", ""));
      return {
        tenant_id: _auth.tenantId,
        phone: phone,
        message: message,
        status: atResult?.status || "Unknown",
        sent_at: new Date().toISOString(),
        sent_by: _auth.userId
      };
    });

    // Save logs to Supabase
    if (logsToInsert.length > 0) {
      const { error: logError } = await supabase.from("sms_logs").insert(logsToInsert);
      if (logError) console.error("Failed to save SMS logs to Supabase", logError);
    }

    res.json({ success: true, logs: logsToInsert });
  } catch (error: any) {
    console.error("Bulk SMS Error:", error);
    res.status(500).json({ error: error.message || "Failed to send SMS" });
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
    const [usersRes, coursesRes, enrollmentsRes, materialsRes, assignmentsRes, schedulesRes] = await Promise.all([
      supabase.from("users").select("id, tenant_id, username, phone, email, role, assigned_courses, profile_pic, tuition, remuneration, created_at").eq("tenant_id", targetTenantId),
      supabase.from("courses").select("*").eq("tenant_id", targetTenantId),
      supabase.from("enrollments").select("*").eq("tenant_id", targetTenantId),
      supabase.from("course_materials").select("*").eq("tenant_id", targetTenantId),
      supabase.from("assignments").select("*").eq("tenant_id", targetTenantId),
      supabase.from("schedules").select("*").eq("tenant_id", targetTenantId),
    ]);

    res.json({
      users: usersRes.data || [],
      courses: coursesRes.data || [],
      enrollments: enrollmentsRes.data || [],
      course_materials: materialsRes.data || [],
      assignments: assignmentsRes.data || [],
      schedules: schedulesRes.data || [],
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// SERVE REACT APP (FIXED WILDCARD SYNTAX)
// ==========================================
if (process.env.NODE_ENV === 'production') {
  const __dirname = path.resolve();
  app.use(express.static(path.join(__dirname, '../dist')));
  
  // ✅ FIX: Changed '*' to '{*path}' to comply with new path-to-regexp rules
  app.get('{*path}', (req: Request, res: Response) => {
    res.sendFile(path.join(__dirname, '../dist', 'index.html'));
  });
}

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));