// src/api/authApi.ts — v3: Supabase RPC for auth (NO Render backend for login/register)
//
// WHAT CHANGED (v3)
//
//   loginTenant and registerTenant now call Supabase RPC functions
//   (verify_login, register_tenant_with_admin) directly. No Render
//   backend is involved in credential verification or institution
//   creation — only the OTP/SMS flow still uses Render.
//
//   This means:
//     - No Render cold starts (30-60s wake delay) on login
//     - No 401s from a sleeping server
//     - No DNS-blocked *.onrender.com hostname for auth
//     - Login works as long as Supabase is reachable
//
//   The Render backend remains for OTP only:
//     - sendATCode (sends SMS via Africa's Talking)
//     - verifyATCode (verifies the OTP code)
//
//   Prerequisite: run supabase_auth.sql in the Supabase SQL Editor to
//   create the verify_login, register_tenant_with_admin, and
//   resolve_tenant SECURITY DEFINER functions.

import { supabase, apiFetchAny } from "../auth/supabase";

/* ------------------------------------------------------------------ */
/* Wake — only needed for the OTP flow (Render backend)               */
/* ------------------------------------------------------------------ */

export async function wakeBackend(): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 90000);
  try {
    await apiFetchAny("/api/health", { signal: controller.signal });
  } catch {
    /* unreachable — the OTP call below will surface the real error */
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/* POST helper for the Render backend (OTP flow only)                */
/* ------------------------------------------------------------------ */

async function authPost<T = any>(
  path: string,
  body: Record<string, any>,
): Promise<T> {
  let response: Response;
  try {
    response = await apiFetchAny(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Could not reach the server. Check your internet connection and try again; " +
        "if it keeps failing, this network may be blocking the server — try another one " +
        "(e.g. a phone hotspot).",
    );
  }

  const text = await response.text().catch(() => "");
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

  if (!response.ok) {
    const msg =
      parsed?.error ||
      parsed?.message ||
      (text ? String(text).slice(0, 200) : "") ||
      `Request failed (${response.status})`;
    throw new Error(msg);
  }

  return (parsed ?? {}) as T;
}

/* ------------------------------------------------------------------ */
/* 1. SEND OTP (Africa's Talking) — PhoneEntry.tsx                    */
/*    Stays on the Render backend (needs SMS sending).                */
/* ------------------------------------------------------------------ */

export async function sendATCode(phone: string): Promise<void> {
  await wakeBackend();
  await authPost("/api/auth/send-code", { phone });
}

/* ------------------------------------------------------------------ */
/* 2. VERIFY OTP — VerifyCode.tsx, returns temp token                */
/*    Stays on the Render backend (OTP codes stored server-side).     */
/* ------------------------------------------------------------------ */

export interface VerifyCodeResult {
  token: string;
}

export async function verifyATCode(
  phone: string,
  code: string,
): Promise<VerifyCodeResult> {
  const result = await authPost<{ token?: string; message?: string }>(
    "/api/auth/verify-code",
    { phone, code },
  );
  if (!result?.token) {
    throw new Error(result?.message || "Verification failed — no token received.");
  }
  return { token: result.token };
}

/* ------------------------------------------------------------------ */
/* 3. REGISTER TENANT + ADMIN — RegisterAdmin.tsx                     */
/*    v3: calls Supabase RPC register_tenant_with_admin.             */
/*    No Render backend, no cold start, no 401s.                      */
/* ------------------------------------------------------------------ */

export interface RegisterTenantParams {
  phone: string;
  tempToken: string;       // from verifyATCode — kept for API compat
  businessName: string;
  username: string;
  password: string;
}

export interface RegisterTenantResult {
  userId: string;
  tenantId: string;
  authToken: string;       // session token
  user?: any;
}

export async function registerTenant(
  params: RegisterTenantParams,
): Promise<RegisterTenantResult> {
  // Call the Supabase SECURITY DEFINER function — it creates the tenant +
  // admin user and hashes the password with bcrypt (gen_salt('bf')).
  const { data, error } = await supabase.rpc("register_tenant_with_admin", {
    p_phone: params.phone,
    p_business_name: params.businessName,
    p_username: params.username,
    p_password: params.password,
  });

  if (error) {
    throw new Error(error.message || "Registration failed (database error).");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Registration failed.");
  }

  if (!data?.tenantId || !data?.userId) {
    throw new Error("Registration completed but missing account details.");
  }

  return {
    userId: data.userId,
    tenantId: data.tenantId,
    authToken: `session-${data.userId}`,
    user: data.user,
  };
}

/* ------------------------------------------------------------------ */
/* 4. LOGIN — userDB.ts loginWithIdentifier + supabase.ts tryReauthenticate */
/*    v3: calls Supabase RPC verify_login.                            */
/*    Accepts tenantId and/or businessName — the function resolves     */
/*    the tenant server-side if tenantId is empty.                    */
/* ------------------------------------------------------------------ */

export interface LoginTenantParams {
  tenantId?: string;
  username: string;
  password: string;
  businessName?: string;
}

export interface LoginTenantResult {
  authToken: string;       // session token
  user?: any;
}

export async function loginTenant(
  params: LoginTenantParams,
): Promise<LoginTenantResult> {
  // Call the Supabase SECURITY DEFINER function — it reads the user row
  // (bypassing RLS), verifies the password with crypt() (pgcrypto bcrypt),
  // and returns the user row MINUS the password column.
  const { data, error } = await supabase.rpc("verify_login", {
    p_tenant_id: params.tenantId || null,
    p_business_name: params.businessName || null,
    p_username: params.username,
    p_password: params.password,
  });

  if (error) {
    throw new Error(error.message || "Login failed (database error).");
  }

  if (!data?.success) {
    throw new Error(data?.error || "Invalid username or password.");
  }

  if (!data?.user?.id) {
    throw new Error("Login succeeded but no user data was returned.");
  }

  return {
    authToken: `session-${data.user.id}`,
    user: data.user,
  };
}