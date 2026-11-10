/* ============================================================
   authApi.ts — VERIFIED-WORKING login (drop-in replacement)
   Replace your AuthRejectedError class and your loginTenant()
   with the two pieces below. Keep every other export as-is.

   Verified against the live API (HTTP 200):
     payload  { tenantId, username, password }  — camelCase tenantId,
     username EXACT case ("Try", never transformed),
     password RAW (the backend bcrypt-compares it).
   ============================================================ */

const API_BASE = "https://medstat-3rxl.onrender.com";

export class AuthRejectedError extends Error {
  noOfflineFallback = true; // startup.tsx: hard rejection → do NOT fall back to local DB
  constructor(message: string) {
    super(message);
    this.name = "AuthRejectedError";
  }
}

export interface LoginTenantResult {
  user: {
    id: string;
    username: string;
    email?: string | null;
    phone?: string | null;
    profile_pic?: string | null;
    role: string;
    tenantId?: string;
    tenant_id?: string;
    assigned_courses?: string[];
    created_at?: string;
  };
  authToken?: string;
}

export async function loginTenant(params: {
  tenantId: string;
  username: string;
  password: string;
}): Promise<LoginTenantResult> {
  // ⚠️ Send the payload EXACTLY as proven working.
  // The backend matches usernames CASE-SENSITIVELY ("Try" ≠ "try"),
  // so the username must never be lowercased/normalized.
  const body = JSON.stringify({
    tenantId: params.tenantId,          // camelCase — required by the API
    username: params.username.trim(),   // trim stray spaces only; PRESERVE case
    password: params.password,          // raw; backend bcrypt-compares
  });

  let resp: Response;
  try {
    resp = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" }, // deliberately NO Authorization header
      body,
    });
  } catch {
    const e: any = new Error("Backend unreachable");
    e.noOfflineFallback = false;      // network down → startup.tsx may use local login
    throw e;
  }

  const data: any = await resp.json().catch(() => ({}));

  if (resp.status === 401) {
    throw new AuthRejectedError(data?.error || "Invalid credentials");
  }
  if (!resp.ok) {
    const e: any = new Error(data?.error || `Login failed (${resp.status})`);
    e.noOfflineFallback = false;      // tenant/server issue → allow local fallback
    throw e;
  }

  return { user: data.user, authToken: data.authToken };
}
