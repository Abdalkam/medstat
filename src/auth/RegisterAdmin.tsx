import { useState, useEffect } from "react";
import { registerTenant } from "../api/authApi";
import { addUser } from "../database/userDB";
import { supabase } from "../auth/supabase";

const MEDICAL_BLUE = "#007AFF";

export default function RegisterAdmin({ phone, tempToken, onComplete, onBack }: { phone: string; tempToken: string; onComplete: (user: any) => void; onBack: () => void }) {
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => { checkExistingAccount(); }, []);

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
    if (!businessName.trim() || !username.trim() || !password.trim() || !confirmPassword.trim()) { 
      setMessage("Please fill all fields"); 
      return; 
    }
    if (password.length < 6) {
      setMessage("Password must be at least 6 characters");
      return;
    }
    if (password !== confirmPassword) { setMessage("Passwords do not match"); return; }

    try {
      setLoading(true);
      const result = await registerTenant({ phone, tempToken, businessName: businessName.trim(), username: username.trim(), password });
      const localUser = { 
        id: result.userId, 
        username: username.trim(), 
        phone, 
        email: "", 
        profilePic: "", 
        role: "admin" as const, 
        tenantId: result.tenantId, 
        assignedCourses: [] as string[], 
        createdAt: new Date().toISOString(), 
        password, 
        synced: true 
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
    width: "100%", height: "56px", padding: "0 16px", border: "none", outline: "none",
    background: "#F2F2F7", fontSize: "17px", color: "#1C1C1E", boxSizing: "border-box",
    borderRadius: "12px", marginBottom: "12px"
  };

  if (checking) {
    return (
      <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "-apple-system, sans-serif", overflow: "hidden", position: "relative" }}>
        <div style={{ width: "40px", height: "40px", border: "3px solid #E5E5EA", borderTopColor: MEDICAL_BLUE, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: "-apple-system, sans-serif", overflow: "auto", position: "relative", padding: "80px 24px 40px" }}>
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
        <h1 style={{ fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "32px" }}>Set Up Institution</h1>
        
        <form onSubmit={(e) => { e.preventDefault(); createAdmin(); }} style={{ width: "100%" }}>
          <input 
            placeholder="Institution Name" 
            value={businessName} 
            onChange={e => setBusinessName(e.target.value)} 
            style={inputStyle} 
            autoFocus 
            autoComplete="organization"
          />
          <input 
            placeholder="Verified Phone" 
            value={phone} 
            disabled 
            style={{ ...inputStyle, background: "#E5E5EA", color: "#8E8E93", cursor: "not-allowed" }} 
          />
          <input 
            placeholder="Admin Username" 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            style={inputStyle} 
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input 
            type="password" 
            placeholder="Password (min 6 chars)" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            style={inputStyle} 
            autoComplete="new-password"
          />
          <input 
            type="password" 
            placeholder="Re-enter Password" 
            value={confirmPassword} 
            onChange={e => setConfirmPassword(e.target.value)} 
            style={inputStyle} 
            autoComplete="new-password"
          />

          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{message}</p>}
          
          <button type="submit" disabled={loading} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.4 : 1, transition: "opacity 0.2s" }}>
            {loading ? "Creating..." : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  );
}