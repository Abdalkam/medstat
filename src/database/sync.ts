// src/database/sync.ts
import { db } from "./db";

let periodicPullInterval: ReturnType<typeof setInterval> | null = null;
let last401Logged = 0;

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

// ✅ FIX: Single source of truth for logging out. 
// We no longer use window.location.href to avoid fighting with React Router.
export function hardRedirectToLogin() {
  stopPeriodicPull();
  
  localStorage.removeItem("authToken");
  localStorage.removeItem("currentUser");
  localStorage.removeItem("activeTenantId");
  
  // Notify React to update state and redirect gracefully
  window.dispatchEvent(new Event("authStateChanged"));
}

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
    throw new Error("No auth token available");
  }

  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: getAuthHeaders(),
  });

  if (res.status === 401) {
    const now = Date.now();
    if (now - last401Logged > 60000) {
      console.warn("⚠️ Auth token rejected — stopped periodic sync.");
      last401Logged = now;
    }

    // ✅ NUCLEAR FIX: NEVER forcefully log the user out or redirect on a background 401 error.
    // Just stop the background sync. React will handle the redirect if the user 
    // actually logs out via the Logout button.
    stopPeriodicPull(); 
    
    throw new Error("401");
  }

  if (!res.ok) {
    throw new Error(`API fetch failed: ${res.status}`);
  }

  return res.json();
}

// ==========================================
// 1. REALTIME SYNC (Disabled for stability)
// ==========================================
export function enableSyncHooks() {
  console.log("📡 Sync hooks enabled (Polling mode).");
}

// ==========================================
// 2. PERIODIC PULL
// ==========================================
export function startPeriodicPull(ms: number = 60000) {
  if (periodicPullInterval) clearInterval(periodicPullInterval);
  
  periodicPullInterval = setInterval(async () => {
    if (!hasValidAuth()) return;
    
    const token = localStorage.getItem("authToken");
    if (token === "offline-mode-pending-sync") {
      console.log("⏳ Skipping background sync because backend is asleep (Offline Mode).");
      return; 
    }

    const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (user?.tenantId) {
      try {
        await pullAllTenantData(user.tenantId);
      } catch {
        // 401 will stop the interval via apiFetch
      }
    }
  }, ms);
}

export function stopPeriodicPull() {
  if (periodicPullInterval) {
    clearInterval(periodicPullInterval);
    periodicPullInterval = null;
  }
}

// ==========================================
// 3. PULL ALL DATA (Via Backend API)
// ==========================================
export async function pullAllTenantData(tenantId: string) {
  if (!tenantId) return;

  const token = localStorage.getItem("authToken");
  if (token === "offline-mode-pending-sync") return;

  try {
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
  } catch (error) {
    if (!(error instanceof Error && error.message === "401")) {
      console.error("❌ Pull tenant data failed:", error);
    }
  }
}

// ==========================================
// 4. PULL SETTINGS
// ==========================================
export async function pullSettings() {
  const user = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = user?.tenantId;
  if (!tenantId) return null;

  const token = localStorage.getItem("authToken");
  if (token === "offline-mode-pending-sync") return null;

  try {
    return await apiFetch(`/api/settings/get?tenant_id=${tenantId}`);
  } catch (error) {
    if (!(error instanceof Error && error.message === "401")) {
      console.error("❌ Failed to pull settings:", error);
    }
    return null;
  }
}

// ==========================================
// 5. MANUAL SYNC DOWN
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
  if (!hasValidAuth()) return;

  try {
    const localUsers = await db.users.toArray();
    const usersToSync = localUsers.filter((u) => !(u as any).synced);

    if (usersToSync.length > 0) {
      const res = await fetch(`${API_BASE_URL}/api/sync/push-users`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: JSON.stringify({ users: usersToSync }),
      });
      if (!res.ok) {
        if (res.status === 401) {
          console.warn("⚠️ Auth expired — sync up skipped.");
        } else {
          console.warn(`Push users failed: ${res.status}`);
        }
      }
    }
  } catch (error) {
    console.error("❌ Sync Up failed:", error);
  }
}

// ==========================================
// HELPERS
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