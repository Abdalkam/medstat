
// src/api/authApi.ts
//
// Authentication architecture:
// - Render: Africa's Talking SMS delivery and OTP verification ONLY.
// - Supabase: institution lookup, registration and existing-institution login.
// - Supabase register_tenant RPC independently verifies the signed OTP token.
// - No database credentials or OTP signing secrets are exposed to the frontend.

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

interface ApiErrorResponse {
  error?: string;
  message?: string;
}

interface OtpResponse extends ApiErrorResponse {
  tempToken?: string;
  token?: string;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getErrorMessage(
  error: unknown,
  fallback: string,
): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Render API — OTP operations only                                          */
/* -------------------------------------------------------------------------- */

export async function wakeBackend(): Promise<void> {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    90_000,
  );

  try {
    await apiFetchAny("/api/health", {
      method: "GET",
      signal: controller.signal,
    });
  } catch {
    // The actual OTP request will provide the user-facing error.
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function authPost<T>(
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
  } catch (error) {
    throw new Error(
      `Could not reach the authentication server. ${getErrorMessage(
        error,
        "Check your internet connection and try again.",
      )}`,
    );
  }

  const responseText = await response.text().catch(() => "");

  let parsed: unknown = null;

  try {
    parsed = responseText ? JSON.parse(responseText) : null;
  } catch {
    // The server did not return JSON.
  }

  if (!response.ok) {
    const errorData = parsed as ApiErrorResponse | null;

    throw new Error(
      errorData?.error ||
        errorData?.message ||
        responseText.slice(0, 250) ||
        `Authentication request failed (${response.status}).`,
    );
  }

  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "The authentication server returned an invalid response.",
    );
  }

  return parsed as T;
}

/* -------------------------------------------------------------------------- */
/* 1. Send OTP                                                                */
/* -------------------------------------------------------------------------- */

export async function sendATCode(phone: string): Promise<void> {
  const normalizedPhone = phone.trim();

  if (!normalizedPhone) {
    throw new Error("A valid phone number is required.");
  }

  await wakeBackend();

  await authPost<Record<string, unknown>>(
    "/api/auth/send-code",
    { phone: normalizedPhone },
  );
}

/* -------------------------------------------------------------------------- */
/* 2. Verify OTP                                                              */
/* -------------------------------------------------------------------------- */

export async function verifyATCode(
  phone: string,
  code: string,
): Promise<VerifyCodeResult> {
  if (!phone.trim()) {
    throw new Error("Phone number is required.");
  }

  if (!/^\d{6}$/.test(code)) {
    throw new Error(
      "Enter the complete six-digit verification code.",
    );
  }

  const result = await authPost<OtpResponse>(
    "/api/auth/verify-code",
    {
      phone: phone.trim(),
      code,
    },
  );

  // Render currently returns tempToken. Accept token for compatibility.
  const token = result.tempToken || result.token;

  if (typeof token !== "string" || !token.trim()) {
    throw new Error(
      result.message ||
        result.error ||
        "OTP verification did not return a temporary verification token.",
    );
  }

  return { token };
}

/* -------------------------------------------------------------------------- */
/* 3. Register institution and first administrator — Supabase RPC            */
/* -------------------------------------------------------------------------- */

export async function registerTenant(
  params: RegisterTenantParams,
): Promise<RegisterTenantResult> {
  const phone = params.phone.trim();
  const tempToken = params.tempToken.trim();
  const businessName = params.businessName.trim();
  const username = params.username.trim();

  if (!tempToken) {
    throw new Error(
      "Verify the institution phone number before registering.",
    );
  }

  if (!phone || !businessName || !username || !params.password) {
    throw new Error("Complete all institution registration fields.");
  }

  const { data, error } = await supabase.rpc("register_tenant", {
    p_phone: phone,
    p_temp_token: tempToken,
    p_business_name: businessName,
    p_username: username,
    p_password: params.password,
  });

  if (error) {
    throw new Error(
      error.message || "Institution registration failed.",
    );
  }

  if (!data || data.success !== true) {
    throw new Error(
      data?.error || "Institution registration failed. Please try again.",
    );
  }

  const user = data.user as Record<string, unknown> | undefined;

  if (!user || !user.id) {
    throw new Error(
      "Registration response did not contain the administrator's user ID.",
    );
  }

  const tenantId = user.tenantId || user.tenant_id;

  if (typeof tenantId !== "string" || !tenantId.trim()) {
    throw new Error(
      "Registration response did not contain the institution ID.",
    );
  }

  // Never manufacture a session token. The RPC must return a real token
  // if the application requires one.
  const authToken = data.authToken || data.access_token;

  if (typeof authToken !== "string" || !authToken.trim()) {
    throw new Error(
      "The institution was registered, but the RPC did not return an authentication token. Check the register_tenant SQL response.",
    );
  }

  return {
    userId: String(user.id),
    tenantId,
    authToken,
    user,
  };
}

/* -------------------------------------------------------------------------- */
/* 4. Existing institution login — Supabase RPC                              */
/* -------------------------------------------------------------------------- */

export async function loginTenant(
  params: LoginTenantParams,
): Promise<LoginTenantResult> {
  const username = params.username.trim();

  if (!username || !params.password) {
    throw new Error("Enter your username and password.");
  }

  const { data, error } = await supabase.rpc("verify_login", {
    p_tenant_id: params.tenantId || null,
    p_business_name: params.businessName?.trim() || null,
    p_username: username,
    p_password: params.password,
  });

  if (error) {
    throw new Error(
      error.message || "Institution login failed.",
    );
  }

  if (!data || data.success !== true) {
    throw new Error(
      data?.error || "Invalid username or password.",
    );
  }

  if (!data.user?.id) {
    throw new Error(
      "Login response did not contain the user ID.",
    );
  }

  const authToken = data.authToken || data.access_token;

  if (typeof authToken !== "string" || !authToken.trim()) {
    throw new Error(
      "Login succeeded, but no authentication token was returned. Check the verify_login SQL response.",
    );
  }

  return {
    authToken,
    user: data.user as Record<string, unknown>,
  };
}
