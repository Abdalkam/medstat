
import {
  tryReauthenticate,
  apiFetchAny,
  isRenderJwtToken,
} from "../auth/supabase";

// ==========================================
// API CONFIGURATION
// ==========================================

const API_BASE = (
  (import.meta.env.VITE_API_URL as string) ||
  (import.meta.env.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:10000")
)
  .trim()
  .replace(/\/+$/, "");

const SMS_TIMEOUT = 90000;

// ==========================================
// TYPES
// ==========================================

export interface SendSmsPayload {
  recipients: string[];
  message: string;
}

export interface SendSmsResult {
  success?: boolean;
  message?: string;
  error?: string;
  logs?: any[];
  [key: string]: any;
}

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
// AUTHENTICATION
// ==========================================

async function getSmsAuthToken(): Promise<string> {
  let token = localStorage.getItem("authToken");

  if (!isRenderJwtToken(token)) {
    token = await tryReauthenticate();
  }

  if (!isRenderJwtToken(token)) {
    throw new Error(
      "You must be online and logged in to send SMS."
    );
  }

  return token;
}

// ==========================================
// SMS SENDING
// ==========================================

/**
 * Send SMS through the authenticated Render backend.
 *
 * Requires a genuine Render JWT.
 * If the server rejects an expired JWT with 401,
 * the app attempts one silent re-authentication
 * and retries the request once.
 */
export async function sendSms(
  payload: SendSmsPayload
): Promise<SendSmsResult> {
  if (
    !payload ||
    !Array.isArray(payload.recipients) ||
    typeof payload.message !== "string" ||
    !payload.message.trim()
  ) {
    throw new Error(
      "Recipient phone numbers and message are required."
    );
  }

  if (payload.recipients.length === 0) {
    throw new Error("At least one recipient is required.");
  }

  const recipients = payload.recipients.map((phone) => {
    if (typeof phone !== "string" || !phone.trim()) {
      throw new Error(
        "One or more recipient phone numbers are invalid."
      );
    }

    return phone.trim();
  });

  if (
    typeof navigator !== "undefined" &&
    !navigator.onLine
  ) {
    throw new Error(
      "You must be online and logged in to send SMS."
    );
  }

  const token = await getSmsAuthToken();

  const requestBody = {
    recipients,
    message: payload.message.trim(),
  };

  // ------------------------------------------
  // AUTHENTICATED REQUEST
  // ------------------------------------------

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

  // ------------------------------------------
  // RETRY ONCE AFTER 401
  // ------------------------------------------

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

  // ------------------------------------------
  // PROCESS RESPONSE
  // ------------------------------------------

  const result = await readResponse(response);

  if (!response.ok) {
    throw new Error(
      getErrorMessage(result, response.status)
    );
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
