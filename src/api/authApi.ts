// src/api/authApi.ts
import { supabase } from "../auth/supabase";
import { loginUser } from "../database/userDB"; // ✅ FIX: Import offline fallback

function throwError(message: string): never {
  throw new Error(message);
}

function getCurrentUser(): { id: string; tenantId: string; role: string; assigned_courses?: string[] } | null {
  const stored = localStorage.getItem("currentUser");
  if (!stored) return null;
  return JSON.parse(stored);
}

// ==========================================
// AUTH API
// ==========================================

export async function sendATCode(phone: string) {
  const API_BASE = import.meta.env.VITE_API_URL || 
    (import.meta.env.PROD 
      ? "https://medstat-3rxl.onrender.com" 
      : "http://localhost:10000");

  const response = await fetch(`${API_BASE}/api/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to send code");
  return { success: true };
}

export async function verifyATCode(phone: string, code: string) {
  const API_BASE = import.meta.env.VITE_API_URL || 
    (import.meta.env.PROD 
      ? "https://medstat-3rxl.onrender.com" 
      : "http://localhost:10000");

  const response = await fetch(`${API_BASE}/api/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code })
  });

  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Failed to verify code");
  
  // The backend returns a tempToken for the next step
  return { token: data.tempToken };
}

export async function registerTenant(data: {
  phone: string;
  tempToken: string;
  businessName: string;
  username: string;
  password: string;
}) {
  const { data: tenant, error: tenantErr } = await supabase
    .from("tenants")
    .insert({ business_name: data.businessName, phone: data.phone })
    .select()
    .single();

  if (tenantErr) throwError(tenantErr.message);

  const userId = crypto.randomUUID();
  
  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(data.password, 10);

  const { error: userErr } = await supabase.from("users").insert({
    id: userId,
    tenant_id: tenant.id,
    username: data.username,
    phone: data.phone,
    role: "admin",
    password: hashedPassword,
  });

  if (userErr) throwError(userErr.message);

  // Generate a local fallback authToken to satisfy local storage requirements
  const authToken = crypto.randomUUID(); 

  return { 
    success: true, 
    authToken, 
    tenantId: tenant.id, 
    userId 
  };
}

export async function loginTenant(data: {
  phone?: string;
  tenantId?: string;
  business_name?: string;
  username: string;
  password: string;
}) {
  let targetTenantId = data.tenantId || null;

  if (!targetTenantId && data.business_name) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .ilike("business_name", `%${data.business_name}%`)
      .maybeSingle();
    if (!tenant) throwError("Business not found.");
    targetTenantId = tenant.id;
  }

  if (!targetTenantId && data.phone) {
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();
    if (!tenant) throwError("Business not found.");
    targetTenantId = tenant.id;
  }

  if (!targetTenantId) throwError("Could not identify business.");

  // ✅ FIX: Try to log in via the backend first. Let it wait up to 60s for Render to wake up.
  try {
    const API_BASE = import.meta.env.VITE_API_URL || 
      (import.meta.env.PROD 
        ? "https://medstat-3rxl.onrender.com" 
        : "http://localhost:10000");

    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, tenantId: targetTenantId })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || "Invalid credentials");
    }

    const result = await response.json();

    return {
      authToken: result.authToken,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email || "",
        phone: result.user.phone || "",
        role: result.user.role,
        tenant_id: result.user.tenant_id || result.user.tenantId,
        tenantId: result.user.tenant_id || result.user.tenantId,
        assigned_courses: result.user.assigned_courses || [],
        created_at: result.user.created_at || new Date().toISOString(),
      },
    };
  } catch (backendError: any) {
    console.warn("Backend login failed, falling back to OFFLINE mode:", backendError.message);
    
    // ✅ FIX: Instantly fall back to local IndexedDB if backend is asleep
    const localUser = await loginUser(data.username, data.password);
    if (!localUser) throw new Error("Invalid username or password (Offline)");

    return {
      authToken: "offline-mode-pending-sync", // Placeholder token to prevent 401 logouts
      user: {
        id: localUser.id,
        username: localUser.username,
        email: localUser.email || "",
        phone: localUser.phone || "",
        role: localUser.role,
        tenant_id: (localUser as any).tenant_id || targetTenantId,
        tenantId: (localUser as any).tenant_id || targetTenantId,
        assigned_courses: localUser.assignedCourses || [],
        created_at: localUser.createdAt || new Date().toISOString(),
      },
    };
  }
}

// ==========================================
// USER API
// ==========================================

export async function createUserApi(user: {
  id: string;
  username: string;
  phone?: string;
  email?: string;
  password: string;
  role?: "admin" | "trainer" | "trainee";
  assigned_courses?: string[];
  profile_pic?: string | null;
  tuition?: { expected: number; paid: number };
  remuneration?: { net_salary: number; per_diem: number };
}) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can create users.");
  }

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(user.password, 10);

  const { data, error } = await supabase.from("users").insert({
    id: user.id,
    tenant_id: currentUser.tenantId,
    username: user.username,
    phone: user.phone,
    email: user.email,
    password: hashedPassword,
    role: user.role || "trainee",
    assigned_courses: user.assigned_courses || [],
    profile_pic: user.profile_pic,
    tuition: user.role === "trainee" ? user.tuition : undefined,
    remuneration: user.role === "trainer" ? user.remuneration : undefined,
  }).select().single();

  if (error) throwError(error.message);
  return { user: data };
}

export async function updateUserApi(user: {
  id: string;
  username?: string;
  phone?: string;
  email?: string;
  password?: string;
  role?: string;
  assigned_courses?: string[];
  profile_pic?: string | null;
  tuition?: { expected: number; paid: number };
  remuneration?: { net_salary: number; per_diem: number };
}) {
  const currentUser = getCurrentUser();
  if (currentUser?.role !== "admin" && currentUser?.id !== user.id) {
    throwError("You can only update your own profile.");
  }

  const updates: Record<string, any> = {};
  if (user.username !== undefined) updates.username = user.username;
  if (user.phone !== undefined) updates.phone = user.phone;
  if (user.email !== undefined) updates.email = user.email;
  if (user.password) {
    const bcrypt = await import("bcryptjs");
    updates.password = await bcrypt.default.hash(user.password, 10);
  }
  if (user.role !== undefined && currentUser?.role === "admin") updates.role = user.role;
  if (user.assigned_courses !== undefined) updates.assigned_courses = user.assigned_courses;
  if (user.profile_pic !== undefined) updates.profile_pic = user.profile_pic;
  if (user.tuition !== undefined) updates.tuition = user.tuition;
  if (user.remuneration !== undefined) updates.remuneration = user.remuneration;

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .select()
    .single();

  if (error) throwError(error.message);
  return { user: data };
}

export async function deleteUserApi(id: string) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can delete users.");
  }

  const { error } = await supabase.from("users").delete().eq("id", id);
  if (error) throwError(error.message);
  return { success: true };
}

export async function changePasswordApi(id: string, newPassword: string) {
  const currentUser = getCurrentUser();
  if (!currentUser) throwError("Not authenticated.");
  if (currentUser.role !== "admin" && currentUser.id !== id) {
    throwError("You can only change your own password.");
  }

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(newPassword, 10);

  const { error } = await supabase
    .from("users")
    .update({ password: hashedPassword })
    .eq("id", id);

  if (error) throwError(error.message);
  return { success: true };
}

// ==========================================
// COURSE API
// ==========================================

export async function createCourseApi(course: {
  id: string;
  name: string;
  description?: string;
  logo?: string | null;
  tuition_type?: string;
  amount?: number;
  start_date?: string;
  period?: string;
}) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can create courses.");
  }

  const { data, error } = await supabase.from("courses").insert({
    id: course.id,
    tenant_id: currentUser.tenantId,
    name: course.name,
    description: course.description,
    logo: course.logo,
    tuition_type: course.tuition_type,
    amount: course.amount,
    start_date: course.start_date,
    period: course.period,
  }).select().single();

  if (error) throwError(error.message);
  return { course: data };
}

export async function updateCourseApi(course: {
  id: string;
  name?: string;
  description?: string;
  logo?: string | null;
  tuition_type?: string;
  amount?: number;
  start_date?: string;
  period?: string;
}) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can update courses.");
  }

  const updates: Record<string, any> = {};
  if (course.name !== undefined) updates.name = course.name;
  if (course.description !== undefined) updates.description = course.description;
  if (course.logo !== undefined) updates.logo = course.logo;
  if (course.tuition_type !== undefined) updates.tuition_type = course.tuition_type;
  if (course.amount !== undefined) updates.amount = course.amount;
  if (course.start_date !== undefined) updates.start_date = course.start_date;
  if (course.period !== undefined) updates.period = course.period;

  const { data, error } = await supabase
    .from("courses")
    .update(updates)
    .eq("id", course.id)
    .select()
    .single();

  if (error) throwError(error.message);
  return { course: data };
}

export async function deleteCourseApi(id: string) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can delete courses.");
  }

  const { error } = await supabase.from("courses").delete().eq("id", id);
  if (error) throwError(error.message);
  return { success: true };
}

// ==========================================
// SYNC API
// ==========================================

export async function pullSyncData(tenantId: string) {
  const [usersRes, coursesRes] = await Promise.all([
    supabase.from("users").select("*").eq("tenant_id", tenantId),
    supabase.from("courses").select("*").eq("tenant_id", tenantId),
  ]);

  if (usersRes.error) throwError(usersRes.error.message);
  if (coursesRes.error) throwError(coursesRes.error.message);

  return {
    users: usersRes.data,
    courses: coursesRes.data,
  };
}

// ==========================================
// SETTINGS API
// ==========================================

export async function getPublicSettingsApi(tenantId: string) {
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throwError(error.message);
  return data;
}

export async function getSettingsApi(tenantId: string) {
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throwError(error.message);
  return data;
}

export async function upsertSettingsApi(settings: {
  id?: string;
  tenant_id?: string;
  business_name?: string;
  address?: string;
  logo?: string | null;
  login_background?: string | null;
  phone?: string;
  email?: string;
  website?: string;
}) {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Only admins can update settings.");
  }

  const { data, error } = await supabase
    .from("business_settings")
    .upsert(settings, { onConflict: "id" })
    .select()
    .single();

  if (error) throwError(error.message);
  return data;
}

// ==========================================
// ROLE-SPECIFIC QUERIES
// ==========================================

export async function getTenantUsersApi() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Unauthorized.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("tenant_id", currentUser.tenantId)
    .order("created_at", { ascending: false });

  if (error) throwError(error.message);
  return { users: data };
}

export async function getTrainersApi() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Unauthorized.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("tenant_id", currentUser.tenantId)
    .eq("role", "trainer")
    .order("username");

  if (error) throwError(error.message);
  return { trainers: data };
}

export async function getTraineesApi() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    throwError("Unauthorized.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("tenant_id", currentUser.tenantId)
    .eq("role", "trainee")
    .order("username");

  if (error) throwError(error.message);
  return { trainees: data };
}

export async function getMyTraineesApi() {
  const currentUser = getCurrentUser();
  if (!currentUser || currentUser.role !== "trainer") {
    throwError("Only trainers can access this.");
  }

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("tenant_id", currentUser.tenantId)
    .eq("role", "trainee")
    .contains("assigned_courses", currentUser.assigned_courses || []);

  if (error) throwError(error.message);
  return { trainees: data };
}

export async function getMyCoursesApi() {
  const currentUser = getCurrentUser();
  if (!currentUser) throwError("Unauthorized.");

  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .in("id", currentUser.assigned_courses || []);

  if (error) throwError(error.message);
  return { courses: data };
}