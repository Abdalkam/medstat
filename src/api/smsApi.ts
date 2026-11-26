
import {
  tryReauthenticate,
  apiFetchAny,
  isRenderJwtToken,
} from "../auth/supabase";

const API_BASE = import.meta.env.VITE_API_URL
  ? String(import.meta.env.VITE_API_URL).replace(/\/+$/, "")
  : import.meta.env.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:10000";

const SMS_TIMEOUT = 90000;

// ==========================================
// BACKEND WAKE-UP
// ==========================================

export async function warmUpBackend(): Promise<void> {
  const controller = new AbortController();

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    SMS_TIMEOUT
  );

  try {
    const response = await apiFetchAny(
      "/api/health",
      {
        method: "GET",
        signal: controller.signal,
      },
      API_BASE
    );

    if (!response.ok) {
      console.warn(
        `Backend health check returned ${response.status}.`
      );
    }
  } catch (error) {
    console.warn("Backend warm-up failed:", error);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

// ==========================================
// RESPONSE HELPERS
// ==========================================

async function readResponse(response: Response): Promise<any> {
  const responseText = await response.text();

  if (!responseText) return {};

  try {
    return JSON.parse(responseText);
  } catch {
    return {
      error: responseText,
      message: responseText,
    };
  }
}

function getErrorMessage(
  result: any,
  status: number
): string {
  return (
    result?.error ||
    result?.message ||
    result?.details ||
    `SMS request failed (${status}).`
  );
}

// ==========================================
// SMS SENDING
// ==========================================

export interface SendSmsPayload {
  phone: string | string[];
  message: string;
  [key: string]: any;
}

export interface SendSmsResult {
  success?: boolean;
  message?: string;
  error?: string;
  logs?: any[];
  [key: string]: any;
}

/**
 * Send SMS through the authenticated Render backend.
 *
 * Offline/session marker tokens are not accepted.
 * A genuine Render JWT is required.
 *
 * If the JWT has expired, the app attempts one silent
 * re-authentication and retries the SMS request once.
 */
export async function sendSms(
  payload: SendSmsPayload
): Promise<SendSmsResult> {
  if (!payload || !payload.phone || !payload.message?.trim()) {
    throw new Error("Phone number and message are required.");
  }

  if (
    Array.isArray(payload.phone) &&
    payload.phone.length === 0
  ) {
    throw new Error("At least one recipient is required.");
  }

  if (
    Array.isArray(payload.phone) &&
    payload.phone.some(
      (phone) => typeof phone !== "string" || !phone.trim()
    )
  ) {
    throw new Error("One or more recipient phone numbers are invalid.");
  }

  if (
    typeof payload.phone === "string" &&
    !payload.phone.trim()
  ) {
    throw new Error("A valid recipient phone number is required.");
  }

  if (typeof navigator !== "undefined" && !navigator.onLine) {
    throw new Error(
      "You must be online and logged in to send SMS."
    );
  }

  let token = localStorage.getItem("authToken");

  if (!isRenderJwtToken(token)) {
    token = await tryReauthenticate();
  }

  if (!isRenderJwtToken(token)) {
    throw new Error(
      "You must be online and logged in to send SMS."
    );
  }

  const requestBody = {
    ...payload,
    phone: Array.isArray(payload.phone)
      ? payload.phone.map((phone) => phone.trim())
      : payload.phone.trim(),
    message: payload.message.trim(),
  };

  const makeRequest = async (
    authToken: string
  ): Promise<Response> => {
    const controller = new AbortController();

    const timeoutId = window.setTimeout(
      () => controller.abort(),
      SMS_TIMEOUT
    );

    try {
      return await apiFetchAny(
        "/api/sms/send",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        },
        API_BASE
      );
    } finally {
      window.clearTimeout(timeoutId);
    }
  };

  let response: Response;

  try {
    response = await makeRequest(token);
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new Error(
        "SMS request timed out. The server may still be processing the message. Check SMS history before retrying."
      );
    }

    if (error instanceof TypeError) {
      throw new Error(
        "Unable to connect to the SMS server. Check your internet connection and try again."
      );
    }

    throw error;
  }

  // Retry exactly once if the JWT has expired.
  if (response.status === 401) {
    const refreshedToken = await tryReauthenticate(true);

    if (
      !refreshedToken ||
      !isRenderJwtToken(refreshedToken)
    ) {
      const expiredResult = await readResponse(response);

      throw new Error(
        expiredResult?.error ||
          expiredResult?.message ||
          "Your session has expired. Please sign in again."
      );
    }

    try {
      response = await makeRequest(refreshedToken);
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error(
          "SMS retry timed out. Check SMS history before sending again."
        );
      }

      if (error instanceof TypeError) {
        throw new Error(
          "Unable to reconnect to the SMS server."
        );
      }

      throw error;
    }
  }

  const result = await readResponse(response);

  if (!response.ok) {
    throw new Error(getErrorMessage(result, response.status));
  }

  if (result?.success === false) {
    throw new Error(
      result?.error ||
        result?.message ||
        "The SMS provider could not send the message."
    );
  }

  return result;
}

// ==========================================
// BACKEND CONNECTIVITY
// ==========================================

export async function checkSmsBackend(): Promise<boolean> {
  try {
    const response = await apiFetchAny(
      "/api/health",
      {
        method: "GET",
      },
      API_BASE
    );

    return response.ok;
  } catch {
    return false;
  }
}
