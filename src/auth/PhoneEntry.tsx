// src/auth/PhoneEntry.tsx
import { useState } from "react";
import AppBar from "../components/AppBar";
import { sendATCode } from "../api/authApi";
import { supabase } from "../auth/supabase";

export default function PhoneEntry({ onSent }: { onSent: (phone: string) => void }) {
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const MEDICAL_BLUE = "#007AFF";

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    
    // Enhanced validation to prevent API formatting errors
    if (phone.trim().length < 10 || !phone.match(/^\+?\d{10,15}$/)) {
      setError("Please enter a valid phone number (e.g., +256712345678)");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const { data: existingTenant, error: checkError } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", phone.trim())
        .maybeSingle();

      if (checkError) {
        console.warn("Tenant check failed:", checkError);
      } else if (existingTenant) {
        setError(`This phone is already registered${existingTenant.business_name ? ` for "${existingTenant.business_name}"` : ""}. Please login instead.`);
        return;
      }

      await sendATCode(phone.trim());
      onSent(phone.trim());
    } catch (err: any) {
      setError(err.message || "Failed to send verification code");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none",
    background: "transparent", fontSize: "16px", color: "#1C1C1E", boxSizing: "border-box"
  };

  return (
    <div style={{ width: "100%", height: "100vh", background: "#F2F2F7", display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", overflow: "hidden" }}>
      <AppBar />

      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "36px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>

          <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Create New Account</h1>
          <p style={{ textAlign: "center", fontSize: "14px", color: "#8E8E93", marginBottom: "24px" }}>Enter your phone number to verify and get started</p>

          <form onSubmit={handleSend}>
            <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
              <input
                type="tel"
                placeholder="Phone number (+256...)"
                value={phone}
                onChange={e => { setPhone(e.target.value); setError(""); }}
                style={inputStyle}
                autoFocus
              />
            </div>

            {error && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{error}</p>}

            <button
              type="submit"
              disabled={loading || phone.trim().length < 10}
              style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: (loading || phone.trim().length < 10) ? "not-allowed" : "pointer", opacity: (loading || phone.trim().length < 10) ? 0.4 : 1 }}
            >
              {loading ? "Sending..." : "Send Verification Code"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}