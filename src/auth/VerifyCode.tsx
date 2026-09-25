import { useState, useEffect } from "react";
import { verifyATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

export default function VerifyCode({ phone, onVerified, onBack }: { phone: string; onVerified: (token: string) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [appVersion, setAppVersion] = useState("");
  const [branding, setBranding] = useState<any>(null);

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
    supabase.from('business_settings').select('logo, login_background').limit(1).maybeSingle().then(({ data }) => {
      if (data) setBranding(data);
    });
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
      backgroundImage: branding?.login_background ? `url(${branding.login_background})` : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      backgroundSize: "cover", backgroundPosition: "center",
      fontFamily: iosFont, overflow: "hidden", position: "relative", padding: "24px" 
    }}>
      <style>{`@keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {branding?.login_background && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)" }} />}

      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", backdropFilter: "blur(10px)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>

      <div style={{ 
        position: "relative", zIndex: 1, width: "100%", maxWidth: "400px", 
        background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)", 
        borderRadius: "28px", padding: "40px 32px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", 
        border: "1px solid rgba(255,255,255,0.6)", animation: "fadeUp 0.6s ease-out" 
      }}>
        <img src={branding?.logo || "/loadlogo.png"} alt="App Logo" style={{ width: "80px", height: "80px", borderRadius: "20px", marginBottom: "24px", objectFit: "cover", display: "block", margin: "0 auto" }} />
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

      {appVersion && <div style={{ position: "absolute", bottom: "20px", width: "100%", textAlign: "center", color: branding?.login_background ? "rgba(255,255,255,0.8)" : "#8E8E93", fontSize: "12px", zIndex: 10, pointerEvents: "none" }}>Version {appVersion}</div>}
    </div>
  );
}