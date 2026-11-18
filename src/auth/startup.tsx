/* ============================================================================
   src/auth/startup.tsx — v2.1: CANNOT-FAIL BOOT SPLASH + SESSION GATE (MD3)
   ============================================================================

   WHAT THIS FILE IS

   The Material Design 3 splash screen between launch and the first screen.
   v2.1 exists for one reason: the user must NEVER be trapped here.

   HOW v2.1 GUARANTEES YOU ALWAYS REACH A SCREEN

     1. HARD DEADLINE (6 s) — registered before any async work. If we are
        somehow still mounted, it does a FULL-PAGE redirect (window.location,
        not SPA navigation — SPA navigate() can silently fail when a route
        is missing).
     2. db.open() is raced against a 2.5 s cap (blocked IndexedDB cannot
        stall the boot).
     3. If the session gate finds no session and SPA navigation to /login
        does not unmount us within 1.5 s, we force a full-page redirect to
        the app root with a sessionStorage flag — and on the next boot the
        flag renders the LOGIN CARD INLINE, so you reach the sign-in screen
        (with the Institution name field) even if the router is wired wrong.
     4. A visible version stamp ("boot v2.1") in the footer + a console log
        make it obvious WHICH build is running. If the splash does not say
        v2.1, the browser is still serving the old bundle: rebuild + hard
        refresh.

   BRAND

     Always "SmartPages" unless a real institution name was created on the
     login screen. A legacy "MedStat" value in localStorage is ignored.

   ROUTING / INTEGRATION (unchanged API)

     • Default export <Startup /> (named export Startup too).
     • Optional: <Startup routes={{...}} minSplashMs={600} timeoutMs={6000} />
     • Exported helpers: routeForRole(), readCurrentUser(), brandFromSettings().
   ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { db } from "../database/db";
// Defensive sync import: compiles against ANY sync.ts — if it doesn't export
// these names, the calls become safe no-ops instead of build errors.
import * as SyncEngine from "../database/sync";
const startPeriodicPull = (SyncEngine as any).startPeriodicPull ?? (() => {});
const syncNow = (SyncEngine as any).syncNow ?? (async () => {});
import Login from "./Login";

/* ------------------------------------------------------------------ */
/* Shared constants — identical values to database/sync.ts / Login.tsx */
/* ------------------------------------------------------------------ */

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
const FALLBACK_BRAND = "SmartPages";
const BOOT_VERSION = "v2.1";
const FORCE_LOGIN_KEY = "sp_force_login";

/** Institution name saved by Login.tsx; legacy "MedStat" → SmartPages. */
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

/**
 * Bulletproof way to reach the login card: remember the intent, then reload
 * the app at its root. On the next boot the flag makes Startup render the
 * login card INLINE — no router wiring can block it.
 */
function gotoLoginHard(): void {
  try {
    sessionStorage.setItem(FORCE_LOGIN_KEY, "1");
  } catch {
    /* ignore */
  }
  window.location.assign("/");
}

/* ============================================================================
   MD3 DESIGN TOKENS — identical to CourseManagement.tsx / Login.tsx
============================================================================ */

const C = {
  primary: "#0B57D0",
  onPrimaryContainer: "#041E49",
  primaryDeep: "#0842A0",
  primaryContainer: "#D3E3FD",

  background: "#F8FAFD",
  surfaceVariant: "#E9EEF6",
  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",

  green: "#146C2E",
  greenBg: "#E6F4EA",
  orange: "#B06000",
  orangeBg: "#FEF7E0",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const SHADOW = {
  level1: "0 1px 2px 0 rgba(0,0,0,0.10), 0 1px 3px 1px rgba(0,0,0,0.07)",
  level2: "0 1px 2px 0 rgba(0,0,0,0.12), 0 2px 6px 2px rgba(0,0,0,0.08)",
};

/* ============================================================================
   TYPES + ROLE ROUTING (same rule as Login.tsx)
============================================================================ */

export interface HomeRoutes {
  admin?: string;
  trainer?: string;
  member?: string;
}

export interface StartupProps {
  routes?: HomeRoutes;
  /** Minimum time the splash stays visible (ms). */
  minSplashMs?: number;
  /** HARD deadline: full-page redirect after this many ms, whatever is pending. */
  timeoutMs?: number;
}

type AnyUser = Record<string, any> & { id?: string };

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

/* ============================================================================
   INLINE SVG ICONS (no icon font dependency)
============================================================================ */

const iconProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function IconSchool({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="m2.5 9.5 9.5-5 9.5 5-9.5 5z" />
      <path d="M6.5 11.8V16c0 1.6 2.9 3 5.5 3s5.5-1.4 5.5-3v-4.2" />
      <path d="M21.5 9.5v5.5" />
    </svg>
  );
}

function IconCloudOn({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M17.5 18.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.1 11.7 3.5 3.5 0 0 0 6.5 18.5z" />
      <path d="m9 13 2.2 2.2L15.5 11" />
    </svg>
  );
}

function IconCloudOff({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...iconProps}>
      <path d="M17.5 18.5a4.5 4.5 0 0 0 .4-8.98A7 7 0 0 0 4.1 11.7 3.5 3.5 0 0 0 6.5 18.5z" />
      <line x1="3" y1="4" x2="21" y2="21" />
    </svg>
  );
}

/* ============================================================================
   MD3 STYLE SHEET — st- = startup namespace
============================================================================ */

const CSS = `
.st-root {
  min-height: 100vh; min-height: 100dvh;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, ${C.background} 55%, #EEF3FB 100%);
  font-family: ${FONT};
  color: ${C.onSurface};
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}
.st-col {
  display: flex; flex-direction: column; align-items: center;
  text-align: center;
  width: 100%; max-width: 460px;
  padding: clamp(16px, 4vh, 40px) clamp(18px, 5vw, 32px);
}
.st-logo {
  width: clamp(66px, 9vh, 84px); height: clamp(66px, 9vh, 84px);
  border-radius: 26px;
  background: ${C.primaryContainer};
  color: ${C.onPrimaryContainer};
  display: flex; align-items: center; justify-content: center;
  box-shadow: ${SHADOW.level2};
  margin-bottom: clamp(16px, 3vh, 26px);
}
.st-app-name {
  font-size: clamp(22px, 6vw, 28px);
  font-weight: 600; letter-spacing: 0.2px;
  color: ${C.onSurface};
}
.st-app-tag {
  font-size: clamp(12.5px, 3.4vw, 14px);
  color: ${C.onSurfaceVariant};
  letter-spacing: 0.3px;
  margin-top: 5px;
}
.st-progress-track {
  width: min(260px, 62vw);
  height: 5px;
  border-radius: 999px;
  background: ${C.surfaceVariant};
  overflow: hidden;
  margin-top: clamp(24px, 5.4vh, 44px);
  position: relative;
}
.st-progress-bar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 38%;
  border-radius: 999px;
  background: ${C.primary};
  animation: stSlide 1.15s cubic-bezier(0.45, 0, 0.55, 1) infinite;
}
@keyframes stSlide {
  0% { left: -38%; }
  100% { left: 100%; }
}
.st-status {
  font-size: 13.5px;
  color: ${C.onSurfaceVariant};
  margin-top: 14px;
  line-height: 1.5;
  min-height: 20px;
  transition: all 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.st-skip {
  margin-top: 10px;
  border: none;
  background: transparent;
  font-family: ${FONT};
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: ${C.primaryDeep};
  padding: 10px 18px;
  border-radius: 999px;
  cursor: pointer;
  min-height: 44px;
  transition: background 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.st-skip:hover { background: ${C.primaryContainer}; }
.st-chip {
  display: inline-flex; align-items: center; gap: 6px;
  height: 30px; padding: 0 14px 0 10px;
  border-radius: 999px;
  font-size: 12.5px; font-weight: 600; letter-spacing: 0.2px;
  margin-top: clamp(16px, 3.4vh, 26px);
  box-shadow: ${SHADOW.level1};
}
.st-footer {
  position: absolute;
  left: 0; right: 0;
  bottom: calc(10px + env(safe-area-inset-bottom));
  font-size: 11.5px;
  color: ${C.onSurfaceVariant};
  opacity: 0.75;
  text-align: center;
}
@media (max-height: 520px) and (orientation: landscape) {
  .st-col { padding-top: 10px; padding-bottom: 10px; }
  .st-logo { width: 52px; height: 52px; border-radius: 18px; margin-bottom: 12px; }
  .st-progress-track { margin-top: 16px; }
  .st-status { margin-top: 8px; }
  .st-skip { margin-top: 4px; min-height: 36px; }
  .st-chip { margin-top: 12px; }
  .st-footer { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .st-root *, .st-root *::before, .st-root *::after {
    transition: none !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
`;

/* ============================================================================
   <Startup /> — default export
============================================================================ */

export default function Startup(props: StartupProps) {
  const navigate = useNavigate();

  const [appName, setAppName] = useState(FALLBACK_BRAND);
  const [status, setStatus] = useState("Checking for a saved session…");
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const [skipReady, setSkipReady] = useState(false);
  const routed = useRef(false);

  // A previous boot decided router navigation is unreliable on this device —
  // render the login card INLINE right away, no navigation involved.
  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      if (sessionStorage.getItem(FORCE_LOGIN_KEY) === "1") {
        sessionStorage.removeItem(FORCE_LOGIN_KEY);
        return true;
      }
    } catch {
      /* ignore */
    }
    return false;
  });

  useEffect(() => {
    // Show the login card directly? Then there is nothing to boot.
    if (showLogin) return;

    let cancelled = false;
    const startedAt = Date.now();
    const minSplash = props.minSplashMs ?? 600;
    const timeoutMs = props.timeoutMs ?? 6000;

    console.info(`[Startup] boot ${BOOT_VERSION}`);

    /** Where should the user go, judging by what is saved right now? */
    const routeBySession = (): string => {
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) return "/login";
      return routeForRole(cu.role, props.routes);
    };

    const finish = (path: string) => {
      if (routed.current || cancelled) return;
      routed.current = true;
      const wait = Math.max(0, minSplash - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (!cancelled) navigate(path, { replace: true });
      }, wait);
    };

    /* 1. HARD DEADLINE — registered BEFORE any async work. Full-page
        redirect: works even when SPA navigation silently fails. -------- */
    const hardDeadline = window.setTimeout(() => {
      if (cancelled) return;
      const target = routeBySession();
      if (target === "/login") {
        gotoLoginHard();
      } else {
        window.location.assign(target);
      }
    }, timeoutMs);

    /* 2. Skip escape hatch, visible after 3 s. -------------------------- */
    const skipTimer = window.setTimeout(() => setSkipReady(true), 3000);

    const markOnline = () => setOffline(false);
    const markOffline = () => setOffline(true);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    const onAuthChanged = () => {
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) finish("/login");
    };
    window.addEventListener("authStateChanged", onAuthChanged);

    (async () => {
      const brand = brandFromSettings();
      if (brand) setAppName(brand);

      // 3. Local database first — but NEVER wait more than 2.5 s on it.
      setStatus("Opening local database…");
      try {
        await Promise.race([
          db.open().catch(() => {}),
          new Promise((res) => window.setTimeout(res, 2500)),
        ]);
      } catch {
        /* screens handle their own reads */
      }
      if (cancelled) return;

      // 4. Session gate.
      setStatus("Checking for a saved session…");
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) {
        try {
          localStorage.removeItem("authToken");
          localStorage.removeItem("currentUser");
        } catch {
          /* ignore */
        }

        // Already on a login-ish URL? Just show the login card inline —
        // no navigation, nothing that can fail.
        const path = window.location.pathname;
        if (/login|signin|sign-in/i.test(path)) {
          setShowLogin(true);
          return;
        }

        finish("/login");
        // If SPA navigation did not unmount us in 1.5 s, force it.
        window.setTimeout(() => {
          if (!cancelled) gotoLoginHard();
        }, 1500);
        return;
      }

      // 5. Start the always-draining engine (idempotent — safe to re-call).
      try {
        startPeriodicPull();
      } catch {
        /* sync chips surface engine errors later */
      }
      const offlineSession = token === OFFLINE_LOGIN_TOKEN;
      if (offlineSession) {
        setStatus("Offline mode — your data is safe on this device");
      } else if (typeof navigator !== "undefined" && navigator.onLine && cu.tenantId) {
        setStatus("Syncing your data…");
        try {
          void syncNow(cu.tenantId).catch(() => {});
        } catch {
          /* ignore */
        }
      }

      finish(routeForRole(cu.role, props.routes));
      // Same insurance for the signed-in path.
      window.setTimeout(() => {
        if (!cancelled) window.location.assign(routeForRole(cu.role, props.routes));
      }, 2000);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(hardDeadline);
      window.clearTimeout(skipTimer);
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("authStateChanged", onAuthChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogin]);

  const skip = () => {
    const target = routeBySessionPublic();
    if (target === "/login") gotoLoginHard();
    else window.location.assign(target);
  };
  function routeBySessionPublic(): string {
    const token = localStorage.getItem("authToken");
    const cu = readCurrentUser();
    if (!token || !cu?.id) return "/login";
    return routeForRole(cu.role, props.routes);
  }

  // The login card, rendered inline — reachable with ZERO navigation.
  if (showLogin) {
    return <Login routes={props.routes} />;
  }

  return (
    <div className="st-root">
      <style>{CSS}</style>
      <div className="st-col">
        <div className="st-logo"><IconSchool /></div>
        <div className="st-app-name">{appName}</div>
        <div className="st-app-tag">Attendance · Courses · Live classes</div>

        <div className="st-progress-track" role="progressbar" aria-label="Loading">
          <div className="st-progress-bar" />
        </div>
        <div className="st-status">{status}</div>

        {skipReady && (
          <button type="button" className="st-skip" onClick={skip}>
            Skip
          </button>
        )}

        {offline ? (
          <span className="st-chip" style={{ background: C.orangeBg, color: C.orange }}>
            <IconCloudOff />
            Offline — working from this device
          </span>
        ) : (
          <span className="st-chip" style={{ background: C.greenBg, color: C.green }}>
            <IconCloudOn />
            Connected — data will sync
          </span>
        )}
      </div>
      <div className="st-footer">SmartPages boot {BOOT_VERSION} · offline-first</div>
    </div>
  );
}
