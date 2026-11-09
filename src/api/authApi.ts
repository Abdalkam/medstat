
// src/api/authApi.ts

import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { loginUser } from "../database/userDB";

/* ---------------- Server base URL ----------------
 * 1. VITE_API_URL when configured.
 * 2. Render backend as the default in both development and production.
 *
 * This prevents local development from accidentally using localhost:10000.
 * ------------------------------------------------------------------ */

const API_BASE = (
  import.meta.env.VITE_API_URL ||
  "https://medstat-3rxl.onrender.com"
).replace(/\/+$/, "");

function throwError(message: string): never {
  throw new Error(message);
}

class AuthRejectedError extends Error {
  noOfflineFallback = true;

  constructor(message: string) {
    super(message);
    this.name = "AuthRejectedError";
  }
}

function assertExactUsername(typed: string, returned: unknown): void {
  if (
    typeof returned !== "string" ||
    returned.toLowerCase() !== typed.trim().toLowerCase()
  ) {
    throw new AuthRejectedError("Invalid username or password");
  }
}

function getCurrentUser(): {
  id: string;
  tenantId: string;
  role: string;
  assigned_courses?: string[];
} | null {
  const stored = localStorage.getItem("currentUser");

  if (!stored) return null;

  try {
    return JSON.parse(stored);
  } catch {
    return null;
  }
}

async function cacheUserToLocalDB(user: {
  id: string;
  tenant_id: string;
  username: string;
  phone?: string;
  email?: string;
  password?: string;
  role: string;
  assigned_courses?: string[];
  profile_pic?: string;
  created_at?: string;
}): Promise<void> {
  try {
    await db.users.put({
      id: user.id,
      tenantId: user.tenant_id,
      username: user.username,
      phone: user.phone || "",
      email: user.email || "",
      password: user.password || "",
      role: user.role,
      assignedCourses: user.assigned_courses || [],
      profilePic: user.profile_pic || "",
      tuition: { paid: 0, expected: 0 },
      remuneration: { per_diem: 0, net_salary: 0 },
      synced: true,
      createdAt: user.created_at || new Date().toISOString(),
    } as any);

    console.log("User cached to local IndexedDB:", user.username);
  } catch (cacheErr) {
    console.warn("Failed to cache user to local DB:", cacheErr);
  }
}

// ==========================================
// AUTH API
// ==========================================

export async function sendATCode(phone: string) {
  const response = await fetch(`${API_BASE}/api/auth/send-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to send code");
  }

  return { success: true };
}

export async function verifyATCode(phone: string, code: string) {
  const response = await fetch(`${API_BASE}/api/auth/verify-code`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Failed to verify code");
  }

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
    .insert({
      business_name: data.businessName,
      phone: data.phone,
    })
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

  // This is a placeholder, not a real authenticated backend session.
  // Backend registration/login must issue the actual session token.
  const authToken = "offline-mode-pending-sync";

  return {
    success: true,
    authToken,
    tenantId: tenant.id,
    userId,
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
    const { data: tenant, error } = await supabase
      .from("tenants")
      .select("id")
      .ilike("business_name", `%${data.business_name}%`)
      .maybeSingle();

    if (error) throwError(error.message);
    if (!tenant) throwError("Business not found.");

    targetTenantId = tenant.id;
  }

  if (!targetTenantId && data.phone) {
    const { data: tenant, error } = await supabase
      .from("tenants")
      .select("id")
      .eq("phone", data.phone)
      .maybeSingle();

    if (error) throwError(error.message);
    if (!tenant) throwError("Business not found.");

    targetTenantId = tenant.id;
  }

  if (!targetTenantId) {
    throwError("Could not identify business.");
  }

  // ------------------------------------------
  // 1. TRY BACKEND FIRST
  // ------------------------------------------

  try {
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...data,
        tenantId: targetTenantId,
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));

      if (response.status === 401 || response.status === 403) {
        throw new AuthRejectedError(
          err.error || "Invalid username or password"
        );
      }

      throw new Error(
        err.error || `Backend login failed: ${response.status}`
      );
    }

    const result = await response.json();

    assertExactUsername(data.username, result.user?.username);

    if (!result.authToken) {
      throw new Error("Backend did not return an authentication token.");
    }

    await cacheUserToLocalDB({
      id: result.user.id,
      tenant_id:
        result.user.tenant_id ||
        result.user.tenantId ||
        targetTenantId,
      username: result.user.username,
      phone: result.user.phone,
      email: result.user.email,
      password: undefined,
      role: result.user.role,
      assigned_courses:
        result.user.assigned_courses ||
        result.user.assignedCourses ||
        [],
      profile_pic: result.user.profile_pic,
      created_at: result.user.created_at,
    });

    return {
      authToken: result.authToken,
      user: {
        id: result.user.id,
        username: result.user.username,
        email: result.user.email || "",
        phone: result.user.phone || "",
        role: result.user.role,
        tenant_id:
          result.user.tenant_id ||
          result.user.tenantId ||
          targetTenantId,
        tenantId:
          result.user.tenant_id ||
          result.user.tenantId ||
          targetTenantId,
        assigned_courses:
          result.user.assigned_courses ||
          result.user.assignedCourses ||
          [],
        created_at:
          result.user.created_at ||
          new Date().toISOString(),
      },
    };
  } catch (backendError: any) {
    if (backendError?.noOfflineFallback) {
      throw backendError;
    }

    console.warn(
      "Backend login failed:",
      backendError?.message || backendError
    );
  }

  // ------------------------------------------
  // 2. SUPABASE RPC FALLBACK
  // ------------------------------------------

  try {
    console.log(
      "Trying Supabase RPC lookup for:",
      data.username
    );

    const { data: rpcResult, error: supErr } = await supabase.rpc(
      "lookup_user_for_login",
      {
        p_tenant_id: targetTenantId,
        p_username: data.username,
      }
    );

    console.log("Supabase RPC result:", {
      rpcResult,
      supErr,
    });

    if (supErr) throw supErr;

    const supabaseUser = Array.isArray(rpcResult)
      ? rpcResult[0] ?? null
      : rpcResult;

    if (supabaseUser) {
      assertExactUsername(data.username, supabaseUser.username);

      let passwordValid = false;

      if (supabaseUser.password === data.password) {
        passwordValid = true;
      } else if (supabaseUser.password?.startsWith("$2")) {
        const bcrypt = await import("bcryptjs");

        passwordValid = await bcrypt.default.compare(
          data.password,
          supabaseUser.password
        );
      }

      if (!passwordValid) {
        throw new AuthRejectedError(
          "Invalid username or password"
        );
      }

      await cacheUserToLocalDB(supabaseUser);

      return {
        authToken: "offline-mode-pending-sync",
        user: {
          id: supabaseUser.id,
          username: supabaseUser.username,
          email: supabaseUser.email || "",
          phone: supabaseUser.phone || "",
          role: supabaseUser.role,
          tenant_id: supabaseUser.tenant_id,
          tenantId: supabaseUser.tenant_id,
          assigned_courses:
            supabaseUser.assigned_courses || [],
          created_at:
            supabaseUser.created_at ||
            new Date().toISOString(),
        },
      };
    }

    console.warn(
      "Supabase RPC returned no user. Trying direct query."
    );
  } catch (supabaseErr: any) {
    if (supabaseErr?.noOfflineFallback) {
      throw supabaseErr;
    }

    console.warn(
      "Supabase RPC failed:",
      supabaseErr?.message || supabaseErr
    );
  }

  // ------------------------------------------
  // 3. DIRECT SUPABASE FALLBACK
  // ------------------------------------------

  try {
    console.log("Trying direct Supabase users query");

    const { data: directUser, error: directErr } = await supabase
      .from("users")
      .select(
        "id, username, password, email, phone, role, tenant_id, profile_pic, assigned_courses, created_at"
      )
      .eq("tenant_id", targetTenantId)
      .ilike("username", data.username.trim())
      .maybeSingle();

    if (directErr) throw directErr;

    if (directUser) {
      assertExactUsername(data.username, directUser.username);

      let passwordValid = false;

      if (directUser.password === data.password) {
        passwordValid = true;
      } else if (directUser.password?.startsWith("$2")) {
        const bcrypt = await import("bcryptjs");

        passwordValid = await bcrypt.default.compare(
          data.password,
          directUser.password
        );
      }

      if (!passwordValid) {
        throw new AuthRejectedError(
          "Invalid username or password"
        );
      }

      await cacheUserToLocalDB(directUser);

      return {
        authToken: "offline-mode-pending-sync",
        user: {
          id: directUser.id,
          username: directUser.username,
          email: directUser.email || "",
          phone: directUser.phone || "",
          role: directUser.role,
          tenant_id: directUser.tenant_id,
          tenantId: directUser.tenant_id,
          assigned_courses:
            directUser.assigned_courses || [],
          created_at:
            directUser.created_at ||
            new Date().toISOString(),
        },
      };
    }
  } catch (directErr: any) {
    if (directErr?.noOfflineFallback) {
      throw directErr;
    }

    console.warn(
      "Direct Supabase query failed:",
      directErr?.message || directErr
    );
  }

  // ------------------------------------------
  // 4. LOCAL INDEXEDDB FALLBACK
  // ------------------------------------------

  console.warn("Falling back to local IndexedDB login");

  const localUser = await loginUser(
    data.username,
    data.password
  );

  if (!localUser) {
    throw new Error(
      "No cached credentials. Please connect to the internet and try again."
    );
  }

  assertExactUsername(data.username, localUser.username);

  return {
    authToken: "offline-mode-pending-sync",
    user: {
      id: localUser.id,
      username: localUser.username,
      email: localUser.email || "",
      phone: localUser.phone || "",
      role: localUser.role,
      tenant_id:
        (localUser as any).tenant_id ||
        (localUser as any).tenantId ||
        targetTenantId,
      tenantId:
        (localUser as any).tenant_id ||
        (localUser as any).tenantId ||
        targetTenantId,
      assigned_courses:
        localUser.assignedCourses || [],
      created_at:
        localUser.createdAt ||
        new Date().toISOString(),
    },
  };
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

  const { data: dupe, error: dupeError } = await supabase
    .from("users")
    .select("id")
    .eq("tenant_id", currentUser.tenantId)
    .ilike("username", user.username)
    .maybeSingle();

  if (dupeError) throwError(dupeError.message);

  if (dupe) {
    throwError("A user with this username already exists.");
  }

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(
    user.password,
    10
  );

  const { data, error } = await supabase
    .from("users")
    .insert({
      id: user.id,
      tenant_id: currentUser.tenantId,
      username: user.username,
      phone: user.phone,
      email: user.email,
      password: hashedPassword,
      role: user.role || "trainee",
      assigned_courses: user.assigned_courses || [],
      profile_pic: user.profile_pic,
      tuition:
        user.role === "trainee"
          ? user.tuition
          : undefined,
      remuneration:
        user.role === "trainer"
          ? user.remuneration
          : undefined,
    })
    .select()
    .single();

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

  if (
    currentUser?.role !== "admin" &&
    currentUser?.id !== user.id
  ) {
    throwError("You can only update your own profile.");
  }

  if (user.username !== undefined && currentUser) {
    const { data: dupe, error: dupeError } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", currentUser.tenantId)
      .ilike("username", user.username)
      .maybeSingle();

    if (dupeError) throwError(dupeError.message);

    if (dupe && dupe.id !== user.id) {
      throwError("That username is already taken.");
    }
  }

  const updates: Record<string, any> = {};

  if (user.username !== undefined) updates.username = user.username;
  if (user.phone !== undefined) updates.phone = user.phone;
  if (user.email !== undefined) updates.email = user.email;

  if (user.password) {
    const bcrypt = await import("bcryptjs");

    updates.password = await bcrypt.default.hash(
      user.password,
      10
    );
  }

  if (
    user.role !== undefined &&
    currentUser?.role === "admin"
  ) {
    updates.role = user.role;
  }

  if (user.assigned_courses !== undefined) {
    updates.assigned_courses = user.assigned_courses;
  }

  if (user.profile_pic !== undefined) {
    updates.profile_pic = user.profile_pic;
  }

  if (user.tuition !== undefined) {
    updates.tuition = user.tuition;
  }

  if (user.remuneration !== undefined) {
    updates.remuneration = user.remuneration;
  }

  const { data, error } = await supabase
    .from("users")
    .update(updates)
    .eq("id", user.id)
    .eq("tenant_id", currentUser?.tenantId)
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

  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", id)
    .eq("tenant_id", currentUser.tenantId);

  if (error) throwError(error.message);

  return { success: true };
}

export async function changePasswordApi(
  id: string,
  newPassword: string
) {
  const currentUser = getCurrentUser();

  if (!currentUser) {
    throwError("Not authenticated.");
  }

  if (
    currentUser.role !== "admin" &&
    currentUser.id !== id
  ) {
    throwError("You can only change your own password.");
  }

  const bcrypt = await import("bcryptjs");
  const hashedPassword = await bcrypt.default.hash(
    newPassword,
    10
  );

  const { error } = await supabase
    .from("users")
    .update({ password: hashedPassword })
    .eq("id", id)
    .eq("tenant_id", currentUser.tenantId);

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

  const { data, error } = await supabase
    .from("courses")
    .insert({
      id: course.id,
      tenant_id: currentUser.tenantId,
      name: course.name,
      description: course.description,
      logo: course.logo,
      tuition_type: course.tuition_type,
      amount: course.amount,
      start_date: course.start_date,
      period: course.period,
    })
    .select()
    .single();

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
    .eq("tenant_id", currentUser.tenantId)
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

  const { error } = await supabase
    .from("courses")
    .delete()
    .eq("id", id)
    .eq("tenant_id", currentUser.tenantId);

  if (error) throwError(error.message);

  return { success: true };
}

// ==========================================
// SYNC API
// ==========================================

export async function pullSyncData(tenantId: string) {
  const [usersRes, coursesRes] = await Promise.all([
    supabase
      .from("users")
      .select("*")
      .eq("tenant_id", tenantId),

    supabase
      .from("courses")
      .select("*")
      .eq("tenant_id", tenantId),
  ]);

  if (usersRes.error) throwError(usersRes.error.message);
  if (coursesRes.error) throwError(coursesRes.error.message);

  return {
    users: usersRes.data,
    courses: coursesRes.data,
  };
}

// ==========================================
// IMAGE / LOGO HELPERS
// ==========================================

export function normalizeImageSrc(
  value?: string | null
): string {
  const raw = (value ?? "").trim();

  if (!raw) return "";

  if (raw.startsWith("data:")) return raw;

  if (/^https?:\/\//i.test(raw)) return raw;

  if (
    raw.startsWith("<svg") ||
    raw.startsWith("<?xml")
  ) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
  }

  const compact = raw.replace(/\s+/g, "");

  if (
    compact.length > 100 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(compact)
  ) {
    let mime = "image/png";

    if (compact.startsWith("/9j/")) {
      mime = "image/jpeg";
    } else if (compact.startsWith("R0lGOD")) {
      mime = "image/gif";
    } else if (compact.startsWith("UklGR")) {
      mime = "image/webp";
    } else if (
      compact.startsWith("PHN2Zy") ||
      compact.startsWith("PD94bW")
    ) {
      mime = "image/svg+xml";
    }

    return `data:${mime};base64,${compact}`;
  }

  return raw;
}

export function getLogoSrc(
  settings?: { logo?: string | null } | null
): string {
  return normalizeImageSrc(settings?.logo);
}

export function getLoginBackgroundSrc(
  settings?: { login_background?: string | null } | null
): string {
  return normalizeImageSrc(settings?.login_background);
}

// ==========================================
// SETTINGS API
// ==========================================

export async function getPublicSettingsApi(
  tenantId: string
) {
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throwError(error.message);

  if (!data) return data;

  return {
    ...data,
    logo: data.logo
      ? normalizeImageSrc(data.logo)
      : null,
    login_background: data.login_background
      ? normalizeImageSrc(data.login_background)
      : null,
  };
}

export async function getSettingsApi(
  tenantId: string
) {
  const { data, error } = await supabase
    .from("business_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) throwError(error.message);

  if (!data) return data;

  return {
    ...data,
    logo: data.logo
      ? normalizeImageSrc(data.logo)
      : null,
    login_background: data.login_background
      ? normalizeImageSrc(data.login_background)
      : null,
  };
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
    .upsert(
      {
        ...settings,
        tenant_id: currentUser.tenantId,
      },
      { onConflict: "id" }
    )
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
    .contains(
      "assigned_courses",
      currentUser.assigned_courses || []
    );

  if (error) throwError(error.message);

  return { trainees: data };
}

export async function getMyCoursesApi() {
  const currentUser = getCurrentUser();

  if (!currentUser) {
    throwError("Unauthorized.");
  }

  const { data, error } = await supabase
    .from("courses")
    .select("*")
    .eq("tenant_id", currentUser.tenantId)
    .in("id", currentUser.assigned_courses || []);

  if (error) throwError(error.message);

  return { courses: data };
}
