import { useState, useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginUser, addUser } from "../database/userDB";
import { loginTenant } from "../api/authApi";
import { pullAllTenantData, enableSyncHooks, startPeriodicPull, stopPeriodicPull, pullSettings } from "../database/sync";
import { supabase } from "../auth/supabase";
import PhoneEntry from "./PhoneEntry";
import VerifyCode from "./VerifyCode";
import RegisterAdmin from "./RegisterAdmin";
import { getVersion } from "@tauri-apps/api/app";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

type AppScreen = "main" | "login" | "admin_sms" | "admin_otp" | "admin_register";

const AuthLayout = ({ children, background, logo, version, showBack, onBack, watermark }: { 
  children: React.ReactNode, 
  background?: string, 
  logo?: string, 
  version?: string,
  showBack?: boolean, 
  onBack?: () => void,
  watermark?: boolean
}) => (
  <div style={{ 
    width: "100%", 
    height: "100vh", 
    display: "flex", 
    alignItems: "center", 
    justifyContent: "center", 
    backgroundImage: watermark ? "none" : (background ? `url(${background})` : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)"),
    backgroundSize: watermark ? "auto" : "cover",
    backgroundPosition: "center",
    backgroundColor: watermark ? "#FFFFFF" : "#F2F2F7",
    fontFamily: iosFont, 
    overflow: "hidden", 
    position: "relative", 
    padding: "24px" 
  }}>
    <style>{`
      @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      @keyframes scrollBg { 0% { background-position: 0px 0px; } 100% { background-position: 120px 120px; } }
    `}</style>
    
    {watermark && (
      <div style={{
        position: "absolute",
        top: 0, left: 0, right: 0, bottom: 0,
        backgroundImage: "url(/loadlogo.png)",
        backgroundRepeat: "repeat",
        backgroundSize: "120px 120px",
        opacity: 0.08,
        animation: "scrollBg 30s linear infinite",
        zIndex: 0
      }} />
    )}

    {!watermark && background && <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.4)", zIndex: 0 }} />}

    {showBack && onBack && (
      <button onClick={onBack} style={{ position: "absolute", top: "24px", left: "24px", width: "44px", height: "44px", borderRadius: "50%", background: "rgba(255,255,255,0.2)", backdropFilter: "blur(10px)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", zIndex: 10 }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
      </button>
    )}

    <div style={{ 
      position: "relative", 
      zIndex: 1, 
      width: "100%", 
      maxWidth: "400px", 
      background: "rgba(255, 255, 255, 0.85)", 
      backdropFilter: "blur(30px)", 
      WebkitBackdropFilter: "blur(30px)",
      borderRadius: "28px", 
      padding: "40px 32px", 
      boxShadow: "0 20px 60px rgba(0,0,0,0.15)", 
      border: "1px solid rgba(255,255,255,0.6)",
      animation: "fadeUp 0.6s ease-out"
    }}>
      {logo && (
        <img src={logo} alt="Logo" style={{ width: "80px", height: "80px", borderRadius: "20px", objectFit: "cover", display: "block", margin: "0 auto 24px", boxShadow: "0 8px 24px rgba(0,0,0,0.1)" }} />
      )}
      {children}
    </div>

    {version && (
      <div style={{ position: "absolute", bottom: "20px", width: "100%", textAlign: "center", color: (watermark || !background) ? "#8E8E93" : "rgba(255,255,255,0.8)", fontSize: "12px", fontFamily: iosFont, zIndex: 10, pointerEvents: "none" }}>
        Version {version}
      </div>
    )}
  </div>
);

export default function Startup() {
  const location = useLocation();
  const [redirectRoute, setRedirectRoute] = useState<string | null>(null);
  const [screen, setScreen] = useState<AppScreen>("main");
  const [branding, setBranding] = useState<{ businessName: string; logo: string; phone: string; loginBackground: string } | null>(null);
  const [appVersion, setAppVersion] = useState("");

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
    getVersion().then(v => setAppVersion(v)).catch(() => {});
    
    const storedUser = localStorage.getItem("currentUser");
    if (storedUser && location.pathname === "/") {
      try {
        const userObj = JSON.parse(storedUser);
        if (userObj?.id) {
          setRequiresUnlock(true);
          setUsername(userObj.username || "");
          setTenantId(userObj.tenantId || null);
          
          if (userObj.tenantId) {
            try {
              supabase.from('business_settings').select('business_name, logo, phone, login_background').eq('tenant_id', userObj.tenantId).maybeSingle().then(({ data }) => {
                if (data) setBranding({ 
                  businessName: data.business_name || "", 
                  logo: data.logo || "", 
                  phone: data.phone || "", 
                  loginBackground: data.login_background || "" 
                });
              });
            } catch (e) {
              console.warn("Offline: Cannot fetch branding");
            }
          }
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
    
    let foundTenantId: string | null = null;

    try {
      const { data: tenant } = await supabase.from("tenants").select("id").ilike("business_name", businessName.trim()).maybeSingle();
      if (tenant?.id) foundTenantId = tenant.id;
    } catch (err) {
      console.warn("Network error, checking local DB for institution...");
    }

    if (!foundTenantId) {
      try {
        const { getUsers } = await import("../database/userDB");
        const localUsers = await getUsers();
        const localMatch = localUsers.find((u: any) => u.tenantId && u.tenantId.toLowerCase().includes(businessName.trim().toLowerCase()));
        if (localMatch) foundTenantId = localMatch.tenantId ?? null;
      } catch (e) { console.error("Local DB lookup failed", e); }
    }

    if (!foundTenantId) {
      setLookupError("Institution not found. Please check the name or connect to the internet.");
      setLookupLoading(false);
      return;
    }

    setTenantId(foundTenantId);

    try {
      const { data: settings } = await supabase.from("business_settings").select("*").eq("tenant_id", foundTenantId).maybeSingle();
      if (settings) {
        setBranding({ 
          businessName: settings.business_name || "", 
          logo: settings.logo || "", 
          phone: settings.phone || "", 
          loginBackground: settings.login_background || "" 
        });
      }
    } catch (e) { console.warn("Offline mode: Using default branding"); }

    setScreen("login");
    setLookupLoading(false);
  }

  async function handleLogin() {
    setMessage("");
    if (!username.trim() || !password.trim()) return setMessage("Please enter username and password");
    if (!tenantId) return setMessage("Session error. Please go back and re-select institution.");

    setLoading(true);
    isLoggingIn.current = true;
    
    try {
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
        
        redirectUser(safeUser.role);
        return;
      } catch (backendError) {
        console.warn("Backend login failed, trying offline local DB login...", backendError);
      }

      const user = await loginUser(username, password);
      if (!user) throw new Error("Invalid username or password (Offline Mode)");

      const safeUser = {
        id: user.id, username: user.username, email: user.email || "", phone: user.phone || "",
        profilePic: user.profilePic || "", role: user.role, tenantId: user.tenantId,
        assignedCourses: user.assignedCourses || [], createdAt: user.createdAt, synced: false
      };
      
      localStorage.setItem("currentUser", JSON.stringify(safeUser));
      localStorage.setItem("authToken", "offline-mode-pending-sync");
      window.dispatchEvent(new Event("authStateChanged"));
      
      redirectUser(safeUser.role);
    } catch (error: any) {
      isLoggingIn.current = false;
      setMessage(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  function redirectUser(role: string) {
    if (role === "admin") setRedirectRoute("/admin");
    else if (role === "trainer") setRedirectRoute("/trainer");
    else setRedirectRoute("/user");
  }

  if (redirectRoute) return <Navigate to={redirectRoute} replace />;

  const inputStyle: React.CSSProperties = { 
    width: "100%", height: "54px", padding: "0 16px", border: "none", outline: "none", 
    background: "rgba(255,255,255,0.8)", fontSize: "17px", color: "#1C1C1E", boxSizing: "border-box", 
    borderRadius: "14px", marginBottom: "12px", transition: "background 0.2s"
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%", height: "54px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE,
    color: "white", fontSize: "17px", fontWeight: "600", cursor: "pointer", 
    opacity: loading ? 0.4 : 1, marginBottom: "0", boxShadow: "0 4px 12px rgba(0,122,255,0.3)"
  };

  if (screen === "admin_sms") return <PhoneEntry onSent={handleSmsSent} onBack={() => setScreen("main")} />;
  if (screen === "admin_otp") return <VerifyCode phone={phoneNumber} onVerified={handleOtpVerified} onBack={() => setScreen("admin_sms")} />;
  if (screen === "admin_register") return <RegisterAdmin phone={phoneNumber} tempToken={tempToken || ""} onComplete={handleAdminCreated} onBack={() => setScreen("admin_otp")} />;

  if (requiresUnlock) {
    return (
      <AuthLayout background={branding?.loginBackground} logo={branding?.logo || "/loadlogo.png"} version={appVersion} showBack onBack={() => { 
        stopPeriodicPull(); 
        localStorage.removeItem("currentUser"); 
        localStorage.removeItem("authToken"); 
        setRequiresUnlock(false); 
        setPassword(""); 
        setUsername("");
      }}>
        <h2 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Welcome back</h2>
        <p style={{ textAlign: "center", fontSize: "15px", color: "#8E8E93", marginBottom: "24px" }}>Enter your password to continue.</p>
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
          <button type="submit" disabled={loading || !password} style={primaryBtn}>{loading ? "Signing in..." : "Unlock"}</button>
        </form>
      </AuthLayout>
    );
  }

  if (screen === "login") {
    return (
      <AuthLayout background={branding?.loginBackground} logo={branding?.logo || "/loadlogo.png"} version={appVersion} showBack onBack={() => { stopPeriodicPull(); setScreen("main"); setTenantId(null); setMessage(""); }}>
        <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px" }}>Welcome Back</h1>
        <form onSubmit={(e) => { e.preventDefault(); handleLogin(); }} style={{ width: "100%" }}>
          <input 
            name="username" placeholder="Username" value={username} 
            onChange={e => setUsername(e.target.value)} style={inputStyle} 
            autoFocus autoComplete="username" autoCapitalize="none" autoCorrect="off"
          />
          <input 
            type="password" name="password" placeholder="Password" value={password} 
            onChange={e => setPassword(e.target.value)} style={inputStyle} 
            autoComplete="current-password"
          />
          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{message}</p>}
          <button type="submit" disabled={loading} style={primaryBtn}>{loading ? "Signing in..." : "Login"}</button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout watermark logo="/loadlogo.png" version={appVersion}>
      <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "8px" }}>Welcome</h1>
      <p style={{ textAlign: "center", fontSize: "15px", color: "#8E8E93", marginBottom: "24px" }}>Enter your institution to continue</p>
      
      <form onSubmit={(e) => { e.preventDefault(); handleTrainerLookup(); }} style={{ width: "100%" }}>
        <input 
          type="text" placeholder="Enter Institution Name" value={businessName} 
          onChange={e => { setBusinessName(e.target.value); setLookupError(""); }} 
          style={inputStyle} autoFocus autoComplete="organization"
        />
        {lookupError && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "12px" }}>{lookupError}</p>}
        <button type="submit" disabled={lookupLoading || !businessName.trim()} style={primaryBtn}>
          {lookupLoading ? "Finding..." : "Continue"}
        </button>
      </form>

      <button onClick={handleStartAdminRegister} style={{ position: "absolute", bottom: "32px", right: "32px", width: "56px", height: "56px", borderRadius: "50%", border: "none", background: MEDICAL_BLUE, boxShadow: "0 4px 12px rgba(0,122,255,0.3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2 }} title="Register New Institution">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </AuthLayout>
  );
}