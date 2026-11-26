
// src/screens/PhoneEntry.tsx
//
// Step 1 of institution registration.
// Supabase checks whether the institution phone number already exists.
// Render is used only to send the OTP through Africa's Talking.

import { useState } from "react";
import type { FormEvent } from "react";

import { sendATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";

const C = {
  primary: "#0B57D0",
  text: "#1F1F1F",
  secondary: "#444746",
  outline: "#C4C7C5",
  red: "#B3261E",
  redBg: "#F9DEDC",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// Accept international numbers, with or without a leading plus.
const PHONE_PATTERN = /^\+?\d{10,15}$/;

function normalizePhone(value: string): string {
  return value.replace(/[\s()-]/g, "").trim();
}

export default function PhoneEntry({
  onSent,
  onBack,
}: {
  onSent: (phone: string) => void;
  onBack: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const cleanPhone = normalizePhone(phone);
  const validPhone = PHONE_PATTERN.test(cleanPhone);

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validPhone) {
      setError("Enter a valid international phone number, e.g. +256712345678.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // Check Supabase before sending an OTP.
      // Do not continue if the institution lookup fails.
      const { data: existingTenant, error: lookupError } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (lookupError) {
        throw new Error(
          `Could not check the institution in Supabase: ${lookupError.message}`,
        );
      }

      if (existingTenant) {
        throw new Error(
          `This phone number is already registered${
            existingTenant.business_name
              ? ` for "${existingTenant.business_name}"`
              : ""
          }. Please log in instead.`,
        );
      }

      // Render handles SMS delivery only.
      await sendATCode(cleanPhone);

      // Move to VerifyCode screen only after successful SMS request.
      onSent(cleanPhone);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not send the verification code. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pe-root">
      <style>{`
        .pe-root {
          min-height: 100vh;
          min-height: 100dvh;
          box-sizing: border-box;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow-y: auto;
          padding: 24px;
          background: radial-gradient(
            120% 90% at 50% 0%,
            #fff 0%,
            #f8fafd 55%,
            #eef3fb 100%
          );
          color: ${C.text};
          font-family: ${FONT};
          -webkit-tap-highlight-color: transparent;
        }

        .pe-root * {
          box-sizing: border-box;
        }

        .pe-back {
          position: fixed;
          top: 20px;
          left: 20px;
          width: 44px;
          height: 44px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 50%;
          background: transparent;
          color: ${C.primary};
          font-size: 28px;
          cursor: pointer;
        }

        .pe-back:hover {
          background: rgba(11, 87, 208, .08);
        }

        .pe-panel {
          width: 100%;
          max-width: 460px;
          margin: auto;
        }

        .pe-card {
          display: flex;
          flex-direction: column;
          gap: 18px;
          padding: clamp(24px, 5vw, 36px);
          background: #fff;
          border-radius: 28px;
          box-shadow:
            0 1px 2px rgba(0,0,0,.12),
            0 2px 6px 2px rgba(0,0,0,.08);
        }

        .pe-title {
          margin: 0 0 8px;
          font-size: clamp(22px, 5.6vw, 26px);
          font-weight: 600;
          line-height: 1.25;
        }

        .pe-subtitle {
          margin: 0;
          color: ${C.secondary};
          font-size: 14px;
          line-height: 1.5;
        }

        .pe-form {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .pe-field {
          position: relative;
          display: flex;
          align-items: center;
          height: 56px;
          border: 1px solid ${C.outline};
          border-radius: 12px;
          background: #fff;
        }

        .pe-field:focus-within {
          border-color: ${C.primary};
          box-shadow: inset 0 0 0 1px ${C.primary};
        }

        .pe-input {
          width: 100%;
          height: 100%;
          padding: 0 16px;
          border: 0;
          outline: 0;
          border-radius: inherit;
          background: transparent;
          color: ${C.text};
          font: inherit;
          font-size: 16px;
        }

        .pe-input::placeholder {
          color: #777;
        }

        .pe-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          width: 100%;
          min-height: 50px;
          padding: 12px 20px;
          border: 0;
          border-radius: 999px;
          background: ${C.primary};
          color: #fff;
          font: inherit;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
        }

        .pe-button:hover:not(:disabled) {
          filter: brightness(.95);
        }

        .pe-button:disabled {
          opacity: .45;
          cursor: not-allowed;
        }

        .pe-error {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px;
          border-radius: 12px;
          background: ${C.redBg};
          color: ${C.red};
          font-size: 13.5px;
          line-height: 1.5;
          overflow-wrap: anywhere;
        }

        .pe-spinner {
          width: 18px;
          height: 18px;
          flex-shrink: 0;
          border: 2.5px solid currentColor;
          border-top-color: transparent;
          border-radius: 50%;
          animation: peSpin .8s linear infinite;
        }

        @keyframes peSpin {
          to { transform: rotate(360deg); }
        }

        @media (prefers-reduced-motion: reduce) {
          .pe-spinner {
            animation: none;
          }
        }
      `}</style>

      <button
        type="button"
        className="pe-back"
        onClick={onBack}
        aria-label="Go back"
      >
        ‹
      </button>

      <main className="pe-panel">
        <section className="pe-card">
          <div>
            <h1 className="pe-title">Create Account</h1>
            <p className="pe-subtitle">
              Enter your institution's phone number. We will send you a
              verification code by SMS.
            </p>
          </div>

          {error && (
            <div className="pe-error" role="alert">
              <span aria-hidden="true">⚠</span>
              <span>{error}</span>
            </div>
          )}

          <form
            className="pe-form"
            onSubmit={handleSend}
            aria-busy={loading}
          >
            <div className="pe-field">
              <input
                className="pe-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="+256712345678"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setError("");
                }}
                aria-label="Institution phone number"
                aria-invalid={Boolean(error)}
                required
                autoFocus
              />
            </div>

            <button
              type="submit"
              className="pe-button"
              disabled={loading || !validPhone}
            >
              {loading ? (
                <>
                  <span className="pe-spinner" aria-hidden="true" />
                  Sending code...
                </>
              ) : (
                <>
                  Send verification code
                  <span aria-hidden="true">→</span>
                </>
              )}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
