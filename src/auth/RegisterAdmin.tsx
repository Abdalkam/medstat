// src/screens/RegisterAdmin.tsx — v2: Material Design 3 restyle (UI ONLY — flow unchanged)
//
// Step 3 of account creation ("Set Up Institution"): creates the tenant and
// the admin account via registerTenant(), caches the user in Dexie via
// addUser(), writes the localStorage session keys and fires the
// "authStateChanged" event. LOGIC IS IDENTICAL TO v1 — same duplicate-phone
// gate, same validation, same messages, same onComplete/onBack contract.
//
// UI-only changes: MD3 card + floating-label fields (same design language as
// src/auth/startup.tsx / src/auth/Login.tsx), MD3 error banner, corner back
// button, MD3 checking spinner. The institution's own cloud branding
// (business_settings.login_background) is still honored with its scrim; the
// duplicated app-owned logo images were removed. A password show/hide toggle
// was added (view-only state; it touches no registration logic).

import { useState, useEffect } from "react";
import type { FormEvent, ReactNode } from "react";
import { registerTenant } from "../api/authApi";
import { addUser } from "../database/userDB";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

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
/* Injected stylesheet — ra- namespace, MD3 surfaces, floating labels          */
/* -------------------------------------------------------------------------- */

const RA_CSS = `
.ra-root {
  min-height: 100vh; min-height: 100dvh;
  box-sizing: border-box;
  display: flex; overflow-y: auto;
  align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, #F8FAFD 55%, #EEF3FB 100%);
  font-family: ${FONT};
  color: ${C.onSurface};
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           calc(48px + env(safe-area-inset-bottom)) env(safe-area-inset-left);
  -webkit-tap-highlight-color: transparent;
  position: relative;
}
.ra-root * { box-sizing: border-box; }
.ra-root-bg { background-color: #F8FAFD; background-size: cover; background-position: center; }
.ra-scrim { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, .4); }
.ra-back {
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
.ra-back:hover { background: rgba(11, 87, 208, .08); }
.ra-back-onbg {
  color: #FFFFFF;
  background: rgba(255, 255, 255, .18);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.ra-back-onbg:hover { background: rgba(255, 255, 255, .3); }
.ra-panel {
  position: relative; z-index: 1;
  width: 100%; max-width: 460px; margin: auto;
  display: flex; flex-direction: column;
  padding: clamp(14px, 3vh, 32px) clamp(16px, 4vw, 28px);
}
.ra-card {
  width: 100%;
  background: #FFFFFF;
  border-radius: 28px;
  box-shadow: 0 1px 2px 0 rgba(0,0,0,.12), 0 2px 6px 2px rgba(0,0,0,.08);
  padding: clamp(22px, 5vw, 36px);
  display: flex; flex-direction: column; gap: 14px;
}
.ra-card-title {
  font-size: clamp(21px, 5.6vw, 26px);
  font-weight: 600; margin: 2px 0 0;
  letter-spacing: .1px; line-height: 1.25;
  text-align: center;
}
.ra-card-sub { font-size: 14px; color: ${C.onSurfaceVariant}; margin: 0 0 4px; line-height: 1.5; text-align: center; }
.ra-form { display: flex; flex-direction: column; gap: 12px; }
.ra-field {
  position: relative; display: flex; align-items: center;
  height: 56px; border-radius: 12px;
  background: #FFFFFF;
  border: 1px solid ${C.outlineVariant};
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
}
.ra-field:focus-within { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; }
.ra-lead { position: absolute; left: 14px; display: flex; color: ${C.onSurfaceVariant}; transition: all .2s cubic-bezier(.2, 0, 0, 1); }
.ra-field:focus-within .ra-lead { color: ${C.primary}; }
.ra-input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  padding: 0 46px;
  font-family: inherit; font-size: 16px; color: ${C.onSurface};
}
.ra-input:disabled { opacity: .55; }
.ra-float {
  position: absolute; left: 46px; top: 50%;
  transform: translateY(-50%);
  color: ${C.onSurfaceVariant};
  font-size: 15px;
  pointer-events: none;
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
  white-space: nowrap;
}
.ra-float.ra-floated {
  top: 0; transform: translateY(-50%) scale(.76);
  transform-origin: left center;
  background: #FFFFFF;
  padding: 0 5px; margin-left: -5px;
  color: ${C.onSurfaceVariant};
}
.ra-field:focus-within .ra-float.ra-floated { color: ${C.primary}; }
.ra-trailing {
  position: absolute; right: 6px;
  width: 42px; height: 42px;
  border: none; background: transparent; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: ${C.onSurfaceVariant}; cursor: pointer;
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
}
.ra-trailing:hover { background: ${C.surfaceVariant}; color: ${C.onSurface}; }
.ra-btn {
  position: relative;
  height: 48px; width: 100%;
  border: none; border-radius: 999px;
  font-family: inherit; font-size: 15px; font-weight: 600; letter-spacing: .2px;
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  cursor: pointer;
  transition: all .2s cubic-bezier(.2, 0, 0, 1);
}
.ra-btn:active:not(:disabled) { transform: scale(.985); }
.ra-btn:disabled { opacity: .42; cursor: default; }
.ra-btn-filled { background: ${C.primary}; color: #FFFFFF; box-shadow: 0 1px 2px 0 rgba(0,0,0,.10), 0 1px 3px 1px rgba(0,0,0,.07); }
.ra-btn-filled:hover:not(:disabled) { box-shadow: 0 1px 2px 0 rgba(0,0,0,.12), 0 2px 6px 2px rgba(0,0,0,.08); }
.ra-banner {
  display: flex; align-items: flex-start; gap: 10px;
  border-radius: 12px; padding: 11px 13px;
  font-size: 13.5px; line-height: 1.5;
}
.ra-banner svg { flex-shrink: 0; margin-top: 1px; }
.ra-spinner {
  width: 18px; height: 18px; flex-shrink: 0;
  border-radius: 50%;
  border: 2.5px solid currentColor; border-top-color: transparent;
  animation: raSpin .8s linear infinite;
}
.ra-bigspinner {
  width: 40px; height: 40px;
  border-radius: 50%;
  border: 3px solid #E9EEF6;
  border-top-color: ${C.primary};
  animation: raSpin .8s linear infinite;
  display: inline-block;
}
@keyframes raSpin { to { transform: rotate(360deg); } }
.ra-version {
  position: absolute;
  bottom: calc(18px + env(safe-area-inset-bottom));
  left: 0; right: 0;
  text-align: center;
  font-size: 12px;
  color: ${C.onSurfaceVariant};
  z-index: 10;
  pointer-events: none;
}
.ra-version-onbg { color: rgba(255, 255, 255, .85); }
.ra-focusable:focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; }
@media (max-width: 374px) {
  .ra-field { height: 52px; }
  .ra-float { left: 42px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .ra-panel { padding-top: 10px; padding-bottom: 10px; }
  .ra-card { padding: 16px 22px; gap: 9px; border-radius: 20px; }
  .ra-field { height: 48px; }
  .ra-btn { height: 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .ra-root *, .ra-root *::before, .ra-root *::after { transition: none !important; animation-duration: .01ms !important; animation-iteration-count: 1 !important; }
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

function IconBuilding({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2" />
      <path d="M10.5 20.5v-3h3v3" />
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

function IconPerson({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" />
    </svg>
  );
}

function IconLock({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

function IconEye({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconEyeOff({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M10.6 5.6A10 10 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.8 3.8" />
      <path d="M6.5 6.7A16.7 16.7 0 0 0 2.5 12S6 18.5 12 18.5a9.9 9.9 0 0 0 3.9-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <line x1="3" y1="3" x2="21" y2="21" />
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

function RaField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon: ReactNode;
  autoComplete?: string;
  autoCapitalize?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  trailing?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const floated = focused || props.value.length > 0;
  return (
    <div className="ra-field">
      <span className="ra-lead">{props.icon}</span>
      <input
        className="ra-input"
        type={props.type ?? "text"}
        value={props.value}
        placeholder=" "
        disabled={props.disabled}
        autoComplete={props.autoComplete}
        autoCapitalize={props.autoCapitalize}
        autoFocus={props.autoFocus}
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <label className={`ra-float${floated ? " ra-floated" : ""}`}>{props.label}</label>
      {props.trailing}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen — LOGIC IDENTICAL TO v1; only the markup/styles around it changed    */
/* -------------------------------------------------------------------------- */

export default function RegisterAdmin({
  phone,
  tempToken,
  onComplete,
  onBack,
}: {
  phone: string;
  tempToken: string;
  onComplete: (user: any) => void;
  onBack: () => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [branding, setBranding] = useState<any>(null);
  const [showPw, setShowPw] = useState(false); // view-only toggle, no flow impact

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => {});
    supabase
      .from("business_settings")
      .select("logo, login_background")
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setBranding(data);
      });
    checkExistingAccount();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function checkExistingAccount() {
    try {
      const { data: existingTenant } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", phone)
        .maybeSingle();
      if (existingTenant) {
        setMessage(`This phone is already registered. Please login instead.`);
        setTimeout(() => onComplete(null), 3000);
        setChecking(false);
        return;
      }
    } catch (err) {
      console.error(err);
    }
    setChecking(false);
  }

  async function createAdmin() {
    setMessage("");
    if (
      !businessName.trim() ||
      !username.trim() ||
      !password.trim() ||
      !confirmPassword.trim()
    ) {
      setMessage("Please fill all fields");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    try {
      setLoading(true);
      const result = await registerTenant({
        phone,
        tempToken,
        businessName: businessName.trim(),
        username: username.trim(),
        password,
      });
      const localUser = {
        id: result.userId,
        username: username.trim(),
        phone,
        email: "",
        profilePic: "",
        role: "admin" as const,
        tenantId: result.tenantId,
        assignedCourses: [] as string[],
        createdAt: new Date().toISOString(),
        password,
        synced: true,
      };
      await addUser(localUser);
      localStorage.setItem("currentUser", JSON.stringify(localUser));
      localStorage.setItem("authToken", result.authToken);
      window.dispatchEvent(new Event("authStateChanged"));
      onComplete(localUser);
    } catch (error: any) {
      setMessage(error.message || "Failed to create admin");
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="ra-root">
        <style>{RA_CSS}</style>
        <span className="ra-bigspinner" role="status" aria-label="Checking account" />
      </div>
    );
  }

  const hasBg = !!branding?.login_background;

  return (
    <div
      className={hasBg ? "ra-root ra-root-bg" : "ra-root"}
      style={hasBg ? { backgroundImage: `url(${branding.login_background})` } : undefined}
    >
      <style>{RA_CSS}</style>
      {hasBg && <div className="ra-scrim" aria-hidden="true" />}

      <button
        type="button"
        className={hasBg ? "ra-back ra-back-onbg ra-focusable" : "ra-back ra-focusable"}
        onClick={onBack}
        aria-label="Back"
      >
        <IconChevronLeft />
      </button>

      <main className="ra-panel">
        <div className="ra-card">
          <div>
            <h1 className="ra-card-title">Set Up Institution</h1>
            <p className="ra-card-sub">
              Creates the admin account for your institution on this phone.
            </p>
          </div>

          {message && (
            <div
              className="ra-banner"
              style={{ background: C.redBg, color: C.red }}
              role="alert"
            >
              <IconAlert size={18} />
              <span>{message}</span>
            </div>
          )}

          <form
            className="ra-form"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              createAdmin();
            }}
          >
            <RaField
              label="Institution Name"
              value={businessName}
              onChange={setBusinessName}
              autoComplete="organization"
              autoFocus
              icon={<IconBuilding />}
            />
            <RaField
              label="Verified Phone"
              value={phone}
              onChange={() => {}}
              disabled
              autoComplete="tel"
              icon={<IconPhone />}
            />
            <RaField
              label="Admin Username"
              value={username}
              onChange={setUsername}
              autoCapitalize="none"
              autoComplete="username"
              icon={<IconPerson />}
            />
            <RaField
              label="Password"
              value={password}
              onChange={setPassword}
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              icon={<IconLock />}
              trailing={
                <button
                  type="button"
                  className="ra-trailing ra-focusable"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((s) => !s)}
                  tabIndex={0}
                >
                  {showPw ? <IconEyeOff /> : <IconEye />}
                </button>
              }
            />
            <RaField
              label="Re-enter Password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              icon={<IconLock />}
              trailing={
                <button
                  type="button"
                  className="ra-trailing ra-focusable"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw((s) => !s)}
                  tabIndex={0}
                >
                  {showPw ? <IconEyeOff /> : <IconEye />}
                </button>
              }
            />

            <button
              type="submit"
              className="ra-btn ra-btn-filled ra-focusable"
              disabled={loading}
            >
              {loading ? (
                <>
                  <span className="ra-spinner" aria-hidden="true" />
                  Creating...
                </>
              ) : (
                <>
                  Create Account
                  <IconArrowRight />
                </>
              )}
            </button>
          </form>
        </div>
      </main>

      {appVersion && (
        <div className={hasBg ? "ra-version ra-version-onbg" : "ra-version"}>
          Version {appVersion}
        </div>
      )}
    </div>
  );
}
