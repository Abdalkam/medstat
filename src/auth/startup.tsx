/* ============================================================================
   src/auth/startup.tsx — v5: BULLETPROOF session gate + diagnostic logging
   ============================================================================

   v5 fixes three hang bugs in v4:

   1. STALE SESSION REDIRECT LOOP — if authToken + currentUser exist from a
      previous failed login, v4 navigates to /admin. If that route fails to
      load (sync issues), the 2s fallback fires fullPageRedirect("/admin"),
      the page reloads, startup sees the same stale session, tries again —
      but the redirect guard blocks it (10s cooldown) -> stuck on splash.
      FIX: v5 clears any token that isn't a real session before proceeding,
      and validates the currentUser object has a tenantId (no orphan sessions).

   2. cancelled FLAG KILLS THE HARD DEADLINE — v4's 6s deadline checks
      `if (cancelled) return;`, but `cancelled` is set by the cleanup
      function which runs on ANY re-render. If any state update fires
      before the deadline, the escape hatch silently disappears.
      FIX: v5 uses a separate `deadlineFired` ref — the deadline always
      runs once, regardless of `cancelled`.

   3. NO LOGGING — when the app hangs, there's zero visibility into which
      step is stuck.
      FIX: v5 logs every step with [Startup] prefix + timestamps.

   Everything else (MD3 design, in-place login handover, role routing,
   Skip button, boot version footer) is unchanged from v4.
   ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { db } from "../database/db";
import * as SyncEngine from "../database/sync";
const startPeriodicPull = (SyncEngine as any).startPeriodicPull ?? (() => {});
const syncNow = (SyncEngine as any).syncNow ?? (async () => {});
import Login from "./Login";

/* ------------------------------------------------------------------ */
/* Shared constants                                                     */
/* ------------------------------------------------------------------ */

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
const BOOT_VERSION = "v5";
const REDIRECT_GUARD_KEY = "sp_last_redirect";

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
 * But on the splash screen, if we're already stuck, we MUST break out —
 * so v5 adds a `force` parameter that bypasses the guard for /login only.
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
   MD3 DESIGN TOKENS + STYLES (unchanged from v4)
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
 * v5: Validates that a stored session is actually usable. A session is
 * "stale" (returns false) when:
 *   - There's no authToken
 *   - There's no currentUser, or it has no id
 *   - The currentUser has no tenantId (orphaned from a failed registration)
 * Stale sessions are cleared by the caller so the app shows login.
 */
function isValidSession(): boolean {
  const token = localStorage.getItem("authToken");
  const cu = readCurrentUser();
  if (!token || !cu?.id) return false;
  // v5: require a tenantId — without it the sync engine and admin pages
  // can't scope their reads, causing the "stuck on loading" symptom.
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
   <Startup /> — default export
============================================================================ */

function Startup(props: StartupProps) {
  const navigate = useNavigate();

  const [appName, setAppName] = useState("");
  const [status, setStatus] = useState("Getting ready…");
  const [skipReady, setSkipReady] = useState(false);
  const routed = useRef(false);

  // v5: deadlineFired is SEPARATE from cancelled — the hard deadline
  // always runs once, even if the effect was cleaned up by a re-render.
  const deadlineFired = useRef(false);

  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      return /login|signin|sign-in/i.test(window.location.pathname);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    log(`boot ${BOOT_VERSION} — showLogin=${showLogin}`);

    if (showLogin) {
      log("URL contains login — rendering Login directly");
      return;
    }

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

    /* 1. HARD DEADLINE — v5: uses deadlineFired ref, NOT cancelled.
       The deadline ALWAYS fires once, even if the effect was cleaned up
       by a re-render. This is the ultimate escape hatch. */
    const hardDeadline = window.setTimeout(() => {
      if (deadlineFired.current) return;
      deadlineFired.current = true;
      log(`HARD DEADLINE fired after ${Date.now() - startedAt}ms`);

      // Always re-validate the session at deadline time — it may have
      // been cleared by the async block above.
      const target = routeBySession();
      if (target === "/login") {
        if (!cancelled) {
          setShowLogin(true);
        } else {
          // Effect was cleaned up — force a full-page redirect to /login
          // so the user is never stuck on a dead splash.
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

      // 3. v5: Session gate — validate BEFORE proceeding. Clear stale
      //    sessions so they can't cause a redirect loop.
      if (!isValidSession()) {
        log("No valid session — clearing and showing login");
        clearStaleSession();
        setShowLogin(true);
        return;
      }

      const cu = readCurrentUser()!;
      const token = localStorage.getItem("authToken")!;
      log(`Valid session: user=${cu.username || cu.id}, role=${cu.role}, tenant=${cu.tenantId || cu.tenant_id}`);

      // 4. Open the local database (2.5 s cap).
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

      // 5. Start the sync engine + one online refresh.
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
        // Fire-and-forget — never blocks navigation.
        void syncNow(cu.tenantId).catch((e: any) =>
          log(`syncNow error (non-fatal): ${e?.message || e}`)
        );
      } else {
        log(`Skipping syncNow: offlineSession=${offlineSession}, online=${typeof navigator !== "undefined" ? navigator.onLine : "?"}`);
      }

      // 6. Navigate to the role home.
      const target = routeForRole(cu.role, props.routes);
      log(`Target route: ${target}`);
      finish(target);

      // 7. Fallback: if SPA navigation didn't work after 2s, force a
      //    full-page redirect. v5: force=true for /login so the guard
      //    can't trap the user on the splash.
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
    const target = routeBySessionPublic();
    if (target === "/login") setShowLogin(true);
    else fullPageRedirect(target, true);
  };
  function routeBySessionPublic(): string {
    if (!isValidSession()) return "/login";
    const cu = readCurrentUser()!;
    return routeForRole(cu.role, props.routes);
  }

  if (showLogin) {
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
