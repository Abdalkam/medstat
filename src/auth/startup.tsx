/* ============================================================================
   src/auth/startup.tsx — v1: BOOT SPLASH + SESSION GATE + SYNC BOOTSTRAP
   ============================================================================

   WHAT THIS FILE IS

   The professional Android (MD3) splash screen the app shows for the instant
   between launch and the first real screen. It is built in the same Material
   Design 3 language as CourseManagement.tsx / login.tsx (same palette,
   shadows, motion) and adapts to ANY device screen size:

     • phones / tablets / desktops → centered brand column, clamp() sizing
     • landscape phones            → compact layout via @media (max-height)
     • notched devices             → env(safe-area-inset-*) padding
     • prefers-reduced-motion      → animations disabled

   BOOT SEQUENCE (offline-first):

     1. Open the local Dexie database (the app's source of truth).
     2. Restore the session from localStorage:
          authToken + currentUser  → start the sync engine (startPeriodicPull),
          drain queued work (syncNow) for real sessions, then route to the
          role home (admin → /admin, trainer → /trainer, others → /).
          "offline-mode-pending-sync" token → same routing, but cloud work is
          skipped (database/sync.ts already guards that token).
        no session → clean stale keys and route to /login.
     3. Safety net: even if a step hangs, the splash NEVER traps the user —
        after a few seconds it routes anyway.
     4. If another tab logs out while the splash is up (authStateChanged),
        the destination re-evaluates to /login.

   ROUTING / INTEGRATION

     • Default export <Startup /> (named export Startup too) — make it the
       first route so every launch passes through it:
           <Route path="/" element={<Startup />} />
           <Route path="/startup" element={<Startup />} />
     • Optional overrides:
           <Startup routes={{ admin: "/admin", trainer: "/trainer", member: "/" }} />
           <Startup minSplashMs={700} />
     • Exported helpers: routeForRole(), readCurrentUser().
   ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { db } from "../database/db";
import { startPeriodicPull, syncNow } from "../database/sync";

/* ------------------------------------------------------------------ */
/* Shared constants — identical values to database/sync.ts / Login.tsx */
/* ------------------------------------------------------------------ */

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";

/* ============================================================================
   MD3 DESIGN TOKENS — identical to CourseManagement.tsx / login.tsx
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
  /** Minimum time the splash stays visible (ms) — keeps the boot from flashing. */
  minSplashMs?: number;
  /** Give up waiting on the boot sequence after this many ms and route anyway. */
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
   MD3 STYLE SHEET
   st- = startup namespace.
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
/* Landscape phones: pull the block up, shrink rhythm */
@media (max-height: 520px) and (orientation: landscape) {
  .st-col { padding-top: 10px; padding-bottom: 10px; }
  .st-logo { width: 52px; height: 52px; border-radius: 18px; margin-bottom: 12px; }
  .st-progress-track { margin-top: 16px; }
  .st-status { margin-top: 8px; }
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

  const [appName, setAppName] = useState("MedStat");
  const [status, setStatus] = useState("Preparing your workspace…");
  const [offline, setOffline] = useState(
    typeof navigator !== "undefined" ? !navigator.onLine : false
  );
  const routed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();
    const minSplash = props.minSplashMs ?? 700;
    const timeoutMs = props.timeoutMs ?? 6000;

    const finish = (path: string) => {
      if (routed.current || cancelled) return;
      routed.current = true;
      const wait = Math.max(0, minSplash - (Date.now() - startedAt));
      window.setTimeout(() => {
        if (!cancelled) navigate(path, { replace: true });
      }, wait);
    };

    const markOnline = () => setOffline(false);
    const markOffline = () => setOffline(true);
    window.addEventListener("online", markOnline);
    window.addEventListener("offline", markOffline);

    // Another tab/device session change while the splash is up:
    const onAuthChanged = () => {
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) finish("/login");
    };
    window.addEventListener("authStateChanged", onAuthChanged);

    (async () => {
      try {
        const settings = localStorage.getItem("localBusinessSettings");
        if (settings) {
          const parsed = JSON.parse(settings);
          if (parsed?.businessName) setAppName(String(parsed.businessName));
        }
      } catch {
        /* ignore */
      }

      // 1. Local database first — the app's source of truth.
      setStatus("Opening local database…");
      try {
        await db.open();
      } catch {
        /* Dexie already open (or blocked) — the screens handle their own reads */
      }
      if (cancelled) return;

      // 2. Session gate.
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) {
        try {
          localStorage.removeItem("authToken");
          localStorage.removeItem("currentUser");
        } catch {
          /* ignore */
        }
        setStatus("Checking for a saved session…");
        finish("/login");
        return;
      }

      // 3. Start the always-draining engine (idempotent — safe to re-call).
      startPeriodicPull();
      const offlineSession = token === OFFLINE_LOGIN_TOKEN;
      if (offlineSession) {
        setStatus("Offline mode — your data is safe on this device");
      } else if (typeof navigator !== "undefined" && navigator.onLine && cu.tenantId) {
        setStatus("Syncing your data…");
        void syncNow(cu.tenantId).catch(() => {
          /* sync errors surface in the dashboard status chips */
        });
      }

      finish(routeForRole(cu.role, props.routes));

      // 4. Safety net — the splash must never trap anyone.
      window.setTimeout(() => {
        if (!cancelled && !routed.current) {
          routed.current = true;
          navigate(routeForRole(cu.role, props.routes), { replace: true });
        }
      }, timeoutMs);
    })();

    return () => {
      cancelled = true;
      window.removeEventListener("online", markOnline);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("authStateChanged", onAuthChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <div className="st-footer">Offline-first · sign in works with or without internet</div>
    </div>
  );
}
