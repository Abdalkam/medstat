/* ============================================================================
   src/auth/Login.tsx — v4: INSTITUTION-FIRST SETUP + SIGN-IN (Material Design 3)
   ============================================================================

   WHAT THIS FILE IS

   The app's front door, rebuilt around ONE idea: the institution is the app.
   There is no product logo and no product brand anywhere on this screen —
   the institution name the user types becomes the app's identity.

   THE FLOW (professional Android onboarding, two clean steps)

     Step 1 — "Set up your institution" (shown until an institution exists):
        • One MD3 card: title, one outlined text field, one primary button
          ("Create institution"). Saving stores the name in
          localStorage.localBusinessSettings (the key every other screen
          already reads), reuses the device tenant id or mints a fresh one
          ("sp-…"), and best-effort writes business_settings.business_name
          to the cloud (never blocks — offline degrades gracefully).
        • Then it auto-advances to sign-in.

     Step 2 — "Sign in" (shown once an institution exists, or via "Change"):
        • The INSTITUTION NAME is the card title. A small "Change" text
          button reopens step 1 to rename it.
        • Email + password sign-in (Supabase auth), forgot-password email,
          and "Continue offline" (uses the account cached on this device).

   AUTH (unchanged logic)

     1. Online  → signInWithPassword → profile from public.users (or the
        local Dexie copy) → session to localStorage ("authToken" +
        "currentUser") → sync engine started → routed by role.
     2. Network failure → automatic offline sign-in with the
        "offline-mode-pending-sync" token database/sync.ts understands.
     3. "Continue offline" → the same path on demand.

   ROUTING / INTEGRATION

     • Default export <Login /> (named export Login too):
           <Route path="/login" element={<Login />} />
     • Optional overrides: <Login routes={{ admin: "/admin", ... }} />
     • Exported helpers: routeForRole(), readCurrentUser(), brandFromSettings().
   ============================================================================ */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "./supabase";
import { db } from "../database/db";
// Defensive sync import: compiles against ANY sync.ts — if it doesn't export
// these names, the calls become safe no-ops instead of build errors.
import * as SyncEngine from "../database/sync";
const startPeriodicPull = (SyncEngine as any).startPeriodicPull ?? (() => {});
const syncNow = (SyncEngine as any).syncNow ?? (async () => {});

/* ------------------------------------------------------------------ */
/* Shared constants (same values as database/sync.ts)                  */
/* ------------------------------------------------------------------ */

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
const LAST_USER_KEY = "medstat_last_user";
/** One full-page redirect per target per 10 s — shared with startup.tsx so a
 *  broken router can never cause a reload loop. */
const REDIRECT_GUARD_KEY = "sp_last_redirect";

/** Institution name saved by this screen; legacy "MedStat" → treated as none. */
export function brandFromSettings(): string | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("localBusinessSettings") || "null"
    );
    const name = parsed?.businessName ? String(parsed.businessName).trim() : "";
    if (!name) return null;
    if (name.toLowerCase() === "medstat") return null; // legacy default
    return name;
  } catch {
    return null;
  }
}

/* ============================================================================
   MD3 DESIGN TOKENS
============================================================================ */

const C = {
  primary: "#0B57D0",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  primaryDeep: "#0842A0",

  surface: "#FFFFFF",
  background: "#F8FAFD",

  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",

  secondaryContainer: "#DAE2F2",
  onSecondaryContainer: "#1A2E45",
  surfaceVariant: "#E9EEF6",

  outline: "#747775",
  outlineVariant: "#C4C7C5",

  green: "#146C2E",
  greenBg: "#E6F4EA",
  orange: "#B06000",
  orangeBg: "#FEF7E0",
  red: "#B3261E",
  redBg: "#F9DEDC",
  blueBg: "#D3E3FD",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const SHADOW = {
  level1: "0 1px 2px 0 rgba(0,0,0,0.10), 0 1px 3px 1px rgba(0,0,0,0.07)",
  level2: "0 1px 2px 0 rgba(0,0,0,0.12), 0 2px 6px 2px rgba(0,0,0,0.08)",
};

const MOTION = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

/* ============================================================================
   TYPES + ROLE ROUTING
============================================================================ */

export interface HomeRoutes {
  admin?: string;
  trainer?: string;
  member?: string;
}

export interface LoginProps {
  routes?: HomeRoutes;
}

type AnyUser = Record<string, any> & { id?: string };

/** Role → home route. Exported so startup.tsx / App can reuse the same rule. */
export function routeForRole(role: string | undefined | null, routes?: HomeRoutes): string {
  const r = String(role || "").toLowerCase();
  if (r === "admin" || r === "owner" || r === "super_admin" || r === "superadmin") {
    return routes?.admin ?? "/admin";
  }
  if (r === "trainer" || r === "teacher") return routes?.trainer ?? "/trainer";
  return routes?.member ?? "/";
}

export function readCurrentUser(): AnyUser | null {
  try {
    const raw = localStorage.getItem("currentUser");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Last-resort full-page redirect. Guarded: the same target is only followed
 *  ONCE per 10 s, so even completely broken routing can never loop. */
function fullPageRedirect(target: string): void {
  try {
    const last = JSON.parse(
      sessionStorage.getItem(REDIRECT_GUARD_KEY) || "null"
    );
    if (last && last.target === target && Date.now() - last.ts < 10000) return;
  } catch {
    /* ignore */
  }
  try {
    sessionStorage.setItem(
      REDIRECT_GUARD_KEY,
      JSON.stringify({ target, ts: Date.now() })
    );
  } catch {
    /* ignore */
  }
  window.location.assign(target);
}

/** SPA navigation first; if the router never applied it (bad wiring), ONE
 *  guarded full-page redirect follows 1.2 s later. */
function navigateWithFallback(
  target: string,
  navigate: (path: string, opts?: { replace?: boolean }) => void
): void {
  try {
    navigate(target, { replace: true });
  } catch {
    fullPageRedirect(target);
    return;
  }
  window.setTimeout(() => {
    try {
      const here = window.location.pathname + window.location.hash;
      if (here.endsWith(target)) return; // navigation worked
    } catch {
      /* ignore */
    }
    fullPageRedirect(target);
  }, 1200);
}

/* ============================================================================
   INLINE SVG ICONS (stroke style, currentColor — no icon font dependency)
============================================================================ */

const iconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconMail({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m3.5 7.5 8.5 6 8.5-6" />
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

function IconCloudOn({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M17.5 18.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.1 11.7 3.5 3.5 0 0 0 6.5 18.5z" />
      <path d="m9 13 2.2 2.2L15.5 11" />
    </svg>
  );
}

function IconCloudOff({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M17.5 18.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.1 11.7 3.5 3.5 0 0 0 6.5 18.5z" />
      <line x1="3" y1="4" x2="21" y2="21" />
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

function IconInfo({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16.5" />
      <line x1="12" y1="7.8" x2="12" y2="7.9" />
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

function IconBuilding({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
      <path d="M9 7.5h2M13 7.5h2M9 11h2M13 11h2M9 14.5h2M13 14.5h2" />
      <path d="M10.5 20.5v-3h3v3" />
    </svg>
  );
}

/* ============================================================================
   MD3 STYLE SHEET (lg- = login namespace — cannot collide with other screens)
   One centered card at every size; media queries only tighten spacing.
============================================================================ */

const CSS = `
.lg-root {
  min-height: 100vh; min-height: 100dvh;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, ${C.background} 55%, #EEF3FB 100%);
  font-family: ${FONT};
  color: ${C.onSurface};
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-tap-highlight-color: transparent;
}
.lg-panel {
  width: 100%; max-width: 460px;
  display: flex; flex-direction: column; align-items: center;
  padding: clamp(14px, 3vh, 32px) clamp(16px, 4vw, 28px);
}
.lg-card {
  box-sizing: border-box;
  width: 100%;
  background: ${C.surface};
  border-radius: 28px;
  box-shadow: ${SHADOW.level2};
  padding: clamp(22px, 5vw, 36px);
  display: flex; flex-direction: column; gap: 14px;
}
.lg-card-title {
  font-size: clamp(21px, 5.6vw, 26px);
  font-weight: 600; margin: 2px 0 0;
  letter-spacing: 0.1px; line-height: 1.25;
}
.lg-inst-name { word-break: break-word; }
.lg-card-sub { font-size: 14px; color: ${C.onSurfaceVariant}; margin: 0 0 4px; line-height: 1.5; }
.lg-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
.lg-title-row .lg-link { flex-shrink: 0; margin-top: 4px; }
.lg-banner {
  display: flex; align-items: flex-start; gap: 10px;
  border-radius: 12px; padding: 11px 13px;
  font-size: 13.5px; line-height: 1.5;
}
.lg-banner svg { flex-shrink: 0; margin-top: 1px; }
/* ---------- MD3 outlined text field ---------- */
.lg-field {
  position: relative; display: flex; align-items: center;
  height: 56px; border-radius: 12px;
  background: ${C.surface};
  border: 1px solid ${C.outlineVariant};
  transition: ${MOTION};
}
.lg-field:focus-within { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; }
.lg-lead { position: absolute; left: 14px; display: flex; color: ${C.onSurfaceVariant}; transition: ${MOTION}; }
.lg-field:focus-within .lg-lead { color: ${C.primary}; }
.lg-field.lg-field-error { border-color: ${C.red}; }
.lg-field.lg-field-error:focus-within { box-shadow: inset 0 0 0 1px ${C.red}; }
.lg-field.lg-field-error .lg-lead { color: ${C.red}; }
.lg-input {
  flex: 1; min-width: 0; height: 100%;
  border: none; outline: none; background: transparent;
  padding: 0 46px;
  font-family: inherit; font-size: 16px; color: ${C.onSurface};
}
.lg-input:disabled { opacity: 0.55; }
.lg-float {
  position: absolute; left: 46px; top: 50%;
  transform: translateY(-50%);
  color: ${C.onSurfaceVariant};
  font-size: 15px;
  pointer-events: none;
  transition: ${MOTION};
  white-space: nowrap;
}
.lg-float.lg-floated {
  top: 0; transform: translateY(-50%) scale(0.76);
  transform-origin: left center;
  background: ${C.surface};
  padding: 0 5px; margin-left: -5px;
  color: ${C.onSurfaceVariant};
}
.lg-field:focus-within .lg-float.lg-floated { color: ${C.primary}; }
.lg-field.lg-field-error .lg-float.lg-floated { color: ${C.red}; }
.lg-trailing {
  position: absolute; right: 6px;
  width: 42px; height: 42px;
  border: none; background: transparent; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: ${C.onSurfaceVariant}; cursor: pointer;
  transition: ${MOTION};
}
.lg-trailing:hover { background: ${C.surfaceVariant}; color: ${C.onSurface}; }
/* ---------- buttons ---------- */
.lg-btn {
  position: relative;
  height: 48px; width: 100%;
  border: none; border-radius: 999px;
  font-family: inherit; font-size: 15px; font-weight: 600; letter-spacing: 0.2px;
  display: inline-flex; align-items: center; justify-content: center; gap: 9px;
  cursor: pointer;
  transition: ${MOTION};
}
.lg-btn:active:not(:disabled) { transform: scale(0.985); }
.lg-btn:disabled { opacity: 0.42; cursor: default; }
.lg-btn-filled { background: ${C.primary}; color: ${C.onPrimary}; box-shadow: ${SHADOW.level1}; }
.lg-btn-filled:hover:not(:disabled) { box-shadow: ${SHADOW.level2}; }
.lg-btn-tonal { background: ${C.secondaryContainer}; color: ${C.onSecondaryContainer}; }
.lg-btn-tonal:hover:not(:disabled) { box-shadow: ${SHADOW.level1}; }
.lg-link {
  background: none; border: none; padding: 6px 2px;
  font-family: inherit; font-size: 13.5px; font-weight: 600;
  color: ${C.primary}; cursor: pointer;
  border-radius: 8px;
  transition: ${MOTION};
  align-self: flex-end;
}
.lg-link:hover:not(:disabled) { text-decoration: underline; }
.lg-link:disabled { opacity: 0.5; cursor: default; }
.lg-divider-row { display: flex; align-items: center; gap: 14px; color: ${C.onSurfaceVariant}; font-size: 12px; letter-spacing: 0.6px; text-transform: uppercase; margin: 2px 0; }
.lg-divider-row::before, .lg-divider-row::after { content: ""; flex: 1; height: 1px; background: ${C.outlineVariant}; }
.lg-spinner {
  width: 18px; height: 18px; flex-shrink: 0;
  border-radius: 50%;
  border: 2.5px solid currentColor; border-top-color: transparent;
  animation: lgSpin 0.8s linear infinite;
}
@keyframes lgSpin { to { transform: rotate(360deg); } }
.lg-focusable:focus-visible { outline: 2px solid ${C.primary}; outline-offset: 2px; }
@media (max-width: 374px) {
  .lg-field { height: 52px; }
  .lg-float { left: 42px; }
}
@media (max-height: 520px) and (orientation: landscape) {
  .lg-panel { padding-top: 10px; padding-bottom: 10px; }
  .lg-card { padding: 16px 22px; gap: 9px; border-radius: 20px; }
  .lg-field { height: 48px; }
  .lg-btn { height: 42px; }
}
@media (prefers-reduced-motion: reduce) {
  .lg-root *, .lg-root *::before, .lg-root *::after { transition: none !important; animation-duration: 0.01ms !important; }
}
`;

/* ============================================================================
   SMALL PRESENTATIONAL PIECES
============================================================================ */

function TextField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon: ReactNode;
  autoComplete?: string;
  inputMode?: "email" | "text";
  error?: boolean;
  disabled?: boolean;
  onEnter?: () => void;
  trailing?: ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const floated = focused || props.value.length > 0;
  return (
    <div className={`lg-field${props.error ? " lg-field-error" : ""}`}>
      <span className="lg-lead">{props.icon}</span>
      <input
        className="lg-input"
        type={props.type ?? "text"}
        value={props.value}
        placeholder=" "
        disabled={props.disabled}
        autoComplete={props.autoComplete}
        inputMode={props.inputMode}
        spellCheck={false}
        onChange={(e) => props.onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && props.onEnter) props.onEnter();
        }}
      />
      <label className={`lg-float${floated ? " lg-floated" : ""}`}>{props.label}</label>
      {props.trailing}
    </div>
  );
}

function Banner(props: {
  kind: "error" | "info" | "success";
  children: ReactNode;
}) {
  const conf = {
    error: { bg: C.redBg, color: C.red, Icon: IconAlert },
    info: { bg: C.blueBg, color: C.onPrimaryContainer, Icon: IconInfo },
    success: { bg: C.greenBg, color: C.green, Icon: IconCloudOn },
  }[props.kind];
  return (
    <div className="lg-banner" style={{ background: conf.bg, color: conf.color }} role={props.kind === "error" ? "alert" : "status"}>
      <conf.Icon size={18} />
      <span>{props.children}</span>
    </div>
  );
}

/* ============================================================================
   HELPERS — session + local account lookup (unchanged working logic)
============================================================================ */

/** Cloud/row values (snake_case or camelCase) → the currentUser shape the
 *  whole app reads (id, name, email, role, tenantId — see AdminDashboard,
 *  TrainerLiveClassroom, sync.ts). */
function localShapeFrom(row: any, fallbackEmail: string, authId?: string): AnyUser {
  const email = String(row?.email ?? fallbackEmail ?? "").trim();
  const u: AnyUser = {
    id: String(authId ?? row?.id ?? ""),
    name: String(row?.name ?? row?.username ?? row?.full_name ?? email.split("@")[0] ?? "User").trim() || "User",
    email,
    role: String(row?.role ?? "admin").toLowerCase(),
    tenantId: String(row?.tenantId ?? row?.tenant_id ?? ""),
  };
  if (row?.phone) u.phone = String(row.phone);
  if (row?.logo) u.logo = String(row.logo);
  if (Array.isArray(row?.assignedCourses)) u.assignedCourses = row.assignedCourses;
  return u;
}

/** Find the account in the OFFLINE caches: Dexie users first (the synced
 *  roster), then the last account that signed in on this device. */
async function findLocalUser(email: string): Promise<AnyUser | null> {
  const needle = email.trim().toLowerCase();
  try {
    const all = await db.users.toArray();
    const hit = all.find((u: any) => String(u?.email ?? "").trim().toLowerCase() === needle && needle !== "");
    if (hit) return hit as AnyUser;
  } catch {
    /* Dexie not open / table missing — fall through to the last-user cache */
  }
  try {
    const last = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
    if (last && (needle === "" || String(last?.email ?? "").toLowerCase() === needle)) {
      return last as AnyUser;
    }
  } catch {
    /* no cache */
  }
  return null;
}

function classifyAuthError(err: any): "network" | "credentials" | "other" {
  const msg = String(err?.message ?? err ?? "");
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  if (/failed to fetch|networkerror|network request|fetch failed|load failed|timed?\s?out|ERR_INTERNET|ERR_NETWORK|dns/i.test(msg)) {
    return "network";
  }
  if (/invalid login|invalid credentials|incorrect email or password/i.test(msg)) return "credentials";
  return "other";
}

function friendlyAuthError(raw: string): string {
  const msg = String(raw ?? "");
  if (/invalid login|invalid credentials/i.test(msg)) {
    return "Wrong email or password. Please check them and try again.";
  }
  if (/email not confirmed/i.test(msg)) {
    return "This email hasn't been confirmed yet — open the confirmation link in your inbox, then sign in.";
  }
  if (/too many requests/i.test(msg)) {
    return "Too many attempts. Wait about a minute, then try again.";
  }
  if (/rate limit/i.test(msg)) {
    return "Sign-in is rate-limited right now. Please wait a moment and retry.";
  }
  return msg || "Sign-in failed. Please try again.";
}

/* ============================================================================
   <Login /> — default export
============================================================================ */

export default function Login(props: LoginProps) {
  const navigate = useNavigate();

  const [step, setStep] = useState<"institution" | "signin">("institution");
  const [savedName, setSavedName] = useState("");
  const [institution, setInstitution] = useState("");
  const [instError, setInstError] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "success">("info");
  const [emailError, setEmailError] = useState(false);
  const [pwError, setPwError] = useState(false);
  const [hasLocalAccount, setHasLocalAccount] = useState(false);

  /* ---- mount: prefill, session forward, local account check -------------- */
  useEffect(() => {
    try {
      const settings = localStorage.getItem("localBusinessSettings");
      if (settings) {
        const parsed = JSON.parse(settings);
        if (parsed?.businessName) {
          // Prefill the field with whatever was saved (even a legacy value,
          // so it can be corrected), but only advance to sign-in when a REAL
          // institution name was created.
          setInstitution(String(parsed.businessName));
        }
      }
      const brand = brandFromSettings();
      if (brand) {
        setInstitution(brand);
        setSavedName(brand);
        setStep("signin");
      }
      const last = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
      if (last?.email) setEmail(String(last.email));
    } catch {
      /* ignore */
    }

    (async () => {
      // Already signed in on this device? Forward straight to the role home.
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (token && cu?.id) {
        startPeriodicPull();
        navigateWithFallback(routeForRole(cu.role, props.routes), navigate);
        return;
      }
      try {
        // Capped at 2 s so a blocked IndexedDB can never stall the login card.
        const count = await Promise.race([
          db.users.count(),
          new Promise<number>((res) => window.setTimeout(() => res(0), 2000)),
        ]);
        setHasLocalAccount(count > 0 || !!localStorage.getItem(LAST_USER_KEY));
      } catch {
        setHasLocalAccount(!!localStorage.getItem(LAST_USER_KEY));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------- session write ---------------------------- */

  function setUserSession(user: AnyUser, token: string, offline: boolean) {
    try {
      localStorage.setItem("authToken", token);
      localStorage.setItem("currentUser", JSON.stringify(user));
      if (user.tenantId) localStorage.setItem("activeTenantId", user.tenantId);
      // The institution typed on this screen outlives the session — persist it
      // with the same key every other screen reads.
      if (institution.trim()) {
        let prevSettings: any = {};
        try { prevSettings = JSON.parse(localStorage.getItem("localBusinessSettings") || "{}") || {}; } catch {}
        localStorage.setItem(
          "localBusinessSettings",
          JSON.stringify({ ...prevSettings, businessName: institution.trim() })
        );
      }
    } catch {
      /* storage full/blocked — session still lives in memory for this page */
    }
    window.dispatchEvent(new Event("authStateChanged"));
    // The engine is idempotent (it clears its previous interval first) and it
    // skips doomed cloud work by itself while the offline token is set.
    startPeriodicPull();
    if (!offline) void syncNow(user.tenantId);
    navigateWithFallback(routeForRole(user.role, props.routes), navigate);
  }

  /* ------------------------- OFFLINE sign-in path ------------------------ */

  async function finishOffline(afterNetworkFailure: boolean) {
    const mail = email.trim();
    if (!hasLocalAccount) {
      setErrorMsg(
        "There is no saved account on this device yet. Sign in once with an internet connection — after that, offline sign-in works everywhere."
      );
      return;
    }
    setOfflineBusy(true);
    setErrorMsg("");
    setNotice("");
    try {
      const hit = await findLocalUser(mail);
      if (!hit || !hit.id) {
        setErrorMsg(
          mail
            ? `"${mail}" is not saved on this device. Connect to the internet once and sign in with it to enable offline access.`
            : "Enter your email above so the saved account can be found."
        );
        return;
      }
      const user = localShapeFrom(hit, mail, String(hit.id));
      if (afterNetworkFailure) {
        setNoticeKind("info");
        setNotice(
          "You're offline — signed in to the local copy. Everything you do will sync automatically when you reconnect."
        );
      }
      setUserSession(user, OFFLINE_LOGIN_TOKEN, true);
    } finally {
      setOfflineBusy(false);
    }
  }

  /* -------------------------- ONLINE sign-in path ------------------------ */

  async function finishOnline() {
    const mail = email.trim();
    const pass = password;
    if (!mail) {
      setEmailError(true);
      setErrorMsg("Enter your email to continue.");
      return;
    }
    if (!pass) {
      setPwError(true);
      setErrorMsg("Enter your password to continue.");
      return;
    }
    setBusy(true);
    setErrorMsg("");
    setNotice("");
    setEmailError(false);
    setPwError(false);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: mail,
        password: pass,
      });

      if (error) {
        // A dead network must never block the user — fall back to the local
        // account automatically instead of showing an error.
        if (classifyAuthError(error) === "network") {
          await finishOffline(true);
          return;
        }
        setErrorMsg(friendlyAuthError(error.message));
        return;
      }

      const session = data?.session;
      const authUser = data?.user;
      if (!session || !authUser) {
        setErrorMsg("Sign-in succeeded but no session was returned. Please try again.");
        return;
      }

      // App profile: public.users row first, then the local Dexie copy.
      let row: any = null;
      try {
        const { data: profile } = await supabase
          .from("users")
          .select("*")
          .eq("email", mail)
          .maybeSingle();
        row = profile ?? null;
      } catch {
        row = null;
      }
      if (!row) {
        const localHit = await findLocalUser(mail);
        if (localHit) row = localHit;
      }

      const user = localShapeFrom(row, mail, String(authUser.id));
      if (!user.tenantId) {
        const meta = (authUser.user_metadata ?? {}) as any;
        user.tenantId = String(meta.tenant_id ?? meta.tenantId ?? localStorage.getItem("activeTenantId") ?? "");
      }

      setNoticeKind("success");
      setNotice("Welcome back!");
      setUserSession(user, session.access_token, false);
    } catch (e: any) {
      if (classifyAuthError(e) === "network") {
        await finishOffline(true);
        return;
      }
      setErrorMsg(friendlyAuthError(e?.message ?? "Sign-in failed. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------ CREATE INSTITUTION --------------------------- */

  async function createInstitution() {
    const name = institution.trim();
    if (!name) {
      setInstError(true);
      setErrorMsg("Type the institution name first, then tap the button below.");
      return;
    }
    setCreateBusy(true);
    setErrorMsg("");
    setNotice("");
    try {
      // 1) Persist locally — localBusinessSettings is the key the rest of the
      //    app (UploadMaterials, startup splash) already reads for branding.
      let prevSettings: any = {};
      try { prevSettings = JSON.parse(localStorage.getItem("localBusinessSettings") || "{}") || {}; } catch {}
      localStorage.setItem(
        "localBusinessSettings",
        JSON.stringify({ ...prevSettings, businessName: name })
      );
      setSavedName(name);

      // 2) Tenant context: reuse the signed-in account's tenant when present;
      //    otherwise mint a fresh id for the brand-new institution.
      let tenantId = "";
      try {
        tenantId = String(
          JSON.parse(localStorage.getItem("currentUser") || "{}")?.tenantId ||
            localStorage.getItem("activeTenantId") ||
            ""
        );
      } catch { tenantId = ""; }
      if (!tenantId) {
        tenantId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? `sp-${crypto.randomUUID()}`
            : `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        try { localStorage.setItem("activeTenantId", tenantId); } catch {}
      }

      // 3) Best-effort cloud write — never blocks the button: offline or RLS
      //    failures degrade to "saved on this device" with a clear notice.
      let cloudNote = "It will sync to the cloud once you're signed in online.";
      if (
        typeof navigator !== "undefined" &&
        navigator.onLine &&
        localStorage.getItem("authToken") &&
        localStorage.getItem("authToken") !== OFFLINE_LOGIN_TOKEN
      ) {
        try {
          const { data: updated, error: updErr } = await supabase
            .from("business_settings")
            .update({ business_name: name })
            .eq("tenant_id", tenantId)
            .select("tenant_id");
          if (updErr || !updated || updated.length === 0) {
            const { error: insErr } = await supabase
              .from("business_settings")
              .insert({ tenant_id: tenantId, business_name: name });
            if (insErr) {
              cloudNote = "Saved on this device — the cloud copy will follow once you sign in.";
            } else {
              cloudNote = "Saved to the cloud.";
            }
          } else {
            cloudNote = "Saved to the cloud.";
          }
        } catch {
          /* keep the local-only note */
        }
      }

      setNoticeKind("success");
      setNotice(`Institution “${name}” is ready on this device. ${cloudNote}`);
      setStep("signin");
    } finally {
      setCreateBusy(false);
    }
  }

  /* --------------------------- password reset ---------------------------- */

  async function sendPasswordReset() {
    const mail = email.trim();
    if (!mail) {
      setEmailError(true);
      setErrorMsg("Type your email above first, then tap “Forgot password”.");
      return;
    }
    setResetBusy(true);
    setErrorMsg("");
    setNotice("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(mail);
      if (error) {
        if (classifyAuthError(error) === "network") {
          setNoticeKind("info");
          setNotice("You're offline — password reset needs a connection. Try again once you're back online.");
        } else {
          setErrorMsg(friendlyAuthError(error.message));
        }
        return;
      }
      setNoticeKind("info");
      setNotice(`Password reset email sent to ${mail}. Check your inbox.`);
    } catch (e: any) {
      setErrorMsg(classifyAuthError(e) === "network" ? "You're offline — password reset needs a connection." : friendlyAuthError(e?.message));
    } finally {
      setResetBusy(false);
    }
  }

  const working = busy || offlineBusy || createBusy;
  const displayName = savedName || institution.trim();

  /* -------------------------------- view -------------------------------- */

  return (
    <div className="lg-root">
      <style>{CSS}</style>
      <main className="lg-panel">
        <div className="lg-card">
          {step === "institution" ? (
            /* ================= STEP 1 — INSTITUTION SETUP ================= */
            <>
              <div>
                <h1 className="lg-card-title">
                  {displayName ? "Institution name" : "Welcome"}
                </h1>
                <p className="lg-card-sub">
                  Enter your institution name — it becomes the app's name on this
                  device. You can change it anytime.
                </p>
              </div>

              {errorMsg && <Banner kind="error">{errorMsg}</Banner>}
              {notice && <Banner kind={noticeKind}>{notice}</Banner>}

              <TextField
                label="Institution name"
                value={institution}
                onChange={(v) => {
                  setInstitution(v);
                  setInstError(false);
                }}
                autoComplete="organization"
                icon={<IconBuilding />}
                error={instError}
                disabled={createBusy}
                onEnter={() => void createInstitution()}
              />

              <button
                type="button"
                className="lg-btn lg-btn-filled lg-focusable"
                onClick={() => void createInstitution()}
                disabled={createBusy}
                title="Save this institution as the app's name on this device"
              >
                {createBusy ? (
                  <>
                    <span className="lg-spinner" aria-hidden="true" />
                    Saving…
                  </>
                ) : (
                  <>
                    <IconBuilding size={18} />
                    {displayName ? "Save changes" : "Create institution"}
                  </>
                )}
              </button>
            </>
          ) : (
            /* ================== STEP 2 — SIGN IN ========================== */
            <>
              <div className="lg-title-row">
                <div>
                  <h1 className="lg-card-title lg-inst-name">
                    {displayName || "Welcome back"}
                  </h1>
                  <p className="lg-card-sub">
                    Sign in to manage courses, members and live classes.
                  </p>
                </div>
                <button
                  type="button"
                  className="lg-link lg-focusable"
                  onClick={() => {
                    setStep("institution");
                    setErrorMsg("");
                    setNotice("");
                  }}
                >
                  Change
                </button>
              </div>

              {errorMsg && <Banner kind="error">{errorMsg}</Banner>}
              {notice && <Banner kind={noticeKind}>{notice}</Banner>}

              <TextField
                label="Email address"
                value={email}
                onChange={(v) => {
                  setEmail(v);
                  setEmailError(false);
                }}
                type="email"
                inputMode="email"
                autoComplete="email"
                icon={<IconMail />}
                error={emailError}
                disabled={busy}
                onEnter={() => {
                  if (busy) return;
                  if (password) void finishOnline();
                }}
              />

              <TextField
                label="Password"
                value={password}
                onChange={(v) => {
                  setPassword(v);
                  setPwError(false);
                }}
                type={showPw ? "text" : "password"}
                autoComplete="current-password"
                icon={<IconLock />}
                error={pwError}
                disabled={busy}
                onEnter={() => {
                  if (!busy) void finishOnline();
                }}
                trailing={
                  <button
                    type="button"
                    className="lg-trailing lg-focusable"
                    aria-label={showPw ? "Hide password" : "Show password"}
                    onClick={() => setShowPw((s) => !s)}
                    tabIndex={0}
                  >
                    {showPw ? <IconEyeOff /> : <IconEye />}
                  </button>
                }
              />

              <button
                type="button"
                className="lg-link lg-focusable"
                onClick={() => void sendPasswordReset()}
                disabled={resetBusy || busy}
              >
                {resetBusy ? "Sending reset email…" : "Forgot password?"}
              </button>

              <button
                type="button"
                className="lg-btn lg-btn-filled lg-focusable"
                onClick={() => void finishOnline()}
                disabled={busy}
              >
                {busy ? (
                  <>
                    <span className="lg-spinner" aria-hidden="true" />
                    Signing in…
                  </>
                ) : (
                  <>
                    Sign in
                    <IconArrowRight />
                  </>
                )}
              </button>

              <div className="lg-divider-row">or</div>

              <button
                type="button"
                className="lg-btn lg-btn-tonal lg-focusable"
                onClick={() => void finishOffline(false)}
                disabled={busy}
                title="Use the account saved on this device — no internet needed"
              >
                {offlineBusy ? (
                  <>
                    <span className="lg-spinner" aria-hidden="true" />
                    Opening offline mode…
                  </>
                ) : (
                  <>
                    <IconCloudOff />
                    Continue offline
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export { Login };
