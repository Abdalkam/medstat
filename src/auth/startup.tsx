/* ============================================================================
   src/auth/startup.tsx — v7: institution gate enforcement
   ============================================================================

   v7 changes (on top of v6):

   - Institution check runs on EVERY boot without a valid session — even
     when the URL points directly at /login. The login screen can only
     render after the gate confirms an institution exists (Supabase or
     local DB).
   - Login is gated behind `gateResolved` — no more fallback-to-login
     when navigation goes sideways.
   - Register navigation has a loop guard (missing route detection).
   - Local DB check logs the actual table names for diagnosis.

   v5 fixes still in effect: stale-session clearing, hard deadline via
   deadlineFired ref, [Startup] diagnostic logging.
   ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { db } from "../database/db";
import * as SyncEngine from "../database/sync";
const startPeriodicPull = (SyncEngine as any).startPeriodicPull ?? (() => {});
const syncNow = (SyncEngine as any).syncNow ?? (async () => {});
import { supabase } from "./supabase";
import Login from "./Login";

/* ------------------------------------------------------------------ */
/* Shared constants                                                     */
/* ------------------------------------------------------------------ */

// ⚠️ MUST match the real registration route in your <Routes> definition
//    AND the REGISTER_ROUTE constant in Login.tsx. Run:
//      findstr /s /n /c:"<Route" src\*.tsx
//    to see every route your app actually has.
const REGISTER_ROUTE = "/register";

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
const BOOT_VERSION = "v7";
const REDIRECT_GUARD_KEY = "sp_last_redirect";
const REGISTER_NAV_GUARD = "sp_register_nav";

function log(msg: string): void {
  console.info(`[Startup ${BOOT_VERSION}] ${msg}`);
}

/** Institution name saved by Login.tsx; legacy "MedStat" -> treated as none. */
export function brandFromSettings(): string | null {
  try {
    const parsed = JSON.parse(
      localStorage.getItem("localBusinessSettings") || "null"
    );
    const name = parsed?.businessName ? String(parsed.businessName).trim() : "";
    if (!name) return null;
    if (name.toLowerCase() === "medstat") return null;
    return name;
  } catch {
    return null;
  }
}

/**
 * Guarded full-page redirect: same target only followed ONCE per 10 s.
 * `force` bypasses the guard (used for /login escapes).
 */
function fullPageRedirect(target: string, force = false): void {
  try {
    const last = JSON.parse(
      sessionStorage.getItem(REDIRECT_GUARD_KEY) || "null"
    );
    if (!force && last && last.target === target && Date.now() - last.ts < 10000) {
      log(`Redirect to ${target} blocked by 10s guard (already redirected recently)`);
      return;
    }
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
  log(`Full-page redirect -> ${target}${force ? " (forced)" : ""}`);
  window.location.assign(target);
}

/* ============================================================================
   MD3 DESIGN TOKENS + STYLES
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

const CSS = `
.st-root {
  min-height: 100vh; min-height: 100dvh;
  box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  background: radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, ${C.background} 55%, #EEF3FB 100%);
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
   TYPES + ROLE ROUTING
============================================================================ */

export interface HomeRoutes {
  admin?: string;
  trainer?: string;
  member?: string;
}

export interface StartupProps {
  routes?: HomeRoutes;
  minSplashMs?: number;
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

/**
 * Validates that a stored session is actually usable (has token, user id,
 * and tenantId). Stale sessions are cleared by the caller.
 */
function isValidSession(): boolean {
  const token = localStorage.getItem("authToken");
  const cu = readCurrentUser();
  if (!token || !cu?.id) return false;
  const tid = cu.tenantId || cu.tenant_id;
  if (!tid) {
    log("Session has no tenantId — clearing stale session");
    return false;
  }
  return true;
}

function clearStaleSession(): void {
  try {
    localStorage.removeItem("authToken");
    localStorage.removeItem("token");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("activeTenantId");
  } catch {
    /* ignore */
  }
}

/* ============================================================================
   INSTITUTION AVAILABILITY CHECK
============================================================================ */

/** Supabase: does ANY tenant exist? Never throws. */
async function supabaseHasInstitution(): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("id")
      .limit(1);
    if (error) {
      log(`tenants query error: ${error.message}`);
      return false;
    }
    return Array.isArray(data) && data.length > 0;
  } catch (e: any) {
    log(`tenants query threw: ${e?.message || e}`);
    return false;
  }
}

/**
 * Local DB: does ANY tenant/business row exist? Logs the actual table
 * names so mismatches are visible in the console.
 */
async function localHasInstitution(): Promise<boolean> {
  try {
    const tables: any[] = ((db as any).tables || []) as any[];
    const names = tables.map((t) => String(t?.name || ""));
    log(`Local tables: ${names.join(", ") || "(none)"}`);
    const tenantTable = tables.find((t) =>
      /tenant|business|institution/i.test(String(t?.name || ""))
    );
    if (!tenantTable) {
      log("No local tenant-like table found (institution lives in Supabase only?)");
      return false;
    }
    const count = await tenantTable.count();
    return count > 0;
  } catch (e: any) {
    log(`local tenant check failed: ${e?.message || e}`);
    return false;
  }
}

/**
 * Institution is "available" if it exists in Supabase OR the local DB.
 * The Supabase check is capped at ~3 s; a timeout counts as "not found".
 */
async function institutionExists(): Promise<boolean> {
  const [online, local] = await Promise.all([
    Promise.race([
      supabaseHasInstitution(),
      new Promise<boolean>((res) => window.setTimeout(() => res(false), 3000)),
    ]),
    localHasInstitution().catch(() => false),
  ]);
  log(`institution check: supabase=${online}, local=${local}`);
  return online || local;
}

/* ============================================================================
   <Startup /> — default export
============================================================================ */

function Startup(props: StartupProps) {
  const navigate = useNavigate();

  const [appName, setAppName] = useState("");
  const [status, setStatus] = useState("Getting ready…");
  const [skipReady, setSkipReady] = useState(false);
  const routed = useRef(false);
  const deadlineFired = useRef(false);

  // v7: the institution gate must resolve before Login may render.
  const [gateResolved, setGateResolved] = useState(false);
  const gateResolvedRef = useRef(false);

  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      return /login|signin|sign-in/i.test(window.location.pathname);
    } catch {
      return false;
    }
  });

  const [showRegister, setShowRegister] = useState(false);

  useEffect(() => {
    log(`boot ${BOOT_VERSION} — showLogin=${showLogin}`);

    let cancelled = false;
    const startedAt = Date.now();
    const minSplash = props.minSplashMs ?? 600;
    const timeoutMs = props.timeoutMs ?? 6000;

    const routeBySession = (): string => {
      if (!isValidSession()) return "/login";
      const cu = readCurrentUser()!;
      return routeForRole(cu.role, props.routes);
    };

    const finish = (path: string) => {
      if (routed.current || cancelled) return;
      routed.current = true;
      const wait = Math.max(0, minSplash - (Date.now() - startedAt));
      log(`finish -> ${path} (waiting ${wait}ms for minSplash)`);
      window.setTimeout(() => {
        if (!cancelled) {
          log(`navigate(${path})`);
          navigate(path, { replace: true });
        }
      }, wait);
    };

    /* 1. HARD DEADLINE — always fires once via deadlineFired ref.
       As an escape hatch it may reveal Login, but it also resolves the
       gate so the Login render isn't blocked. */
    const hardDeadline = window.setTimeout(() => {
      if (deadlineFired.current) return;
      deadlineFired.current = true;
      log(`HARD DEADLINE fired after ${Date.now() - startedAt}ms`);

      const target = routeBySession();
      if (target === "/login") {
        if (!cancelled) {
          log("Deadline escape: revealing login (gate resolved by force)");
          gateResolvedRef.current = true;
          setGateResolved(true);
          setShowLogin(true);
        } else {
          fullPageRedirect("/login", true);
        }
      } else {
        fullPageRedirect(target);
      }
    }, timeoutMs);

    /* 2. Skip escape hatch, visible after 3 s. */
    const skipTimer = window.setTimeout(() => setSkipReady(true), 3000);

    const onAuthChanged = () => {
      log("authStateChanged event");
      if (!isValidSession()) {
        log("Session invalid after authStateChanged — showing login");
        setShowLogin(true);
      }
    };
    window.addEventListener("authStateChanged", onAuthChanged);

    (async () => {
      // The institution name is the ONLY title this splash ever shows.
      const brand = brandFromSettings();
      if (brand) {
        log(`Institution: ${brand}`);
        setAppName(brand);
      }

      /* 3. SESSION GATE — valid session goes straight to role home. */
      if (isValidSession()) {
        const cu = readCurrentUser()!;
        const token = localStorage.getItem("authToken")!;
        log(`Valid session: user=${cu.username || cu.id}, role=${cu.role}, tenant=${cu.tenantId || cu.tenant_id}`);

        // Open the local database (2.5 s cap).
        setStatus("Opening local database…");
        try {
          await Promise.race([
            db.open().catch((e: any) => log(`db.open error: ${e?.message || e}`)),
            new Promise((res) => window.setTimeout(res, 2500)),
          ]);
          log("Database ready");
        } catch (e: any) {
          log(`Database open failed (non-fatal): ${e?.message || e}`);
        }
        if (cancelled) return;

        try {
          startPeriodicPull();
          log("Periodic pull started");
        } catch (e: any) {
          log(`startPeriodicPull error: ${e?.message || e}`);
        }

        const offlineSession = token === OFFLINE_LOGIN_TOKEN || token.startsWith("offline-");
        if (!offlineSession && typeof navigator !== "undefined" && navigator.onLine && cu.tenantId) {
          setStatus("Syncing your data…");
          log("Starting syncNow (fire-and-forget)…");
          void syncNow(cu.tenantId).catch((e: any) =>
            log(`syncNow error (non-fatal): ${e?.message || e}`)
          );
        } else {
          log(`Skipping syncNow: offlineSession=${offlineSession}, online=${typeof navigator !== "undefined" ? navigator.onLine : "?"}`);
        }

        const target = routeForRole(cu.role, props.routes);
        log(`Target route: ${target}`);
        finish(target);

        window.setTimeout(() => {
          if (cancelled) return;
          try {
            const here = window.location.pathname + window.location.hash;
            if (here.endsWith(target)) {
              log("Navigation confirmed — URL matches target");
              return;
            }
          } catch {
            /* ignore */
          }
          log(`Navigation fallback: SPA nav didn't land on ${target} — forcing redirect`);
          fullPageRedirect(target, target === "/login");
        }, 2000);
        return;
      }

      /* 4. INSTITUTION GATE (v7) — no valid session. Login may ONLY
         appear if an institution exists in Supabase or the local DB.
         This runs even when the URL was already /login. */
      log("No valid session — checking for an institution…");
      clearStaleSession();
      if (!showLogin) setStatus("Checking for an institution…");

      if (!gateResolvedRef.current) {
        const found = await institutionExists();
        if (cancelled) return;
        gateResolvedRef.current = true;

        if (!found) {
          log("No institution available — login is blocked, routing to registration");

          // Loop guard: if we already tried navigating to the register
          // route recently and ended up back here, the route is probably
          // missing — break the loop instead of spinning forever.
          let justTried = false;
          try {
            const last = JSON.parse(
              sessionStorage.getItem(REGISTER_NAV_GUARD) || "null"
            );
            justTried = !!(last && Date.now() - last.ts < 10000);
          } catch {
            /* ignore */
          }
          try {
            sessionStorage.setItem(
              REGISTER_NAV_GUARD,
              JSON.stringify({ ts: Date.now() })
            );
          } catch {
            /* ignore */
          }

          if (justTried) {
            log(
              "REGISTER LOOP DETECTED — the register route is likely missing " +
              `from your <Routes>. Check REGISTER_ROUTE ("${REGISTER_ROUTE}") ` +
              "against your router definition. Falling back to login."
            );
            setGateResolved(true);
            setShowLogin(true);
            return;
          }

          setShowRegister(true);
          return;
        }

        log("Institution available — login allowed");
      } else {
        log("Institution gate already resolved — institution available");
      }

      // Institution exists -> Login may render (in-place or via URL).
      setGateResolved(true);
      if (!showLogin) setShowLogin(true);
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
    log("Skip button clicked");
    if (isValidSession()) {
      const target = routeForRole(readCurrentUser()!.role, props.routes);
      fullPageRedirect(target, true);
    }
    // No valid session: the institution gate decides login vs register.
  };

  if (showRegister) {
    log("Rendering registration flow");
    return <Navigate to={REGISTER_ROUTE} replace />;
  }

  if (showLogin && gateResolved) {
    log("Rendering <Login /> in-place");
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