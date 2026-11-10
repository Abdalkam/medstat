// src/api/smsApi.ts
// SMS sending through the Render backend.
//
// 2026-11 update:
//   - Offline/fabricated sessions ("offline-mode-pending-sync", "local-...")
//     are silently upgraded via tryReauthenticate() BEFORE failing, so a
//     device that logged in while the backend was asleep heals itself.
//   - A 401 response (expired JWT, 7-day lifetime) triggers exactly one
//     silent re-login + retry.
//   - SMS_TIMEOUT raised 45 s -> 90 s: Render's free tier sleeps after
//     15 min idle and a cold-start request can take 30-60 s.
//   - warmUpBackend() pings /api/health so the server wakes before use.

import { tryReauthenticate, apiFetchAny } from "../auth/supabase";

interface SmsResponse {
  success?: boolean;
  message?: string;
  error?: string;
  logs?: any[];
  [key: string]: any;
}

interface SmsError extends Error {
  logs?: any[];
  status?: number;
}

const API_BASE =
  import.meta.env.VITE_API_URL ||
  (import.meta.env.PROD
    ? "https://medstat-3rxl.onrender.com"
    : "http://localhost:10000");

const SMS_TIMEOUT = 90000;

/**
 * Fire-and-forget ping so a sleeping Render instance wakes up before the
 * user actually needs it (login, SMS, settings). Call once on app mount.
 * Walks the API origin list, so even networks that cannot resolve the
 * Render hostname wake the backend through the fallback origins.
 */
export function warmUpBackend(): void {
  apiFetchAny("/api/health", undefined, API_BASE).catch(() => {
    /* unreachable backend — silent; real requests will surface errors */
  });
}

export async function sendSms(
  recipients: string[],
  message: string
): Promise<SmsResponse> {
  // ----------------------------------------------------------
  // AUTHENTICATION (with silent self-heal)
  // ----------------------------------------------------------

  let token = localStorage.getItem("authToken");

  // Offline / fabricated session — attempt a silent re-login first.
  // ("eyJ" = a real backend JWT; anything else — null,
  // "offline-mode-pending-sync", "local-..." — is a local placeholder.)
  // Written as an inline check so TypeScript narrows `token` to string
  // without depending on the type guard's signature.
  if (!token || !token.startsWith("eyJ")) {
    token =
      (await tryReauthenticate()) || localStorage.getItem("authToken");
  }

  if (!token || !token.startsWith("eyJ")) {
    const authError: SmsError = new Error(
      "You must be online and logged in to send SMS."
    );
    authError.status = 0;
    throw authError;
  }

  // From here on, `token` is a real backend JWT (type: string).

  // ----------------------------------------------------------
  // VALIDATION
  // ----------------------------------------------------------

  const cleanRecipients = [
    ...new Set(
      recipients
        .map((phone) => phone.replace(/\s+/g, "").trim())
        .filter(Boolean)
    ),
  ];

  const cleanMessage = message.trim();

  if (cleanRecipients.length === 0) {
    throw new Error("Please provide at least one recipient.");
  }

  if (!cleanMessage) {
    throw new Error("SMS message cannot be empty.");
  }

  if (!navigator.onLine) {
    throw new Error(
      "You are offline. Please reconnect before sending SMS."
    );
  }

  // ----------------------------------------------------------
  // REQUEST CONFIGURATION
  // ----------------------------------------------------------

  const controller = new AbortController();

  const timeoutId = window.setTimeout(
    () => controller.abort(),
    SMS_TIMEOUT
  );

  const doRequest = (bearer: string) =>
    apiFetchAny(
      "/api/sms/send",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${bearer}`,
        },
        body: JSON.stringify({
          recipients: cleanRecipients,
          message: cleanMessage,
        }),
        signal: controller.signal,
      },
      API_BASE
    );

  try {
    let response = await doRequest(token);

    // --------------------------------------------------------
    // EXPIRED/INVALID JWT — one silent re-login + retry
    // --------------------------------------------------------

    if (response.status === 401) {
      const newToken = await tryReauthenticate();

      if (newToken && newToken !== token) {
        token = newToken;
        response = await doRequest(token);
      }
    }

    // --------------------------------------------------------
    // RESPONSE PARSING
    // --------------------------------------------------------

    const responseText = await response.text();

    let data: SmsResponse = {};

    if (responseText) {
      try {
        data = JSON.parse(responseText);
      } catch {
        data = {
          error: responseText,
        };
      }
    }

    // --------------------------------------------------------
    // HTTP ERROR HANDLING
    // --------------------------------------------------------

    if (!response.ok) {
      const error: SmsError = new Error(
        data.error ||
          `SMS request failed with status ${response.status}.`
      );

      error.status = response.status;

      // Preserve partial delivery logs for local persistence.
      if (Array.isArray(data.logs)) {
        error.logs = data.logs;
      }

      throw error;
    }

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return data;
  } catch (err: any) {
    // Preserve backend errors and partial delivery logs.
    if (err?.status || Array.isArray(err?.logs)) {
      throw err;
    }

    // Timeout handling.
    if (err?.name === "AbortError") {
      throw new Error(
        "SMS request timed out. Check your SMS delivery history before retrying."
      );
    }

    // Network and connection errors.
    if (err instanceof TypeError) {
      throw new Error(
        "Unable to connect to the SMS server. Check your internet connection and try again."
      );
    }

    throw err;
  } finally {
    window.clearTimeout(timeoutId);
  }
}
