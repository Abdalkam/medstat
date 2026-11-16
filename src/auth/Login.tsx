// src/screens/LoginScreen.tsx — v1: Material sign-in for MedStat
//
// "Log in from any device, anywhere" — this screen is a thin Material shell
// over the machinery that already lives in src/database/userDB.ts:
//   • loginWithIdentifier() resolves the business identifier (tenant UUID |
//     institution phone | business name) against the tenants table, then
//     authenticates straight against Supabase public.users — no localhost /
//     Render hop, no cold starts.
//   • Offline: Supabase-unreachable logins fall back to credentials cached in
//     Dexie from a previous sign-in on THIS device (the app-side contract).
//   • The user record (incl. bcrypt hash) is cached after every success, so
//     the NEXT sign-in on the same device works with no network at all.
//
// Wiring: render <LoginScreen onSignedIn={(user) => ...} /> from your app
// shell (router or App.tsx auth gate). On success the component also fires
// the same "authStateChanged" event hardRedirectToLogin() uses, so existing
// listeners re-evaluate the session. After the shell switches to the app,
// make sure startPeriodicPull() is running (see CHANGES.md).

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  loginWithIdentifier,
  resolveTenantIdentifier,
  type MedStatUser,
} from "../database/userDB";

/* -------------------------------------------------------------------------- */
/* Injected stylesheet — focus rings, press states, entrance animation        */
/* -------------------------------------------------------------------------- */

const LGS_CSS = `
.lgs-root{font-family:Roboto,'Segoe UI',system-ui,-apple-system,sans-serif;
  min-height:100vh;background:linear-gradient(180deg,#eff6ff 0%,#f8fafc 45%,#f1f5f9 100%);
  display:flex;align-items:center;justify-content:center;padding:24px;color:#0f172a;}
.lgs-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
.lgs-card{width:100%;max-width:400px;background:#ffffff;border:1px solid #e2e8f0;
  border-radius:28px;padding:28px 24px;box-shadow:0 10px 30px rgba(15,23,42,.08);
  animation:lgs-in .25s ease-out;}
@keyframes lgs-in{from{transform:translateY(16px);opacity:0;}to{transform:none;opacity:1;}}
.lgs-field:focus-within{border-color:#2563eb !important;box-shadow:inset 0 0 0 1px #2563eb;}
.lgs-field input:focus{outline:none;}
.lgs-btn{transition:transform .06s ease;}
.lgs-btn:active:not(:disabled){transform:scale(.98);}
.lgs-btn:disabled{opacity:.55;cursor:default;}
.lgs-iconbtn{border:none;background:transparent;border-radius:999px;width:40px;height:40px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#64748b;flex-shrink:0;}
.lgs-iconbtn:hover{background:#e2e8f0;}
`;

/* -------------------------------------------------------------------------- */
/* Icons                                                                      */
/* -------------------------------------------------------------------------- */

const LGS_ICONS: Record<string, string> = {
  visibility:
    "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  visibilityOff:
    "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  domain:
    "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z",
  person:
    "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z",
  lock:
    "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3-9H9V6c0-1.66 1.34-3 3-3s3 1.34 3 3v2z",
};

function LgsIcon({ path, size = 22 }: { path: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const S: Record<string, CSSProperties> = {
  brand: { textAlign: "center", marginBottom: 22 },
  logo: {
    width: 56,
    height: 56,
    borderRadius: 999,
    background: "#2563eb",
    color: "#ffffff",
    fontSize: 24,
    fontWeight: 700,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 12px",
    boxShadow: "0 6px 16px rgba(37, 99, 235, 0.35)",
  },
  title: { fontSize: 20, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },
  offlineChip: {
    display: "block",
    background: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 12,
    padding: "9px 12px",
    fontSize: 12,
    lineHeight: 1.5,
    marginBottom: 14,
  },
  errorCard: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    lineHeight: 1.5,
    marginBottom: 12,
  },
  fieldWrap: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: 600, color: "#334155" },
  field: {
    border: "1px solid #cbd5e1",
    borderRadius: 14,
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 6px 0 12px",
  },
  input: {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 14,
    padding: "13px 0",
    width: "100%",
    minWidth: 0,
    color: "#0f172a",
  },
  hint: { fontSize: 11, color: "#64748b", lineHeight: 1.5, padding: "0 2px" },
  hintFound: { color: "#166534" },
  button: {
    width: "100%",
    border: "none",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 999,
    padding: "13px 20px",
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 6,
    boxShadow: "0 4px 12px rgba(37, 99, 235, 0.35)",
  },
  footer: { fontSize: 11, color: "#94a3b8", textAlign: "center", marginTop: 18, lineHeight: 1.6 },
};

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

interface LoginScreenProps {
  /** Called after a successful sign-in (session already persisted). */
  onSignedIn?: (user: MedStatUser) => void;
}

type TenantHint = "empty" | "checking" | "found" | "unknown";

const LAST_BUSINESS_KEY = "medstat.lastBusiness";

export default function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const [business, setBusiness] = useState<string>("");
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [tenantHint, setTenantHint] = useState<TenantHint>("empty");
  const [online, setOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );

  // Prefill the institution from the last successful sign-in on this device.
  useEffect(() => {
    try {
      const last = localStorage.getItem(LAST_BUSINESS_KEY) || "";
      if (last) setBusiness(last);
    } catch {
      // Storage unavailable — start blank.
    }
  }, []);

  // Track connectivity for the offline notice.
  useEffect(() => {
    const goOnline = (): void => setOnline(true);
    const goOffline = (): void => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // Debounced business-identifier resolution — instant feedback that the
  // institution was recognized (UUID, phone, or name all resolve).
  useEffect(() => {
    const raw = business.trim();
    if (!raw) {
      setTenantHint("empty");
      return;
    }
    setTenantHint("checking");
    const timer = setTimeout(() => {
      void (async (): Promise<void> => {
        try {
          const tenantId = await resolveTenantIdentifier(raw);
          setTenantHint(tenantId ? "found" : "unknown");
        } catch {
          setTenantHint("unknown");
        }
      })();
    }, 500);
    return () => clearTimeout(timer);
  }, [business]);

  const submit = async (): Promise<void> => {
    if (busy) return;
    setError("");
    const trimmedUsername = username.trim();
    if (!trimmedUsername || !password) {
      setError("Enter your username and password.");
      return;
    }
    setBusy(true);
    try {
      const user = await loginWithIdentifier({
        business: business.trim() || undefined,
        username: trimmedUsername,
        password,
      });
      try {
        localStorage.setItem(LAST_BUSINESS_KEY, business.trim());
      } catch {
        // Storage unavailable — prefill is best-effort.
      }
      try {
        window.dispatchEvent(new Event("authStateChanged"));
      } catch {
        // Listeners may not exist.
      }
      onSignedIn?.(user);
    } catch (e: any) {
      setError(String(e?.message ?? e) || "Sign-in failed. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const hintText = (): string => {
    if (tenantHint === "found") {
      return "Institution recognized — sign-in will be scoped to it.";
    }
    if (tenantHint === "unknown") {
      return "No exact match yet — we'll search every institution for your username when you sign in.";
    }
    return "Institution name, phone, or ID — leave blank if your username is unique.";
  };

  return (
    <div className="lgs-root">
      <style>{LGS_CSS}</style>
      <div className="lgs-card">
        <div style={S.brand}>
          <div style={S.logo}>M</div>
          <h1 style={S.title}>MedStat</h1>
          <div style={S.subtitle}>Sign in to your institution</div>
        </div>

        {!online && (
          <div style={S.offlineChip}>
            You're offline. Previously signed-in accounts on this device can still sign in —
            everything syncs once the connection returns.
          </div>
        )}
        {error && <div style={S.errorCard}>{error}</div>}

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div style={S.fieldWrap}>
            <label style={S.label} htmlFor="lgs-business">
              Business (name or phone)
            </label>
            <div className="lgs-field" style={S.field}>
              <LgsIcon path={LGS_ICONS.domain} size={20} />
              <input
                id="lgs-business"
                style={S.input}
                value={business}
                onChange={(event) => setBusiness(event.target.value)}
                placeholder="e.g. Nairobi Medical Trainers"
                autoComplete="organization"
              />
            </div>
            <span
              className="lgs-hint"
              style={{ ...S.hint, ...(tenantHint === "found" ? S.hintFound : {}) }}
            >
              {hintText()}
            </span>
          </div>

          <div style={S.fieldWrap}>
            <label style={S.label} htmlFor="lgs-username">
              Username
            </label>
            <div className="lgs-field" style={S.field}>
              <LgsIcon path={LGS_ICONS.person} size={20} />
              <input
                id="lgs-username"
                style={S.input}
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Your username"
                autoComplete="username"
                autoCapitalize="none"
              />
            </div>
          </div>

          <div style={S.fieldWrap}>
            <label style={S.label} htmlFor="lgs-password">
              Password
            </label>
            <div className="lgs-field" style={S.field}>
              <LgsIcon path={LGS_ICONS.lock} size={20} />
              <input
                id="lgs-password"
                style={S.input}
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="lgs-iconbtn"
                onClick={() => setShowPassword((prev) => !prev)}
                title={showPassword ? "Hide password" : "Show password"}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                <LgsIcon path={showPassword ? LGS_ICONS.visibilityOff : LGS_ICONS.visibility} size={20} />
              </button>
            </div>
            <span style={S.hint}>Passwords are case-sensitive.</span>
          </div>

          <button className="lgs-btn" style={S.button} type="submit" disabled={busy}>
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <div style={S.footer}>
          Works from any device, anywhere — sign-in goes straight to the cloud, and this device
          keeps a secure copy so you can always get back in, even offline.
        </div>
      </div>
    </div>
  );
}
