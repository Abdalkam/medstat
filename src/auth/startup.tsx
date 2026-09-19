// src/auth/Startup.tsx
import { useState, useEffect, useRef } from "react";
import { Navigate, useLocation } from "react-router-dom";
import AppBar from "../components/AppBar";
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
  
  // ✅ FIX: Prevent background auth events from interrupting the login process
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
        }
      } catch {
        localStorage.removeItem("currentUser");
      }
    }
    return () => { stopPeriodicPull(); };
  }, [location.pathname]);

  function handleStartAdminRegister() {
    setScreen("admin_sms");
  }

  function handleSmsSent(phone: string) {
    setPhoneNumber(phone); 
    setScreen("admin_otp");
  }

  function handleOtpVerified(token: string) {
    setTempToken(token);
    setScreen("admin_register");
  }

  async function handleAdminCreated(user: any) {
    if (user) {
      enableSyncHooks();
      startPeriodicPull(60000); // ✅ FIX: 60s interval
      try { await pullAllTenantData(user.tenantId); } catch(e) { /* ignore */ }
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
      const { data: tenant, error } = await supabase
        .from("tenants")
        .select("id")
        .ilike("business_name", businessName.trim())
        .maybeSingle();

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
      isLoggingIn.current = true; // ✅ Lock screen
      try {
        const result = await loginTenant({ tenantId, username, password });
        const safeUser = {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email || "",
          phone: result.user.phone || "",
          profilePic: (result.user as any).profile_pic || "",
          role: result.user.role,
          tenantId: result.user.tenantId,
          assignedCourses: result.user.assigned_courses || [],
          createdAt: (result.user as any).created_at || new Date().toISOString(),
          password,
          synced: true,
        };

        await addUser(safeUser);

        localStorage.setItem("currentUser", JSON.stringify(safeUser));
        localStorage.setItem("authToken", result.authToken);

        window.dispatchEvent(new Event("authStateChanged"));
        enableSyncHooks();
        startPeriodicPull(60000); // ✅ FIX: 60s interval

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
        id: user.id, 
        username: user.username, 
        email: user.email || "",
        phone: user.phone || "", 
        profilePic: user.profilePic || "", 
        role: user.role,
        tenantId: (user as any).tenant_id || (user as any).tenantId, 
        assignedCourses: user.assignedCourses || [],
        createdAt: user.createdAt, 
        synced: user.synced || false
      };

      localStorage.setItem("currentUser", JSON.stringify(safeUser));
      // ✅ FIX: Save offline placeholder token if backend was asleep
      localStorage.setItem("authToken", "offline-mode-pending-sync");
      
      window.dispatchEvent(new Event("authStateChanged"));
      enableSyncHooks();
      startPeriodicPull(60000); // ✅ FIX: 60s interval
      try { await pullAllTenantData(safeUser.tenantId); } catch(e) { /* ignore */ }

      if (user.role === "admin") setRedirectRoute("/admin");
      else if (user.role === "trainer") setRedirectRoute("/trainer");
      else setRedirectRoute("/user");
    } catch (error: any) {
      isLoggingIn.current = false; // ✅ Unlock if failed
      setMessage(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  if (redirectRoute) return <Navigate to={redirectRoute} replace />;

  const inputStyle: React.CSSProperties = { width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none", background: "transparent", fontSize: "16px", color: "#1C1C1E", boxSizing: "border-box" };
  
  const bgStyle: React.CSSProperties = {
    width: "100%", height: "100vh", display: "flex", flexDirection: "column", 
    boxSizing: "border-box", fontFamily: iosFont, overflow: "hidden",
    position: "relative", background: "#F2F2F7"
  };

  if (screen === "admin_sms") return <PhoneEntry onSent={handleSmsSent} />;
  if (screen === "admin_otp") return <VerifyCode phone={phoneNumber} onVerified={handleOtpVerified} />;
  if (screen === "admin_register") return <RegisterAdmin phone={phoneNumber} tempToken={tempToken || ""} onComplete={handleAdminCreated} />;

  if (requiresUnlock) {
    const storedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return (
      <div style={bgStyle}>
        <AppBar />
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
          <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "36px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>
            {branding?.logo && <img src={branding.logo} alt="Logo" style={{ width: "48px", height: "48px", borderRadius: "12px", objectFit: "cover", margin: "0 auto 12px", display: "block" }} />}
            <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: MEDICAL_BLUE, color: "white", fontSize: "32px", fontWeight: "700", display: "flex", justifyContent: "center", alignItems: "center", margin: "0 auto 16px" }}>{storedUser.username?.charAt(0).toUpperCase() || "?"}</div>
            <h2 style={{ textAlign: "center", fontSize: "20px", color: "#1C1C1E", fontWeight: "600", marginBottom: "4px" }}>Welcome back, {storedUser.username}</h2>
            <p style={{ textAlign: "center", fontSize: "14px", color: "#8E8E93", marginBottom: "24px" }}>Enter your password to continue.</p>
            <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
              <input type="password" placeholder="Enter Password" value={password} onChange={e => { setPassword(e.target.value); setMessage(""); }} onKeyDown={e => e.key === "Enter" && handleLogin()} style={inputStyle} autoFocus />
            </div>
            {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{message}</p>}
            <button onClick={handleLogin} disabled={loading || !password} style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: (!password || loading) ? "not-allowed" : "pointer", opacity: (!password || loading) ? 0.4 : 1 }}>{loading ? "Signing in..." : "Unlock"}</button>
            <button onClick={() => { stopPeriodicPull(); localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); setRequiresUnlock(false); setPassword(""); }} style={{ width: "100%", padding: "14px", marginTop: "10px", borderRadius: "14px", border: "none", background: "transparent", color: "#FF3B30", fontSize: "15px", fontWeight: "500", cursor: "pointer" }}>Switch Account</button>
          </div>
        </div>
      </div>
    );
  }

  if (screen === "login") {
    return (
      <div style={bgStyle}>
        <AppBar />
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
          <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "32px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>
            {branding?.logo && <img src={branding.logo} alt="Logo" style={{ width: "48px", height: "48px", borderRadius: "12px", objectFit: "cover", margin: "0 auto 16px", display: "block" }} />}
            <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px" }}>Welcome Back</h1>
            <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
              <input name="username" autoComplete="username" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
              <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }}></div>
              <input type="password" name="password" autoComplete="current-password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleLogin()} style={inputStyle} />
            </div>
            {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{message}</p>}
            <button onClick={handleLogin} disabled={loading} style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>{loading ? "Signing in..." : "Login"}</button>
            <button onClick={() => { stopPeriodicPull(); setScreen("main"); setTenantId(null); setMessage(""); }} style={{ width: "100%", padding: "14px", marginTop: "10px", borderRadius: "14px", border: "none", background: "transparent", color: "#8E8E93", fontSize: "15px", fontWeight: "500", cursor: "pointer" }}>Go Back</button>
          </div>
        </div>
      </div>
    );
  }

  // Main Screen
  return (
    <div style={bgStyle}>
      <AppBar />
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "32px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>

          {branding?.logo && <img src={branding.logo} alt="Logo" style={{ width: "48px", height: "48px", borderRadius: "12px", objectFit: "cover", margin: "0 auto 16px", display: "block" }} />}
          <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px" }}>
            {branding?.businessName || "Sign In"}
          </h1>
          {branding?.phone && <p style={{ textAlign: "center", fontSize: "13px", color: "#8E8E93", marginBottom: "20px" }}>{branding.phone}</p>}

          <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
            <input 
              type="text" 
              placeholder="Enter Institution Name" 
              value={businessName} 
              onChange={e => { setBusinessName(e.target.value); setLookupError(""); }} 
              onKeyDown={e => e.key === "Enter" && handleTrainerLookup()} 
              style={inputStyle} 
            />
          </div>

          {lookupError && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{lookupError}</p>}

          <button 
            onClick={handleTrainerLookup} 
            disabled={lookupLoading || !businessName.trim()} 
            style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: (lookupLoading || !businessName.trim()) ? "not-allowed" : "pointer", opacity: (lookupLoading || !businessName.trim()) ? 0.4 : 1 }}
          >
            {lookupLoading ? "Finding Institution..." : "Continue"}
          </button>
        </div>
      </div>

      <button 
        onClick={handleStartAdminRegister} 
        style={{
          position: "absolute", bottom: "32px", left: "32px", width: "56px", height: "56px", 
          borderRadius: "50%", border: "none", background: "rgba(255, 255, 255, 0.9)", 
          backdropFilter: "blur(10px)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", cursor: "pointer", 
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10
        }}
        title="Register New Institution"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={MEDICAL_BLUE} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="8.5" cy="7" r="4" />
          <line x1="20" y1="8" x2="20" y2="14" />
          <line x1="23" y1="11" x2="17" y2="11" />
        </svg>
      </button>
    </div>
  );
}