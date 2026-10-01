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

const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

// Two-column grid that fills wide screens and stacks gracefully on narrow ones
const twoCol: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
  gap: 16,
  width: "100%",
  boxSizing: "border-box",
};

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
    separator: "#E5E5EA", separatorLight: "#F0F0F2", blue: "#007AFF", blueBg: "#EBF2FF",
    red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
    purple: "#AF52DE", purpleBg: "#F5F0FF", medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  };

  const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

  // Shared fluid styles
  const panel: React.CSSProperties = {
    background: C.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)",
    border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box", minWidth: 0,
  };
  const fieldLabel: React.CSSProperties = {
    fontSize: 13, color: C.textTertiary, fontWeight: 600,
    textTransform: "uppercase", letterSpacing: "0.04em", display: "block", marginBottom: 8, marginLeft: 4,
  };
  const textInput: React.CSSProperties = {
    width: "100%", padding: "14px 16px", borderRadius: 12, border: `1px solid ${C.separator}`,
    background: C.bg, fontSize: 16, color: C.textPrimary, outline: "none",
    boxSizing: "border-box", fontFamily: iosFont, minWidth: 0,
    transition: "border-color 0.15s, box-shadow 0.15s",
  };
  const groupHeader: React.CSSProperties = {
    fontSize: 13, color: C.textTertiary, textTransform: "uppercase",
    letterSpacing: "0.04em", fontWeight: 600, margin: "0 0 12px 4px",
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
        setLoading(false); // Stop loading immediately after local data is shown

        // 2. Try fetching from Supabase to update silently
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

  // Image-upload card — shared by Logo + Background
  const uploadCard = (
    preview: string | null,
    title: string,
    subtitle: string,
    onPick: () => void,
    previewStyle: React.CSSProperties,
    placeholderIcon: React.ReactNode
  ) => (
    <div style={{ ...panel, padding: 16 }}>
      <label style={fieldLabel}>{title}</label>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          {preview
            ? <img src={preview} alt={title} style={{ ...previewStyle, flexShrink: 0 }} />
            : <div style={{ ...previewStyle, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{placeholderIcon}</div>}
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, color: C.textPrimary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {preview ? "Uploaded" : "Not uploaded"}
            </p>
            <p style={{ margin: 0, fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</p>
          </div>
        </div>
        <button
          onClick={onPick}
          style={{ padding: "10px 18px", background: C.blueBg, border: `1px solid ${C.blue}22`, borderRadius: 10, color: C.blue, fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0, fontFamily: iosFont }}
        >Upload</button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 80px`, boxSizing: "border-box", fontFamily: iosFont }}>
        <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
        <div style={{ width: "35%", height: "28px", borderRadius: "8px", background: C.separator, animation: "pulse 1.5s infinite", marginBottom: "24px" }}></div>
        <div style={twoCol}>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} style={{ ...panel, padding: 16 }}>
              <div style={{ width: "35%", height: "12px", borderRadius: "4px", background: C.separator, animation: "pulse 1.5s infinite", marginBottom: "12px" }}></div>
              <div style={{ width: "100%", height: "52px", borderRadius: "12px", background: C.separator, animation: "pulse 1.5s infinite 0.1s" }}></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 80px`, boxSizing: "border-box", fontFamily: iosFont, overflowX: "hidden" }}>

      {/* PAGE HEADER */}
      <h1 style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, color: C.textPrimary, marginBottom: 4, letterSpacing: "-0.5px" }}>Business Settings</h1>
      <p style={{ margin: "0 0 24px 2px", fontSize: 15, color: C.textTertiary }}>Branding, contact details, and account security</p>

      {/* ===== BUSINESS DETAILS — 2-up on wide, stacked on narrow ===== */}
      <div style={groupHeader}>Business Details</div>
      <div style={{ ...twoCol, marginBottom: 8 }}>
        <div>
          <label style={fieldLabel}>Business Name</label>
          <input type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Enter business name" style={textInput} />
        </div>
        <div>
          <label style={fieldLabel}>Business Phone</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter contact phone" style={textInput} />
        </div>
        <div>
          <label style={fieldLabel}>Business Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter contact email" style={textInput} />
        </div>
        <div>
          <label style={fieldLabel}>Business Address</label>
          <textarea value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter business address" rows={2} style={{ ...textInput, resize: "none" }} />
        </div>
      </div>

      {/* ===== BRANDING — logo + background side by side on wide screens ===== */}
      <div style={{ ...groupHeader, marginTop: 24 }}>Branding</div>
      <div style={{ ...twoCol, marginBottom: 8 }}>
        {uploadCard(
          logo || null,
          "Business Logo",
          "PNG or JPG recommended",
          () => logoInputRef.current?.click(),
          { width: 56, height: 56, borderRadius: 12, objectFit: "cover" },
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
        )}
        {uploadCard(
          loginBackground || null,
          "Login Background Image",
          "Shown behind login card",
          () => bgInputRef.current?.click(),
          { width: 80, height: 56, borderRadius: 12, objectFit: "cover" },
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
        )}
        <input type="file" accept="image/*" ref={logoInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLogo, 200)} />
        <input type="file" accept="image/*" ref={bgInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLoginBackground, 1280)} />
      </div>

      {message && (
        <p style={{ color: message.includes("success") || message.includes("offline") ? C.green : C.red, textAlign: "center", margin: "16px 0", fontWeight: 500 }}>{message}</p>
      )}

      <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: 16, background: C.blue, color: "#fff", border: "none", borderRadius: 14, fontSize: 17, fontWeight: 600, cursor: "pointer", opacity: saving ? 0.5 : 1, fontFamily: iosFont, margin: "16px 0 24px" }}>
        {saving ? "Saving..." : "Save Settings"}
      </button>

      {/* ===== SECURITY — full width ===== */}
      <div style={groupHeader}>Security</div>
      {!showPasswordSection ? (
        <button onClick={() => setShowPasswordSection(true)} style={{ width: "100%", padding: 18, background: C.redBg, color: C.red, border: "1px solid rgba(255,59,48,0.2)", borderRadius: 16, fontSize: 17, fontWeight: 600, cursor: "pointer", fontFamily: iosFont, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <span>Change Password</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
        </button>
      ) : (
        <div style={{ ...panel }}>
          <div style={{ padding: "14px 16px", borderBottom: `0.5px solid ${C.separator}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary }}>Change Password</span>
            <button onClick={() => { setShowPasswordSection(false); setPasswordMessage(""); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }} title="Close" style={{ background: "none", border: "none", color: C.textTertiary, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>&times;</button>
          </div>
          <div style={{ padding: 16 }}>
            <div style={{ ...twoCol, marginBottom: 12 }}>
              <div>
                <label style={fieldLabel}>Current Password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" style={textInput} />
              </div>
              <div>
                <label style={fieldLabel}>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Enter new password" style={textInput} />
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <label style={fieldLabel}>Confirm New Password</label>
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleChangePassword()} placeholder="Re-enter new password" style={textInput} />
            </div>
            {passwordMessage && <p style={{ fontSize: 14, marginBottom: 12, fontWeight: 500, textAlign: "center", color: passwordMessage.includes("success") ? C.green : C.red }}>{passwordMessage}</p>}
            <button onClick={handleChangePassword} disabled={changingPassword} style={{ width: "100%", padding: 14, background: C.blue, color: "#fff", border: "none", borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: changingPassword ? "not-allowed" : "pointer", opacity: changingPassword ? 0.5 : 1, fontFamily: iosFont }}>
              {changingPassword ? "Changing..." : "Update Password"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}