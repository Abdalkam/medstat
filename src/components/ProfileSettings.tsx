import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  background: "#F8F9FA",
  outline: "#DADCE0",
  outlineVariant: "#BDC1C6",
  surfaceVariant: "#E8EAED",
  error: "#D93025",
  success: "#137333",
  medBlue: "#007AFF"
};

const FONT = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const CARD_SHADOW = "0 1px 2px rgba(60,64,67,0.10), 0 1px 3px 1px rgba(60,64,67,0.07)";
const HOVER_SHADOW = "0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 6px 2px rgba(60,64,67,0.15)";

async function resizeImageFile(file: File): Promise<string | null> {
  try {
    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
    if (!dataUrl) return null;
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });
    if (!img) return null;
    const size = 512;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    const min = Math.min(img.width, img.height);
    const sx = (img.width - min) / 2;
    const sy = (img.height - min) / 2;
    ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch {
    return null;
  }
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

const IconBack = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
);

const IconCamera = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
);

const IconPerson = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
);

const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);

const IconEye = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
);

const IconEyeOff = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" /><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" /><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
);

const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);

const IconAlert = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
);

const IconPhone = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 3.18 2 2 0 0 1 4.06 1h2a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
);

export default function ProfileSettings({ role, onBack }: { role: "trainee" | "trainer"; onBack?: () => void }) {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string>("");
  const [tenantId, setTenantId] = useState<string>("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [profilePic, setProfilePic] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [actualPassword, setActualPassword] = useState("");
  const [showCur, setShowCur] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConf, setShowConf] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [bizName, setBizName] = useState("");
  const [bizPhone, setBizPhone] = useState("");

  useEffect(() => {
    const fetchUser = async () => {
      const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
      if (!savedUser.id) {
        navigate("/");
        return;
      }

      setUserId(savedUser.id);
      setTenantId(savedUser.tenantId || savedUser.tenant_id || "");

      try {
        const { data: profileData } = await supabase
          .from("profile_settings")
          .select("*")
          .eq("user_id", savedUser.id)
          .maybeSingle();

        if (profileData) {
          setUsername(profileData.username || savedUser.username || "");
          setEmail(profileData.email || savedUser.email || "");
          setPhone(profileData.phone || savedUser.phone || "");
          setProfilePic(profileData.avatar_url || profileData.profile_pic || savedUser.profilePic || "");
          setActualPassword(profileData.password || savedUser.password || "");
        } else {
          setUsername(savedUser.username || "");
          setEmail(savedUser.email || "");
          setPhone(savedUser.phone || "");
          setProfilePic(savedUser.profilePic || "");
          setActualPassword(savedUser.password || "");
        }
      } catch {
        setUsername(savedUser.username || "");
        setEmail(savedUser.email || "");
        setPhone(savedUser.phone || "");
        setProfilePic(savedUser.profilePic || "");
        setActualPassword(savedUser.password || "");
      }
      setLoading(false);
    };
    fetchUser();
  }, [navigate]);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 4500);
    return () => clearTimeout(t);
  }, [message]);

  useEffect(() => {
    try {
      const local = JSON.parse(localStorage.getItem("localBusinessSettings") || "null");
      if (local?.businessName) setBizName(local.businessName);
      if (local?.phone) setBizPhone(local.phone);
    } catch {
      setBizName("");
      setBizPhone("");
    }

    const loadBiz = async () => {
      const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const tId = savedUser.tenantId || savedUser.tenant_id || localStorage.getItem("activeTenantId");
      if (!tId) return;
      try {
        const { data: s } = await supabase
          .from("business_settings")
          .select("business_name, phone")
          .eq("tenant_id", tId)
          .maybeSingle();
        if (s) {
          if (s.business_name) setBizName(s.business_name);
          if (s.phone) setBizPhone(s.phone);
          return;
        }
        const { data: t } = await supabase
          .from("tenants")
          .select("business_name, phone")
          .eq("id", tId)
          .maybeSingle();
        if (t) {
          if (t.business_name) setBizName(t.business_name);
          if (t.phone) setBizPhone(t.phone);
        }
      } catch {
        setBizName("");
        setBizPhone("");
      }
    };
    loadBiz();
  }, []);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      setMessage("Image must be under 2MB.");
      return;
    }

    const resized = await resizeImageFile(file);
    if (resized) {
      setProfilePic(resized);
    } else {
      setMessage("Couldn't process that image. Try another file.");
    }
  };

  const handleSave = async () => {
    setMessage("");

    if (!username.trim()) return setMessage("Username cannot be empty.");

    let passwordToUpdate = actualPassword;
    let passwordChanged = false;

    if (newPassword || currentPassword || confirmPassword) {
      if (!currentPassword) return setMessage("Enter your current password to make changes.");

      if (currentPassword.trim() !== actualPassword) {
        return setMessage("Current password is incorrect.");
      }

      if (!newPassword) return setMessage("Please enter a new password.");
      if (newPassword !== confirmPassword) return setMessage("New passwords do not match.");

      passwordToUpdate = newPassword.trim();
      passwordChanged = true;
    }

    setSaving(true);
    try {
      const payload: Record<string, any> = {
        id: userId,
        user_id: userId,
        tenant_id: tenantId,
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password: passwordToUpdate,
        avatar_url: profilePic,
        updated_at: new Date().toISOString(),
        role: role,
        synced: true
      };

      const { error } = await supabase
        .from("profile_settings")
        .upsert(payload, { onConflict: "user_id" });

      if (error) throw error;

      const { error: userError } = await supabase
        .from("users")
        .update({
          username: username.trim(),
          phone: phone.trim(),
          email: email.trim(),
          profile_pic: profilePic,
          ...(passwordChanged ? { password: passwordToUpdate } : {})
        })
        .eq("id", userId);

      const updatedUser = {
        ...JSON.parse(localStorage.getItem("currentUser") || "{}"),
        id: userId,
        username: username.trim(),
        email: email.trim(),
        phone: phone.trim(),
        profilePic: profilePic,
        avatar_url: profilePic,
        role: role,
        password: passwordToUpdate
      };

      localStorage.setItem("currentUser", JSON.stringify(updatedUser));
      if (profilePic) {
        localStorage.setItem(`cachedAvatar_${userId}`, profilePic);
        localStorage.setItem(`cachedAvatarUrl_${userId}`, profilePic);
      } else {
        localStorage.removeItem(`cachedAvatar_${userId}`);
        localStorage.removeItem(`cachedAvatarUrl_${userId}`);
      }
      localStorage.setItem(`cachedProfile_${userId}`, JSON.stringify({ id: userId, username: username.trim(), role, avatar_url: profilePic }));
      window.dispatchEvent(new Event("userChanged"));
      window.dispatchEvent(new Event("authStateChanged"));

      setActualPassword(passwordToUpdate);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      if (userError) {
        setMessage(passwordChanged
          ? `Profile saved, but the login password was not updated: ${userError.message}. Run fix-users-sync.sql.`
          : `Profile saved, but the users table sync failed: ${userError.message}. Run fix-users-sync.sql.`);
      } else {
        setMessage("Profile updated successfully!");
        setTimeout(() => (onBack ? onBack() : navigate(-1)), 1500);
      }
    } catch (error: any) {
      if (error?.code === "23503") {
        setMessage("Your account is missing from the users table. Log out and back in; if it persists, run fix-profile-settings-fk.sql in the Supabase SQL Editor.");
      } else {
        setMessage(error?.message || "Failed to update profile. Try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  const ok = message.includes("successfully");

  return (
    <div className="ps-root">
      {loading ? (
        <div className="ps-loading">
          <div className="ps-spin" />
          <span>Loading your profile…</span>
        </div>
      ) : (
        <>
          <header className="ps-bar">
            <button type="button" className="ps-iconbtn" onClick={() => (onBack ? onBack() : navigate(-1))} aria-label="Go back" title="Go back">
              <IconBack />
            </button>
            <div className="ps-barid">
              {bizName && <span className="ps-barname">{bizName}</span>}
              {bizPhone && (
                <a href={`tel:${bizPhone.replace(/\s+/g, "")}`} className="ps-barphone" title="Call">
                  <IconPhone />
                  <span className="ps-barphonetext">{bizPhone}</span>
                </a>
              )}
            </div>
            <label className="ps-barava" title="Change profile photo">
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} />
              {profilePic ? (
                <img className="ps-baravapic" src={profilePic} alt="Profile photo" />
              ) : (
                <div className="ps-baravapic ps-baravafall">{initialsOf(username, "U")}</div>
              )}
              <span className="ps-barbadge"><IconCamera /></span>
            </label>
            <button type="button" className="ps-topbtn" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </header>

          <main className="ps-main">
            <div className="ps-wrap">
              <h1 className="ps-pagetitle">Profile settings</h1>
              <div className="ps-forms">
                <div className="ps-secthead">
                  <span className="ps-secticon"><IconPerson /></span>
                  <div>
                    <h3>Account details</h3>
                    <p>How you appear across the app</p>
                  </div>
                </div>
                <section className="ps-card">
                  <div className="ps-field">
                    <input id="ps-user" placeholder=" " value={username} onChange={e => setUsername(e.target.value)} autoCapitalize="none" autoCorrect="off" autoComplete="username" />
                    <label htmlFor="ps-user">Username</label>
                  </div>
                  <div className="ps-field">
                    <input id="ps-email" placeholder=" " type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
                    <label htmlFor="ps-email">Email</label>
                  </div>
                  <div className="ps-field">
                    <input id="ps-phone" placeholder=" " type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e => setPhone(e.target.value)} />
                    <label htmlFor="ps-phone">Phone number</label>
                  </div>
                </section>

                <div className="ps-secthead">
                  <span className="ps-secticon"><IconLock /></span>
                  <div>
                    <h3>Change password</h3>
                    <p>Leave blank to keep your current password</p>
                  </div>
                </div>
                <section className="ps-card">
                  <div className="ps-field">
                    <input id="ps-cur" className={showCur ? "ps-hastrail" : ""} placeholder=" " type={showCur ? "text" : "password"} autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                    <label htmlFor="ps-cur">Current password</label>
                    <button type="button" className="ps-trail" onClick={() => setShowCur(v => !v)} aria-label={showCur ? "Hide password" : "Show password"} title={showCur ? "Hide password" : "Show password"}>
                      {showCur ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                  <div className="ps-field">
                    <input id="ps-new" className={showNew ? "ps-hastrail" : ""} placeholder=" " type={showNew ? "text" : "password"} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                    <label htmlFor="ps-new">New password</label>
                    <button type="button" className="ps-trail" onClick={() => setShowNew(v => !v)} aria-label={showNew ? "Hide password" : "Show password"} title={showNew ? "Hide password" : "Show password"}>
                      {showNew ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                  <div className="ps-field">
                    <input id="ps-conf" className={showConf ? "ps-hastrail" : ""} placeholder=" " type={showConf ? "text" : "password"} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSave()} />
                    <label htmlFor="ps-conf">Confirm new password</label>
                    <button type="button" className="ps-trail" onClick={() => setShowConf(v => !v)} aria-label={showConf ? "Hide password" : "Show password"} title={showConf ? "Hide password" : "Show password"}>
                      {showConf ? <IconEyeOff /> : <IconEye />}
                    </button>
                  </div>
                </section>

                <button type="button" className="ps-save" onClick={handleSave} disabled={saving}>
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </div>
          </main>

          {message && (
            <div className="ps-snack" role="status">
              <span className="ps-snackicon" style={{ color: ok ? "#81C995" : "#F28B82" }}>
                {ok ? <IconCheck /> : <IconAlert />}
              </span>
              <span className="ps-snacktext">{message}</span>
            </div>
          )}
        </>
      )}

      <style>{`
        .ps-root, .ps-root *, .ps-root *::before, .ps-root *::after { box-sizing: border-box; }
        .ps-root { width: 100%; min-height: 100vh; min-height: 100dvh; background: ${C.background}; color: ${C.onSurface}; font-family: ${FONT}; -webkit-font-smoothing: antialiased; display: flex; flex-direction: column; }
        .ps-bar { display: flex; align-items: center; gap: 10px; width: 100%; background: ${C.surface}; border-bottom: 1px solid ${C.outline}; padding: 10px clamp(12px, 3vw, 24px); position: sticky; top: 0; z-index: 20; flex-shrink: 0; }
        .ps-iconbtn { width: 44px; height: 44px; border-radius: 50%; border: none; background: transparent; color: ${C.medBlue}; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: background 0.15s ease; }
        .ps-iconbtn:hover { background: ${C.surfaceVariant}; }
        .ps-barid { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
        .ps-barname { font-size: 15px; font-weight: 500; color: ${C.onSurface}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .ps-barphone { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 500; color: ${C.medBlue}; text-decoration: none; white-space: nowrap; overflow: hidden; max-width: 100%; }
        .ps-barphone svg { flex-shrink: 0; }
        .ps-barphonetext { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        .ps-barava { position: relative; cursor: pointer; border-radius: 50%; flex-shrink: 0; display: flex; }
        .ps-baravapic { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: ${C.surfaceVariant}; border: 1px solid ${C.outline}; }
        .ps-baravafall { display: flex; align-items: center; justify-content: center; background: ${C.primaryContainer}; color: ${C.onPrimaryContainer}; font-size: 15px; font-weight: 500; letter-spacing: 0.5px; }
        .ps-barbadge { position: absolute; right: -3px; bottom: -3px; width: 20px; height: 20px; border-radius: 50%; background: ${C.primary}; color: ${C.onPrimary}; border: 2px solid ${C.surface}; display: flex; align-items: center; justify-content: center; }
        .ps-topbtn { height: 40px; padding: 0 22px; border-radius: 20px; border: none; background: ${C.primary}; color: ${C.onPrimary}; font-family: inherit; font-size: 14px; font-weight: 500; letter-spacing: 0.2px; cursor: pointer; flex-shrink: 0; transition: box-shadow 0.15s ease, opacity 0.15s ease; }
        .ps-topbtn:hover { box-shadow: ${HOVER_SHADOW}; }
        .ps-topbtn:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
        .ps-main { width: 100%; overflow-y: auto; -webkit-overflow-scrolling: touch; display: flex; flex-direction: column; flex: 1; }
        .ps-wrap { width: 100%; max-width: 680px; margin: 0 auto; padding: clamp(20px, 3.5vw, 36px) clamp(16px, 4vw, 28px) clamp(96px, 12vh, 128px); display: flex; flex-direction: column; }
        .ps-pagetitle { margin: 0 0 clamp(16px, 2.5vw, 24px); font-size: clamp(22px, 3vw, 26px); font-weight: 500; letter-spacing: 0; color: ${C.onSurface}; }
        .ps-forms { width: 100%; min-width: 0; display: flex; flex-direction: column; }
        .ps-secthead { display: flex; align-items: center; gap: 12px; margin: 0 2px 12px; }
        .ps-secticon { width: 36px; height: 36px; border-radius: 10px; background: ${C.primaryContainer}; color: ${C.onPrimaryContainer}; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .ps-secthead h3 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.1px; color: ${C.onSurface}; }
        .ps-secthead p { margin: 2px 0 0; font-size: 12.5px; color: ${C.onSurfaceVariant}; }
        .ps-card { background: ${C.surface}; border: 1px solid ${C.outline}; border-radius: 12px; box-shadow: ${CARD_SHADOW}; padding: clamp(18px, 3vw, 26px); display: grid; grid-template-columns: 1fr; gap: 16px; margin-bottom: clamp(26px, 4vw, 34px); }
        .ps-field { position: relative; width: 100%; min-width: 0; }
        .ps-field input { width: 100%; height: 54px; padding: 0 16px; font-family: inherit; font-size: 15.5px; color: ${C.onSurface}; background: ${C.surface}; border: 1px solid ${C.outlineVariant}; border-radius: 8px; outline: none; caret-color: ${C.primary}; transition: border-color 0.15s ease, box-shadow 0.15s ease; }
        .ps-field input:hover { border-color: ${C.onSurfaceVariant}; }
        .ps-field input:focus { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; }
        .ps-field label { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); padding: 0 5px; background: ${C.surface}; color: ${C.onSurfaceVariant}; font-size: 15px; pointer-events: none; max-width: calc(100% - 24px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; transition: top 0.12s ease, font-size 0.12s ease, color 0.12s ease, font-weight 0.12s ease; }
        .ps-field input:focus + label { color: ${C.primary}; }
        .ps-field input:focus + label, .ps-field input:not(:placeholder-shown) + label { top: 0; font-size: 11.5px; font-weight: 500; letter-spacing: 0.3px; }
        .ps-field input.ps-hastrail { padding-right: 50px; }
        .ps-trail { position: absolute; right: 7px; top: 50%; transform: translateY(-50%); width: 40px; height: 40px; border-radius: 50%; border: none; background: transparent; color: ${C.onSurfaceVariant}; display: flex; align-items: center; justify-content: center; cursor: pointer; transition: background 0.15s ease; }
        .ps-trail:hover { background: ${C.surfaceVariant}; }
        .ps-save { width: 100%; height: 52px; border-radius: 26px; border: none; background: ${C.primary}; color: ${C.onPrimary}; font-family: inherit; font-size: 15.5px; font-weight: 500; letter-spacing: 0.2px; cursor: pointer; transition: box-shadow 0.15s ease, opacity 0.15s ease; }
        .ps-save:hover { box-shadow: ${HOVER_SHADOW}; }
        .ps-save:disabled { opacity: 0.55; cursor: default; box-shadow: none; }
        .ps-snack { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); z-index: 100; display: flex; align-items: center; gap: 10px; padding: 13px 20px; border-radius: 8px; background: ${C.onSurface}; color: #FFFFFF; font-size: 14px; font-weight: 500; box-shadow: 0 3px 5px -1px rgba(0,0,0,0.2), 0 6px 10px 0 rgba(0,0,0,0.14), 0 1px 18px 0 rgba(0,0,0,0.12); max-width: min(92vw, 480px); animation: psSnack 0.2s ease; }
        .ps-snackicon { display: flex; flex-shrink: 0; }
        .ps-snacktext { min-width: 0; }
        .ps-loading { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; padding: 80px 24px; color: ${C.onSurfaceVariant}; font-size: 14px; }
        .ps-spin { width: 36px; height: 36px; border-radius: 50%; border: 3px solid ${C.surfaceVariant}; border-top-color: ${C.primary}; animation: psSpin 0.8s linear infinite; }
        @keyframes psSpin { to { transform: rotate(360deg); } }
        @keyframes psSnack { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
        @media (max-width: 480px) {
          .ps-barname { font-size: 14px; }
          .ps-barphone { font-size: 11.5px; }
          .ps-baravapic { width: 36px; height: 36px; }
          .ps-barbadge { width: 18px; height: 18px; }
          .ps-card { padding: 16px; gap: 14px; border-radius: 12px; }
          .ps-field input { height: 52px; font-size: 16px; }
          .ps-field label { font-size: 16px; }
          .ps-field input:focus + label, .ps-field input:not(:placeholder-shown) + label { font-size: 11.5px; }
          .ps-snack { bottom: 16px; }
        }
      `}</style>
    </div>
  );
}
