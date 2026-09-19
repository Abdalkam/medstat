// src/auth/supabase.ts
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string).trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string).trim();

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// ==========================================
// ORIGINAL SUPABASE FETCH WRAPPER
// ==========================================
export async function sbFetch(table: string, options: Record<string, any> = {}) {
  if (options.method === "DELETE") {
    let deleteQuery = supabase.from(table).delete();
    if (options.id) deleteQuery = deleteQuery.eq("id", options.id);
    if (options.tenant_id) deleteQuery = deleteQuery.eq("tenant_id", options.tenant_id);
    if (options.course_id) deleteQuery = deleteQuery.eq("course_id", options.course_id);
    if (options.user_id) deleteQuery = deleteQuery.eq("user_id", options.user_id);
    if (options.assignment_id) deleteQuery = deleteQuery.eq("assignment_id", options.assignment_id);
    
    const { data, error } = await deleteQuery;
    return { data, error };
  }

  let query = supabase.from(table).select(options.select || "*");

  if (options.id) query = query.eq("id", options.id);
  if (options.tenant_id) query = query.eq("tenant_id", options.tenant_id);
  if (options.course_id) query = query.eq("course_id", options.course_id);
  if (options.user_id) query = query.eq("user_id", options.user_id);
  if (options.assignment_id) query = query.eq("assignment_id", options.assignment_id);
  if (options.limit) query = query.limit(parseInt(options.limit));

  if (options.method === "POST" && options.body) {
    const { data, error } = await supabase.from(table).insert(JSON.parse(options.body)).select();
    return { data, error };
  }

  const { data, error } = await query;
  return { data, error };
}


// ==========================================
// BACKEND API SYNC LOGIC
// ==========================================
let periodicPullInterval: ReturnType<typeof setInterval> | null = null;

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function hasValidAuth(): boolean {
  return !!localStorage.getItem("authToken") && !!localStorage.getItem("currentUser");
}

async function apiFetch(path: string) {
  if (!hasValidAuth()) {
    throw new Error("No auth token available - skipping API call");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(`API fetch failed: 401 - Auth token may be expired`);
    }
    throw new Error(`API fetch failed: ${res.status}`);
  }
  return res.json();
}

// ==========================================
// 1. REALTIME SYNC (Disabled for stability with custom backend)
// ==========================================
export function enableSyncHooks() {
  console.log("📡 Sync hooks enabled (Polling mode).");
}

// ==========================================
// 2. PERIODIC PULL
// ==========================================
export function startPeriodicPull(ms: number = 15000) {
  if (periodicPullInterval) clearInterval(periodicPullInterval);
  
  // Prevent 401 spam by disabling backend polling on the Live Classroom page
  if (window.location.pathname.includes("/trainer/live/")) {
    console.log("⏱️ Skipping periodic pull on live classroom page.");
    return;
  }

  console.log(`⏱️ Starting periodic pull every ${ms}ms`);
  periodicPullInterval = setInterval(async () => {
    if (!hasValidAuth()) return; 
    
    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (user?.tenantId) {
      await pullAllTenantData(user.tenantId);
    }
  }, ms);
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
    console.log("⏱️ Stopped periodic pull.");
  }
}

// ==========================================
// 3. PULL ALL DATA (Via Backend API)
// ==========================================
export async function pullAllTenantData(tenantId: string) {
  if (!hasValidAuth()) {
    console.log("⏭️ Skipping pull - not authenticated yet");
    return;
  }

  console.log("🔄 Pulling all tenant data via backend...");
  try {
    // ✅ SAFE DYNAMIC IMPORT: Loads db only when needed, preventing blank screen crashes
    const { db } = await import("../database/db"); 
    
    const data = await apiFetch(`/api/sync/pull?tenant_id=${tenantId}`);
    
    if (data.users) {
      for (const u of data.users) await db.users.put(mapUser(u));
    }
    if (data.courses) {
      for (const c of data.courses) await db.courses.put(mapCourse(c));
    }
    if (data.enrollments) {
      for (const e of data.enrollments) await db.enrollments.put(mapEnrollment(e));
    }
    console.log("✅ Tenant data pull complete.");
  } catch (error) {
    console.error("❌ Pull tenant data failed:", error);
  }
}

// ==========================================
// 4. PULL SETTINGS (Fixed: requires tenant_id)
// ==========================================
export async function pullSettings() {
  if (!hasValidAuth()) {
    console.log("⏭️ Skipping settings pull - not authenticated yet");
    return null;
  }

  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = user?.tenantId;

  if (!tenantId) {
    console.warn("⚠️ No tenantId found for settings pull");
    return null;
  }

  try {
    const data = await apiFetch(`/api/settings/get?tenant_id=${tenantId}`);
    return data;
  } catch (error) {
    console.error("❌ Failed to pull settings:", error);
    return null;
  }
}

// ==========================================
// 5. MANUAL SYNC DOWN (Fallback)
// ==========================================
export async function syncDown() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  if (user?.tenantId) {
    await pullAllTenantData(user.tenantId);
  }
}

// ==========================================
// 6. PUSH LOCAL DATA TO CLOUD
// ==========================================
export async function syncUp() {
  if (!hasValidAuth()) {
    console.log("⏭️ Skipping sync up - not authenticated yet");
    return;
  }

  console.log("☁️ Starting Sync Up...");
  try {
    // ✅ SAFE DYNAMIC IMPORT
    const { db } = await import("../database/db"); 
    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u: any) => !(u as any).synced);

    if (usersToSync.length > 0) {
      const res = await fetch(`${API_BASE_URL}/api/sync/push-users`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ users: usersToSync }),
      });
      if (!res.ok) {
        console.warn("Push users failed:", res.status);
      }
    }
    console.log("☁️ Sync Up complete.");
  } catch (error) {
    console.error("❌ Sync Up failed:", error);
  }
}

// ==========================================
// HELPER FUNCTIONS
// ==========================================
function mapUser(u: any) {
  return {
    id: u.id,
    username: u.username,
    email: u.email || "",
    phone: u.phone || "",
    password: u.password || "",
    role: u.role || "trainee",
    profilePic: u.profile_pic || u.profilePic || "",
    assignedCourses: u.assigned_courses || u.assignedCourses || [],
    tenantId: u.tenant_id || u.tenantId,
    createdAt: u.created_at || u.createdAt || new Date().toISOString(),
    synced: true,
  };
}

function mapCourse(c: any) {
  return {
    id: c.id,
    name: c.name || "",
    description: c.description || "",
    tuitionType: c.tuition_type || c.tuitionType || "free",
    amount: c.amount || 0,
    startDate: c.start_date || c.startDate || new Date().toISOString(),
    period: c.period || "",
    trainerId: c.trainer_id || c.trainerId || "",
    tenantId: c.tenant_id || c.tenantId,
    createdAt: c.created_at || c.createdAt || new Date().toISOString(),
    synced: true,
  };
}

function mapEnrollment(e: any) {
  return {
    id: e.id,
    userId: e.user_id || e.userId || "",
    courseId: e.course_id || e.courseId || "",
    role: e.role || "trainee",
    tenantId: e.tenant_id || e.tenantId,
    enrolledAt: e.enrolled_at || e.enrolledAt || new Date().toISOString(),
    createdAt: e.created_at || e.createdAt || new Date().toISOString(),
    synced: true,
  };
}