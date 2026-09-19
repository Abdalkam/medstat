// src/auth/Login.tsx
import { useState, useEffect, useRef } from "react";
import { Navigate } from "react-router-dom";
import AppBar from "../components/AppBar";
import { loginTenant } from "../api/authApi";
import { supabase } from "../auth/supabase";

const MEDICAL_BLUE = "#007AFF";
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

export default function Login() {
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirectRoute, setRedirectRoute] = useState<string | null>(null);
  const [publicSettings, setPublicSettings] = useState<any>(null);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  
  // ✅ FIX: Prevent background auth events from interrupting the login process
  const isLoggingIn = useRef(false);

  useEffect(() => {
    const initLogin = async () => {
      try {
        const { data } = await supabase
          .from("business_settings")
          .select("*")
          .limit(1)
          .maybeSingle();
          
        if (data) setPublicSettings(data);
      } catch (err) {
        console.warn("Could not load business settings:", err);
      }
    };

    initLogin();
  }, []);

  if (redirectRoute) return <Navigate to={redirectRoute} replace />;

  async function handleLogin() {
    setMessage("");
    if (!businessName.trim() || !username.trim() || !password.trim()) {
      return setMessage("Institution, Username, and Password are required");
    }

    try {
      setLoading(true);
      isLoggingIn.current = true; // ✅ Lock the screen so background events can't interrupt
      const result = await loginTenant({ 
        username, 
        password, 
        business_name: businessName.trim() 
      });
      processLoginResult(result);
    } catch (error: unknown) {
      isLoggingIn.current = false; // Unlock if it failed
      const errMsg = error instanceof Error ? error.message : "Login failed.";
      setMessage(errMsg);
    } finally {
      setLoading(false);
    }
  }

  function processLoginResult(result: { authToken: string; user: Record<string, any> }) {
    localStorage.setItem("authToken", result.authToken);

    const apiUser = result.user;
    const userId = apiUser.id as string;
    const tenantId = (apiUser.tenant_id || apiUser.tenantId) as string;
    const userRole = apiUser.role as string;

    localStorage.setItem(
      "currentUser",
      JSON.stringify({
        id: userId,
        tenantId: tenantId,
        role: userRole,
        username: apiUser.username,
        email: apiUser.email || "",
        phone: apiUser.phone || "",
        profilePic: apiUser.profile_pic || "",
        assignedCourses: apiUser.assigned_courses || apiUser.assignedCourses || [],
      })
    );

    window.dispatchEvent(new Event("authStateChanged"));

    // ✅ FIX: Removed syncUserAssignedData. UserDashboard.tsx already fetches this data safely.

    if (userRole === "admin") setRedirectRoute("/admin");
    else if (userRole === "trainer") setRedirectRoute("/trainer");
    else setRedirectRoute("/user");
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none",
    background: "transparent", fontSize: "16px", color: "#1C1C1E", boxSizing: "border-box",
  };

  const cardStyle: React.CSSProperties = {
    width: "100%", maxWidth: "400px", background: "rgba(255, 255, 255, 0.85)",
    backdropFilter: "blur(30px)", WebkitBackdropFilter: "blur(30px)", borderRadius: "24px",
    padding: "36px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)",
  };

  const primaryBtn: React.CSSProperties = {
    width: "100%", padding: "16px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE,
    color: "white", fontSize: "17px", fontWeight: "600", cursor: "pointer", 
    opacity: loading ? 0.4 : 1, marginBottom: "12px",
  };

  const bgStyle: React.CSSProperties = {
    width: "100%", height: "100vh", display: "flex", flexDirection: "column",
    fontFamily: iosFont, overflow: "hidden", position: "relative",
    background: publicSettings?.login_background
      ? `url(${publicSettings.login_background}) center/cover no-repeat`
      : "#F2F2F7",
  };

  return (
    <div style={bgStyle}>
      <AppBar />
      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
        <div style={cardStyle}>
          
          <img 
            src={publicSettings?.logo || "/app-logo.png"} 
            alt="App Logo" 
            style={{ 
              width: "100px", 
              height: "100px", 
              borderRadius: "24px", 
              objectFit: "cover", 
              display: "block", 
              margin: "0 auto 24px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.08)",
              border: "1px solid rgba(0,0,0,0.04)"
            }} 
          />
          
          <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px" }}>
            {showCreateAccount ? "Create Account" : (publicSettings?.business_name || "Sign In")}
          </h1>

          {!showCreateAccount ? (
            <>
              <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
                <input 
                  type="text" 
                  placeholder="Institution Name" 
                  value={businessName} 
                  onChange={(e) => setBusinessName(e.target.value)} 
                  style={inputStyle} 
                  autoFocus 
                />
                <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }} />
                <input 
                  name="username" 
                  placeholder="Username" 
                  value={username} 
                  onChange={(e) => setUsername(e.target.value)} 
                  style={inputStyle} 
                />
                <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }} />
                <input 
                  type="password" 
                  placeholder="Password" 
                  value={password} 
                  onChange={(e) => setPassword(e.target.value)} 
                  onKeyDown={(e) => e.key === "Enter" && handleLogin()} 
                  style={inputStyle} 
                />
              </div>

              {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{message}</p>}
              
              <button onClick={handleLogin} disabled={loading} style={primaryBtn}>
                {loading ? "Signing in..." : "Login"}
              </button>
            </>
          ) : (
            <div style={{ textAlign: "center" }}>
              <p style={{ color: "#8E8E93", fontSize: "15px", lineHeight: 1.5, marginBottom: "24px" }}>
                New accounts are created by your institution's administrator. If you are an administrator, you can register your institution on the landing page.
              </p>
              <button 
                onClick={() => { setShowCreateAccount(false); setMessage(""); }} 
                style={{ ...primaryBtn, background: "#E5E5EA", color: "#1C1C1E" }}
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>

      <button 
        onClick={() => setShowCreateAccount(true)} 
        style={{
          position: "absolute", bottom: "32px", left: "32px", width: "56px", height: "56px", 
          borderRadius: "50%", border: "none", background: "rgba(255, 255, 255, 0.9)", 
          backdropFilter: "blur(10px)", boxShadow: "0 4px 12px rgba(0,0,0,0.1)", cursor: "pointer", 
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10
        }}
        title="Create Account"
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