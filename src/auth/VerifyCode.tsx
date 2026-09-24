import { useState } from "react";
import { verifyATCode } from "../api/authApi";

const MEDICAL_BLUE = "#007AFF";

export default function VerifyCode({ phone, onVerified, onBack }: { phone: string; onVerified: (token: string) => void; onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
    background: "#F2F2F7", fontSize: "24px", color: "#1C1C1E", boxSizing: "border-box",
    textAlign: "center", letterSpacing: "8px", fontWeight: "600", borderRadius: "12px", marginBottom: "12px"
  };

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "-apple-system, sans-serif", overflow: "hidden", position: "relative", padding: "24px" }}>
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: MEDICAL_BLUE, zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      <div style={{ width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", alignItems: "center", animation: "fadeUp 0.6s ease-out" }}>
        <img src="/applogo.png" alt="App Logo" style={{ width: "96px", height: "96px", borderRadius: "20px", marginBottom: "32px", objectFit: "contain" }} />
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Verify Code</h1>
        <p style={{ color: "#8E8E93", fontSize: "15px", marginBottom: "32px", textAlign: "center" }}>We sent a code to {phone}</p>
        
        <form onSubmit={handleVerify} style={{ width: "100%" }}>
          <input 
            type="text" 
            inputMode="numeric" 
            autoComplete="one-time-code"
            maxLength={6} 
            placeholder="000000" 
            value={code} 
            onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))} 
            style={inputStyle} 
            autoFocus 
          />
          {error && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{error}</p>}
          <button type="submit" disabled={loading || code.length < 6} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: (loading || code.length < 6) ? "not-allowed" : "pointer", opacity: (loading || code.length < 6) ? 0.4 : 1, transition: "opacity 0.2s" }}>
            {loading ? "Verifying..." : "Verify"}
          </button>
        </form>
      </div>
    </div>
  );
}