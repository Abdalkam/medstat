import { useState } from "react";
import { sendATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";

const MEDICAL_BLUE = "#007AFF";

export default function PhoneEntry({ onSent, onBack }: { onSent: (phone: string) => void; onBack: () => void }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const cleanPhone = phone.replace(/\s/g, "").trim();
    
    if (cleanPhone.length < 10 || !cleanPhone.match(/^\+?\d{10,15}$/)) {
      setError("Please enter a valid phone number (e.g., +256712345678)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: existingTenant, error: checkError } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", cleanPhone)
        .maybeSingle();

      if (checkError) {
        console.warn("Tenant check failed:", checkError);
      } else if (existingTenant) {
        setError(`This phone is already registered${existingTenant.business_name ? ` for "${existingTenant.business_name}"` : ""}. Please login instead.`);
        setLoading(false);
        return;
      }

      await sendATCode(cleanPhone);
      onSent(cleanPhone);
    } catch (err: any) {
      setError(err.message || "Failed to send verification code. Check your network.");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "56px", padding: "0 16px", border: "none", outline: "none",
    background: "#F2F2F7", fontSize: "17px", color: "#1C1C1E", boxSizing: "border-box",
    borderRadius: "12px", marginBottom: "12px"
  };

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "-apple-system, sans-serif", overflow: "hidden", position: "relative", padding: "24px" }}>
      <style>{`
        @keyframes scrollBg {
          0% { background-position: 0px 0px; }
          100% { background-position: 120px 120px; }
        }
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
      
      {/* Animated Watermark Background */}
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: "url(/applogo.png)",
        backgroundRepeat: "repeat",
        backgroundSize: "120px 120px",
        opacity: 0.08, // Slightly more visible
        animation: "scrollBg 30s linear infinite",
        zIndex: 0
      }} />

      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: MEDICAL_BLUE, zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
      
      <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", alignItems: "center", animation: "fadeUp 0.6s ease-out" }}>
        <img src="/applogo.png" alt="App Logo" style={{ width: "96px", height: "96px", borderRadius: "20px", marginBottom: "32px", objectFit: "contain" }} />
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Create Account</h1>
        <p style={{ color: "#8E8E93", fontSize: "15px", marginBottom: "32px", textAlign: "center" }}>Enter your phone number to get started</p>
        
        <form onSubmit={handleSend} style={{ width: "100%" }}>
          <input 
            type="tel" 
            placeholder="Phone number (+256...)" 
            value={phone} 
            onChange={e => { setPhone(e.target.value); setError(""); }} 
            style={inputStyle} 
            autoFocus 
            autoComplete="tel"
          />
          {error && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{error}</p>}
          <button type="submit" disabled={loading || phone.trim().length < 10} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: (loading || phone.trim().length < 10) ? "not-allowed" : "pointer", opacity: (loading || phone.trim().length < 10) ? 0.4 : 1, transition: "opacity 0.2s" }}>
            {loading ? "Sending..." : "Send Code"}
          </button>
        </form>
      </div>
    </div>
  );
}