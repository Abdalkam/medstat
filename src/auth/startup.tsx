import { useState, useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginUser, addUser } from "../database/userDB";
import { loginTenant } from "../api/authApi";
import { pullAllTenantData, enableSyncHooks, startPeriodicPull, stopPeriodicPull, pullSettings } from "../database/sync";
import { supabase } from "../auth/supabase";
import PhoneEntry from "./PhoneEntry";
import VerifyCode from "./VerifyCode";
import RegisterAdmin from "./RegisterAdmin";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

type AppScreen = "main" | "login" | "admin_sms" | "admin_otp" | "admin_register";

const ScreenWrapper = ({ children, showBack, onBack }: { children: React.ReactNode, showBack?: boolean, onBack?: () => void }) => (
  <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#FFFFFF", fontFamily: iosFont, overflow: "hidden", position: "relative", padding: "24px" }}>
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

    {showBack && onBack && (
      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: MEDICAL_BLUE, zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
    )}
    <div style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: "400px", display: "flex", flexDirection: "column", alignItems: "center", animation: "fadeUp 0.6s ease-out" }}>
      {children}
    </div>
  </div>
);

export default function Startup() {
  const location = useLocation();
  const [redirectRoute, setRedirectRoute] = useState<string | null>(null);
  const [screen, setScreen] = useState<AppScreen>("main");
  const [branding, setBranding] = useState<{ businessName: string; logo: string; phone: string } | null>(null);

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
  const isLoggingIn = useRef(false);

  useEffect(() => {
    supabase.from('business_settings').select('business_name, logo, phone').limit(1).maybeSingle().then(({ data }) => {
      if (data) setBranding({ businessName: data.business_name || "", logo: data.logo || "", phone: data.phone || "" });
    });

    const storedUser = localStorage.getItem("currentUser");
    if (storedUser && location.pathname === "/") {
      try {
        const userObj = JSON.parse(storedUser);
        if (userObj?.id) {
          setRequiresUnlock(true);
          setUsername(userObj.username || "");
          setTenantId(userObj.tenantId || null);
        }
      } catch {
        localStorage.removeItem("currentUser");
      }
    }
    return () => { stopPeriodicPull(); };
  }, [location.pathname]);

  function handleStartAdminRegister() { setScreen("admin_sms"); }
  function handleSmsSent(phone: string) { setPhoneNumber(phone); setScreen("admin_otp"); }
  function handleOtpVerified(token: string) { setTempToken(token); setScreen("admin_register"); }

  async function handleAdminCreated(user: any) {
    if (user) {
      enableSyncHooks();
      startPeriodicPull(60000);
      try { await pullAllTenantData(user.tenantId); } catch(e) { console.error(e); }
      if (user.role === "admin") setRedirectRoute("/admin");
      else setRedirectRoute("/user");
    } else {
      setScreen("main");
    }
  }

  async function handleTrainerLookup() {
    setLookupError("");
    if (!businessName.trim()) return setLookupError("Please enter your institution name");
    setLookupLoading(true);
    try {
      const { data: tenant, error } = await supabase.from("tenants").select("id").ilike("business_name", businessName.trim()).maybeSingle();
      if (error || !tenant?.id) return setLookupError("Institution not found. Check the spelling or ask your Admin.");
      setTenantId(tenant.id);
      setScreen("login");
    } catch (err: any) {
      setLookupError(err.message || "Network error.");
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleLogin() {
    setMessage("");
    if (!username.trim() || !password.trim()) return setMessage("Please enter username and password");
    if (!tenantId) return setMessage("Session error. Please go back and re-select institution.");

    try {
      setLoading(true);
      isLoggingIn.current = true;
      try {
        const result = await loginTenant({ tenantId, username, password });
        const safeUser = {
          id: result.user.id, username: result.user.username, email: result.user.email || "",
          phone: result.user.phone || "", profilePic: (result.user as any).profile_pic || "",
          role: result.user.role, tenantId: result.user.tenantId, assignedCourses: result.user.assigned_courses || [],
          createdAt: (result.user as any).created_at || new Date().toISOString(), password, synced: true,
        };
        await addUser(safeUser);
        localStorage.setItem("currentUser", JSON.stringify(safeUser));
        localStorage.setItem("authToken", result.authToken);
        window.dispatchEvent(new Event("authStateChanged"));
        enableSyncHooks();
        startPeriodicPull(60000);
        if (safeUser.tenantId) {
          pullAllTenantData(safeUser.tenantId).catch(() => {});
          pullSettings().catch(() => {});
        }
        if (safeUser.role === "admin") setRedirectRoute("/admin");
        else if (safeUser.role === "trainer") setRedirectRoute("/trainer");
        else setRedirectRoute("/user");
        return;
      } catch (backendError) {
        console.warn("Backend login failed, trying offline...", backendError);
      }

      const user = await loginUser(username, password);
      if (!user) throw new Error("Invalid username or password");

      const safeUser = {
        id: user.id, username: user.username, email: user.email || "", phone: user.phone || "",
        profilePic: user.profilePic || "", role: user.role, tenantId: (user as any).tenant_id || (user as any).tenantId,
        assignedCourses: user.assignedCourses || [], createdAt: user.createdAt, synced: user.synced || false
      };
      localStorage.setItem("currentUser", JSON.stringify(safeUser));
      localStorage.setItem("authToken", "offline-mode-pending-sync");
      window.dispatchEvent(new Event("authStateChanged"));
      enableSyncHooks();
      startPeriodicPull(60000);
      try { await pullAllTenantData(safeUser.tenantId); } catch(e) { console.error(e); }
      if (user.role === "admin") setRedirectRoute("/admin");
      else if (user.role === "trainer") setRedirectRoute("/trainer");
      else setRedirectRoute("/user");
    } catch (error: any) {
      isLoggingIn.current = false;
      setMessage(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  if (redirectRoute) return <Navigate to={redirectRoute} replace />;

  const inputStyle: React.CSSProperties = { 
    width: "100%", 
    height: "56px", 
    padding: "0 16px", 
    border: "none", 
    outline: "none", 
    background: "#F2F2F7", 
    fontSize: "17px", 
    color: "#1C1C1E", 
    boxSizing: "border-box", 
    borderRadius: "12px", 
    marginBottom: "12px" 
  };

  // Admin Auth Flow Routing
  if (screen === "admin_sms") return <PhoneEntry onSent={handleSmsSent} onBack={() => setScreen("main")} />;
  if (screen === "admin_otp") return <VerifyCode phone={phoneNumber} onVerified={handleOtpVerified} onBack={() => setScreen("admin_sms")} />;
  if (screen === "admin_register") return <RegisterAdmin phone={phoneNumber} tempToken={tempToken || ""} onComplete={handleAdminCreated} onBack={() => setScreen("admin_otp")} />;

  if (requiresUnlock) {
    const storedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return (
      <ScreenWrapper showBack onBack={() => { 
        stopPeriodicPull(); 
        localStorage.removeItem("currentUser"); 
        localStorage.removeItem("authToken"); 
        setRequiresUnlock(false); 
        setPassword(""); 
        setUsername("");
      }}>
        <div style={{ width: "96px", height: "96px", borderRadius: "24px", overflow: "hidden", marginBottom: "32px", background: "#F2F2F7", display: "flex", justifyContent: "center", alignItems: "center", color: MEDICAL_BLUE, fontSize: "36px", fontWeight: "700" }}>
          {storedUser.profilePic ? <img src={storedUser.profilePic} alt="Profile" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : storedUser.username?.charAt(0).toUpperCase() || "?"}
        </div>
        <h2 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Welcome back</h2>
        <p style={{ textAlign: "center", fontSize: "15px", color: "#8E8E93", marginBottom: "32px" }}>Enter your password to continue.</p>
        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} style={{ width: "100%" }}>
          <input 
            type="password" 
            placeholder="Enter Password" 
            value={password} 
            onChange={e => { setPassword(e.target.value); setMessage(""); }} 
            style={inputStyle} 
            autoFocus 
            autoComplete="current-password"
          />
          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{message}</p>}
          <button type="submit" disabled={loading || !password} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: (!password || loading) ? "not-allowed" : "pointer", opacity: (!password || loading) ? 0.4 : 1, transition: "opacity 0.2s" }}>{loading ? "Signing in..." : "Unlock"}</button>
        </form>
      </ScreenWrapper>
    );
  }

  if (screen === "login") {
    return (
      <ScreenWrapper showBack onBack={() => { stopPeriodicPull(); setScreen("main"); setTenantId(null); setMessage(""); }}>
        <img src="/applogo.png" alt="App Logo" style={{ width: "96px", height: "96px", borderRadius: "20px", marginBottom: "32px", objectFit: "contain" }} />
        <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "32px" }}>Welcome Back</h1>
        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} style={{ width: "100%" }}>
          <input 
            name="username" 
            placeholder="Username" 
            value={username} 
            onChange={e => setUsername(e.target.value)} 
            style={inputStyle} 
            autoFocus 
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
          />
          <input 
            type="password" 
            name="password" 
            placeholder="Password" 
            value={password} 
            onChange={e => setPassword(e.target.value)} 
            style={inputStyle} 
            autoComplete="current-password"
          />
          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{message}</p>}
          <button type="submit" disabled={loading} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1, transition: "opacity 0.2s" }}>{loading ? "Signing in..." : "Login"}</button>
        </form>
      </ScreenWrapper>
    );
  }

  // Main Screen
  return (
    <ScreenWrapper>
      <img 
        src={branding?.logo || "/applogo.png"} 
        alt="Logo" 
        style={{ width: "96px", height: "96px", borderRadius: "20px", objectFit: "contain", marginBottom: "32px" }} 
      />
      <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>{branding?.businessName || "Welcome"}</h1>
      {branding?.phone && <p style={{ textAlign: "center", fontSize: "15px", color: "#8E8E93", marginBottom: "32px" }}>{branding.phone}</p>}
      {!branding?.phone && <p style={{ textAlign: "center", fontSize: "15px", color: "#8E8E93", marginBottom: "32px" }}>Enter your institution to continue</p>}
      
      <form onSubmit={(e) => { e.preventDefault(); handleTrainerLookup(); }} style={{ width: "100%" }}>
        <input 
          type="text" 
          placeholder="Enter Institution Name" 
          value={businessName} 
          onChange={e => { setBusinessName(e.target.value); setLookupError(""); }} 
          style={inputStyle} 
          autoFocus 
          autoComplete="organization"
        />
        {lookupError && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{lookupError}</p>}
        
        <button type="submit" disabled={lookupLoading || !businessName.trim()} style={{ width: "100%", height: "56px", borderRadius: "12px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "16px", fontWeight: "600", cursor: (lookupLoading || !businessName.trim()) ? "not-allowed" : "pointer", opacity: (lookupLoading || !businessName.trim()) ? 0.4 : 1, transition: "opacity 0.2s" }}>
          {lookupLoading ? "Finding..." : "Continue"}
        </button>
      </form>

      <button onClick={handleStartAdminRegister} style={{ position: "absolute", bottom: "32px", right: "32px", width: "56px", height: "56px", borderRadius: "50%", border: "none", background: MEDICAL_BLUE, boxShadow: "0 4px 12px rgba(0,0,0,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }} title="Register New Institution">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </ScreenWrapper>
  );
}