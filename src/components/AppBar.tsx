// src/components/AppBar.tsx
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { stopPeriodicPull } from "../database/sync";
import type { BusinessSettings } from "../types";

interface SupabaseUser {
    id: string;
    username: string;
    role: string;
    avatar_url?: string | null;
    tenant_id?: string | null;
}

function mapSettingsFromSupabase(row: Record<string, any>): BusinessSettings {
  return {
    id: row.id || "main",
    tenantId: row.tenant_id || undefined,
    businessName: row.business_name || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    logo: row.logo || "",
    loginBackground: row.login_background || "",
    website: row.website || "",
    header: row.header || undefined,
    adminProfile: row.admin_profile || undefined,
    themeColor: row.theme_color || undefined,
    appBarItems: row.app_bar_items || [],
    createdAt: row.created_at || new Date().toISOString(),
  };
}

export default function AppBar() {
    const navigate = useNavigate();
    const [windowWidth, setWindowWidth] = useState(window.innerWidth);
    const [settings, setSettings] = useState<BusinessSettings | null>(null);
    const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleResize = () => setWindowWidth(window.innerWidth);
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                const parsedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
                let tenantId = parsedUser?.tenantId || parsedUser?.tenant_id || localStorage.getItem("activeTenantId");

                if (tenantId) {
                    const { data: settingsData } = await supabase
                        .from("business_settings")
                        .select("*")
                        .eq("tenant_id", tenantId)
                        .maybeSingle();

                    if (settingsData) {
                        setSettings(mapSettingsFromSupabase(settingsData));
                        return;
                    }

                    const { data: tenantData } = await supabase
                        .from("tenants")
                        .select("id, business_name, phone")
                        .eq("id", tenantId)
                        .maybeSingle();

                    if (tenantData) {
                        setSettings({
                            id: "main", tenantId: tenantData.id, businessName: tenantData.business_name || "",
                            phone: tenantData.phone || "", email: "", address: "", logo: "", loginBackground: "",
                            website: "", header: undefined, adminProfile: undefined, themeColor: undefined,
                            appBarItems: [], createdAt: new Date().toISOString(),
                        });
                        return;
                    }
                }
                
                const localSettings = localStorage.getItem("localBusinessSettings");
                if (localSettings) setSettings(JSON.parse(localSettings));
            } catch (error) {
                console.error("Failed to load settings", error);
            }
        };

        const loadUser = async () => {
            const savedUserStr = localStorage.getItem("currentUser");
            const parsedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
            if (!parsedUser?.id) { setCurrentUser(null); return; }

            setCurrentUser({
                id: parsedUser.id, 
                username: parsedUser.username,
                role: parsedUser.role, 
                avatar_url: parsedUser.profilePic || parsedUser.avatar_url,
                tenant_id: parsedUser.tenantId,
            });

            try {
                const { data: profileData } = await supabase
                    .from("profile_settings")
                    .select("username, avatar_url, role")
                    .eq("user_id", parsedUser.id)
                    .maybeSingle();

                if (profileData) {
                    setCurrentUser({
                        id: parsedUser.id, username: profileData.username || parsedUser.username,
                        role: profileData.role || parsedUser.role, avatar_url: profileData.avatar_url || parsedUser.profilePic,
                        tenant_id: parsedUser.tenantId,
                    });
                }
            } catch (err) {
                console.warn("Profile fetch error:", err);
            }
        };

        fetchSettings();
        loadUser();
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // ✅ FIX: Borrowed EXACTLY from TrainerDashboard.tsx
    const handleLogout = () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        
        // 1. Stop background sync just in case
        stopPeriodicPull();
        
        // 2. Clear absolutely ALL local storage and session data
        localStorage.removeItem("currentUser");
        localStorage.removeItem("authToken");
        localStorage.removeItem("adminDeviceId");

        // 3. Notify the rest of the app
        window.dispatchEvent(new Event("authStateChanged"));
        
        // 4. Send them to the root "/" (Startup) on logout
        navigate("/");
    };

    const handleSettingsClick = () => {
        if (!currentUser) return;
        if (currentUser.role === "trainer") navigate("/trainer/settings");
        else if (currentUser.role === "admin") navigate("/admin/settings");
        else navigate("/user/settings");
    };

    const businessName = settings?.businessName || "";
    const businessAddress = settings?.address || "";
    const businessLogo = settings?.logo || "";
    const businessPhone = settings?.phone || "";
    const businessEmail = settings?.email || "";
    const businessWebsite = settings?.website || "";
    const hasContactInfo = businessAddress || businessPhone || businessEmail || businessWebsite;
    const hasLeftInfo = businessName || businessLogo || hasContactInfo;
    const userInitial = currentUser?.username ? currentUser.username.charAt(0).toUpperCase() : "";
    let userRole = currentUser?.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : "";
    const showContactText = windowWidth > 820;

    return (
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(255,255,255,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "0.33px solid #E5E5EA", flexShrink: 0, zIndex: 1000, width: "100%", boxSizing: "border-box", gap: "24px", position: "sticky", top: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", flex: 1, minWidth: 0, overflow: "hidden" }}>
                {hasLeftInfo && (
                    <>
                        {businessLogo && <img src={businessLogo} alt="Logo" style={{ width: "32px", height: "32px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }} />}
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 1 }}>
                            {businessName && <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1C1C1E", letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{businessName}</h1>}
                            {hasContactInfo && (
                                <div style={{ display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap", marginTop: businessName ? "2px" : "0" }}>
                                    {businessPhone && (
                                        <a href={`tel:${businessPhone}`} style={{ fontSize: "12px", color: "#8E8E93", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                                            {showContactText && <span>{businessPhone}</span>}
                                        </a>
                                    )}
                                    {businessAddress && (
                                        <div style={{ fontSize: "12px", color: "#8E8E93", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "200px" }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                            {showContactText && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessAddress}</span>}
                                        </div>
                                    )}
                                    {businessEmail && (
                                        <a href={`mailto:${businessEmail}`} style={{ fontSize: "12px", color: "#8E8E93", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                                            {showContactText && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessEmail}</span>}
                                        </a>
                                    )}
                                    {businessWebsite && (
                                        <a href={businessWebsite.startsWith('http') ? businessWebsite : `https://${businessWebsite}`} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "#8E8E93", textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "150px" }}>
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1 4-10z"/></svg>
                                            {showContactText && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessWebsite.replace(/^https?:\/\//, '')}</span>}
                                        </a>
                                    )}
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "16px", flexShrink: 0, minWidth: 0 }}>
                {currentUser && (
                    <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
                        <div onClick={() => setMenuOpen(!menuOpen)} style={{ display: "flex", alignItems: "center", gap: "10px", cursor: "pointer", padding: "4px 8px 4px 4px", borderRadius: "20px", background: menuOpen ? "rgba(118, 118, 128, 0.12)" : "transparent", transition: "background 0.2s ease" }}>
                            {currentUser.avatar_url ? (
                                <img src={currentUser.avatar_url} alt="Profile" style={{ width: "32px", height: "32px", borderRadius: "50%", objectFit: "cover", flexShrink: 0, border: "1px solid rgba(0,0,0,0.05)" }} />
                            ) : userInitial ? (
                                <div style={{ width: "32px", height: "32px", borderRadius: "50%", background: "#0A84FF", color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "700", fontSize: "14px", flexShrink: 0 }}>{userInitial}</div>
                            ) : null}
                            {(currentUser?.username || userRole) && (
                                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
                                    {currentUser?.username && <span style={{ fontSize: "14px", fontWeight: "600", color: "#1C1C1E" }}>{currentUser.username}</span>}
                                    {userRole && <span style={{ fontSize: "11px", color: "#8E8E93", marginTop: "1px" }}>{userRole}</span>}
                                </div>
                            )}
                        </div>

                        {menuOpen && (
                            <div style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, background: "rgba(255, 255, 255, 0.8)", backdropFilter: "blur(20px) saturate(180%)", WebkitBackdropFilter: "blur(20px) saturate(180%)", borderRadius: "14px", boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "0.5px solid rgba(0,0,0,0.05)", width: "180px", padding: "6px", zIndex: 2000 }}>
                                <button onClick={handleSettingsClick} style={{ width: "100%", padding: "10px 12px", border: "none", background: "transparent", color: "#1C1C1E", fontSize: "15px", fontWeight: "500", textAlign: "left", cursor: "pointer", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit", boxSizing: "border-box" }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.05)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                    Settings
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
                                </button>
                                <button onClick={handleLogout} disabled={isLoggingOut} style={{ width: "100%", padding: "10px 12px", border: "none", background: "transparent", color: "#FF3B30", fontSize: "15px", fontWeight: "500", textAlign: "left", cursor: isLoggingOut ? "not-allowed" : "pointer", borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "space-between", fontFamily: "inherit", boxSizing: "border-box", opacity: isLoggingOut ? 0.5 : 1 }} onMouseEnter={(e) => e.currentTarget.style.background = "rgba(0,0,0,0.05)"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                    {isLoggingOut ? "Signing out..." : "Logout"}
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </header>
    );
}