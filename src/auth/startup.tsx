import { useState, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginUser, addUser } from "../database/userDB";
import { loginTenant } from "../api/authApi";
import {
  pullAllTenantData,
  enableSyncHooks,
  startPeriodicPull,
  stopPeriodicPull,
  pullSettings,
} from "../database/sync";
import {
  supabase,
  hasValidAuth,
  tryReauthenticate,
} from "../auth/supabase";
import PhoneEntry from "./PhoneEntry";
import VerifyCode from "./VerifyCode";
import RegisterAdmin from "./RegisterAdmin";
import { warmUpBackend } from "../api/smsApi";
import { getVersion } from "@tauri-apps/api/app";

/* ============ MD3 DESIGN TOKENS (same system as Login.tsx) ============ */
const C = {
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  background: "#F8F9FA",
  outline: "#DADCE0",
  error: "#D93025",
};

const font =
  "'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* ============ IMAGE SOURCE NORMALIZER (same as Login.tsx) ============
   Fixes logos/backgrounds stored as line-wrapped base64 in the DB, raw SVG,
   or bare base64 — so CSS/HTML can actually render them. */
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
  // Bare filenames are not renderable — the browser resolves them against the
  // app origin and they 404 (the old "loadlogo.png" console error). Only
  // absolute/protocol-relative/blob URLs and app-absolute paths survive;
  // anything else falls back to SafeLogo's monogram/briefcase icon.
  if (/^(https?:\/\/|\/\/|blob:)/i.test(raw) || raw.startsWith("/")) return raw;
  return "";
}

/** Safe for embedding inside a CSS url("...") — strips line breaks and quotes. */
function cssUrl(src: string): string {
  return src.replace(/[\r\n]+/g, "").replace(/"/g, "%22");
}

const BRIEFCASE_ICON =
  "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z";

const PHONE_ICON =
  "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z";

const EMAIL_ICON =
  "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z";

const PLACE_ICON =
  "M12 2C8.13 2 5 5.13 5 8.95c0 5.25 7 13.05 7 13.05s7-7.8 7-13.05C19 5.13 15.87 2 12 2zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z";

/* ============ BRANDING HELPER ============ */
interface Branding {
  businessName: string;
  logo: string;
  phone: string;
  email: string;
  address: string;
  loginBackground: string;
}

/** Normalizes both Supabase rows (snake_case) and cached objects (camelCase). */
function normBranding(raw: Record<string, any> | null | undefined): Branding {
  return {
    businessName: raw?.businessName ?? raw?.business_name ?? "",
    logo: normalizeImageSrc(raw?.logo),
    phone: raw?.phone ?? "",
    email: raw?.email ?? "",
    address: raw?.address ?? "",
    loginBackground: normalizeImageSrc(raw?.loginBackground),
  };
}

/** Field-wise merge — the fresh value wins when non-empty, the previous value
 *  fills the gaps. Used when a Supabase row arrives (a failed/offline Settings
 *  sync must never blank the background) and when combining both caches. */
const EMPTY_BRANDING: Branding = {
  businessName: "", logo: "", phone: "", email: "", address: "", loginBackground: "",
};

function mergeBranding(fresh: Branding, prev: Branding | null | undefined): Branding {
  return {
    businessName: fresh.businessName || prev?.businessName || "",
    logo: fresh.logo || prev?.logo || "",
    phone: fresh.phone || prev?.phone || "",
    email: fresh.email || prev?.email || "",
    address: fresh.address || prev?.address || "",
    loginBackground: fresh.loginBackground || prev?.loginBackground || "",
  };
}

/** Best-known branding from EITHER cache — institutionBranding (written by
 *  Settings.tsx + this flow) and localBusinessSettings (admin Settings). */
function readCachedBranding(): Branding | null {
  try {
    const instRaw = localStorage.getItem("institutionBranding");
    const localRaw = localStorage.getItem("localBusinessSettings");
    const inst = instRaw ? normBranding(JSON.parse(instRaw)) : null;
    const local = localRaw ? normBranding(JSON.parse(localRaw)) : null;
    if (!inst && !local) return null;
    const merged = mergeBranding(local || EMPTY_BRANDING, inst);
    const hasAny =
      merged.businessName || merged.logo || merged.phone ||
      merged.email || merged.address || merged.loginBackground;
    return hasAny ? merged : null;
  } catch {
    return null;
  }
}

/* ============ LOGO TILE (seamless) ============
   object-fit: contain (never crops). Rendered FLAT — no plate, no border,
   no shadow — so the artwork is continuous with the app bar / card
   background (WhatsApp-style). Monogram/icon fallback on load failure. */
function SafeLogo({
  src,
  name,
  size = 88,
  radius = 22,
  centered = true,
}: {
  src: string;
  name?: string;
  size?: number;
  radius?: number;
  /** Card layout centers the tile with a bottom gap; the app bar needs a plain inline tile. */
  centered?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src]);
  const showImg = !!src && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        margin: centered ? "0 auto 22px" : 0,
        background: "transparent",
        border: "none",
        boxShadow: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {showImg ? (
        <img
          src={src}
          alt={name ? `${name} logo` : "Business logo"}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center",
            display: "block",
          }}
        />
      ) : name ? (
        <span
          aria-hidden="true"
          style={{
            fontSize: Math.round(size * 0.4),
            fontWeight: 500,
            color: C.primary,
            fontFamily: font,
            lineHeight: 1,
          }}
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <svg
          aria-hidden="true"
          width={Math.round(size * 0.5)}
          height={Math.round(size * 0.5)}
          viewBox="0 0 24 24"
          fill={C.primary}
        >
          <path d={BRIEFCASE_ICON} />
        </svg>
      )}
    </div>
  );
}

/* ============ BRANDING APP BAR (login screens) ============
   Balanced MD3 top bar — LEFT: back chevron + logo + business name + phone;
   RIGHT: email + address stack. No avatar, no menu. The right stack hides on
   very narrow screens. Fixed to the top while the card scrolls underneath. */
function StartupAppBar({
  logo,
  name,
  phone,
  email,
  address,
  onBack,
}: {
  logo: string;
  name: string;
  phone: string;
  email: string;
  address: string;
  onBack?: () => void;
}) {
  const contactRow = (icon: string, text: string, key: string) =>
    text ? (
      <div
        key={key}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill={C.onSurfaceVariant}
          style={{ flexShrink: 0 }}
        >
          <path d={icon} />
        </svg>
        <span
          style={{
            fontSize: 12,
            lineHeight: 1.2,
            color: C.onSurfaceVariant,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
          }}
        >
          {text}
        </span>
      </div>
    ) : null;

  return (
    <header
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 20,
        background: C.surface,
        borderBottom: `1px solid ${C.outline}`,
        boxShadow: "0 1px 2px rgba(60,64,67,0.12), 0 2px 6px 2px rgba(60,64,67,0.06)",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "8px 8px",
          boxSizing: "border-box",
        }}
      >
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Back"
            style={{
              width: 44,
              height: 44,
              flexShrink: 0,
              marginLeft: -4,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: C.onSurface,
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        {/* LEFT — identity: logo tile + business name + phone */}
        <SafeLogo src={logo} name={name || undefined} size={44} radius={12} centered={false} />
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div
            style={{
              fontSize: "clamp(16px, 4.2vw, 19px)",
              fontWeight: 500,
              color: C.onSurface,
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "left",
            }}
          >
            {name || "Welcome"}
          </div>
          {phone && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 2,
                minWidth: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill={C.onSurfaceVariant}
                style={{ flexShrink: 0 }}
              >
                <path d={PHONE_ICON} />
              </svg>
              <span
                style={{
                  fontSize: 12,
                  lineHeight: 1.2,
                  color: C.onSurfaceVariant,
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "left",
                }}
              >
                {phone}
              </span>
            </div>
          )}
        </div>

        {/* RIGHT — email + address; visibility is controlled by the
            stylesheet (.appbar-contact flexes on ≥481px, hides below) */}
        {(email || address) && (
          <div className="appbar-contact">
            {contactRow(EMAIL_ICON, email, "bar-email")}
            {contactRow(PLACE_ICON, address, "bar-address")}
          </div>
        )}
      </div>
    </header>
  );
}

/* ============ COLOUR-CYCLING PROGRESS BAR ============
   Indeterminate bar that slides while its rainbow gradient FLOWS through it
   (background-position animation — reliable in every webview, unlike
   filter: hue-rotate, which some Tauri webviews never animate). */
function TopLoader({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      style={{
        width: "100%",
        height: 5,
        borderRadius: 999,
        overflow: "hidden",
        position: "relative",
        background: "rgba(26,115,232,0.12)",
        marginBottom: 14,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "40%",
          borderRadius: 999,
          backgroundImage:
            "linear-gradient(90deg, #1A73E8 0%, #9334E6 25%, #E8710A 50%, #00897B 75%, #1A73E8 100%)",
          backgroundSize: "300% 100%",
          animation:
            "md3Slide 1.3s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite, md3Flow 2.4s linear infinite",
        }}
      />
    </div>
  );
}

/* ============ MD3 FILLED BUTTON (replaces shared LoadingButton here so the
   login flow gets the full Material look: pill shape, elevation, spinner) ============ */
function MD3Button({
  type = "submit",
  loading = false,
  loadingLabel,
  disabled = false,
  children,
}: {
  type?: "submit" | "button";
  loading?: boolean;
  loadingLabel?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const inactive = disabled || loading;
  return (
    <button
      type={type}
      disabled={inactive}
      style={{
        width: "100%",
        height: 52,
        border: "none",
        borderRadius: 999,
        background: disabled && !loading ? "rgba(32,33,36,0.12)" : C.primary,
        color: disabled && !loading ? "rgba(32,33,36,0.38)" : C.onPrimary,
        fontSize: 15,
        fontWeight: 500,
        letterSpacing: "0.2px",
        fontFamily: font,
        cursor: inactive ? "default" : "pointer",
        opacity: loading ? 0.9 : 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        boxShadow:
          disabled && !loading
            ? "none"
            : "0 1px 2px rgba(60,64,67,0.30), 0 1px 3px 1px rgba(60,64,67,0.15)",
        transition: "opacity 0.15s ease, box-shadow 0.15s ease",
        boxSizing: "border-box",
      }}
    >
      {loading && (
        <span
          aria-hidden="true"
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.40)",
            borderTopColor: "#FFFFFF",
            animation: "md3Spin 0.8s linear infinite",
          }}
        />
      )}
      {loading ? loadingLabel ?? "Please wait…" : children}
    </button>
  );
}

type AppScreen = "main" | "login" | "admin_sms" | "admin_otp" | "admin_register";

const AuthLayout = ({
  children,
  background,
  logo,
  logoName,
  version,
  showBack,
  onBack,
  watermark,
  appBar,
}: {
  children: ReactNode;
  background?: string;
  logo?: string;
  logoName?: string;
  version?: string;
  showBack?: boolean;
  onBack?: () => void;
  watermark?: boolean;
  /** When provided, a white branding bar (logo + business name + contacts)
   *  is pinned to the top and the back chevron moves into the bar. */
  appBar?: { logo: string; name: string; phone: string; email: string; address: string };
}) => (
  <div
    style={{
      width: "100%",
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundImage: watermark
        ? "none"
        : background
        ? `url("${cssUrl(background)}")`
        : "linear-gradient(180deg, #F8F9FA 0%, #E3EEFC 100%)",
      backgroundSize: watermark ? "auto" : "cover",
      backgroundPosition: "center",
      backgroundColor: watermark ? "#FFFFFF" : "#F8F9FA",
      fontFamily: font,
      overflowX: "hidden",
      overflowY: "auto",
      position: "relative",
      padding: appBar ? "88px 24px 24px" : 24,
      boxSizing: "border-box",
    }}
  >
    <style>{`
      @keyframes fadeUp {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes scrollBg {
        0%   { background-position: 0px 0px; }
        100% { background-position: 120px 120px; }
      }
      @keyframes md3Slide { from { left: -40%; } to { left: 100%; } }
      @keyframes md3Flow { from { background-position: 0% 50%; } to { background-position: 150% 50%; } }
      @keyframes md3Spin { to { transform: rotate(360deg); } }
      .md3-input:focus {
        border-color: ${C.primary} !important;
        box-shadow: 0 0 0 3px rgba(26,115,232,0.14) !important;
        outline: none;
      }
      .md3-input::placeholder { color: #80868B; }
      input:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px #FFFFFF inset; -webkit-text-fill-color: #202124; }
      /* App bar balance: logo + business name + phone on the LEFT, email +
         address stack on the RIGHT (stack hides on very narrow screens) */
      .appbar-contact { display: none; flex-direction: column; align-items: flex-end; gap: 2px; max-width: 42%; min-width: 0; }
      @media (min-width: 481px) {
        .appbar-contact { display: flex; }
      }
    `}</style>

    {appBar && (
      <StartupAppBar
        logo={appBar.logo}
        name={appBar.name}
        phone={appBar.phone}
        email={appBar.email}
        address={appBar.address}
        onBack={showBack ? onBack : undefined}
      />
    )}

    {watermark && (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: logo ? `url("${cssUrl(logo)}")` : "none",
          backgroundRepeat: "repeat",
          backgroundSize: "120px 120px",
          opacity: 0.08,
          animation: "scrollBg 30s linear infinite",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    )}

    {/* Light wash so the white card + logo always stay readable over the photo */}
    {!watermark && background && (
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            "linear-gradient(180deg, rgba(248,249,250,0.48) 0%, rgba(227,238,252,0.66) 100%)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    )}

    {showBack && onBack && !appBar && (
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          position: "absolute",
          top: 20,
          left: 20,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "#FFFFFF",
          border: `1px solid ${C.outline}`,
          boxShadow: "0 1px 2px rgba(60,64,67,0.18)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: C.onSurface,
          zIndex: 10,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    )}

    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        maxWidth: 420,
        background: C.surface,
        borderRadius: 28,
        padding: "36px 28px 30px",
        boxShadow: "0 1px 3px rgba(60,64,67,0.30), 0 4px 8px 3px rgba(60,64,67,0.15)",
        animation: "fadeUp 0.35s cubic-bezier(0.2, 0, 0, 1)",
        boxSizing: "border-box",
        textAlign: "center",
      }}
    >
      {/* Card logo only when there is NO app bar (lookup screen) — on
          app-bar screens the logo lives in the bar, not in the body */}
      {logo && !appBar && <SafeLogo src={logo} name={logoName} size={88} radius={22} />}
      {children}
    </div>

    {version && (
      <div
        style={{
          position: "absolute",
          bottom: 18,
          left: 0,
          right: 0,
          textAlign: "center",
          color: C.onSurfaceVariant,
          fontSize: 12,
          fontFamily: font,
          zIndex: 10,
          pointerEvents: "none",
        }}
      >
        Version {version}
      </div>
    )}
  </div>
);

export default function Startup() {
  const location = useLocation();
  const [redirectRoute, setRedirectRoute] = useState<string | null>(null);
  const [screen, setScreen] = useState<AppScreen>("main");
  const [branding, setBranding] = useState<Branding | null>(null);
  const [appVersion, setAppVersion] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [businessName, setBusinessName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [requiresUnlock, setRequiresUnlock] = useState(false);

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => {});

    // Wake the Render backend (free tier sleeps after ~15 min idle) so the
    // first real request doesn't time out and push the app into offline mode.
    warmUpBackend();

    // Self-heal persisted offline sessions: if this device is holding an
    // offline/fabricated token, silently re-login in the background and
    // restart cloud sync when it succeeds.
    if (!hasValidAuth()) {
      tryReauthenticate().then((token) => {
        if (token) {
          enableSyncHooks();
          startPeriodicPull(60000);
        }
      });
    }

    const storedUser = localStorage.getItem("currentUser");

    if (storedUser && location.pathname === "/") {
      try {
        const userObj = JSON.parse(storedUser);
        if (userObj?.id) {
          setRequiresUnlock(true);
          setUsername(userObj.username || "");
          setTenantId(userObj.tenantId || null);

          const cached = readCachedBranding();
          if (cached) setBranding(cached);

          if (userObj.tenantId) {
            try {
              supabase
                .from("business_settings")
                .select("business_name, logo, phone, email, address, login_background")
                .eq("tenant_id", userObj.tenantId)
                .maybeSingle()
                .then(({ data }: { data: any }) => {
                  if (data) {
                    // Merge with what's already known — an empty/stale DB
                    // field must never wipe branding cached by Settings.
                    setBranding((prev) => {
                      const merged = mergeBranding(normBranding(data), prev);
                      try {
                        localStorage.setItem("institutionBranding", JSON.stringify(merged));
                      } catch { /* ignore quota errors */ }
                      return merged;
                    });
                  }
                });
            } catch {
              // Offline — cached branding shown.
            }
          }
        }
      } catch {
        localStorage.removeItem("currentUser");
      }
    }

    return () => {
      stopPeriodicPull();
    };
  }, [location.pathname]);

  function handleStartAdminRegister() {
    setScreen("admin_sms");
  }

  function handleSmsSent(phone: string) {
    setPhoneNumber(phone);
    setScreen("admin_otp");
  }

  function handleOtpVerified(token: string) {
    setTempToken(token);
    setScreen("admin_register");
  }

  async function handleAdminCreated(user: any) {
    if (user) {
      enableSyncHooks();
      startPeriodicPull(60000);

      try {
        await pullAllTenantData(user.tenantId);
      } catch {
        // Sync on next pull.
      }

      if (user.role === "admin") {
        setRedirectRoute("/admin");
      } else {
        setRedirectRoute("/user");
      }
    } else {
      setScreen("main");
    }
  }

  async function handleTrainerLookup() {
    setLookupError("");

    if (!businessName.trim()) {
      return setLookupError("Institution name is required");
    }

    setLookupLoading(true);
    const enteredName = businessName.trim();

    const savedInstName = localStorage.getItem("institutionName");
    const savedInstId = localStorage.getItem("institutionTenantId");

    if (savedInstName && savedInstId && savedInstName === enteredName) {
      setTenantId(savedInstId);
      const cached = readCachedBranding();
      if (cached) setBranding(cached);
      setScreen("login");
      setLookupLoading(false);

      (async () => {
        try {
          const { data: settings } = await supabase
            .from("business_settings")
            .select("*")
            .eq("tenant_id", savedInstId)
            .maybeSingle();

          if (settings) {
            setBranding((prev) => {
              const merged = mergeBranding(normBranding(settings), prev);
              try {
                localStorage.setItem("institutionBranding", JSON.stringify(merged));
              } catch { /* ignore quota errors */ }
              return merged;
            });
          }
        } catch {}
      })();

      return;
    }

    try {
      const { data: tenants, error } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("business_name", enteredName);

      if (error) throw error;

      if (!tenants || tenants.length === 0) {
        setLookupError("Institution not found. Check the name or your connection.");
        setLookupLoading(false);
        return;
      }

      if (tenants.length > 1) {
        setLookupError("Multiple institutions share this name. Please contact support.");
        setLookupLoading(false);
        return;
      }

      const tenant = tenants[0];
      localStorage.setItem("institutionName", tenant.business_name || enteredName);
      localStorage.setItem("institutionTenantId", tenant.id);

      try {
        const { data: settings } = await supabase
          .from("business_settings")
          .select("*")
          .eq("tenant_id", tenant.id)
          .maybeSingle();

        if (settings) {
          setBranding((prev) => {
            const merged = mergeBranding(normBranding(settings), prev);
            try {
              localStorage.setItem("institutionBranding", JSON.stringify(merged));
            } catch { /* ignore quota errors */ }
            return merged;
          });
        }
      } catch {}
      setTenantId(tenant.id);
      setScreen("login");
      setLookupLoading(false);
    } catch {
      setLookupError("Institution not found. Check the name or your connection.");
      setLookupLoading(false);
    }
  }

  async function handleLogin() {
    setMessage("");

    if (!username.trim() || !password.trim()) {
      return setMessage("Username and password are required");
    }

    if (!tenantId) {
      return setMessage("Session error. Please re-select your institution.");
    }

    setLoading(true);

    try {
      // --- Primary: custom backend auth (standardized to tenantId) ---
      try {
        const result = await loginTenant({
          tenantId,
          username,
          password,
        });

        // Case-insensitive username validation
        if (
          typeof result.user.username !== "string" ||
          result.user.username.toLowerCase() !== username.trim().toLowerCase()
        ) {
          throw new Error("Invalid username or password");
        }

        const safeUser = {
          id: result.user.id,
          username: result.user.username,
          password,
          email: result.user.email || "",
          phone: result.user.phone || "",
          profilePic: (result.user as any).profile_pic || "",
          role: result.user.role,
          tenantId: result.user.tenantId,
          assignedCourses: result.user.assigned_courses || [],
          createdAt: (result.user as any).created_at || new Date().toISOString(),
          synced: true,
        };

        // Token + user must be in localStorage BEFORE addUser — userDB.addUser
        // treats a tokenless call as an offline registration and would log
        // "User saved locally only (synced:false)" on every fresh device.
        // Some authApi flows (RPC-based login) return no authToken — fall back
        // to a local session token so addUser always sees a real session.
        const authToken =
          result.authToken || `local-${result.user.id || Date.now()}`;
        localStorage.setItem("authToken", authToken);
        localStorage.setItem(
          "currentUser",
          JSON.stringify({ ...safeUser, authToken, token: authToken }),
        );
        await addUser(safeUser);
        window.dispatchEvent(new Event("authStateChanged"));

        enableSyncHooks();
        startPeriodicPull(60000);

        if (safeUser.tenantId) {
          pullAllTenantData(safeUser.tenantId).catch(() => {});
          pullSettings().catch(() => {});
        }

        redirectUser(safeUser.role);
        return;
      } catch (backendError: any) {
        console.warn("Backend login error:", backendError);
        if (backendError?.noOfflineFallback) {
          throw backendError;
        }
      }

      // --- Fallback: offline local DB ---
      const user = await loginUser(username.trim(), password, tenantId);

      if (
        !user ||
        typeof user.username !== "string" ||
        user.username.toLowerCase() !== username.trim().toLowerCase()
      ) {
        throw new Error("Invalid username or password.");
      }

      const safeUser = {
        id: user.id,
        username: user.username,
        password,
        email: user.email || "",
        phone: user.phone || "",
        profilePic: user.profilePic || "",
        role: user.role,
        tenantId: user.tenantId,
        assignedCourses: user.assignedCourses || [],
        createdAt: user.createdAt,
        synced: false,
      };

      localStorage.setItem("currentUser", JSON.stringify(safeUser));
      localStorage.setItem("authToken", "offline-mode-pending-sync");
      console.warn(
        "Logged in OFFLINE (backend unreachable). SMS and cloud sync are " +
          "disabled until an online login succeeds - the app will retry " +
          "automatically in the background."
      );
      window.dispatchEvent(new Event("authStateChanged"));

      redirectUser(safeUser.role);
    } catch (err: any) {
      console.error("Login failed:", err);
      const msg =
        err?.message ||
        err?.error_description ||
        (typeof err === "string" ? err : null);
      setMessage(msg && msg !== "undefined" ? msg : "Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  function redirectUser(role: string) {
    if (role === "admin") {
      setRedirectRoute("/admin");
    } else if (role === "trainer") {
      setRedirectRoute("/trainer");
    } else {
      setRedirectRoute("/user");
    }
  }

  if (redirectRoute) {
    return <Navigate to={redirectRoute} replace />;
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    height: 54,
    padding: "0 16px",
    border: `1px solid ${C.outline}`,
    outline: "none",
    background: C.surface,
    fontSize: 16,
    color: C.onSurface,
    boxSizing: "border-box",
    borderRadius: 12,
    marginBottom: 12,
    fontFamily: font,
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  };

  const h1Style: CSSProperties = {
    textAlign: "center",
    fontSize: 24,
    fontWeight: 500,
    color: C.onSurface,
    letterSpacing: "-0.01em",
    margin: "0 0 8px",
    fontFamily: font,
  };

  const subStyle: CSSProperties = {
    textAlign: "center",
    fontSize: 14,
    color: C.onSurfaceVariant,
    margin: "0 0 24px",
    lineHeight: 1.5,
    fontFamily: font,
  };

  const errStyle: CSSProperties = {
    textAlign: "center",
    color: C.error,
    fontSize: 13.5,
    margin: "0 0 12px",
    lineHeight: 1.45,
    fontFamily: font,
  };

  if (screen === "admin_sms") {
    return <PhoneEntry onSent={handleSmsSent} onBack={() => setScreen("main")} />;
  }

  if (screen === "admin_otp") {
    return <VerifyCode phone={phoneNumber} onVerified={handleOtpVerified} onBack={() => setScreen("admin_sms")} />;
  }

  if (screen === "admin_register") {
    return <RegisterAdmin phone={phoneNumber} tempToken={tempToken || ""} onComplete={handleAdminCreated} onBack={() => setScreen("admin_otp")} />;
  }

  if (requiresUnlock) {
    return (
      <AuthLayout
        background={branding?.loginBackground}
        logo={branding?.logo || ""}
        logoName={branding?.businessName}
        version={appVersion}
        showBack
        appBar={{
          logo: branding?.logo || "",
          name: branding?.businessName || localStorage.getItem("institutionName") || "",
          phone: branding?.phone || "",
          email: branding?.email || "",
          address: branding?.address || "",
        }}
        onBack={() => {
          stopPeriodicPull();
          localStorage.removeItem("currentUser");
          localStorage.removeItem("authToken");
          setRequiresUnlock(false);
          setPassword("");
          setUsername("");
        }}
      >
        <h1 style={h1Style}>Welcome back</h1>
        <p style={subStyle}>Enter your password to continue.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
          style={{ width: "100%" }}
        >
          <input
            type="password"
            className="md3-input"
            placeholder="Enter Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setMessage("");
            }}
            style={inputStyle}
            autoFocus
            autoComplete="current-password"
          />
          {message && <p style={errStyle}>{message}</p>}
          <TopLoader show={loading} />
          <MD3Button type="submit" loading={loading} loadingLabel="Signing in…" disabled={!password}>
            Unlock
          </MD3Button>
        </form>
      </AuthLayout>
    );
  }

  if (screen === "login") {
    return (
      <AuthLayout
        background={branding?.loginBackground}
        logo={branding?.logo || ""}
        logoName={branding?.businessName}
        version={appVersion}
        showBack
        appBar={{
          logo: branding?.logo || "",
          name: branding?.businessName || localStorage.getItem("institutionName") || "",
          phone: branding?.phone || "",
          email: branding?.email || "",
          address: branding?.address || "",
        }}
        onBack={() => {
          stopPeriodicPull();
          setScreen("main");
          setTenantId(null);
          setMessage("");
        }}
      >
        <h1 style={{ ...h1Style, marginBottom: 24 }}>Welcome Back</h1>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleLogin();
          }}
          style={{ width: "100%" }}
        >
          <input
            name="username"
            className="md3-input"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={inputStyle}
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <input
            type="password"
            name="password"
            className="md3-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
            autoComplete="current-password"
          />
          {message && <p style={errStyle}>{message}</p>}
          <TopLoader show={loading} />
          <MD3Button type="submit" loading={loading} loadingLabel="Signing in…">
            Login
          </MD3Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", height: "100vh" }}>
      <AuthLayout watermark logo={branding?.logo || ""} version={appVersion}>
        <h1 style={h1Style}>Welcome</h1>
        <p style={subStyle}>Enter your institution to continue</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleTrainerLookup();
          }}
          style={{ width: "100%" }}
        >
          <input
            type="text"
            className="md3-input"
            placeholder="Enter Institution Name"
            value={businessName}
            onChange={(e) => {
              setBusinessName(e.target.value);
              setLookupError("");
            }}
            style={inputStyle}
            autoFocus
            autoComplete="organization"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {lookupError && <p style={errStyle}>{lookupError}</p>}
          <TopLoader show={lookupLoading} />
          <MD3Button type="submit" loading={lookupLoading} loadingLabel="Finding…" disabled={!businessName.trim()}>
            Continue
          </MD3Button>
        </form>
      </AuthLayout>

      {/* MD3 FAB — primary container tone, rounded-square */}
      <button
        onClick={handleStartAdminRegister}
        style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          width: 56,
          height: 56,
          borderRadius: 16,
          border: "none",
          background: C.primaryContainer,
          color: C.onPrimaryContainer,
          boxShadow: "0 3px 6px rgba(60,64,67,0.24), 0 1px 2px rgba(60,64,67,0.30)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 100,
          transition: "transform 0.15s ease, box-shadow 0.15s ease",
        }}
        title="Register New Institution"
        aria-label="Register New Institution"
        onMouseEnter={(e) => {
          e.currentTarget.style.transform = "scale(1.06)";
          e.currentTarget.style.boxShadow = "0 6px 14px rgba(60,64,67,0.28), 0 2px 4px rgba(60,64,67,0.32)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.transform = "scale(1)";
          e.currentTarget.style.boxShadow = "0 3px 6px rgba(60,64,67,0.24), 0 1px 2px rgba(60,64,67,0.30)";
        }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </div>
  );
}
