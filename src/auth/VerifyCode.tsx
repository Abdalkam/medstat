// src/auth/VerifyCode.tsx
import { useState } from "react";
import AppBar from "../components/AppBar";
import { verifyATCode } from "../api/authApi";

export default function VerifyCode({ phone, onVerified }: { phone: string; onVerified: (token: string) => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const MEDICAL_BLUE = "#007AFF";

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 6) {
      setError("Please enter the 6-digit code");
      return;
    }

    setLoading(true);
    setError("");

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
    width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none",
    background: "transparent", fontSize: "20px", color: "#1C1C1E", boxSizing: "border-box",
    textAlign: "center", letterSpacing: "8px", fontWeight: "600"
  };

  return (
    <div style={{ width: "100%", height: "100vh", background: "#F2F2F7", display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", overflow: "hidden" }}>
      <AppBar />

      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "36px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>

          <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Enter Verification Code</h1>
          <p style={{ textAlign: "center", fontSize: "14px", color: "#8E8E93", marginBottom: "24px" }}>We sent a 6-digit code to {phone}</p>

          <form onSubmit={handleVerify}>
            <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                style={inputStyle}
                autoFocus
              />
            </div>

            {error && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{error}</p>}

            <button
              type="submit"
              disabled={loading || code.length < 6}
              style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: (loading || code.length < 6) ? "not-allowed" : "pointer", opacity: (loading || code.length < 6) ? 0.4 : 1 }}
            >
              {loading ? "Verifying..." : "Verify Code"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}