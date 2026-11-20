// src/api/authApi.ts
// Auth API client — talks to the Render backend (medstat-3rxl.onrender.com)
// which is the ONLY issuer of real session JWTs ("eyJ…"). The app never
// signs in through supabase.auth; it authenticates with its own backend.
//
// WHY THE BACKEND, NOT DIRECT SUPABASE
//   Supabase enables RLS by default. With no policies on public.users, an
//   anon client read (supabase.from("users").select("*")) returns ZERO rows
//   — the password hash is never exposed to anon, which is correct security,
//   but it means the client CANNOT verify credentials itself. The Render
//   backend uses the service-role key (bypasses RLS) to read the user row,
//   bcrypt.compare the password, and issue a real JWT. This file is the
//   single bridge to that backend.
//
// ENDPOINT CONTRACT (verify against your Render routes — adjust paths only
// here if they differ):
//
//   POST /api/auth/send-code        { phone }
//   POST /api/auth/verify-code      { phone, code }            → { token }
//   POST /api/auth/register-tenant  { phone, tempToken, businessName,
//                                     username, password }     → { authToken, userId,
//                                                                     tenantId, user? }
//   POST /api/auth/login            { tenantId, username, password,
//                                     businessName? }          → { authToken, user? }
//   GET  /api/health                (wake ping for cold starts)
//
// Every call goes through apiFetchAny() (from supabase.ts) which walks a
// fallback list of API origins on network failures, so a network that can't
// resolve *.onrender.com still reaches the backend via the same-origin
// Vercel proxy.

import { apiFetchAny, isRealBackendToken } from "../auth/supabase";

/* ------------------------------------------------------------------ */
/* Wake — Render free tier sleeps after 15 min idle (30-60s cold start) */
/* ------------------------------------------------------------------ */

export async function wakeBackend(): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 90000);
  try {
    await apiFetchAny("/api/health", { signal: controller.signal });
  } catch {
    /* unreachable — the auth call below will surface the real error */
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/* ------------------------------------------------------------------ */
/* POST helper — surfaces server messages, never throws TypeError      */
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
    // Every origin failed at the network level (DNS / offline / CORS).
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
/* ------------------------------------------------------------------ */

export async function sendATCode(phone: string): Promise<void> {
  await authPost("/api/auth/send-code", { phone });
}

/* ------------------------------------------------------------------ */
/* 2. VERIFY OTP — VerifyCode.tsx, returns temp token for registration */
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
/*    Endpoint name matches userDB.ts v2 addUser: /api/auth/register-tenant */
/* ------------------------------------------------------------------ */

export interface RegisterTenantParams {
  phone: string;
  tempToken: string;
  businessName: string;
  username: string;
  password: string;
}

export interface RegisterTenantResult {
  userId: string;
  tenantId: string;
  authToken: string;
  user?: any;
}

export async function registerTenant(
  params: RegisterTenantParams,
): Promise<RegisterTenantResult> {
  // Wake first — a cold Render instance will otherwise time out the
  // registration (the user already waited for the OTP).
  await wakeBackend();

  const result = await authPost<{
    userId?: string;
    tenantId?: string;
    authToken?: string;
    user?: any;
    message?: string;
  }>("/api/auth/register-tenant", params);

  if (!result?.userId || !result?.tenantId) {
    throw new Error(result?.message || "Registration failed — missing account details.");
  }
  if (!isRealBackendToken(result.authToken)) {
    throw new Error(
      result?.message ||
        "Registration completed but no valid session token was returned. Please try logging in.",
    );
  }

  return {
    userId: result.userId,
    tenantId: result.tenantId,
    authToken: result.authToken,
    user: result.user,
  };
}

/* ------------------------------------------------------------------ */
/* 4. LOGIN — userDB.ts loginWithIdentifier + supabase.ts tryReauthenticate */
/*    Accepts tenantId (resolved client-side) and/or businessName       */
/*    (resolved server-side) so it works even when RLS blocks the     */
/*    client-side tenant lookup.                                       */
/* ------------------------------------------------------------------ */

export interface LoginTenantParams {
  tenantId: string;
  username: string;
  password: string;
  businessName?: string;
}

export interface LoginTenantResult {
  authToken: string;
  user?: any;
}

export async function loginTenant(
  params: LoginTenantParams,
): Promise<LoginTenantResult> {
  // Wake first (same cold-start concern as register).
  await wakeBackend();

  const result = await authPost<{
    authToken?: string;
    user?: any;
    message?: string;
  }>("/api/auth/login", params);

  if (!result?.authToken) {
    throw new Error(result?.message || "Login failed — no session token received.");
  }
  if (!isRealBackendToken(result.authToken)) {
    throw new Error(
      result?.message || "Login failed — the server returned an invalid session token.",
    );
  }

  return { authToken: result.authToken, user: result.user };
}
