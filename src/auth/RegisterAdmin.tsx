import { useState, useEffect } from "react";
import { registerTenant } from "../api/authApi";
import { addUser } from "../database/userDB";
import { supabase } from "../auth/supabase";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

export default function RegisterAdmin({ phone, tempToken, onComplete, onBack }: { phone: string; tempToken: string; onComplete: (user: any) => void; onBack: () => void }) {
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [appVersion, setAppVersion] = useState("");
  const [branding, setBranding] = useState<any>(null);

  useEffect(() => {
    getVersion().then(v => setAppVersion(v)).catch(() => {});
    supabase.from('business_settings').select('logo, login_background').limit(1).maybeSingle().then(({ data }) => {
      if (data) setBranding(data);
    });
    checkExistingAccount(); 
  }, []);

  async function checkExistingAccount() {
    try {
      const { data: existingTenant } = await supabase.from("tenants").select("id, business_name").eq("phone", phone).maybeSingle();
      if (existingTenant) {
        setMessage(`This phone is already registered. Please login instead.`);
        setTimeout(() => onComplete(null), 3000);
        setChecking(false);
        return;
      }
    } catch (err) { console.error(err); }
    setChecking(false);
  }

  async function createAdmin() {
    setMessage("");
    if (!businessName.trim() || !username.trim() || !password.trim() || !confirmPassword.trim()) { setMessage("Please fill all fields"); return; }
    if (password !== confirmPassword) { setMessage("Passwords do not match"); return; }

    try {
      setLoading(true);
      const result = await registerTenant({ phone, tempToken, businessName: businessName.trim(), username: username.trim(), password });
      const localUser = { 
        id: result.userId, username: username.trim(), phone, email: "", profilePic: "", 
        role: "admin" as const, tenantId: result.tenantId, assignedCourses: [] as string[], 
        createdAt: new Date().toISOString(), password, synced: true 
      };
      await addUser(localUser);
      localStorage.setItem("currentUser", JSON.stringify(localUser));
      localStorage.setItem("authToken", result.authToken);
      window.dispatchEvent(new Event("authStateChanged"));
      onComplete(localUser);
    } catch (error: any) {
      setMessage(error.message || "Failed to create admin");
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "54px", padding: "0 16px", border: "none", outline: "none",
    background: "rgba(255,255,255,0.8)", fontSize: "17px", color: "#1C1C1E", boxSizing: "border-box",
    borderRadius: "14px", marginBottom: "12px"
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%", height: "54px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE,
    color: "white", fontSize: "17px", fontWeight: "600", cursor: "pointer", 
    opacity: loading ? 0.4 : 1, boxShadow: "0 4px 12px rgba(0,122,255,0.3)"
  };

  if (checking) {
    return (
      <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F2F2F7", fontFamily: iosFont }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid #E5E5EA", borderTopColor: MEDICAL_BLUE, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ 
      width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", 
      backgroundImage: branding?.login_background ? `url(${branding.login_background})` : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      backgroundSize: "cover", backgroundPosition: "center",
      fontFamily: iosFont, overflow: "auto", position: "relative", padding: "80px 24px 40px" 
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
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px", textAlign: "center" }}>Set Up Institution</h1>
        
        <form onSubmit={(e) => { e.preventDefault(); createAdmin(); }} style={{ width: "100%" }}>
          <input placeholder="Institution Name" value={businessName} onChange={e => setBusinessName(e.target.value)} style={inputStyle} autoFocus />
          <input placeholder="Verified Phone" value={phone} disabled style={{ ...inputStyle, background: "#E5E5EA", color: "#8E8E93", cursor: "not-allowed" }} />
          <input placeholder="Admin Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} autoCapitalize="none" />
          <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
          <input type="password" placeholder="Re-enter Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />

          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{message}</p>}
          <button type="submit" disabled={loading} style={primaryBtn}>{loading ? "Creating..." : "Create Account"}</button>
        </form>
      </div>

      {appVersion && <div style={{ position: "absolute", bottom: "20px", width: "100%", textAlign: "center", color: branding?.login_background ? "rgba(255,255,255,0.8)" : "#8E8E93", fontSize: "12px", zIndex: 10, pointerEvents: "none" }}>Version {appVersion}</div>}
    </div>
  );
}