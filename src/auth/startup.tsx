/* ============================================================================
   src/auth/startup.tsx — v4: ONE LOADING PAGE + SESSION GATE (Material Design 3)
   ============================================================================

   WHAT THIS FILE IS

   The ONE loading page of the app. A quiet progress bar, then a hand-over
   that happens IN PLACE — no second loading screen, no reload bounce:

     • Signed out → the login card (Login.tsx) replaces this splash directly
       in the component tree. Zero navigation, zero reload — the boot ever
       shows this single loading page.
     • Signed in  → the sync engine starts and the splash routes to the
       role's home (admin/owner → /admin, trainer → /trainer, else /).

   NO BRANDING

   No product logo, no product name, no slogans. The only title ever shown
   is the INSTITUTION name the user set on the login screen (if one exists).

   WHY IT CANNOT HANG

     1. The session check is a plain localStorage read done BEFORE any
        database work — the login card appears in milliseconds.
     2. db.open() is raced against a 2.5 s cap (a blocked IndexedDB cannot
        stall the boot).
     3. HARD DEADLINE (6 s) — registered before any async work; a full-page
        redirect follows if we are somehow still mounted.
     4. Every full-page redirect is GUARDED (one per target per 10 s) — a
        broken router can never turn the boot into a reload loop.
     5. "Skip" escape button appears after 3 s.
     6. Footer stamps the boot version ("boot v4") so a stale deployed
        bundle is instantly recognizable.

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
const BOOT_VERSION = "v4";
/** One full-page redirect per target per 10 s — shared with Login.tsx so a
 *  broken router can never cause a reload loop. */
const REDIRECT_GUARD_KEY = "sp_last_redirect";

/** Institution name saved by Login.tsx; legacy "MedStat" → treated as none. */
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
 * Last-resort full-page redirect. Guarded: the same target is only followed
 * ONCE per 10 s, so even completely broken routing can never loop.
 */
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

/* ============================================================================
   MD3 DESIGN TOKENS
============================================================================ */

const C = {
  primary: "#0B57D0",
  primaryDeep: "#0842A0",
  primaryContainer: "#D3E3FD",

  background: "#F8FAFD",
  surfaceVariant: "#E9EEF6",
  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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
.st-title {
  font-size: clamp(22px, 6vw, 28px);
  font-weight: 600; letter-spacing: 0.2px;
  color: ${C.onSurface};
  word-break: break-word;
  line-height: 1.25;
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
  .st-progress-track { margin-top: 16px; }
  .st-status { margin-top: 8px; }
  .st-skip { margin-top: 4px; min-height: 36px; }
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
   <Startup /> — default export
============================================================================ */

function Startup(props: StartupProps) {
  const navigate = useNavigate();

  const [appName, setAppName] = useState(""); // institution name; empty = none
  const [status, setStatus] = useState("Getting ready…");
  const [skipReady, setSkipReady] = useState(false);
  const routed = useRef(false);

  // Already heading to the login card (e.g. opened on /login)? Render it
  // immediately — no splash at all, exactly one screen.
  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      return /login|signin|sign-in/i.test(window.location.pathname);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    console.info(`[Startup] boot ${BOOT_VERSION}`);

    // Show the login card directly? Then there is nothing to boot.
    if (showLogin) return;

    let cancelled = false;
    const startedAt = Date.now();
    const minSplash = props.minSplashMs ?? 600;
    const timeoutMs = props.timeoutMs ?? 6000;

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

    /* 1. HARD DEADLINE — registered BEFORE any async work. --------------- */
    const hardDeadline = window.setTimeout(() => {
      if (cancelled) return;
      const target = routeBySession();
      if (target === "/login") {
        setShowLogin(true); // in-place, no reload
      } else {
        fullPageRedirect(target);
      }
    }, timeoutMs);

    /* 2. Skip escape hatch, visible after 3 s. -------------------------- */
    const skipTimer = window.setTimeout(() => setSkipReady(true), 3000);

    const onAuthChanged = () => {
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) setShowLogin(true);
    };
    window.addEventListener("authStateChanged", onAuthChanged);

    (async () => {
      // The institution name is the ONLY title this splash ever shows.
      const brand = brandFromSettings();
      if (brand) setAppName(brand);

      // 3. Session gate FIRST — a plain localStorage read, instant. Signed
      //    out? The login card replaces this splash IN PLACE: no navigation,
      //    no reload, so the user only ever sees this one loading page.
      const token = localStorage.getItem("authToken");
      const cu = readCurrentUser();
      if (!token || !cu?.id) {
        try {
          localStorage.removeItem("authToken");
          localStorage.removeItem("currentUser");
        } catch {
          /* ignore */
        }
        setShowLogin(true);
        return;
      }

      // 4. Signed in — open the local database, but NEVER wait more than
      //    2.5 s on it (a blocked IndexedDB cannot stall the boot).
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

      // 5. Start the always-draining engine (idempotent — safe to re-call)
      //    and refresh online sessions once.
      try {
        startPeriodicPull();
      } catch {
        /* ignore */
      }
      const offlineSession = token === OFFLINE_LOGIN_TOKEN;
      if (!offlineSession && typeof navigator !== "undefined" && navigator.onLine && cu.tenantId) {
        setStatus("Syncing your data…");
        try {
          void syncNow(cu.tenantId).catch(() => {});
        } catch {
          /* ignore */
        }
      }

      const target = routeForRole(cu.role, props.routes);
      finish(target);
      // Same insurance for the signed-in path: if SPA navigation did not
      // happen, ONE guarded full-page redirect follows.
      window.setTimeout(() => {
        if (cancelled) return;
        try {
          const here = window.location.pathname + window.location.hash;
          if (here.endsWith(target)) return; // navigation worked
        } catch {
          /* ignore */
        }
        fullPageRedirect(target);
      }, 2000);
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(hardDeadline);
      window.clearTimeout(skipTimer);
      window.removeEventListener("authStateChanged", onAuthChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showLogin]);

  const skip = () => {
    const target = routeBySessionPublic();
    if (target === "/login") setShowLogin(true);
    else fullPageRedirect(target);
  };
  function routeBySessionPublic(): string {
    const token = localStorage.getItem("authToken");
    const cu = readCurrentUser();
    if (!token || !cu?.id) return "/login";
    return routeForRole(cu.role, props.routes);
  }

  // The login card (institution setup + sign-in), rendered IN PLACE —
  // the splash simply becomes the login screen. One page, no reload.
  if (showLogin) {
    return <Login routes={props.routes} />;
  }

  return (
    <div className="st-root">
      <style>{CSS}</style>
      <div className="st-col">
        {appName ? <div className="st-title">{appName}</div> : null}

        <div className="st-progress-track" role="progressbar" aria-label="Loading">
          <div className="st-progress-bar" />
        </div>
        <div className="st-status">{status}</div>

        {skipReady && (
          <button type="button" className="st-skip" onClick={skip}>
            Skip
          </button>
        )}
      </div>
      <div className="st-footer">boot {BOOT_VERSION}</div>
    </div>
  );
}

export default Startup;
export { Startup };
