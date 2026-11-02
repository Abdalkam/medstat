import { useState, useEffect } from "react";
import { verifyATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

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

export default function VerifyCode({ phone, onVerified, onBack }: { phone: string; onVerified: (token: string) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const branding = useAppBranding();

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
  }, []);

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length !== 6) { setError("Please enter the 6-digit code"); return; }
    setLoading(true); setError("");
    try {
      const result = await verifyATCode(phone, code);
      if (!result.token) throw new Error("No token received");
      onVerified(result.token);
    } catch (err: any) {
      setError(err.message || "Verification failed");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "60px", padding: "0 16px", border: "none", outline: "none",
    background: "rgba(255,255,255,0.8)", fontSize: "24px", color: "#1C1C1E", boxSizing: "border-box",
    textAlign: "center", letterSpacing: "8px", fontWeight: "600", borderRadius: "14px", marginBottom: "12px"
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%", height: "54px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE,
    color: "white", fontSize: "17px", fontWeight: "600", cursor: "pointer",
    opacity: loading ? 0.4 : 1, boxShadow: "0 4px 12px rgba(0,122,255,0.3)"
  };

  return (
    <div style={{
      width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      backgroundImage: branding.loginBackground ? `url("${branding.loginBackground}")` : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      backgroundSize: "cover", backgroundPosition: "center",
      fontFamily: iosFont, overflow: "hidden", position: "relative", padding: "24px"
    }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {branding.loginBackground && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)" }} />}

      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", backdropFilter: "blur(10px)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      <div style={{
        position: "relative", zIndex: 1, width: "100%", maxWidth: "400px",
        background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)",
        borderRadius: "28px", padding: "40px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        border: "1px solid rgba(255,255,255,0.6)", animation: "fadeUp 0.6s ease-out"
      }}>
        <AppLogo size={80} radius={20} marginBottom={24} />
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px", textAlign: "center" }}>Verify Code</h1>
        <p style={{ color: "#8E8E93", fontSize: "15px", marginBottom: "24px", textAlign: "center" }}>We sent a code to {phone}</p>

        <form onSubmit={handleVerify} style={{ width: "100%" }}>
          <input
            type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
            placeholder="000000" value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
            style={inputStyle} autoFocus
          />
          {error && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{error}</p>}
          <button type="submit" disabled={loading || code.length < 6} style={primaryBtn}>
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>
      </div>

      {appVersion && <div style={{ position: "absolute", bottom: "20px", width: "100%", textAlign: "center", color: branding.loginBackground ? "rgba(255,255,255,0.8)" : "#8E8E93", fontSize: "12px", zIndex: 10, pointerEvents: "none" }}>Version {appVersion}</div>}
    </div>
  );
}