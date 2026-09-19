// src/auth/RegisterAdmin.tsx
import { useState, useEffect } from "react";
import AppBar from "../components/AppBar";
import { registerTenant } from "../api/authApi";
import { addUser } from "../database/userDB";
import { supabase } from "../auth/supabase";

export default function RegisterAdmin({
  phone,
  tempToken,
  onComplete
}: {
  phone: string;
  tempToken: string;
  onComplete: (user: any) => void
}) {
  const [businessName, setBusinessName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  const MEDICAL_BLUE = "#007AFF";

  useEffect(() => {
    checkExistingAccount();
  }, []);

  async function checkExistingAccount() {
    try {
      const { data: existingTenant } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", phone)
        .maybeSingle();

      if (existingTenant) {
        setMessage(`This phone is already registered${existingTenant.business_name ? ` for "${existingTenant.business_name}"` : ""}. Please login instead.`);
        setTimeout(() => onComplete(null), 3000);
        setChecking(false);
        return;
      }
    } catch (err) {
      // If check fails, allow registration to proceed
    }
    setChecking(false);
  }

  async function createAdmin() {
    setMessage("");

    if (!businessName.trim() || !username.trim() || !password.trim() || !confirmPassword.trim()) {
      setMessage("Please fill all fields");
      return;
    }

    if (password !== confirmPassword) {
      setMessage("Passwords do not match");
      return;
    }

    try {
      setLoading(true);

      const { data: existingTenant } = await supabase
        .from("tenants")
        .select("id, business_name")
        .eq("phone", phone)
        .maybeSingle();

      if (existingTenant) {
        setMessage(`This phone is already registered. Please login instead.`);
        setTimeout(() => onComplete(null), 3000);
        return;
      }

      const result = await registerTenant({
        phone,
        tempToken,
        businessName: businessName.trim(),
        username: username.trim(),
        password: password
      });

      // FIX: Removed crypto.randomUUID() and used the authToken returned from your API
      const authToken = result.authToken;

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
        password: password,
        synced: true,
      };

      await addUser(localUser);
      localStorage.setItem("currentUser", JSON.stringify(localUser));
      localStorage.setItem("authToken", authToken);

      // FIX: Standardized event name
      window.dispatchEvent(new Event("authStateChanged"));
      onComplete(localUser);

    } catch (error: any) {
      if (error.message.includes("already registered") || error.message.includes("duplicate") || error.message.includes("unique")) {
        setMessage("This phone number is already registered. Please login instead.");
        setTimeout(() => onComplete(null), 2000);
      } else {
        setMessage(error.message || "Failed to create admin");
      }
    } finally {
      setLoading(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none",
    background: "transparent", fontSize: "16px", color: "#1C1C1E", boxSizing: "border-box", cursor: "text"
  };

  if (checking) {
    return (
      <div style={{ width: "100%", height: "100vh", background: "#F2F2F7", display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", overflow: "hidden" }}>
        <AppBar />
        <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
          <p style={{ color: "#8E8E93", fontSize: "15px" }}>Verifying...</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: "100vh", background: "#F2F2F7", display: "flex", flexDirection: "column", boxSizing: "border-box", fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", overflow: "hidden" }}>
      <AppBar />

      <div style={{ flex: 1, display: "flex", justifyContent: "center", alignItems: "center", padding: "24px" }}>
        <div style={{ width: "100%", maxWidth: "400px", background: "rgba(255, 255, 255, 0.85)", backdropFilter: "blur(30px)", borderRadius: "24px", padding: "36px 28px", boxShadow: "0 15px 50px rgba(0,0,0,0.1)", border: "1px solid rgba(255,255,255,0.8)" }}>

          <h1 style={{ textAlign: "center", fontSize: "24px", color: "#1C1C1E", fontWeight: "700", marginBottom: "24px" }}>Set Up Institution</h1>

          <div style={{ background: "rgba(255,255,255,0.9)", borderRadius: "14px", overflow: "hidden", border: "1px solid rgba(0,0,0,0.04)", marginBottom: "16px" }}>
            <input placeholder="Institution Name" value={businessName} onChange={e => setBusinessName(e.target.value)} style={inputStyle} />
            <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }}></div>
            <input placeholder="Verified Phone" value={phone} disabled style={{ ...inputStyle, background: "rgba(0,0,0,0.03)", color: "#8E8E93", cursor: "not-allowed" }} />
            <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }}></div>
            <input placeholder="Admin Username" value={username} onChange={e => setUsername(e.target.value)} style={inputStyle} />
            <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }}></div>
            <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} style={inputStyle} />
            <div style={{ height: "1px", background: "rgba(0,0,0,0.06)", marginLeft: "16px" }}></div>
            <input type="password" placeholder="Re-enter Password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} style={inputStyle} />
          </div>

          {message && <p style={{ textAlign: "center", color: "#FF3B30", fontSize: "14px", marginBottom: "16px" }}>{message}</p>}

          <button onClick={createAdmin} disabled={loading} style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: MEDICAL_BLUE, color: "white", fontSize: "17px", fontWeight: "600", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.4 : 1 }}>
            {loading ? "Creating..." : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}