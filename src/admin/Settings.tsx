// src/admin/Settings.tsx
import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import type { BusinessSettings } from "../types";

// ============================ shared design tokens (same system as AdminForms) ============================

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF", medBlueSoft: "#F0F7FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE", purpleBg: "#F5F0FF",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TS = {
  h1: { fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
};

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

/* ================= IMAGE UPLOAD HELPERS (pure, unit-tested) ================= */

/** Aspect-ratio-preserving target size for canvas compression, rounded and
 *  never smaller than 1px. Images already within maxSize are untouched. */
export function containSize(w: number, h: number, maxSize: number): { width: number; height: number } {
  let width = w, height = h;
  if (width > height) {
    if (width > maxSize) { height *= maxSize / width; width = maxSize; }
  } else {
    if (height > maxSize) { width *= maxSize / height; height = maxSize; }
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/** Alpha-preserving output MIME for a data URL. Transparent-capable sources
 *  (PNG/WebP/GIF) stay PNG — encoding them as JPEG would flatten transparency
 *  onto black and make logos look cut off / boxed. Opaque sources keep JPEG. */
export function encodeMimeFor(dataUrl: string): "image/png" | "image/jpeg" {
  return /^data:image\/(png|webp|gif)/i.test(dataUrl) ? "image/png" : "image/jpeg";
}

// Two-column grid that fills wide screens and stacks gracefully on narrow ones
const twoCol: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(min(360px, 100%), 1fr))",
  gap: 16,
  width: "100%",
  boxSizing: "border-box",
};

type Msg = { kind: "ok" | "error" | "info"; text: string };
const MSG_STYLE: Record<Msg["kind"], { bg: string; fg: string; icon: string }> = {
  ok: { bg: C.greenBg, fg: C.green, icon: "✓" },
  error: { bg: C.redBg, fg: C.red, icon: "⚠" },
  info: { bg: C.medBlueBg, fg: C.medBlue, icon: "ⓘ" },
};

export default function Settings() {
  const navigate = useNavigate();

  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [businessName, setBusinessName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [logo, setLogo] = useState<string>("");
  const [loginBackground, setLoginBackground] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [loading, setLoading] = useState(true);

  const [showPasswordSection, setShowPasswordSection] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [pwMsg, setPwMsg] = useState<Msg | null>(null);
  const [showPw, setShowPw] = useState<{ current: boolean; next: boolean; confirm: boolean }>({ current: false, next: false, confirm: false });

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const securityRef = useRef<HTMLDivElement>(null);

  // Shared fluid styles
  const panel: CSSProperties = {
    background: C.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)",
    border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box", minWidth: 0,
  };
  const fieldLabel: CSSProperties = {
    ...TS.caption, fontSize: 10, color: C.textTertiary, display: "block", marginBottom: 6, marginLeft: 4,
  };
  const textInput: CSSProperties = {
    width: "100%", padding: "13px 16px", borderRadius: 12, border: `1px solid ${C.separator}`,
    background: C.card, fontSize: 16, color: C.textPrimary, outline: "none",
    boxSizing: "border-box", fontFamily: FONT, minWidth: 0,
    transition: "border-color 0.15s, box-shadow 0.15s",
  };
  const groupHeader: CSSProperties = {
    ...TS.caption, fontSize: 11, color: C.textTertiary, margin: "0 0 12px 4px",
  };
  const pwWrap: CSSProperties = { position: "relative" };
  const eyeBtn: CSSProperties = {
    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
    background: "none", border: "none", color: C.textTertiary, cursor: "pointer",
    padding: 4, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: 8,
  };

  // -------- dirty tracking (floating "Unsaved changes" bar + toolbar dot) --------
  const savedSnapshotRef = useRef<string>("");
  const currentSnapshot = [businessName, phone, email, address, logo, loginBackground].join("|");
  const dirty = currentSnapshot !== savedSnapshotRef.current;

  // Success/info banners auto-dismiss; errors stay until fixed or dismissed
  useEffect(() => {
    if (!msg || msg.kind === "error") return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const currentUser: Record<string, unknown> = JSON.parse(localStorage.getItem("currentUser") || "{}");
        const tenantId = currentUser?.tenantId as string | null;

        const applyLoaded = (mapped: BusinessSettings) => {
          setSettings(mapped);
          setBusinessName(mapped.businessName || "");
          setPhone(mapped.phone || "");
          setEmail(mapped.email || "");
          setAddress(mapped.address || "");
          setLogo(mapped.logo || "");
          setLoginBackground(mapped.loginBackground || "");
          savedSnapshotRef.current = [mapped.businessName || "", mapped.phone || "", mapped.email || "", mapped.address || "", mapped.logo || "", mapped.loginBackground || ""].join("|");
        };

        // 1. Load from Local Storage INSTANTLY
        const localData = localStorage.getItem("localBusinessSettings");
        if (localData) {
          const mapped = JSON.parse(localData) as BusinessSettings;
          applyLoaded(mapped);
        }
        setLoading(false); // Stop loading immediately after local data is shown

        // 2. Try fetching from Supabase to update silently
        if (tenantId) {
          try {
            const { data, error } = await supabase.from("business_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
            if (!error && data) {
              const mapped = mapSettingsFromSupabase(data);
              applyLoaded(mapped);
              localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
            }
          } catch (e) {
            console.warn("Offline: Fetching settings from local storage...", e);
          }
        }
      } catch (error) {
        console.error("Failed to load settings", error);
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleImageUpload = (e: ChangeEvent<HTMLInputElement>, setter: (val: string) => void, maxSize: number = 200) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const img = new Image();
        img.src = reader.result as string;
        img.onerror = () => setMsg({ kind: "error", text: "Could not read that image. Try a different file." });
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          const { width, height } = containSize(img.width, img.height, maxSize);
          canvas.width = width;
          canvas.height = height;
          const src = reader.result as string;
          const mime = encodeMimeFor(src);
          if (ctx) ctx.imageSmoothingQuality = "high";
          if (mime === "image/jpeg" && ctx) {
            // JPEG has no alpha channel — composite onto WHITE so transparent
            // areas never flatten to black (which made logos look cut off).
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, width, height);
          }
          ctx?.drawImage(img, 0, 0, width, height);
          setter(canvas.toDataURL(mime, mime === "image/jpeg" ? 0.85 : undefined));
        };
      };
      reader.readAsDataURL(file);
    }
    e.target.value = ""; // allows re-picking the same file after a Remove
  };

  // Opens/closes the Change Password panel. The button lives in the sticky
  // toolbar (far above the section), so opening also scrolls it into view.
  const togglePasswordSection = () => {
    const next = !showPasswordSection;
    setShowPasswordSection(next);
    if (next) setTimeout(() => securityRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
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
        savedSnapshotRef.current = currentSnapshot;
        setMsg({ kind: "ok", text: "Settings saved successfully!" });
      } catch (e) {
        console.warn("Offline: Saved locally. Will sync later.", e);
        savedSnapshotRef.current = currentSnapshot;
        setMsg({ kind: "info", text: "Saved offline — will sync when you're back online." });
      }
    } catch (error: unknown) {
      const err = error as { message?: string };
      setMsg({ kind: "error", text: err.message || "Failed to save settings." });
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    setPwMsg(null);
    if (!currentPassword) return setPwMsg({ kind: "error", text: "Current password is required." });
    if (!newPassword) return setPwMsg({ kind: "error", text: "New password is required." });
    if (newPassword.length < 8) return setPwMsg({ kind: "error", text: "New password must be at least 8 characters." });
    if (newPassword !== confirmPassword) return setPwMsg({ kind: "error", text: "Passwords do not match." });

    setChangingPassword(true);
    try {
      const currentUser: Record<string, unknown> = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const userId = currentUser.id as string;
      if (!userId) return setPwMsg({ kind: "error", text: "Not logged in." });

      const token = localStorage.getItem("authToken");
      if (token === "offline-mode-pending-sync") return setPwMsg({ kind: "error", text: "Cannot change password offline. Please connect to the internet." });

      const { data: profileData, error: fetchError } = await supabase.from("profile_settings").select("password").eq("user_id", userId).maybeSingle();
      if (fetchError) throw fetchError;

      const storedPassword = profileData?.password as string | null;
      if (storedPassword && currentPassword !== storedPassword) return setPwMsg({ kind: "error", text: "Current password is incorrect." });

      const { error: profileUpdateError } = await supabase.from("profile_settings").update({ password: newPassword }).eq("user_id", userId);
      if (profileUpdateError) throw profileUpdateError;

      const { error: userUpdateError } = await supabase.from("users").update({ password: newPassword }).eq("id", userId);
      if (userUpdateError) throw userUpdateError;

      try {
        const { updateUser } = await import("../database/userDB");
        const userObj = JSON.parse(localStorage.getItem("currentUser") || "{}");
        await updateUser({ ...userObj, password: newPassword });
      } catch (e) { console.error("Failed to update local password", e); }

      setPwMsg({ kind: "ok", text: "Password changed successfully!" });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowPasswordSection(false);
    } catch (error: unknown) {
      const err = error as { message?: string };
      setPwMsg({ kind: "error", text: err.message || "Failed to change password. You might be offline." });
    } finally {
      setChangingPassword(false);
    }
  };

  // Banner — shared by settings + password messages
  const banner = (m: Msg, onClose: () => void, compact = false) => {
    const s = MSG_STYLE[m.kind];
    return (
      <div role="status" style={{ background: s.bg, color: s.fg, borderRadius: 12, padding: compact ? "10px 14px" : "12px 18px", margin: compact ? "0 0 12px" : "16px 0", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span style={{ fontSize: compact ? 13 : 14, fontWeight: 600, fontFamily: FONT }}>{s.icon}&nbsp; {m.text}</span>
        <button onClick={onClose} title="Dismiss" style={{ background: "none", border: "none", color: s.fg, cursor: "pointer", fontSize: 14, fontWeight: 700, padding: 2, lineHeight: 1 }}>✕</button>
      </div>
    );
  };

  // Image-upload card — shared by Logo + Background.
  // The preview image itself is frameless: whatever the caller passes in
  // previewStyle decides the frame (the logo passes none, so the uploaded
  // artwork previews exactly as the app bar renders it — flat, seamless).
  const uploadCard = (
    preview: string | null,
    title: string,
    subtitle: string,
    onPick: () => void,
    onRemove: () => void,
    previewStyle: CSSProperties,
    placeholderIcon: ReactNode
  ) => (
    <div
      style={{ ...panel, padding: 16, transition: "border-color 0.15s, box-shadow 0.15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.medBlue + "55"; e.currentTarget.style.boxShadow = "0 4px 18px rgba(0,122,255,0.10)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(17,24,39,0.05)"; e.currentTarget.style.boxShadow = "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)"; }}
    >
      <label style={fieldLabel}>{title}</label>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16, minWidth: 0 }}>
          {preview
            ? <img src={preview} alt={title} style={{ ...previewStyle, flexShrink: 0 }} />
            : <div style={{ ...previewStyle, background: C.bg, border: `1.5px dashed ${C.separator}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{placeholderIcon}</div>}
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 16, color: C.textPrimary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontFamily: FONT }}>
              {preview ? "Uploaded" : "Not uploaded"}
            </p>
            <p style={{ ...TS.bodySm, margin: 0, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{subtitle}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          {preview && (
            <button onClick={onRemove} title={`Remove ${title.toLowerCase()}`} style={{ padding: "10px 14px", background: C.redBg, border: `1px solid ${C.red}22`, borderRadius: 10, color: C.red, fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0, fontFamily: FONT }}>Remove</button>
          )}
          <button onClick={onPick} style={{ padding: "10px 18px", background: C.medBlueSoft, border: `1px solid ${C.medBlue}22`, borderRadius: 10, color: C.medBlue, fontSize: 14, fontWeight: 600, cursor: "pointer", flexShrink: 0, fontFamily: FONT }}>Upload</button>
        </div>
      </div>
    </div>
  );

  // Show/hide password eye button
  const eye = (on: boolean, onClick: () => void) => (
    <button type="button" onClick={onClick} title={on ? "Hide password" : "Show password"} style={eyeBtn}>
      {on ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
      )}
    </button>
  );

  if (loading) {
    return (
      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 80px`, boxSizing: "border-box", fontFamily: FONT }}>
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
    <div style={{ width: "100%", background: C.bg, minHeight: "100%", boxSizing: "border-box", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
        .set-input:focus { border-color: ${C.medBlue} !important; box-shadow: 0 0 0 3px rgba(0,122,255,0.15); }
        @media (max-width: 600px) { .pw-btn-label { display: none; } }
      `}</style>

      {/* ===== STICKY TOOLBAR — back · title · always-visible Save ===== */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.bg, width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", maxWidth: PAGE_MAX, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <button onClick={() => navigate("/admin")} title="Back to Dashboard" style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Settings{dirty ? " •" : ""}
            </div>
          </div>
          <button onClick={togglePasswordSection} title="Change your account password" style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: FONT, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,122,255,0.25)" }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            <span className="pw-btn-label">Change Password</span>
          </button>
          <button onClick={handleSave} disabled={saving} style={{ background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, cursor: saving ? "default" : "pointer", padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: FONT, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,122,255,0.25)", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 80px`, boxSizing: "border-box", overflowX: "hidden" }}>

        {/* PAGE HEADER */}
        <h1 style={{ ...TS.h1, margin: "0 0 4px" }}>Business Settings</h1>
        <p style={{ ...TS.bodySm, margin: "0 0 24px 2px", fontSize: 15 }}>Branding, contact details, and account security</p>

        {/* ===== BUSINESS DETAILS — 2-up on wide, stacked on narrow ===== */}
        <div style={groupHeader}>Business Details</div>
        <div style={{ ...panel, padding: "20px 24px", marginBottom: 8 }}>
          <div style={twoCol}>
            <div>
              <label style={fieldLabel}>Business Name</label>
              <input className="set-input" type="text" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Enter business name" style={textInput} />
            </div>
            <div>
              <label style={fieldLabel}>Business Phone</label>
              <input className="set-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Enter contact phone" style={{ ...textInput, color: C.medBlue, fontWeight: 600, letterSpacing: "0.01em" }} />
            </div>
            <div>
              <label style={fieldLabel}>Business Email</label>
              <input className="set-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter contact email" style={textInput} />
            </div>
            <div>
              <label style={fieldLabel}>Business Address</label>
              <textarea className="set-input" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Enter business address" rows={2} style={{ ...textInput, resize: "none" }} />
            </div>
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
            () => setLogo(""),
            { width: 56, height: 56, borderRadius: 12, objectFit: "contain", objectPosition: "center", background: "#FFFFFF", padding: 4, boxSizing: "border-box" },
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          )}
          {uploadCard(
            loginBackground || null,
            "Login Background Image",
            "Shown behind login card",
            () => bgInputRef.current?.click(),
            () => setLoginBackground(""),
            { width: 80, height: 56, borderRadius: 12, objectFit: "cover", border: `1px solid ${C.separator}` },
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#AEAEB2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
          )}
          <input type="file" accept="image/*" ref={logoInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLogo, 200)} />
          <input type="file" accept="image/*" ref={bgInputRef} style={{ display: "none" }} onChange={(e) => handleImageUpload(e, setLoginBackground, 1280)} />
        </div>

        {msg && banner(msg, () => setMsg(null))}

        {/* ===== SECURITY — opener now lives in the sticky toolbar ===== */}
        <div style={{ ...groupHeader, marginTop: 24 }}>Security</div>
        {showPasswordSection && (
          <div ref={securityRef} style={{ ...panel, scrollMarginTop: 76 }}>
            <div style={{ padding: "14px 16px", borderBottom: `0.5px solid ${C.separator}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ ...TS.h3, fontSize: 17 }}>Change Password</span>
              <button onClick={() => { setShowPasswordSection(false); setPwMsg(null); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); setShowPw({ current: false, next: false, confirm: false }); }} title="Close" style={{ background: "none", border: "none", color: C.textTertiary, fontSize: 24, cursor: "pointer", lineHeight: 1, padding: "0 4px" }}>&times;</button>
            </div>
            <div style={{ padding: 16 }}>
              <div style={{ ...twoCol, marginBottom: 12 }}>
                <div>
                  <label style={fieldLabel}>Current Password</label>
                  <div style={pwWrap}>
                    <input className="set-input" type={showPw.current ? "text" : "password"} value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} placeholder="Enter current password" style={{ ...textInput, paddingRight: 46 }} />
                    {eye(showPw.current, () => setShowPw((s) => ({ ...s, current: !s.current })))}
                  </div>
                </div>
                <div>
                  <label style={fieldLabel}>New Password</label>
                  <div style={pwWrap}>
                    <input className="set-input" type={showPw.next ? "text" : "password"} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="At least 8 characters" style={{ ...textInput, paddingRight: 46 }} />
                    {eye(showPw.next, () => setShowPw((s) => ({ ...s, next: !s.next })))}
                  </div>
                </div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={fieldLabel}>Confirm New Password</label>
                <div style={pwWrap}>
                  <input className="set-input" type={showPw.confirm ? "text" : "password"} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleChangePassword()} placeholder="Re-enter new password" style={{ ...textInput, paddingRight: 46 }} />
                  {eye(showPw.confirm, () => setShowPw((s) => ({ ...s, confirm: !s.confirm })))}
                </div>
              </div>
              {pwMsg && banner(pwMsg, () => setPwMsg(null), true)}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button onClick={handleChangePassword} disabled={changingPassword} style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, cursor: changingPassword ? "default" : "pointer", padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: FONT, boxShadow: "0 2px 8px rgba(0,122,255,0.25)", opacity: changingPassword ? 0.7 : 1 }}>
                  {changingPassword ? "Changing…" : "Update Password"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
