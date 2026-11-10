
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

const SMS_TIMEOUT = 45000;

export async function sendSms(
  recipients: string[],
  message: string
): Promise<SmsResponse> {
  // ----------------------------------------------------------
  // AUTHENTICATION
  // ----------------------------------------------------------

  const token = localStorage.getItem("authToken");

  if (!token || token === "offline-mode-pending-sync") {
    throw new Error(
      "You must be online and logged in to send SMS."
    );
  }

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

  try {
    const response = await fetch(
      `${API_BASE.replace(/\/+$/, "")}/api/sms/send`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipients: cleanRecipients,
          message: cleanMessage,
        }),
        signal: controller.signal,
      }
    );

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
