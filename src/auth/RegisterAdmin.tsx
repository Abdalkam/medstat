import { useState, useEffect } from "react";
import type { FormEvent, CSSProperties, ReactNode } from "react";
import { registerTenant } from "../api/authApi";
import type { RegisterTenantResult } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const IOS_RED = "#FF3B30";
const IOS_GRAY = "#8E8E93";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,20}$/;

/* ===== Branding helpers (same logic as Startup.tsx, kept local — no new file) ===== */

interface BrandingData { businessName: string; logo: string; loginBackground: string; }

function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    const m = raw.match(/^(data:image\/[a-z.+-]+;base64,)([\s\S]*)$/i);
    return m ? m[1] + m[2].replace(/\s+/g, "") : raw;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("<svg") || raw.startsWith("<?xml")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
  }
  const compact = raw.replace(/\s+/g, "");
  if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    let mime = "image/png";
    if (compact.startsWith("/9j/")) mime = "image/jpeg";
    else if (compact.startsWith("R0lGOD")) mime = "image/gif";
    else if (compact.startsWith("UklGR")) mime = "image/webp";
    else if (compact.startsWith("PHN2Zy") || compact.startsWith("PD94bW")) mime = "image/svg+xml";
    return `data:${mime};base64,${compact}`;
  }
  return raw;
}

function readCachedBranding(): BrandingData | null {
  try {
    const merged: BrandingData = { businessName: "", logo: "", loginBackground: "" };
    for (const key of ["institutionBranding", "localBusinessSettings"]) {
      const rawStr = localStorage.getItem(key);
      if (!rawStr) continue;
      const o = JSON.parse(rawStr);
      merged.businessName = o.businessName ?? o.business_name ?? merged.businessName ?? "";
      merged.logo = normalizeImageSrc(o.logo) || merged.logo;
      merged.loginBackground =
        normalizeImageSrc(o.loginBackground ?? o.login_background) || merged.loginBackground;
    }
    return merged.businessName || merged.logo || merged.loginBackground ? merged : null;
  } catch {
    return null;
  }
}

function useAppBranding(): BrandingData {
  const [branding, setBranding] = useState<BrandingData>(
    () => readCachedBranding() ?? { businessName: "", logo: "", loginBackground: "" }
  );

  useEffect(() => {
    const tenantId = localStorage.getItem("institutionTenantId");
    if (!tenantId) return;
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("business_settings")
          .select("business_name, logo, login_background")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (!alive || !data) return;
        setBranding((prev) => {
          const merged: BrandingData = {
            businessName: data.business_name || prev.businessName,
            logo: normalizeImageSrc(data.logo) || prev.logo,
            loginBackground: normalizeImageSrc(data.login_background) || prev.loginBackground,
          };
          try {
            let cached: Record<string, unknown> = {};
            try { cached = JSON.parse(localStorage.getItem("institutionBranding") || "{}"); } catch { /* ignore */ }
            localStorage.setItem(
              "institutionBranding",
              JSON.stringify({ ...cached, businessName: merged.businessName, logo: merged.logo, loginBackground: merged.loginBackground })
            );
          } catch { /* quota */ }
          return merged;
        });
      } catch { /* offline — cached branding already shown */ }
    })();
    return () => { alive = false; };
  }, []);

  return branding;
}

/* Logo chain: institution logo -> /loadlogo.png -> monogram. Always shows something. */
function AppLogo({ size = 80, radius = 20, marginBottom = 24 }: { size?: number; radius?: number; marginBottom?: number }) {
  const branding = useAppBranding();
  const [failedBrand, setFailedBrand] = useState(false);
  const [failedDefault, setFailedDefault] = useState(false);
  useEffect(() => { setFailedBrand(false); }, [branding.logo]);
  const showBrand = !!branding.logo && !failedBrand;
  const showDefault = !showBrand && !failedDefault;
  return (
    <div style={{ width: size, height: size, borderRadius: radius, margin: `0 auto ${marginBottom}px`, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}>
      {showBrand ? (
        <img
          src={branding.logo}
          alt={branding.businessName ? `${branding.businessName} logo` : "App logo"}
          onError={() => setFailedBrand(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : showDefault ? (
        <img
          src="/loadlogo.png"
          alt="App logo"
          onError={() => setFailedDefault(true)}
          style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
        />
      ) : (
        <span style={{ fontSize: Math.round(size * 0.4), fontWeight: 600, color: MEDICAL_BLUE, lineHeight: 1 }}>
          {(branding.businessName || "M").trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Module-level style constants — don't depend on render state.               */
/* -------------------------------------------------------------------------- */

const BACK_BTN_STYLE: CSSProperties = {
  position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%",
  background: "rgba(255,255,255,0.2)", backdropFilter: "blur(10px)", border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", zIndex: 10
};

const CARD_STYLE: CSSProperties = {
  position: "relative", zIndex: 1, width: "100%", maxWidth: "400px",
  background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)",
  borderRadius: "28px", padding: "40px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
  border: "1px solid rgba(255,255,255,0.6)", animation: "fadeUp 0.6s ease-out"
};

const PRIMARY_BTN_BASE: CSSProperties = {
  width: "100%", height: "54px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE,
  color: "white", fontSize: "17px", fontWeight: "600", cursor: "pointer",
  boxShadow: "0 4px 12px rgba(0,122,255,0.3)", marginTop: "6px"
};

const ERROR_STYLE: CSSProperties = {
  textAlign: "center", color: IOS_RED, fontSize: "14px", marginBottom: "12px", fontWeight: 500
};

const FIELD_ERR_STYLE: CSSProperties = { color: IOS_RED, fontSize: "12.5px", margin: "6px 0 0" };

/* Focus/invalid states need real CSS — inline styles can't express :focus. */
const RA_CSS = `
.ra-field {
  width: 100%; height: 52px; padding: 0 44px 0 14px; border-radius: 12px;
  border: 1.5px solid #D1D1D6; background: rgba(255,255,255,0.92);
  font-size: 16px; color: #1C1C1E; outline: none; box-sizing: border-box;
  font-family: inherit; transition: border-color .15s ease, box-shadow .15s ease;
}
.ra-field:focus { border-color: ${MEDICAL_BLUE}; box-shadow: 0 0 0 3px rgba(0,122,255,0.15); }
.ra-field.ra-invalid { border-color: ${IOS_RED}; }
.ra-label { display: block; font-size: 13px; font-weight: 600; color: #3A3A3C; margin-bottom: 6px; }
.ra-hint { font-size: 12px; color: ${IOS_GRAY}; margin: 6px 0 0; }
`;

/* Map Supabase RPC / Postgres errors to human messages. */
function friendlyRegisterError(err: unknown): string {
  const raw = (err instanceof Error ? err.message : String(err ?? "")).toLowerCase();
  if (raw.includes("username")) {
    if (raw.includes("duplicate") || raw.includes("unique") || raw.includes("exists") || raw.includes("taken"))
      return "That username is already taken — please choose another.";
    if (raw.includes("invalid")) return "That username isn't allowed — use 3–20 letters, numbers, dots or dashes.";
  }
  if (raw.includes("business") && (raw.includes("duplicate") || raw.includes("exists") || raw.includes("taken")))
    return "An institution with that name already exists.";
  if (raw.includes("phone") && (raw.includes("registered") || raw.includes("exists")))
    return "This phone number is already registered — please log in instead.";
  if (raw.includes("token") || raw.includes("unauthorized") || raw.includes("401"))
    return "Your verification session expired — please verify your phone again.";
  if (raw.includes("row-level") || raw.includes("permission") || raw.includes("jwt"))
    return "Registration is temporarily unavailable. Please try again in a moment.";
  if (raw.includes("network") || raw.includes("fetch") || raw.includes("failed to fetch"))
    return "Network problem — check your connection and try again.";
  return (err instanceof Error && err.message) || "Registration failed. Please try again.";
}

function EyeIcon({ off }: { off?: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={IOS_GRAY} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
      {off && <line x1="4" y1="3" x2="20" y2="21" />}
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Labeled field with inline error + optional trailing button (eye toggle).   */
/* -------------------------------------------------------------------------- */

function Field({
  label, value, onChange, type = "text", autoComplete, error, hint, autoFocus, trailing, describedBy,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  autoComplete?: string;
  error?: string;
  hint?: string;
  autoFocus?: boolean;
  trailing?: ReactNode;
  describedBy?: string;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label className="ra-label">{label}</label>
      <div style={{ position: "relative" }}>
        <input
          className={`ra-field${error ? " ra-invalid" : ""}`}
          type={type}
          value={value}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={describedBy ?? (error ? `${label}-error` : undefined)}
          onChange={(e) => onChange(e.target.value)}
        />
        {trailing && (
          <div style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)" }}>{trailing}</div>
        )}
      </div>
      {error && <p id={`${label}-error`} style={FIELD_ERR_STYLE}>{error}</p>}
      {!error && hint && <p className="ra-hint">{hint}</p>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* RegisterAdmin — creates the tenant + admin.
/* Phone is already OTP-verified by VerifyCode (Render SMS path); tempToken
/* arrives as a prop as proof. User/account creation itself must go through
/* Supabase only — the Render backend is reserved for SMS verification.
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
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<"businessName" | "username" | "password" | "confirm", string>>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const branding = useAppBranding();

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
  }, []);

  // Password policy: NONE. The user may choose any password they like —
  // no minimum length, no required character classes. The only checks are
  // "not empty" and "confirm matches" (a correctness check, not a rule).
  function validate(): boolean {
    const fe: typeof fieldErrors = {};
    if (businessName.trim().length < 2) fe.businessName = "Enter your institution's name.";
    if (!USERNAME_RE.test(username.trim()))
      fe.username = "3–20 characters: letters, numbers, dots, dashes or underscores.";
    if (!password) fe.password = "Enter a password.";
    if (confirm !== password) fe.confirm = "Passwords don't match.";
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tempToken) {
      setError("Your verification session expired — please verify your phone again.");
      return;
    }
    if (!validate()) return;
    setLoading(true);
    setError("");
    try {
      const result: RegisterTenantResult = await registerTenant({
        phone,
        tempToken,
        businessName: businessName.trim(),
        username: username.trim(),
        password,
      });

      const user = result.user ?? { id: result.userId, tenantId: result.tenantId, phone };

      // Persist the session — adjust keys to whatever your
      // supabase.ts tryReauthenticate / userDB layer reads.
      try {
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("institutionTenantId", result.tenantId);
        localStorage.setItem("authToken", result.authToken);
      } catch { /* quota — non-fatal */ }

      onComplete(user);
    } catch (err: unknown) {
      setError(friendlyRegisterError(err));
    } finally {
      setLoading(false);
    }
  }

  const primaryBtn: CSSProperties = {
    ...PRIMARY_BTN_BASE,
    opacity: loading ? 0.4 : 1,
  };

  return (
    <div style={{
      width: "100%", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      backgroundImage: branding.loginBackground ? `url("${branding.loginBackground}")` : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      backgroundSize: "cover", backgroundPosition: "center",
      fontFamily: iosFont, overflow: "hidden", position: "relative", padding: "24px"
    }}>
      <style>{RA_CSS}{`@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {branding.loginBackground && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)" }} />}

      <button type="button" onClick={onBack} aria-label="Back" style={BACK_BTN_STYLE}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      <div style={CARD_STYLE}>
        <AppLogo size={72} radius={18} marginBottom={14} />
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "6px", textAlign: "center" }}>Create Institution</h1>
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 22 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(52,199,89,0.12)",
            color: "#248A3D", fontSize: 13, fontWeight: 600, borderRadius: 999, padding: "6px 12px",
          }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
            {phone} verified
          </span>
        </div>

        {error && <p role="alert" style={ERROR_STYLE}>{error}</p>}

        <form onSubmit={handleSubmit} aria-busy={loading} noValidate>
          <Field
            label="Institution name"
            value={businessName}
            onChange={(v) => { setBusinessName(v); setFieldErrors((f) => ({ ...f, businessName: undefined })); }}
            autoComplete="organization"
            autoFocus
            error={fieldErrors.businessName}
          />

          <Field
            label="Username"
            value={username}
            onChange={(v) => { setUsername(v); setFieldErrors((f) => ({ ...f, username: undefined })); }}
            autoComplete="username"
            error={fieldErrors.username}
            hint="You'll use this to log in — 3–20 letters, numbers, dots or dashes."
          />

          <Field
            label="Password"
            value={password}
            onChange={(v) => { setPassword(v); setFieldErrors((f) => ({ ...f, password: undefined })); }}
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            error={fieldErrors.password}
            hint="Choose any password you like — there are no restrictions."
            trailing={
              <button type="button" onClick={() => setShowPw((s) => !s)}
                aria-label={showPw ? "Hide password" : "Show password"}
                style={{ background: "none", border: "none", cursor: "pointer", padding: 6, display: "flex" }}>
                <EyeIcon off={showPw} />
              </button>
            }
          />

          <Field
            label="Confirm password"
            value={confirm}
            onChange={(v) => { setConfirm(v); setFieldErrors((f) => ({ ...f, confirm: undefined })); }}
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            error={fieldErrors.confirm}
          />

          <button type="submit" disabled={loading} style={primaryBtn}>
            {loading ? "Creating institution…" : "Create Account"}
          </button>
        </form>
      </div>

      {appVersion && (
        <div style={{
          position: "absolute", bottom: "20px", width: "100%", textAlign: "center",
          color: branding.loginBackground ? "rgba(255,255,255,0.8)" : IOS_GRAY,
          fontSize: "12px", zIndex: 10, pointerEvents: "none"
        }}>
          Version {appVersion}
        </div>
      )}
    </div>
  );
}
