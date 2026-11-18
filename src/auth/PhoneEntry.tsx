// src/screens/PhoneEntry.tsx — v2: Material Design 3 restyle (UI ONLY — flow unchanged)
//
// Step 1 of account creation: verify the institution phone number.
// LOGIC IS IDENTICAL TO v1 — same validation regex, same tenants-table
// duplicate check with the same message strings, same sendATCode() call,
// same onSent / onBack contract. Only the markup and styles changed:
// MD3 card, floating-label field, MD3 error banner, corner back button.
// The duplicated app-logo images and animated logo watermark were removed
// (no app-owned branding, per the design direction).

import { useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { sendATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";

/* -------------------------------------------------------------------------- */
/* MD3 design tokens — same palette as src/auth/startup.tsx                    */
/* -------------------------------------------------------------------------- */

const C = {
  primary: "#0B57D0",
  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",
  outlineVariant: "#C4C7C5",
  surfaceVariant: "#E9EEF6",
  red: "#B3261E",
  redBg: "#F9DEDC",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* -------------------------------------------------------------------------- */
/* Injected stylesheet — pe- namespace, MD3 surfaces, floating labels          */
/* -------------------------------------------------------------------------- */

const PE_CSS = `
.pe-root {
  min-height: 100vh; min-height: 100dvh;
  box-sizing: border-box;
  display: flex; overflow-y: auto;
  align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, #F8FAFD 55%, #EEF3FB 100%);
  font-family: ${FONT};
  color: ${C.onSurface};
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-tap-highlight-color: transparent;
  position: relative;
}
.pe-root * { box-sizing: border-box; }
.pe-back {
  position: absolute;
  top: calc(16px + env(safe-area-inset-top));
  left: calc(16px + env(safe-area-inset-left));
  width: 44px; height: 44px;
  border: none; border-radius: 50%;
  background: transparent; color: ${C.primary};
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background .2s cubic-bezier(.2, 0, 0, 1);
  z-index: 10;
}
.pe-back:hover { background: rgba(11, 87, 208, .08); }
.pe-panel {
  width: 100%; max-width: 460px; margin: auto;
  display: flex; flex-direction: column;
  padding: clamp(14px, 3vh, 32px) clamp(16px, 4vw, 28px);
}
.pe-card {
  width: 100%;
  background: #FFFFFF;
  border-radius: 28px;
  box-shadow: 0 1px 2px 0 rgba(0,0,0,.12), 0 2px 6px 2px rgba(0,0,0,.08);
  padding: clamp(22px, 5vw, 36px);
  display: flex; flex-direction: column; gap: 14px;
}
.pe-card-title {
  font-size: clamp(21px, 5.6vw, 26px);
  font-weight: 600; margin: 2px 0 0;
  letter-spacing: .1px; line-height: 1.25;
}
.pe-card-sub { font-size: 14px; color: ${C.onSurfaceVariant}; margin: 0 0 4px; line-height: 1.5; }
.pe-form { display: flex; flex-direction: column; gap: 12px; }
.pe-field {
  position: relative; display: flex; align-items: center;
  height: 56px; border-radius: 12px;
  background: #FFFFFF;
  border: 1px solid ${C.outlineVariant};
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
}
.pe-field:focus-within { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; }
.pe-lead { position: absolute; left: 14px; display: flex; color: ${C.onSurfaceVariant}; transition: all .2s cubic-bezier(.2, 0, 0, 1); }
.pe-field:focus-within .pe-lead { color: ${C.primary}; }
.pe-input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  padding: 0 46px;
  font-family: inherit; font-size: 16px; color: ${C.onSurface};
}
.pe-input:disabled { opacity: .55; }
.pe-float {
  position: absolute; left: 46px; top: 50%;
  transform: translateY(-50%);
  color: ${C.onSurfaceVariant};
  font-size: 15px;
  pointer-events: none;
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
  white-space: nowrap;
}
.pe-float.pe-floated {
  top: 0; transform: translateY(-50%) scale(.76);
  transform-origin: left center;
  background: #FFFFFF;
  padding: 0 5px; margin-left: -5px;
  color: ${C.onSurfaceVariant};
}
.pe-field:focus-within .pe-float.pe-floated { color: ${C.primary}; }
.pe-btn {
  position: relative;
  height: 48px; width: 100%;
  border: none; border-radius: 999px;
  font-family: inherit; font-size: 15px; font-weight: 600; letter-spacing: .2px;
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  cursor: pointer;
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
}
.pe-btn:active:not(:disabled) { transform: scale(.985); }
.pe-btn:disabled { opacity: .42; cursor: default; }
.pe-btn-filled { background: ${C.primary}; color: #FFFFFF; box-shadow: 0 1px 2px 0 rgba(0,0,0,.10), 0 1px 3px 1px rgba(0,0,0,.07); }
.pe-btn-filled:hover:not(:disabled) { box-shadow: 0 1px 2px 0 rgba(0,0,0,.12), 0 2px 6px 2px rgba(0,0,0,.08); }
.pe-banner {
  display: flex; align-items: flex-start; gap: 10px;
  border-radius: 12px; padding: 11px 13px;
  font-size: 13.5px; line-height: 1.5;
}
.pe-banner svg { flex-shrink: 0; margin-top: 1px; }
.pe-spinner {
  width: 18px; height: 18px; flex-shrink: 0;
  border-radius: 50%;
  border: 2.5px solid currentColor; border-top-color: transparent;
  animation: peSpin .8s linear infinite;
}
@keyframes peSpin { to { transform: rotate(360deg); } }
.pe-focusable:focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; }
@media (max-width: 374px) {
  .pe-field { height: 52px; }
  .pe-float { left: 42px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .pe-panel { padding-top: 10px; padding-bottom: 10px; }
  .pe-card { padding: 16px 22px; gap: 9px; border-radius: 20px; }
  .pe-field { height: 48px; }
  .pe-btn { height: 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .pe-root *, .pe-root *::before, .pe-root *::after { transition: none !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
}
`;

/* -------------------------------------------------------------------------- */
/* Inline SVG icons (stroke style, currentColor)                               */
/* -------------------------------------------------------------------------- */

const iconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconChevronLeft({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function IconPhone({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  );
}

function IconAlert({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="7.5" x2="12" y2="13" />
      <line x1="12" y1="16.2" x2="12" y2="16.3" />
    </svg>
  );
}

function IconArrowRight({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* MD3 outlined field with floating label (same pattern as src/auth/Login.tsx) */
/* -------------------------------------------------------------------------- */

function PeField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon: ReactNode;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  const floated = focused || props.value.length > 0;
  return (
    <div className="pe-field">
      <span className="pe-lead">{props.icon}</span>
      <input
        className="pe-input"
        type={props.type ?? "text"}
        value={props.value}
        placeholder=" "
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <label className={`pe-float${floated ? " pe-floated" : ""}`}>{props.label}</label>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen — LOGIC IDENTICAL TO v1; only the markup/styles around it changed    */
/* -------------------------------------------------------------------------- */

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

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    const cleanPhone = phone.replace(/\s/g, "").trim();

    if (cleanPhone.length < 10 || !cleanPhone.match(/^\+?\d{10,15}$/)) {
      setError("Please enter a valid phone number (e.g., +256712345678)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: existingTenant, error: checkError } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (checkError) {
        console.warn("Tenant check failed:", checkError);
      } else if (existingTenant) {
        setError(
          `This phone is already registered${existingTenant.business_name ? ` for "${existingTenant.business_name}"` : ""}. Please login instead.`,
        );
        setLoading(false);
        return;
      }

      await sendATCode(cleanPhone);
      onSent(cleanPhone);
    } catch (err: any) {
      setError(err.message || "Failed to send verification code. Check your network.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="pe-root">
      <style>{PE_CSS}</style>

      <button
        type="button"
        className="pe-back pe-focusable"
        onClick={onBack}
        aria-label="Back"
      >
        <IconChevronLeft />
      </button>

      <main className="pe-panel">
        <div className="pe-card">
          <div>
            <h1 className="pe-card-title">Create Account</h1>
            <p className="pe-card-sub">
              Enter your phone number to get started — we'll text you a
              verification code.
            </p>
          </div>

          {error && (
            <div
              className="pe-banner"
              style={{ background: C.redBg, color: C.red }}
              role="alert"
            >
              <IconAlert size={18} />
              <span>{error}</span>
            </div>
          )}

          <form className="pe-form" onSubmit={handleSend}>
            <PeField
              label="Phone number"
              value={phone}
              onChange={(v) => {
                setPhone(v);
                setError("");
              }}
              type="tel"
              autoComplete="tel"
              autoFocus
              icon={<IconPhone />}
            />

            <button
              type="submit"
              className="pe-btn pe-btn-filled pe-focusable"
              disabled={loading || phone.trim().length < 10}
            >
              {loading ? (
                <>
                  <span className="pe-spinner" aria-hidden="true" />
                  Sending...
                </>
              ) : (
                <>
                  Send Code
                  <IconArrowRight />
                </>
              )}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
