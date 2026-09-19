// src/components/AppLayout.tsx
import { Outlet, useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { User, BusinessSettings } from "../types";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E",
  textTertiary: "#8E8E93",
  bg: "#F2F2F7",
  separator: "#E5E5EA",
  red: "#FF3B30",
  redBg: "#FFEFEE",
  purple: "#AF52DE",
  purpleBg: "#F5F0FF",
};

interface Props {
  user: User | null;
}

export default function AppLayout({ user }: Props) {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<BusinessSettings | null>(null);

  useEffect(() => {
    if (!user?.tenantId) return;
    supabase
      .from("business_settings")
      .select("*")
      .eq("tenant_id", user.tenantId)
      .maybeSingle()
      .then(({ data: s }) => {
        if (s) {
          setSettings({
            id: s.id,
            businessName: s.business_name || "",
            address: s.address || "",
            phone: s.phone || "",
            email: s.email || "",
            website: s.website || "",
            logo: s.logo || "",
            header: s.header || "",
            adminProfile: s.admin_profile || "",
            loginBackground: s.login_background || "",
            themeColor: s.theme_color || "",
            appBarItems: s.app_bar_items || [],
            tenantId: s.tenant_id,
            createdAt: s.created_at,
          });
        }
      });
  }, [user?.tenantId]);

  function handleLogout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    window.dispatchEvent(new Event("userChanged"));
    navigate("/login");
  }

  return (
    <div style={{
      height: "100dvh", width: "100%", display: "flex", flexDirection: "column",
      background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      color: C.textPrimary, overflow: "hidden", boxSizing: "border-box",
    }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px", background: "rgba(255,255,255,0.8)",
        backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
        borderBottom: `1px solid ${C.separator}`, flexShrink: 0, gap: "8px",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: 0 }}>
          {settings?.logo && (
            <img src={settings.logo} alt="Logo" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
          )}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            {settings?.businessName && (
              <h1 style={{ margin: 0, fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{settings.businessName}</h1>
            )}
            {settings?.phone && (
              <a href={`tel:${settings.phone}`} style={{ fontSize: 12, color: C.textTertiary, textDecoration: "none" }}>{settings.phone}</a>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: "20px" }}>
            {user?.profilePic ? (
              <img src={user.profilePic} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#fff", color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
                {user?.username?.charAt(0).toUpperCase() || "?"}
              </div>
            )}
            <span style={{ fontSize: 13, fontWeight: 600, color: C.purple }}>{user?.username || "User"}</span>
          </div>
          <button onClick={handleLogout} style={{ width: 36, height: 36, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>
      <main style={{ flex: 1, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch", width: "100%", minHeight: 0, boxSizing: "border-box" }}>
        <Outlet />
      </main>
    </div>
  );
}