/* ============================================================================
   src/auth/Login.tsx — v7: USERNAME SIGN-IN + ENTER-INSTITUTION FLOW (MD3)

   v7 change: sign-in now uses USERNAME, not email. It goes through
   database/userDB.loginWithIdentifier() — the app's real auth path, the
   same call src/screens/LoginScreen.tsx makes. The email field, the
   supabase.auth.signInWithPassword call and the forgot-password email are
   gone (RegisterAdmin accounts are username accounts — they have no email).

   v6 change: Screen 1 is now ALWAYS the first thing a signed-out user sees.
   The sign-in page opens only AFTER the institution name is entered — a
   name already saved on this device just prefills the field (one tap on
   "Continue"). Previously a saved name skipped straight to sign-in.
   ============================================================================

   WHAT THIS FILE IS

   The app's front door, rebuilt around ONE idea: the institution is the app.
   There is no product logo and no product brand anywhere on this screen —
   the institution name the user types becomes the app's identity.

   THE FLOW (the login algorithm, three clean screens)

     Screen 1 — "Enter institution name" (the front door):
        • ALWAYS shown first. The login page is reached BY entering the
          institution name — it is never shown before that.
        • One MD3 card: institution name field + "Continue". Continue saves
          the name on this device (localStorage.localBusinessSettings — the
          key every other screen reads) and routes to sign-in.
        • A "Create institution" button sits in the CORNER (top-right) and
          opens screen 2.

     Screen 2 — "Create institution" (its own page):
        • A back arrow in the corner returns to screen 1.
        • Name field + "Create institution": stores the name, reuses the
          device tenant id or mints a fresh one ("sp-…"), best-effort writes
          business_settings.business_name to the cloud (never blocks), then
          opens sign-in.

     Screen 3 — "Sign in" (opens after the name is entered, or via "Change"):
        • The INSTITUTION NAME is the card title. A small "Change" text
          button reopens screen 1 to rename it.
        • USERNAME + password sign-in via userDB.loginWithIdentifier, and
          "Continue offline" (uses the account cached on this device).

   AUTH (USERNAME — the app's real path, not email)

     1. Sign-in calls userDB.loginWithIdentifier({ business, username,
        password }): the institution name from screen 1 scopes the lookup,
        then username + password are checked against public.users (bcrypt).
        userDB itself persists the session ("authToken" + "currentUser")
        and caches the credentials in Dexie for offline sign-ins.
     2. "Continue offline" → finds the cached account (Dexie roster or the
        last successful sign-in on this device) and signs in with the
        "offline-mode-pending-sync" token database/sync.ts understands.

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
// The app's REAL auth path — username + password checked against
// public.users, scoped by the institution name, credentials cached in
// Dexie for offline. Same call src/screens/LoginScreen.tsx makes.
import { loginWithIdentifier } from "../database/userDB";
// Defensive sync import: compiles against ANY sync.ts — if it doesn't export
// these names, the calls become safe no-ops instead of build errors.
import * as SyncEngine from "../database/sync";
const startPeriodicPull = (SyncEngine as any).startPeriodicPull ?? (() => {});
const syncNow = (SyncEngine as any).syncNow ?? (async () => {});

/* ------------------------------------------------------------------ */
/* Shared constants (same values as database/sync.ts)                  */
/* ------------------------------------------------------------------ */

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
/** Last successful sign-in on this device ({username, id, role, tenantId…})
 *  — username prefill + the "Continue offline" fallback account. */
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

function IconArrowBack({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 5 5 12 12 19" />
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
.lg-topbar {
  width: 100%; min-height: 40px;
  display: flex; align-items: center;
  padding: 0 4px; margin-bottom: 4px;
}
.lg-topbar-right { justify-content: flex-end; }
.lg-topbar-left { justify-content: flex-start; }
.lg-topbar .lg-link { margin-top: 0; align-self: center; }
.lg-topbar-spacer { width: 40px; height: 40px; }
.lg-iconbtn {
  width: 40px; height: 40px;
  border: none; border-radius: 50%;
  background: transparent; color: ${C.onSurface};
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; transition: ${MOTION};
}
.lg-iconbtn:hover { background: ${C.surfaceVariant}; }
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
  autoCapitalize?: string;
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
        autoCapitalize={props.autoCapitalize}
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
   HELPERS — session + local account lookup
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

/** Find the account in the OFFLINE caches by USERNAME (or a legacy email
 *  value): Dexie users first (the synced roster), then the last account
 *  that signed in on this device. */
async function findLocalUser(handle: string): Promise<AnyUser | null> {
  const needle = handle.trim().toLowerCase();
  try {
    const all = await db.users.toArray();
    const hit = all.find((u: any) => {
      if (needle === "") return false;
      const un = String(u?.username ?? "").trim().toLowerCase();
      const em = String(u?.email ?? "").trim().toLowerCase();
      return un === needle || (em === needle && em !== "");
    });
    if (hit) return hit as AnyUser;
  } catch {
    /* Dexie not open / table missing — fall through to the last-user cache */
  }
  try {
    const last = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
    const un = String(last?.username ?? "").trim().toLowerCase();
    const em = String(last?.email ?? "").trim().toLowerCase();
    if (last && (needle === "" || un === needle || (em === needle && em !== ""))) {
      return last as AnyUser;
    }
  } catch {
    /* no cache */
  }
  return null;
}

function friendlyAuthError(raw: string): string {
  const msg = String(raw ?? "");
  if (/invalid login|invalid credentials|incorrect (email|username) or password|wrong (email|username) or password|username not found|user not found/i.test(msg)) {
    return "Wrong username or password. Please check them and try again.";
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

  const [step, setStep] = useState<"enter" | "create" | "signin">("enter");
  const [savedName, setSavedName] = useState("");
  const [institution, setInstitution] = useState("");
  const [instError, setInstError] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [offlineBusy, setOfflineBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"info" | "success">("info");
  const [usernameError, setUsernameError] = useState(false);
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
          // so it can be corrected). Screen 1 still shows first — the login
          // page is reached BY entering the institution name.
          setInstitution(String(parsed.businessName));
        }
      }
      const brand = brandFromSettings();
      if (brand) {
        // Known institution: prefill only. NEVER auto-jump to sign-in —
        // the user routes there by entering the name on "Continue".
        setInstitution(brand);
        setSavedName(brand);
      }
      const last = JSON.parse(localStorage.getItem(LAST_USER_KEY) || "null");
      const lastHandle = String(last?.username ?? last?.email ?? "").trim();
      if (lastHandle) setUsername(lastHandle);
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
    const uname = username.trim();
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
      const hit = await findLocalUser(uname);
      if (!hit || !hit.id) {
        setErrorMsg(
          uname
            ? `"${uname}" is not saved on this device. Connect to the internet once and sign in with it to enable offline access.`
            : "Enter your username above so the saved account can be found."
        );
        return;
      }
      const user = localShapeFrom(hit, "", String(hit.id));
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

  /* --------------------------- USERNAME sign-in --------------------------- */

  /** Screen 3 "Sign in": username + password through the app's REAL auth
   *  path — userDB.loginWithIdentifier(). The institution name from screen
   *  1 scopes the lookup; userDB itself persists the session and caches the
   *  credentials in Dexie, so a dead network falls back to the cached
   *  account inside userDB (the explicit "Continue offline" button below is
   *  the manual path for the same thing). */
  async function finishSignIn() {
    const uname = username.trim();
    const pass = password;
    if (!uname) {
      setUsernameError(true);
      setErrorMsg("Enter your username to continue.");
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
    setUsernameError(false);
    setPwError(false);
    try {
      const user = await loginWithIdentifier({
        business: institution.trim() || undefined,
        username: uname,
        password: pass,
      });

      // Normalize to the currentUser shape the whole app reads (id, name,
      // role, tenantId, assignedCourses…).
      const anyUser = user as any;
      const shaped = localShapeFrom(anyUser, "", String(anyUser?.id ?? ""));

      // Belt-and-braces: the startup gate reads these keys. userDB persists
      // them itself — only fill the gap if a future version ever stops.
      try {
        if (shaped.id && !localStorage.getItem("currentUser")) {
          localStorage.setItem("currentUser", JSON.stringify(shaped));
        }
        // Remember the account for the username prefill + offline lookup.
        localStorage.setItem(LAST_USER_KEY, JSON.stringify({ ...shaped, username: uname }));
      } catch {
        /* storage blocked — session still lives for this run */
      }

      setNoticeKind("success");
      setNotice("Welcome back!");
      window.dispatchEvent(new Event("authStateChanged"));
      // The engine is idempotent (it clears its previous interval first).
      startPeriodicPull();
      void syncNow(shaped.tenantId);
      navigateWithFallback(routeForRole(shaped.role, props.routes), navigate);
    } catch (e: any) {
      setErrorMsg(friendlyAuthError(String(e?.message ?? e)));
    } finally {
      setBusy(false);
    }
  }

  /* --------------------- SCREEN 1 → save + continue ---------------------- */

  /** Screen 1 ("Enter institution name"): remember the name on this device
   *  and continue to sign-in. The tenant id is NOT touched here — it comes
   *  from the signed-in account. */
  function enterInstitution() {
    const name = institution.trim();
    if (!name) {
      setInstError(true);
      setErrorMsg("Enter your institution name to continue.");
      return;
    }
    try {
      let prevSettings: any = {};
      try { prevSettings = JSON.parse(localStorage.getItem("localBusinessSettings") || "{}") || {}; } catch {}
      localStorage.setItem(
        "localBusinessSettings",
        JSON.stringify({ ...prevSettings, businessName: name })
      );
    } catch {
      /* storage blocked — continue with the in-memory name */
    }
    setSavedName(name);
    setErrorMsg("");
    setNotice("");
    setStep("signin");
  }

  /* ---------------------- corner navigation helpers ---------------------- */

  /** Corner button on screen 1 → the create-institution page. */
  function goCreate() {
    setStep("create");
    setErrorMsg("");
    setNotice("");
  }

  /** Back arrow on screen 2 → back to screen 1. */
  function goEnter() {
    setStep("enter");
    setErrorMsg("");
    setNotice("");
  }

  /* ------------------------ CREATE INSTITUTION --------------------------- */

  async function createInstitution() {
    const name = institution.trim();
    if (!name) {
      setInstError(true);
      setErrorMsg("Enter a name for the new institution first.");
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

  const displayName = savedName || institution.trim();

  /* -------------------------------- view -------------------------------- */

  return (
    <div className="lg-root">
      <style>{CSS}</style>
      <main className="lg-panel">
        {/* Corner row: "Create institution" (screen 1) / back arrow (screen 2). */}
        <div
          className={
            step === "create" ? "lg-topbar lg-topbar-left" : "lg-topbar lg-topbar-right"
          }
        >
          {step === "enter" ? (
            <button
              type="button"
              className="lg-link lg-focusable"
              onClick={goCreate}
              title="New institution? Create it here"
            >
              Create institution
            </button>
          ) : step === "create" ? (
            <button
              type="button"
              className="lg-iconbtn lg-focusable"
              aria-label="Back to institution name"
              onClick={goEnter}
            >
              <IconArrowBack />
            </button>
          ) : (
            <span className="lg-topbar-spacer" aria-hidden="true" />
          )}
        </div>

        <div className="lg-card">
          {step === "enter" ? (
            /* ========== SCREEN 1 — ENTER INSTITUTION NAME ============== */
            <>
              <div>
                <h1 className="lg-card-title">Enter institution name</h1>
                <p className="lg-card-sub">
                  Type your institution's name to continue. New institution?
                  Use “Create institution” in the corner.
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
                onEnter={() => void enterInstitution()}
              />

              <button
                type="button"
                className="lg-btn lg-btn-filled lg-focusable"
                onClick={() => void enterInstitution()}
              >
                Continue
                <IconArrowRight />
              </button>
            </>
          ) : step === "create" ? (
            /* ========== SCREEN 2 — CREATE INSTITUTION (own page) ======= */
            <>
              <div>
                <h1 className="lg-card-title">Create institution</h1>
                <p className="lg-card-sub">
                  Register a new institution on this device — its name becomes
                  the app's name here. You'll sign in right after.
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
                    Creating…
                  </>
                ) : (
                  <>
                    <IconBuilding size={18} />
                    Create institution
                  </>
                )}
              </button>
            </>
          ) : (
            /* ================= SCREEN 3 — SIGN IN ====================== */
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
                    setStep("enter");
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
                label="Username"
                value={username}
                onChange={(v) => {
                  setUsername(v);
                  setUsernameError(false);
                }}
                autoComplete="username"
                autoCapitalize="none"
                icon={<IconPerson />}
                error={usernameError}
                disabled={busy}
                onEnter={() => {
                  if (busy) return;
                  if (password) void finishSignIn();
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
                  if (!busy) void finishSignIn();
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
                className="lg-btn lg-btn-filled lg-focusable"
                onClick={() => void finishSignIn()}
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
