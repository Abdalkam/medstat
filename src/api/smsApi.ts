import { supabase } from "../auth/supabase";

export type SmsPreflightFail = "offline" | "not-logged-in";

export class SmsNotReadyError extends Error {
  readonly reason: SmsPreflightFail;
  constructor(reason: SmsPreflightFail) {
    super(
      reason === "offline"
        ? "No internet connection. Check your network and try again."
        : "You must be logged in to send SMS."
    );
    this.name = "SmsNotReadyError";
    this.reason = reason;
  }
}

async function isReallyOnline(): Promise<boolean> {
  if (navigator.onLine) return true;
  try {
    await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/`, {
      method: "HEAD",
      cache: "no-store",
    });
    return true;
  } catch {
    return false;
  }
}

export async function canSendSms(): Promise<
  { ok: true; userId: string } | { ok: false; reason: SmsPreflightFail }
> {
  if (!(await isReallyOnline())) {
    console.warn("[smsApi] blocked: offline");
    return { ok: false, reason: "offline" };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) console.error("[smsApi] getSession failed:", error);

  const userId = data.session?.user?.id;
  if (!userId) {
    console.warn("[smsApi] blocked: no active session", { error });
    return { ok: false, reason: "not-logged-in" };
  }

  return { ok: true, userId };
}

export async function sendSms(to: string, message: string): Promise<void> {
  const preflight = await canSendSms();
  if (!preflight.ok) {
    throw new SmsNotReadyError(preflight.reason);
  }

  await deliverSms(preflight.userId, to, message);
}

async function deliverSms(senderAuthUserId: string, to: string, message: string): Promise<void> {
  const { error } = await supabase.functions.invoke("send-sms", {
    body: { to, message },
  });
  if (error) throw new Error(`SMS failed: ${error.message}`);
  void senderAuthUserId;
}