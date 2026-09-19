// src/components/ProfileSettings.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759"
};

export default function ProfileSettings({ role }: { role: "trainee" | "trainer" }) {
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

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
        const { data: profileData, error: profileError } = await supabase
          .from("profile_settings")
          .select("*")
          .eq("user_id", savedUser.id)
          .maybeSingle();

        if (profileError) console.error("Profile fetch error:", profileError);

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

        setLoading(false);
      } catch (err) {
        console.error("Error fetching profile:", err);
        setLoading(false);
      }
    };
    fetchUser();
  }, [navigate]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 2 * 1024 * 1024) {
      alert("File is too large! Please use an image under 2MB.");
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setProfilePic(reader.result);
      }
    };
    reader.onerror = () => alert("Failed to process the image.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const handleSave = async () => {
    setMessage("");

    if (!username.trim()) return setMessage("Username cannot be empty.");

    let passwordToUpdate = actualPassword;
    let passwordChanged = false;

    if (newPassword || currentPassword || confirmPassword) {
      if (!currentPassword) return setMessage("Please enter your current password to make changes.");
      
      if (currentPassword.trim() !== actualPassword) {
        console.log("Password mismatch:", { input: currentPassword, actual: actualPassword });
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
        id: userId, // Use userId as primary key for profile_settings to keep things simple
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

      await supabase
        .from("users")
        .update({ 
          username: username.trim(), 
          phone: phone.trim(), 
          email: email.trim(),
          profile_pic: profilePic
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
        role: role
      };

      localStorage.setItem("currentUser", JSON.stringify(updatedUser));
      window.dispatchEvent(new Event("userChanged"));

      setActualPassword(passwordToUpdate);

      if (passwordChanged) {
        console.warn("Password changed locally.");
      }

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setMessage("Profile updated successfully!");

      setTimeout(() => navigate(-1), 1500);
    } catch (error: any) {
      console.error("Save error:", JSON.stringify(error, null, 2));
      setMessage(error?.message || "Failed to update profile. Check console for details.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: C.textTertiary, padding: "40px" }}>Loading...</div>
  );

  const inputStyle: React.CSSProperties = {
    width: "100%", height: "50px", padding: "0 16px", border: "none", outline: "none",
    background: "transparent", fontSize: "16px", color: C.textPrimary, boxSizing: "border-box",
    caretColor: C.medBlue, textAlign: "right"
  };

  const rowStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "12px 16px", borderBottom: `0.5px solid ${C.separator}`, gap: "16px"
  };

  return (
    <div style={{ width: "100%", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", color: C.textPrimary, minHeight: "100vh" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "8px 16px", borderBottom: `0.33px solid ${C.separator}`, flexShrink: 0, gap: "12px", background: C.card, position: "sticky", top: 0, zIndex: 10 }}>
        <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: C.medBlue, cursor: "pointer", display: "flex", alignItems: "center", padding: 0, flexShrink: 0 }}>
          <svg width="24px" height="24px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span style={{ fontSize: "17px", fontWeight: "600", color: C.textPrimary }}>Edit Profile</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleSave} disabled={saving} style={{ background: "none", border: "none", color: saving ? C.textTertiary : C.medBlue, fontSize: "17px", cursor: saving ? "default" : "pointer", fontWeight: "600", padding: 0 }}>
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <main style={{ overflowY: "auto", WebkitOverflowScrolling: "touch", width: "100%" }}>
        <div style={{ width: "100%", maxWidth: "600px", margin: "0 auto", padding: "32px 24px 120px 24px", boxSizing: "border-box" }}>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "32px" }}>
            <label style={{ cursor: "pointer", position: "relative" }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} />
              {profilePic ? (
                <img src={profilePic} alt="Profile" style={{ width: "100px", height: "100px", borderRadius: "50%", objectFit: "cover", border: `3px solid ${C.card}`, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }} />
              ) : (
                <div style={{ width: "100px", height: "100px", borderRadius: "50%", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "36px", fontWeight: "700", border: `3px solid ${C.card}`, boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
                  {username?.charAt(0).toUpperCase() || "U"}
                </div>
              )}
              <div style={{ position: "absolute", bottom: 0, right: 0, background: C.medBlue, color: "#fff", borderRadius: "50%", width: "30px", height: "30px", display: "flex", alignItems: "center", justifyContent: "center", border: `3px solid ${C.card}` }}>
                <svg width="15px" height="15px" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              </div>
            </label>
            <h2 style={{ margin: "16px 0 4px 0", fontSize: "22px", fontWeight: "700", letterSpacing: "-0.5px" }}>{username}</h2>
            <p style={{ margin: 0, fontSize: "14px", color: C.textTertiary }}>{role === 'trainer' ? 'Trainer Profile' : 'Learner Profile'}</p>
          </div>

          <h3 style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 16px" }}>Account</h3>
          <div style={{ background: C.card, borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: "24px" }}>
            <div style={rowStyle}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>Username</span>
              <input style={inputStyle} value={username} onChange={e => setUsername(e.target.value)} placeholder="Username" />
            </div>
            <div style={rowStyle}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>Email</span>
              <input style={inputStyle} value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" type="email" />
            </div>
            <div style={{ ...rowStyle, borderBottom: "none" }}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>Phone</span>
              <input style={inputStyle} value={phone} onChange={e => setPhone(e.target.value)} placeholder="Phone Number" type="tel" />
            </div>
          </div>

          <h3 style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 16px" }}>Change Password</h3>
          <div style={{ background: C.card, borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: "24px" }}>
            <div style={rowStyle}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>Current</span>
              <input style={inputStyle} type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} placeholder="Required to save" />
            </div>
            <div style={rowStyle}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>New</span>
              <input style={inputStyle} type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Leave blank to keep same" />
            </div>
            <div style={{ ...rowStyle, borderBottom: "none" }}>
              <span style={{ fontSize: "16px", color: C.textPrimary, flexShrink: 0 }}>Confirm</span>
              <input style={inputStyle} type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && handleSave()} placeholder="Re-type new password" />
            </div>
          </div>

          {message && (
            <p style={{ textAlign: "center", fontSize: "14px", marginBottom: "16px", color: message.includes("successfully") ? C.green : C.red }}>
              {message}
            </p>
          )}

          <button onClick={handleSave} disabled={saving} style={{ width: "100%", padding: "14px", borderRadius: "14px", border: "none", background: C.medBlue, color: "white", fontSize: "17px", fontWeight: "600", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </main>
    </div>
  );
}