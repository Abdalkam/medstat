// src/admin/Settings.tsx
import { useEffect, useState, useRef } from "react";
import { supabase } from "../auth/supabase";
import type { BusinessSettings } from "../types";

function mapSettingsFromSupabase(row: Record<string, unknown>): BusinessSettings {
  return {
    id: (row.id as string) || "main",
    tenantId: (row.tenant_id as string | null) ?? undefined,
    businessName: (row.business_name as string) || "",
    phone: (row.phone as string) || "",
    email: (row.email as string) || "",
    address: (row.address as string) || "",
    logo: (row.logo as string) || "",
    loginBackground: (row.login_background as string) || "",
    website: (row.website as string) || "",
    header: (row.header as string | null) ?? undefined,
    adminProfile: (row.admin_profile as string | null) ?? undefined,
    themeColor: (row.theme_color as string | null) ?? undefined,
    appBarItems: (row.app_bar_items as string[]) || [],
    createdAt: (row.created_at as string) || new Date().toISOString(),
  };
}

export default function Settings() {
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [logo, setLogo] = useState<string>("");
  const [loginBackground, setLoginBackground] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  const C = {
    bg: "#F2F2F7", card: "#FFFFFF", textPrimary: "#1C1C1E", textTertiary: "#8E8E93",
    separator: "#E5E5EA", blue: "#007AFF", red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759",
  };

  useEffect(() => {
    async function loadSettings() {
      try {
        const currentUser: Record<string, unknown> = JSON.parse(localStorage.getItem("currentUser") || "{}");
        const tenantId = currentUser?.tenantId as string | null;

        // 1. Load from Local Storage INSTANTLY
        const localData = localStorage.getItem("localBusinessSettings");
        if (localData) {
          const mapped = JSON.parse(localData) as BusinessSettings;
          setSettings(mapped);
          setBusinessName(mapped.businessName || "");
          setPhone(mapped.phone || "");
          setEmail(mapped.email || "");
          setAddress(mapped.address || "");
          setLogo(mapped.logo || "");
          setLoginBackground(mapped.loginBackground || "");
        }

        // 2. Try fetching from Supabase to update
        if (tenantId) {
          try {
            const { data, error } = await supabase.from("business_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
            if (!error && data) {
              const mapped = mapSettingsFromSupabase(data);
              setSettings(mapped);
              setBusinessName(mapped.businessName || "");
              setPhone(mapped.phone || "");
              setEmail(mapped.email || "");
              setAddress(mapped.address || "");
              setLogo(mapped.logo || "");
              setLoginBackground(mapped.loginBackground || "");
              localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
            }
          } catch (e) {
            console.warn("Offline: Fetching settings from local storage...");
          }
        }
      } catch (error) {
        console.error("Failed to load settings", error);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (val: string) => void, maxSize: number = 200) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
          } else {
            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
          }
          canvas.width = width;
          canvas.height = height;
          ctx?.drawImage(img, 0, 0, width, height);
          setter(canvas.toDataURL("image/jpeg", 0.7));
        };
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const currentUser: Record<string, unknown> = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const tenantId = currentUser.tenantId as string | null;
      if (!tenantId) throw new Error("No tenant ID found. Please log in again.");

      const payload = {
        tenant_id: tenantId, business_name: businessName, phone, email, address,
        logo, login_background: loginBackground, website: settings?.website || "",
        app_bar_items: settings?.appBarItems || [],
      };

      // Save to Local Storage INSTANTLY
      const localSettings = { ...settings, businessName, phone, email, address, logo, loginBackground };
      localStorage.setItem("localBusinessSettings", JSON.stringify(localSettings));
      localStorage.setItem("institutionBranding", JSON.stringify({ businessName, logo, phone, loginBackground }));
      window.dispatchEvent(new Event("settingsChanged"));

      // Try Supabase sync in background
      try {
        if (settings?.id && settings.id !== "main") {
          const { error } = await supabase.from("business_settings").update(payload).eq("id", settings.id);
          if (error) throw error;
        } else {
          const { data: existing, error: checkError } = await supabase.from("business_settings").select("id").eq("tenant_id", tenantId).maybeSingle();
          if (checkError) throw checkError;
          if (existing) {
            const { error } = await supabase.from("business_settings").update(payload).eq("id", existing.id);
            if (error) throw error;
          } else {
            const { error } = await supabase.from("business_settings").insert(payload);
            if (error) throw error;
          }
        }
        setMessage("Settings saved successfully!");
      } catch (e) {
        console.warn("Offline: Saved locally. Will sync later.", e);
        setMessage("Saved offline! Will sync when online.");
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      setMessage(err.message || "Failed to save settings.");
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPasswordMessage("");
    if (!currentPassword) return setPasswordMessage("Current password is required.");
    if (!newPassword) return setPasswordMessage("New password is required.");
    if (newPassword !== confirmPassword) return setPasswordMessage("Passwords do not match.");

    setChangingPassword(true);
    try {
      const currentUser: Record<string, unknown> = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const userId = currentUser.id as string;
      if (!userId) return setPasswordMessage("Not logged in.");

      const token = localStorage.getItem("authToken");
      if (token === "offline-mode-pending-sync") return setPasswordMessage("Cannot change password offline. Please connect to the internet.");

      const { data: profileData, error: fetchError } = await supabase.from("profile_settings").select("password").eq("user_id", userId).maybeSingle();
      if (fetchError) throw fetchError;

      const storedPassword = profileData?.password as string | null;
      if (storedPassword && currentPassword !== storedPassword) return setPasswordMessage("Current password is incorrect.");

      const { error: profileUpdateError } = await supabase.from("profile_settings").update({ password: newPassword }).eq("user_id", userId);
      if (profileUpdateError) throw profileUpdateError;

      const { error: userUpdateError } = await supabase.from("users").update({ password: newPassword }).eq("id", userId);
      if (userUpdateError) throw userUpdateError;

      try {
        const { updateUser } = await import("../database/userDB");
        const userObj = JSON.parse(localStorage.getItem("currentUser") || "{}");
        await updateUser({ ...userObj, password: newPassword });
      } catch (e) { console.error("Failed to update local password", e); }

      setPasswordMessage("Password changed successfully!");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowPasswordSection(false);
    } catch (error: unknown) {
      const err = error as { message?: string };
      setPasswordMessage(err.message || "Failed to change password. You might be offline.");
    } finally {
      setChangingPassword(false);
    }
  };

  const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

  if (loading) {
    return (
      <div style={{ padding: "24px 16px 80px 16px", maxWidth: "600px", margin: "0 auto", fontFamily: iosFont }}>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        <div style={{ width: "40%", height: "28px", borderRadius: "8px", background: "#E5E5EA", animation: "pulse 1.5s infinite", marginBottom: "24px" }}></div>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} style={{ marginBottom: "24px" }}>
            <div style={{ width: "30%", height: "12px", borderRadius: "4px", background: "#E5E5EA", animation: "pulse 1.5s infinite", marginLeft: "4px", marginBottom: "8px" }}></div>
            <div style={{ width: "100%", height: "52px", borderRadius: "14px", background: "#E5E5EA", animation: "pulse 1.5s infinite 0.1s" }}></div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 16px 80px 16px", maxWidth: "600px", margin: "0 auto", fontFamily: iosFont }}>
      <h1 style={{ fontSize: "28px", fontWeight: "700", color: C.textPrimary, marginBottom: "24px" }}>Business Settings</h1>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Business Name</label>
        <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Enter business name" style={{ width: "100%", padding: "16px", marginTop: "8px", borderRadius: "14px", border: "none", background: C.card, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Business Phone</label>
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter contact phone" style={{ width: "100%", padding: "16px", marginTop: "8px", borderRadius: "14px", border: "none", background: C.card, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Business Email</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter contact email" style={{ width: "100%", padding: "16px", marginTop: "8px", borderRadius: "14px", border: "none", background: C.card, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Business Address</label>
        <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter business address" rows={3} style={{ width: "100%", padding: "16px", marginTop: "8px", borderRadius: "14px", border: "none", background: C.card, boxShadow: "0 1px 3px rgba(0,0,0,0.05)", fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box", resize: "none", fontFamily: "inherit" }} />
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Business Logo</label>
        <div style={{ background: C.card, borderRadius: "14px", padding: "16px", marginTop: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {logo ? <img src={logo} alt="Logo" style={{ width: "56px", height: "56px", borderRadius: "12px", objectFit: "cover" }} /> : <div style={{ width: "56px", height: "56px", borderRadius: "12px", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg></div>}
            <div><p style={{ margin: 0, fontSize: "16px", color: C.textPrimary, fontWeight: "500" }}>{logo ? "Logo uploaded" : "No logo uploaded"}</p><p style={{ margin: 0, fontSize: "13px", color: C.textTertiary }}>PNG or JPG recommended</p></div>
          </div>
          <button onClick={() => logoInputRef.current?.click()} style={{ padding: "10px 16px", background: "#F2F2F7", border: "none", borderRadius: "10px", color: C.blue, fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>Upload</button>
          <input type="file" accept="image/*" ref={logoInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLogo, 200)} />
        </div>
      </div>

      <div style={{ marginBottom: "24px" }}>
        <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", marginLeft: "4px" }}>Login Background Image</label>
        <div style={{ background: C.card, borderRadius: "14px", padding: "16px", marginTop: "8px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            {loginBackground ? <img src={loginBackground} alt="Background" style={{ width: "80px", height: "56px", borderRadius: "12px", objectFit: "cover" }} /> : <div style={{ width: "80px", height: "56px", borderRadius: "12px", background: "#F2F2F7", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg></div>}
            <div><p style={{ margin: 0, fontSize: "16px", color: C.textPrimary, fontWeight: "500" }}>{loginBackground ? "Background uploaded" : "No background uploaded"}</p><p style={{ margin: 0, fontSize: "13px", color: C.textTertiary }}>Shown behind login card</p></div>
          </div>
          <button onClick={() => bgInputRef.current?.click()} style={{ padding: "10px 16px", background: "#F2F2F7", border: "none", borderRadius: "10px", color: C.blue, fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>Upload</button>
          <input type="file" accept="image/*" ref={bgInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLoginBackground, 1280)} />
        </div>
      </div>

      {message && <p style={{ color: message.includes("success") || message.includes("offline") ? C.green : C.red, textAlign: "center", marginBottom: "16px", fontWeight: "500" }}>{message}</p>}

      <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "16px", background: C.blue, color: "#fff", border: "none", borderRadius: "14px", fontSize: "17px", fontWeight: "600", cursor: "pointer", opacity: saving ? 0.5 : 1, marginBottom: "24px" }}>{saving ? "Saving..." : "Save Settings"}</button>

      <div style={{ marginBottom: "24px" }}>
        {!showPasswordSection ? (
          <button onClick={() => setShowPasswordSection(true)} style={{ width: "100%", padding: "16px", background: C.redBg, color: C.red, border: "1px solid rgba(255,59,48,0.2)", borderRadius: "14px", fontSize: "17px", fontWeight: "600", cursor: "pointer" }}>Change Password</button>
        ) : (
          <div style={{ background: C.card, borderRadius: "14px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div style={{ padding: "14px 16px", borderBottom: `0.5px solid ${C.separator}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "17px", fontWeight: "600", color: C.textPrimary }}>Change Password</span>
              <button onClick={() => { setShowPasswordSection(false); setPasswordMessage(""); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }} style={{ background: "none", border: "none", color: C.textTertiary, fontSize: "24px", cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>&times;</button>
            </div>
            <div style={{ padding: "4px 16px 16px 16px" }}>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Current Password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" style={{ width: "100%", padding: "14px 16px", borderRadius: "12px", border: `1px solid ${C.separator}`, background: C.card, fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" style={{ width: "100%", padding: "14px 16px", borderRadius: "12px", border: `1px solid ${C.separator}`, background: C.card, fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
              </div>
              <div style={{ marginBottom: "12px" }}>
                <label style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", display: "block", marginBottom: "6px" }}>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleChangePassword()} placeholder="Re-enter new password" style={{ width: "100%", padding: "14px 16px", borderRadius: "12px", border: `1px solid ${C.separator}`, background: C.card, fontSize: "16px", color: C.textPrimary, outline: "none", boxSizing: "border-box" }} />
              </div>
              {passwordMessage && <p style={{ fontSize: "14px", marginBottom: "12px", fontWeight: "500", textAlign: "center", color: passwordMessage.includes("success") ? C.green : C.red }}>{passwordMessage}</p>}
              <button onClick={handleChangePassword} disabled={changingPassword} style={{ width: "100%", padding: "14px", background: C.blue, color: "#fff", border: "none", borderRadius: "12px", fontSize: "17px", fontWeight: "600", cursor: changingPassword ? "not-allowed" : "pointer", opacity: changingPassword ? 0.5 : 1 }}>{changingPassword ? "Changing..." : "Update Password"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}