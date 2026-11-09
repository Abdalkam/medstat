import { useState, useEffect } from "react";
import type { CSSProperties, InputHTMLAttributes, ReactNode } from "react";
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
import { supabase } from "../auth/supabase";
import PhoneEntry from "./PhoneEntry";
import VerifyCode from "./VerifyCode";
import RegisterAdmin from "./RegisterAdmin";
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
   Professional glass bar — LEFT: back chevron + logo + business name + phone;
   RIGHT: email + address stack (hides below 481px). Safe-area aware for
   notched phones; translucency + blur keeps it feeling native over brand
   panels and photo backgrounds alike. */
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
      <div key={key} className="st-barcontact">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill={C.onSurfaceVariant} style={{ flexShrink: 0 }}>
          <path d={icon} />
        </svg>
        <span className="st-barcontact-text">{text}</span>
      </div>
    ) : null;

  return (
    <header className="st-appbar">
      <div className="st-appbar-inner">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="st-appbar-back">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
        )}

        <SafeLogo src={logo} name={name || undefined} size={42} radius={12} centered={false} />
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div className="st-appbar-name">{name || "Welcome"}</div>
          {phone && (
            <div className="st-appbar-phone">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill={C.onSurfaceVariant} style={{ flexShrink: 0 }}>
                <path d={PHONE_ICON} />
              </svg>
              <span>{phone}</span>
            </div>
          )}
        </div>

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
      className="st-btn"
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

/* ============ PROFESSIONAL FORM PRIMITIVES ============ */

const PERSON_ICON =
  "M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z";

const LOCK_ICON =
  "M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z";

const EYE_ICON =
  "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z";

const EYE_OFF_ICON =
  "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z";

const WARN_ICON = "M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z";

/** Input with optional leading icon and trailing slot (eye toggle). */
function Field({
  label,
  icon,
  rightSlot,
  ...rest
}: {
  label?: string;
  icon?: string;
  rightSlot?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="st-field">
      {label ? <span className="st-field-label">{label}</span> : null}
      <span className="st-field-box">
        {icon && (
          <svg className="st-field-ico" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill={C.onSurfaceVariant}>
            <path d={icon} />
          </svg>
        )}
        <input className="md3-input" style={icon ? { paddingLeft: 46 } : undefined} {...rest} />
        {rightSlot}
      </span>
    </label>
  );
}

/** Password field with a self-contained visibility toggle. */
function PasswordField({ label, ...rest }: { label?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <Field
      label={label}
      icon={LOCK_ICON}
      type={show ? "text" : "password"}
      rightSlot={
        <button
          type="button"
          tabIndex={-1}
          className="st-field-eye"
          aria-label={show ? "Hide password" : "Show password"}
          onClick={() => setShow((s) => !s)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d={show ? EYE_OFF_ICON : EYE_ICON} />
          </svg>
        </button>
      }
      {...rest}
    />
  );
}

/** Inline error alert — replaces bare red text with an app-grade callout. */
function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div className="st-alert" role="alert">
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, marginTop: 1 }}>
        <path d={WARN_ICON} />
      </svg>
      <span>{children}</span>
    </div>
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
  /** When provided, a glass branding bar (logo + business name + contacts)
   *  is pinned to the top and the back chevron moves into the bar. */
  appBar?: { logo: string; name: string; phone: string; email: string; address: string };
}) => (
  <div
    className="st-root"
    style={
      watermark
        ? { background: "#FFFFFF" }
        : background
        ? {
            backgroundImage: `url("${cssUrl(background)}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundColor: "#F8F9FA",
          }
        : undefined
    }
  >
    <style>{`
      @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
      @keyframes scrollBg { 0% { background-position: 0px 0px; } 100% { background-position: 120px 120px; } }
      @keyframes md3Slide { from { left: -40%; } to { left: 100%; } }
      @keyframes md3Flow { from { background-position: 0% 50%; } to { background-position: 150% 50%; } }
      @keyframes md3Spin { to { transform: rotate(360deg); } }

      .st-root {
        width: 100%;
        min-height: 100vh;
        font-family: ${font};
        background: linear-gradient(180deg, #F8F9FA 0%, #E3EEFC 100%);
        overflow-x: hidden;
        position: relative;
        box-sizing: border-box;
      }
      @supports (height: 100dvh) { .st-root { min-height: 100dvh; } }

      /* --- App bar --- */
      .st-appbar {
        position: fixed; top: 0; left: 0; right: 0; z-index: 20;
        background: rgba(255,255,255,0.88);
        -webkit-backdrop-filter: saturate(1.5) blur(12px);
        backdrop-filter: saturate(1.5) blur(12px);
        border-bottom: 1px solid ${C.outline};
        box-shadow: 0 1px 2px rgba(60,64,67,0.08);
        padding-top: env(safe-area-inset-top);
      }
      .st-appbar-inner {
        max-width: 1160px; margin: 0 auto; width: 100%;
        min-height: 64px; display: flex; align-items: center; gap: 12px;
        padding: 8px clamp(12px, 3vw, 28px); box-sizing: border-box;
      }
      .st-appbar-back {
        width: 42px; height: 42px; flex-shrink: 0; margin-left: -6px;
        border-radius: 50%; border: none; background: transparent; cursor: pointer;
        display: flex; align-items: center; justify-content: center; color: ${C.onSurface};
      }
      .st-appbar-back:hover { background: rgba(32,33,36,0.06); }
      .st-appbar-name {
        font-size: clamp(15px, 4.2vw, 18px); font-weight: 500; color: ${C.onSurface};
        line-height: 1.25; letter-spacing: -0.01em;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: left;
      }
      .st-appbar-phone {
        display: flex; align-items: center; gap: 5px; margin-top: 2px; min-width: 0;
        font-size: 12px; line-height: 1.2; color: ${C.onSurfaceVariant};
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      .st-barcontact {
        display: flex; align-items: center; justify-content: flex-end; gap: 6px; min-width: 0; max-width: 100%;
      }
      .st-barcontact-text {
        font-size: 12px; line-height: 1.2; color: ${C.onSurfaceVariant}; letter-spacing: 0.01em;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: right;
      }
      .appbar-contact { display: none; flex-direction: column; align-items: flex-end; gap: 3px; max-width: 42%; min-width: 0; }
      @media (min-width: 481px) { .appbar-contact { display: flex; } }

      /* --- Layouts --- */
      .st-centerwrap {
        position: relative; z-index: 1;
        display: flex; align-items: center; justify-content: center;
        padding: calc(84px + env(safe-area-inset-top)) clamp(14px, 4vw, 48px) clamp(52px, 9vh, 80px);
        box-sizing: border-box;
        min-height: 100vh; min-height: 100dvh;
      }
      .st-card {
        width: 100%; max-width: 432px;
        background: ${C.surface};
        border-radius: 24px;
        padding: clamp(26px, 5vw, 38px) clamp(20px, 5vw, 30px) clamp(24px, 4vw, 30px);
        box-shadow: 0 1px 3px rgba(60,64,67,0.30), 0 4px 8px 3px rgba(60,64,67,0.15);
        animation: fadeUp 0.35s cubic-bezier(0.2, 0, 0, 1);
        box-sizing: border-box; text-align: center; position: relative;
      }
      .st-watermark {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background-repeat: repeat; background-size: 120px 120px;
        opacity: 0.08; animation: scrollBg 30s linear infinite;
        z-index: 0; pointer-events: none;
      }
      .st-bgwash {
        position: absolute; top: 0; left: 0; right: 0; bottom: 0;
        background: linear-gradient(180deg, rgba(248,249,250,0.48) 0%, rgba(227,238,252,0.66) 100%);
        z-index: 0; pointer-events: none;
      }
      .st-version {
        position: absolute; bottom: 14px; left: 0; right: 0;
        text-align: center; color: ${C.onSurfaceVariant}; font-size: 12px;
        z-index: 10; pointer-events: none;
        padding-bottom: env(safe-area-inset-bottom);
      }

      /* --- Form primitives --- */
      .st-field { display: block; width: 100%; margin-bottom: 14px; text-align: left; }
      .st-field-label {
        display: block; font-size: 13px; font-weight: 500; color: ${C.onSurfaceVariant};
        margin: 0 2px 6px; letter-spacing: 0.01em;
      }
      .st-field-box { position: relative; display: block; }
      .st-field-box .md3-input {
        width: 100%; height: 52px; padding: 0 16px;
        border: 1px solid ${C.outline}; border-radius: 12px;
        background: #FFFFFF; font-size: 16px; color: ${C.onSurface};
        box-sizing: border-box; font-family: ${font}; outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease;
      }
      .st-field-box .md3-input:focus { border-color: ${C.primary} !important; box-shadow: 0 0 0 3px rgba(26,115,232,0.14) !important; }
      .st-field-box .md3-input::placeholder { color: #80868B; }
      .st-field-ico { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); pointer-events: none; }
      .st-field-eye {
        position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
        width: 40px; height: 40px; border: none; background: transparent; border-radius: 50%;
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        color: ${C.onSurfaceVariant};
      }
      .st-field-eye:hover { background: rgba(32,33,36,0.06); }
      .st-alert {
        display: flex; align-items: flex-start; gap: 8px;
        background: #FCE8E6; color: #B3261E;
        border-radius: 10px; padding: 10px 12px; margin: 0 0 12px;
        font-size: 13px; line-height: 1.45; text-align: left;
        animation: fadeUp 0.2s ease;
      }

      /* --- Buttons --- */
      .st-btn:not(:disabled):hover { box-shadow: 0 2px 6px 2px rgba(60,64,67,0.18), 0 1px 2px rgba(60,64,67,0.30) !important; }
      .st-btn:not(:disabled):active { transform: scale(0.985); }

      /* --- Extended FAB --- */
      .st-fab {
        position: fixed; right: 18px;
        bottom: max(18px, env(safe-area-inset-bottom));
        width: 56px; height: 56px; padding: 0; border-radius: 16px; border: none;
        background: ${C.primaryContainer}; color: ${C.onPrimaryContainer};
        box-shadow: 0 3px 6px rgba(60,64,67,0.24), 0 1px 2px rgba(60,64,67,0.30);
        cursor: pointer; display: flex; align-items: center; justify-content: center;
        z-index: 100;
        transition: transform 0.15s ease, box-shadow 0.15s ease;
      }
      .st-fab:hover { transform: scale(1.04); box-shadow: 0 6px 14px rgba(60,64,67,0.28), 0 2px 4px rgba(60,64,67,0.32); }
      .st-fab:active { transform: scale(0.97); }

      input:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px #FFFFFF inset; -webkit-text-fill-color: #202124; }

      @media (max-width: 480px) {
        .st-card { border-radius: 20px; }
        .st-fab { right: 14px; }
      }
      @media (prefers-reduced-motion: reduce) {
        .st-card, .st-alert { animation: none; }
        .st-watermark { animation: none; }
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
      <div className="st-watermark" style={{ backgroundImage: logo ? `url("${cssUrl(logo)}")` : "none" }} />
    )}

    {!watermark && background && <div className="st-bgwash" aria-hidden="true" />}

    <div className="st-centerwrap">
      <div className="st-card">
        {logo && !appBar && <SafeLogo src={logo} name={logoName} size={88} radius={22} />}
        {children}
      </div>
    </div>

    {version && <div className="st-version">Version {version}</div>}
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

  const h1Style: CSSProperties = {
    textAlign: "center",
    fontSize: "clamp(21px, 5vw, 24px)",
    fontWeight: 600,
    color: C.onSurface,
    letterSpacing: "-0.015em",
    margin: "0 0 8px",
    fontFamily: font,
  };

  const subStyle: CSSProperties = {
    textAlign: "center",
    fontSize: 14,
    color: C.onSurfaceVariant,
    margin: "0 0 22px",
    lineHeight: 1.5,
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
          <PasswordField
            placeholder="Enter Password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setMessage("");
            }}
            autoFocus
            autoComplete="current-password"
          />
          {message && <ErrorAlert>{message}</ErrorAlert>}
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
          <Field
            icon={PERSON_ICON}
            placeholder="Username"
            name="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <PasswordField
            placeholder="Password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {message && <ErrorAlert>{message}</ErrorAlert>}
          <TopLoader show={loading} />
          <MD3Button type="submit" loading={loading} loadingLabel="Signing in…">
            Login
          </MD3Button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <div style={{ position: "relative", width: "100%", minHeight: "100vh" }}>
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
          <Field
            icon={BRIEFCASE_ICON}
            placeholder="Enter Institution Name"
            type="text"
            value={businessName}
            onChange={(e) => {
              setBusinessName(e.target.value);
              setLookupError("");
            }}
            autoFocus
            autoComplete="organization"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          {lookupError && <ErrorAlert>{lookupError}</ErrorAlert>}
          <TopLoader show={lookupLoading} />
          <MD3Button type="submit" loading={lookupLoading} loadingLabel="Finding…" disabled={!businessName.trim()}>
            Continue
          </MD3Button>
        </form>
      </AuthLayout>

      {/* MD3 extended FAB — labelled so the action is discoverable */}
      <button
        className="st-fab"
        onClick={handleStartAdminRegister}
        title="Register New Institution"
        aria-label="Register New Institution"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </div>
  );
}
