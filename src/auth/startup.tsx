/* ============================================================================
   src/auth/startup.tsx — v7.1: institution gate enforcement + dialog
  ============================================================================ */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

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
//    AND the REGISTER_ROUTE constant in Login.tsx.
const REGISTER_ROUTE = "/register";

const OFFLINE_LOGIN_TOKEN = "offline-mode-pending-sync";
const BOOT_VERSION = "v7.1";
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
  surface: "#FFFFFF",
  surfaceVariant: "#E9EEF6",
  onSurface: "#1A1C1E",
  onSurfaceVariant: "#43474E",
};

const FONT =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const CSS = `
.st-root {
  position: fixed;
  inset: 0;
  width: 100%;
  min-height: 100vh;
  min-height: 100dvh;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  background: radial-gradient(120% 90% at 50% 0%, #FFFFFF 0%, ${C.background} 55%, #EEF3FB 100%);
  font-family: ${FONT};
  color: ${C.onSurface};
  padding: env(safe-area-inset-top) env(safe-area-inset-right)
           env(safe-area-inset-bottom) env(safe-area-inset-left);
  overflow: hidden;
  -webkit-tap-highlight-color: transparent;
  -webkit-font-smoothing: antialiased;
  user-select: none;
}
.st-main {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  width: 100%;
  padding: clamp(16px, 4vh, 40px) clamp(18px, 5vw, 32px);
}
.st-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  width: 100%;
  max-width: 460px;
}
.st-icon {
  width: clamp(64px, 18vw, 84px);
  height: clamp(64px, 18vw, 84px);
  border-radius: 24%;
  background: linear-gradient(135deg, ${C.primary} 0%, ${C.primaryDeep} 100%);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(30px, 8.5vw, 40px);
  font-weight: 500;
  letter-spacing: 0;
  box-shadow: 0 6px 18px rgba(11, 87, 208, 0.28);
  margin-bottom: clamp(20px, 4.5vh, 30px);
}
.st-title {
  font-size: clamp(22px, 6vw, 28px);
  font-weight: 500;
  letter-spacing: 0;
  color: ${C.onSurface};
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.25;
  max-width: 100%;
}
.st-spinner {
  width: clamp(34px, 8vw, 40px);
  height: clamp(34px, 8vw, 40px);
  margin-top: clamp(26px, 6vh, 46px);
  animation: stRotate 1.4s linear infinite;
}
.st-spinner-circle {
  stroke: ${C.primary};
  stroke-width: 4;
  stroke-linecap: round;
  fill: none;
  animation: stDash 1.4s ease-in-out infinite;
}
@keyframes stRotate { 100% { transform: rotate(360deg); } }
@keyframes stDash {
  0%   { stroke-dasharray: 1 113; stroke-dashoffset: 0; }
  50%  { stroke-dasharray: 85 113; stroke-dashoffset: -14; }
  100% { stroke-dasharray: 1 113; stroke-dashoffset: -113; }
}
.st-status {
  font-size: clamp(13px, 3.5vw, 14px);
  color: ${C.onSurfaceVariant};
  margin-top: 16px;
  line-height: 1.5;
  min-height: 20px;
  max-width: 100%;
  word-break: break-word;
  overflow-wrap: anywhere;
  transition: opacity 0.25s cubic-bezier(0.2, 0, 0, 1);
}
.st-skip {
  margin-top: 12px;
  border: none;
  background: transparent;
  font-family: ${FONT};
  font-size: 14px;
  font-weight: 600;
  letter-spacing: 0.3px;
  color: ${C.primary};
  padding: 10px 18px;
  border-radius: 999px;
  cursor: pointer;
  min-height: 44px;
  position: relative;
  overflow: hidden;
  transition: background 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.st-skip::after {
  content: "";
  position: absolute;
  inset: 0;
  background: currentColor;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.st-skip:hover { background: ${C.primaryContainer}; }
.st-skip:hover::after { opacity: 0.06; }
.st-skip:active::after { opacity: 0.14; }
.st-footer {
  flex: 0 0 auto;
  font-size: 11.5px;
  color: ${C.onSurfaceVariant};
  opacity: 0.7;
  text-align: center;
  padding: 8px 16px calc(10px + env(safe-area-inset-bottom));
  max-width: 100%;
}
@media (max-height: 520px) and (orientation: landscape) {
  .st-main { padding-top: 8px; padding-bottom: 8px; }
  .st-icon { width: 48px; height: 48px; font-size: 24px; margin-bottom: 12px; border-radius: 22%; }
  .st-spinner { margin-top: 16px; }
  .st-status { margin-top: 8px; }
  .st-skip { margin-top: 6px; min-height: 36px; }
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

const DIALOG_CSS = `
.infd-root {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  font-family: ${FONT};
  padding: 24px;
  box-sizing: border-box;
  z-index: 9999;
  -webkit-tap-highlight-color: transparent;
}
.infd-card {
  width: 100%;
  max-width: 380px;
  max-height: calc(100dvh - 48px);
  overflow-y: auto;
  background: ${C.surface};
  border-radius: 28px;
  padding: 28px 24px 20px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.25);
  text-align: center;
  animation: infdIn 0.28s cubic-bezier(0.2, 0, 0, 1);
}
@keyframes infdIn {
  from { opacity: 0; transform: scale(0.92) translateY(8px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}
.infd-icon {
  width: 56px;
  height: 56px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: ${C.primaryContainer};
  color: ${C.primary};
  display: flex;
  align-items: center;
  justify-content: center;
}
.infd-title {
  font-size: 20px;
  font-weight: 500;
  color: ${C.onSurface};
  margin: 0 0 12px;
  letter-spacing: 0;
  word-break: break-word;
}
.infd-message {
  font-size: 14px;
  line-height: 1.55;
  color: ${C.onSurfaceVariant};
  margin: 0 0 24px;
  word-break: break-word;
}
.infd-btn-primary {
  width: 100%;
  height: 48px;
  border: none;
  border-radius: 999px;
  background: ${C.primary};
  color: #fff;
  font-family: ${FONT};
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.3px;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: background 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.infd-btn-primary:hover { background: ${C.primaryDeep}; }
.infd-btn-primary::after {
  content: "";
  position: absolute;
  inset: 0;
  background: #fff;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.infd-btn-primary:active::after { opacity: 0.16; }
.infd-btn-secondary {
  width: 100%;
  height: 44px;
  margin-top: 8px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: ${C.primary};
  font-family: ${FONT};
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: background 0.2s cubic-bezier(0.2, 0, 0, 1);
}
.infd-btn-secondary:hover { background: ${C.primaryContainer}; }
.infd-btn-secondary::after {
  content: "";
  position: absolute;
  inset: 0;
  background: currentColor;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
}
.infd-btn-secondary:active::after { opacity: 0.14; }
@media (prefers-reduced-motion: reduce) {
  .infd-card { animation: none; }
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
   Supabase is the source of truth. Local cache is a fallback only.
============================================================================ */

export interface InstitutionInfo {
  exists: boolean;
  tenantId?: string;
  businessName?: string;
  source: "supabase" | "local";
}

/**
 * Supabase: returns the first tenant row (or null). Source of truth.
 * Never throws — returns { exists: false } on any failure.
 */
async function supabaseHasInstitution(): Promise<InstitutionInfo> {
  try {
    const { data, error } = await supabase
      .from("tenants")
      .select("id, business_name")
      .limit(1)
      .maybeSingle();

    if (error) {
      log(`tenants query error: ${error.message}`);
      return { exists: false, source: "supabase" };
    }
    if (!data) {
      return { exists: false, source: "supabase" };
    }
    return {
      exists: true,
      tenantId: String(data.id),
      businessName: data.business_name ?? "",
      source: "supabase",
    };
  } catch (e: any) {
    log(`tenants query threw: ${e?.message || e}`);
    return { exists: false, source: "supabase" };
  }
}

/**
 * Local fallback: checks the localStorage cache first (fast, no Dexie),
 * then scans Dexie tables for a tenant-like row.
 */
async function localHasInstitution(): Promise<InstitutionInfo> {
  // 1. localStorage cache (set by persistInstitutionToLocal on prior boots)
  try {
    const cachedTenantId = localStorage.getItem("institutionTenantId");
    if (cachedTenantId) {
      const cachedName = brandFromSettings() ?? "";
      log(`Local cache hit: tenantId=${cachedTenantId}, name=${cachedName || "(none)"}`);
      return {
        exists: true,
        tenantId: cachedTenantId,
        businessName: cachedName,
        source: "local",
      };
    }
  } catch {
    /* ignore */
  }

  // 2. Dexie tables (legacy / future-proof path)
  try {
    const tables: any[] = ((db as any).tables || []) as any[];
    const names = tables.map((t) => String(t?.name || ""));
    log(`Local tables: ${names.join(", ") || "(none)"}`);
    const tenantTable = tables.find((t) =>
      /tenant|business|institution/i.test(String(t?.name || ""))
    );
    if (!tenantTable) {
      log("No local tenant-like table found — relying on localStorage cache only");
      return { exists: false, source: "local" };
    }
    const count = await tenantTable.count();
    return { exists: count > 0, source: "local" };
  } catch (e: any) {
    log(`local tenant check failed: ${e?.message || e}`);
    return { exists: false, source: "local" };
  }
}

/**
 * Merge step: persist Supabase institution info into local cache so future
 * boots (and offline boots) can answer "yes" without hitting Supabase.
 * Does NOT clobber branding fields it doesn't own.
 */
function persistInstitutionToLocal(info: InstitutionInfo): void {
  try {
    if (info.tenantId) {
      localStorage.setItem("institutionTenantId", info.tenantId);
    }

    if (info.businessName) {
      let settings: Record<string, unknown> = {};
      try {
        settings = JSON.parse(
          localStorage.getItem("localBusinessSettings") || "{}"
        );
      } catch {
        /* ignore corrupt cache */
      }
      // Only overwrite the name; preserve logo, login_background, etc.
      settings.businessName = info.businessName;
      localStorage.setItem("localBusinessSettings", JSON.stringify(settings));
    }
  } catch {
    /* storage unavailable or full — non-fatal */
  }
}

/**
 * Sequential check with merge:
 *   1. Supabase (3s cap) — source of truth.
 *   2. If found, merge to local cache and return true.
 *   3. If not found (or timed out), fall back to local cache.
 */
async function institutionExists(): Promise<boolean> {
  log("Institution check — Supabase first (source of truth)");

  const online = await Promise.race([
    supabaseHasInstitution(),
    new Promise<InstitutionInfo>((res) =>
      window.setTimeout(
        () => res({ exists: false, source: "supabase" }),
        3000
      )
    ),
  ]);

  log(`institution check: supabase=${online.exists}`);

  if (online.exists) {
    // Merge: cache the authoritative answer locally.
    persistInstitutionToLocal(online);
    log(`Institution merged to local cache (tenantId=${online.tenantId}, name=${online.businessName || "(none)"})`);
    return true;
  }

  // Supabase didn't answer yes (timeout, network, or genuinely no tenants).
  // Fall back to local cache so the app still works offline.
  const local = await localHasInstitution();
  log(`institution check: local fallback=${local.exists}`);
  return local.exists;
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

  // v7.1: institution check result — drives the hard-deadline escape.
  // "pending" until institutionExists() resolves; "found"/"not-found" after.
  const institutionCheckResult = useRef<"pending" | "found" | "not-found">("pending");

  // v7: the institution gate must resolve before Login may render.
  const [gateResolved, setGateResolved] = useState(false);
  const gateResolvedRef = useRef(false);

  // v7.1: replaces showRegister. Login is hard-blocked when this is true.
  const [showInstitutionNotFound, setShowInstitutionNotFound] = useState(false);

  const [showLogin, setShowLogin] = useState<boolean>(() => {
    try {
      return /login|signin|sign-in/i.test(window.location.pathname);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    log(`boot ${BOOT_VERSION} — showLogin=${showLogin}`);

    let cancelled = false;
    const startedAt = Date.now();
    const minSplash = props.minSplashMs ?? 600;
    const timeoutMs = props.timeoutMs ?? 6000;

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
       v7.1: respects the institution gate. Reveals Login ONLY if the
       institution was confirmed earlier in this boot. Otherwise shows
       the institution-not-found dialog. */
    const hardDeadline = window.setTimeout(() => {
      if (deadlineFired.current) return;
      deadlineFired.current = true;
      log(`HARD DEADLINE fired after ${Date.now() - startedAt}ms`);

      if (isValidSession()) {
        // Already authenticated — go straight to role home, bypass the gate.
        const target = routeForRole(readCurrentUser()!.role, props.routes);
        fullPageRedirect(target);
        return;
      }

      // No valid session — login is allowed ONLY if institution was confirmed.
      if (institutionCheckResult.current === "found") {
        log("Deadline escape: revealing login (institution confirmed earlier)");
        gateResolvedRef.current = true;
        setGateResolved(true);
        setShowLogin(true);
      } else {
        log("Deadline escape: institution NOT confirmed — showing 'not found' dialog");
        institutionCheckResult.current = "not-found";
        setShowInstitutionNotFound(true);
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

      /* 4. INSTITUTION GATE (v7.1) — no valid session. Login may ONLY
         appear if an institution exists in Supabase or the local cache.
         If none exists, show the institution-not-found dialog (NOT login). */
      log("No valid session — checking for an institution…");
      clearStaleSession();
      if (!showLogin) setStatus("Checking for an institution…");

      const found = await institutionExists();
      if (cancelled) return;

      if (!found) {
        log("No institution available — login is BLOCKED, showing 'not found' dialog");
        institutionCheckResult.current = "not-found";
        setShowInstitutionNotFound(true);
        return;
      }

      institutionCheckResult.current = "found";
      gateResolvedRef.current = true;
      log("Institution available — login allowed");

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
      return;
    }
    // No valid session — only skip to login if institution is confirmed.
    if (institutionCheckResult.current === "found") {
      gateResolvedRef.current = true;
      setGateResolved(true);
      setShowLogin(true);
    }
    // Otherwise: do nothing. The hard deadline will surface the dialog.
  };

  const handleCreateInstitution = () => {
    log(`Create new institution clicked -> navigate(${REGISTER_ROUTE})`);
    navigate(REGISTER_ROUTE, { replace: true });
  };

  const handleRetry = () => {
    log("Retry institution check clicked -> reload");
    // Full reload re-runs the boot effect from a clean state.
    window.location.reload();
  };

  if (showInstitutionNotFound) {
    log("Rendering institution-not-found dialog");
    return (
      <div className="infd-root">
        <style>{DIALOG_CSS}</style>
        <div
          className="infd-card"
          role="alertdialog"
          aria-labelledby="infd-title"
          aria-describedby="infd-msg"
        >
          <div className="infd-icon" aria-hidden="true">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            </svg>
          </div>
          <div id="infd-title" className="infd-title">Institution not found</div>
          <div id="infd-msg" className="infd-message">
            Check your internet connection and try again. If this is a new
            device or first-time setup, create a new institution to continue.
          </div>
          <button
            type="button"
            className="infd-btn-primary"
            onClick={handleCreateInstitution}
          >
            Create new institution
          </button>
          <button
            type="button"
            className="infd-btn-secondary"
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (showLogin && gateResolved) {
    log("Rendering <Login /> in-place");
    return <Login routes={props.routes} />;
  }

  return (
    <div className="st-root">
      <style>{CSS}</style>
      <div className="st-main">
        <div className="st-col">
          {appName ? (
            <div className="st-icon" aria-hidden="true">
              <span>{appName.charAt(0).toUpperCase()}</span>
            </div>
          ) : null}

          {appName ? <div className="st-title">{appName}</div> : null}

          <svg
            className="st-spinner"
            viewBox="0 0 44 44"
            role="progressbar"
            aria-label="Loading"
          >
            <circle className="st-spinner-circle" cx="22" cy="22" r="18" />
          </svg>
          <div className="st-status">{status}</div>

          {skipReady ? (
            <button type="button" className="st-skip" onClick={skip}>
              Skip
            </button>
          ) : null}
        </div>
      </div>
      <div className="st-footer">boot {BOOT_VERSION}</div>
    </div>
  );
}

export default Startup;
export { Startup };
