// src/api/authApi.ts
//
// Authentication architecture:
// - Africa's Talking SMS + OTP verification: Render API.
// - New institution registration: Render API, which verifies the short-lived
//   OTP JWT before creating the tenant and its administrator.
// - Existing institution login: Supabase verify_login RPC.
//
// IMPORTANT:
// The Render /api/auth/verify-code endpoint returns `tempToken`, not `token`.
// This module normalizes that response to { token } for VerifyCode.tsx.

import { supabase, apiFetchAny } from "../auth/supabase";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export interface VerifyCodeResult {
  token: string;
}

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
  user?: Record<string, unknown>;
}

export interface LoginTenantParams {
  tenantId?: string;
  username: string;
  password: string;
  businessName?: string;
}

export interface LoginTenantResult {
  authToken: string;
  user?: Record<string, unknown>;
}

/* -------------------------------------------------------------------------- */
/* Render backend helpers                                                    */
/* -------------------------------------------------------------------------- */

export async function wakeBackend(): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 90_000);

  try {
    await apiFetchAny("/api/health", {
      method: "GET",
      signal: controller.signal,
    });
  } catch {
    // The actual API request below will provide the useful error.
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function authPost<T = Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  let response: Response;

  try {
    response = await apiFetchAny(path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(
      "Could not reach the server. Check your internet connection and try again. " +
        "If the problem continues, try another network, such as a phone hotspot.",
    );
  }

  const responseText = await response.text().catch(() => "");
  let parsed: any = null;

  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    // The server returned a non-JSON response.
  }

  if (!response.ok) {
    const message =
      parsed?.error ||
      parsed?.message ||
      (responseText ? responseText.slice(0, 200) : "") ||
      `Request failed (${response.status}).`;

    throw new Error(String(message));
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("The server returned an invalid response.");
  }

  return parsed as T;
}

/* -------------------------------------------------------------------------- */
/* 1. Send OTP — PhoneEntry.tsx                                               */
/* -------------------------------------------------------------------------- */

export async function sendATCode(phone: string): Promise<void> {
  await wakeBackend();
  await authPost("/api/auth/send-code", { phone });
}

/* -------------------------------------------------------------------------- */
/* 2. Verify OTP — VerifyCode.tsx                                             */
/* -------------------------------------------------------------------------- */

export async function verifyATCode(
  phone: string,
  code: string,
): Promise<VerifyCodeResult> {
  const result = await authPost<{
    tempToken?: string;
    token?: string;
    message?: string;
    error?: string;
  }>("/api/auth/verify-code", { phone, code });

  // Current Render API responds with `tempToken`.
  // Accept `token` as well for compatibility with a future backend version.
  const token = result.tempToken || result.token;

  if (!token || typeof token !== "string") {
    throw new Error(
      result.message ||
        result.error ||
        "Verification failed — the server did not return a temporary token.",
    );
  }

  return { token };
}

/* -------------------------------------------------------------------------- */
/* 3. Register tenant + first administrator                                   */
/* -------------------------------------------------------------------------- */

/**
 * Registration intentionally uses the Render endpoint.
 *
 * The uploaded Render API implementation verifies:
 *   jwt.verify(tempToken, JWT_SECRET)
 * and checks:
 *   payload.phone === phone
 *   payload.purpose === "otp-verified"
 *
 * The temporary token is short-lived (5 minutes). Do not replace this call
 * with a direct Supabase insert/RPC unless that SQL function independently
 * verifies the signed OTP token on the server.
 */
export async function registerTenant(
  params: RegisterTenantParams,
): Promise<RegisterTenantResult> {
  if (!params.tempToken) {
    throw new Error("Phone verification is required before registration.");
  }

  await wakeBackend();

  const result = await authPost<{
    authToken?: string;
    user?: Record<string, any>;
    error?: string;
    message?: string;
  }>("/api/auth/register-tenant", {
    phone: params.phone,
    tempToken: params.tempToken,
    businessName: params.businessName,
    username: params.username,
    password: params.password,
  });

  if (!result.authToken || !result.user?.id) {
    throw new Error(
      result.error ||
        result.message ||
        "Registration response is missing the authentication token or user details.",
    );
  }

  const tenantId =
    result.user.tenantId ||
    result.user.tenant_id;

  if (!tenantId) {
    throw new Error(
      "Registration completed but the server did not return the tenant ID.",
    );
  }

  return {
    userId: String(result.user.id),
    tenantId: String(tenantId),
    authToken: result.authToken,
    user: result.user,
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Login — existing institutions                                           */
/* -------------------------------------------------------------------------- */

export async function loginTenant(
  params: LoginTenantParams,
): Promise<LoginTenantResult> {
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
