// src/screens/VerifyCode.tsx
// OTP verification screen.
// The API layer normalizes the backend's `tempToken` response to `token`.

import { useEffect, useState } from "react";
import type { FormEvent, CSSProperties } from "react";
import { verifyATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const IOS_FONT = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

interface BrandingData {
  businessName: string;
  logo: string;
  loginBackground: string;
}

function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";

  if (raw.startsWith("data:")) {
    const match = raw.match(/^(data:image\/[a-z.+-]+;base64,)([\s\S]*)$/i);
    return match ? match[1] + match[2].replace(/\s+/g, "") : raw;
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
    else if (compact.startsWith("PHN2Zy") || compact.startsWith("PD94bW")) {
      mime = "image/svg+xml";
    }

    return `data:${mime};base64,${compact}`;
  }

  return raw;
}

function readCachedBranding(): BrandingData | null {
  try {
    const merged: BrandingData = {
      businessName: "",
      logo: "",
      loginBackground: "",
    };

    for (const key of ["institutionBranding", "localBusinessSettings"]) {
      const raw = localStorage.getItem(key);
      if (!raw) continue;

      const settings = JSON.parse(raw);

      merged.businessName =
        settings.businessName ??
        settings.business_name ??
        merged.businessName;

      merged.logo = normalizeImageSrc(settings.logo) || merged.logo;

      merged.loginBackground =
        normalizeImageSrc(
          settings.loginBackground ?? settings.login_background,
        ) || merged.loginBackground;
    }

    return merged.businessName || merged.logo || merged.loginBackground
      ? merged
      : null;
  } catch {
    return null;
  }
}

function useAppBranding(): BrandingData {
  const [branding, setBranding] = useState<BrandingData>(
    () =>
      readCachedBranding() ?? {
        businessName: "",
        logo: "",
        loginBackground: "",
      },
  );

  useEffect(() => {
    const tenantId = localStorage.getItem("institutionTenantId");
    if (!tenantId) return;

    let alive = true;

    async function loadBranding() {
      try {
        const { data, error } = await supabase
          .from("business_settings")
          .select("business_name, logo, login_background")
          .eq("tenant_id", tenantId)
          .maybeSingle();

        if (!alive || error || !data) return;

        setBranding((previous) => {
          const merged: BrandingData = {
            businessName: data.business_name || previous.businessName,
            logo: normalizeImageSrc(data.logo) || previous.logo,
            loginBackground:
              normalizeImageSrc(data.login_background) ||
              previous.loginBackground,
          };

          try {
            let cached: Record<string, unknown> = {};

            try {
              cached = JSON.parse(
                localStorage.getItem("institutionBranding") || "{}",
              );
            } catch {
              // Ignore invalid cached branding.
            }

            localStorage.setItem(
              "institutionBranding",
              JSON.stringify({
                ...cached,
                businessName: merged.businessName,
                logo: merged.logo,
                loginBackground: merged.loginBackground,
              }),
            );
          } catch {
            // Storage may be unavailable or full.
          }

          return merged;
        });
      } catch {
        // Offline: continue using cached branding.
      }
    }

    void loadBranding();

    return () => {
      alive = false;
    };
  }, []);

  return branding;
}

function AppLogo({
  size = 80,
  radius = 20,
  marginBottom = 24,
}: {
  size?: number;
  radius?: number;
  marginBottom?: number;
}) {
  const branding = useAppBranding();
  const [failedBrand, setFailedBrand] = useState(false);
  const [failedDefault, setFailedDefault] = useState(false);

  useEffect(() => {
    setFailedBrand(false);
  }, [branding.logo]);

  const showBrand = Boolean(branding.logo) && !failedBrand;
  const showDefault = !showBrand && !failedDefault;

  const imageStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
  };

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        margin: `0 auto ${marginBottom}px`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {showBrand ? (
        <img
          src={branding.logo}
          alt={branding.businessName ? `${branding.businessName} logo` : "App logo"}
          onError={() => setFailedBrand(true)}
          style={imageStyle}
        />
      ) : showDefault ? (
        <img
          src="/loadlogo.png"
          alt="App logo"
          onError={() => setFailedDefault(true)}
          style={imageStyle}
        />
      ) : (
        <span
          style={{
            fontSize: Math.round(size * 0.4),
            fontWeight: 600,
            color: MEDICAL_BLUE,
            lineHeight: 1,
          }}
        >
          {(branding.businessName || "M").trim().charAt(0).toUpperCase()}
        </span>
      )}
    </div>
  );
}

interface VerifyCodeProps {
  phone: string;
  onVerified: (token: string) => void;
  onBack: () => void;
}

export default function VerifyCode({
  phone,
  onVerified,
  onBack,
}: VerifyCodeProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const branding = useAppBranding();

  useEffect(() => {
    getVersion()
      .then(setAppVersion)
      .catch(() => {
        // Running in a browser rather than the Tauri desktop app.
      });
  }, []);

  async function handleVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (code.length !== 6) {
      setError("Please enter the 6-digit code.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const result = await verifyATCode(phone, code);

      if (!result.token) {
        throw new Error("Verification succeeded without a temporary token.");
      }

      onVerified(result.token);
    } catch (cause) {
      const message =
        cause instanceof Error ? cause.message : "Verification failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: CSSProperties = {
    width: "100%",
    height: "60px",
    padding: "0 16px",
    border: "none",
    outline: "none",
    background: "rgba(255,255,255,0.8)",
    fontSize: "24px",
    color: "#1C1C1E",
    boxSizing: "border-box",
    textAlign: "center",
    letterSpacing: "8px",
    fontWeight: 600,
    borderRadius: "14px",
    marginBottom: "12px",
  };

  const primaryButtonStyle: CSSProperties = {
    width: "100%",
    height: "54px",
    borderRadius: "14px",
    border: "none",
    background: MEDICAL_BLUE,
    color: "white",
    fontSize: "17px",
    fontWeight: 600,
    cursor: loading ? "wait" : "pointer",
    opacity: loading ? 0.65 : 1,
    boxShadow: "0 4px 12px rgba(0,122,255,0.3)",
  };

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxSizing: "border-box",
        backgroundImage: branding.loginBackground
          ? `url("${branding.loginBackground}")`
          : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
        backgroundSize: "cover",
        backgroundPosition: "center",
        fontFamily: IOS_FONT,
        overflow: "hidden",
        position: "relative",
        padding: "24px",
      }}
    >
      <style>
        {`
          @keyframes fadeUp {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}
      </style>

      {branding.loginBackground && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,0.4)",
          }}
        />
      )}

      <button
        type="button"
        onClick={onBack}
        aria-label="Go back"
        style={{
          position: "absolute",
          top: "24px",
          left: "24px",
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          background: branding.loginBackground
            ? "rgba(255,255,255,0.2)"
            : "rgba(0,0,0,0.06)",
          backdropFilter: "blur(10px)",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: branding.loginBackground ? "#fff" : "#1C1C1E",
          zIndex: 10,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          width: "100%",
          maxWidth: "400px",
          boxSizing: "border-box",
          background: "rgba(255,255,255,0.88)",
          backdropFilter: "blur(30px)",
          borderRadius: "28px",
          padding: "40px 32px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
          border: "1px solid rgba(255,255,255,0.6)",
          animation: "fadeUp 0.6s ease-out",
        }}
      >
        <AppLogo size={80} radius={20} marginBottom={24} />

        <h1
          style={{
            fontSize: "24px",
            color: "#1C1C1E",
            fontWeight: 700,
            margin: "0 0 8px",
            textAlign: "center",
          }}
        >
          Verify Code
        </h1>

        <p
          style={{
            color: "#8E8E93",
            fontSize: "15px",
            margin: "0 0 24px",
            textAlign: "center",
          }}
        >
          We sent a code to {phone}
        </p>

        <form onSubmit={handleVerify} style={{ width: "100%" }}>
          <input
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={code}
            onChange={(event) => {
              setCode(event.target.value.replace(/\D/g, "").slice(0, 6));
              if (error) setError("");
            }}
            style={inputStyle}
            autoFocus
            aria-label="Six-digit verification code"
            aria-invalid={Boolean(error)}
          />

          {error && (
            <p
              role="alert"
              style={{
                textAlign: "center",
                color: "#FF3B30",
                fontSize: "14px",
                margin: "0 0 12px",
              }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || code.length !== 6}
            style={primaryButtonStyle}
          >
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>
      </div>

      {appVersion && (
        <div
          style={{
            position: "absolute",
            bottom: "20px",
            width: "100%",
            textAlign: "center",
            color: branding.loginBackground
              ? "rgba(255,255,255,0.8)"
              : "#8E8E93",
            fontSize: "12px",
            zIndex: 10,
            pointerEvents: "none",
          }}
        >
          Version {appVersion}
        </div>
      )}
    </div>
  );
}
