// src/admin/AdminLayout.tsx
import { Outlet, useNavigate, useLocation, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import type { User } from "../types";
import { supabase } from "../auth/supabase";

interface Props {
    user: User | null;
}

export default function AdminLayout({ user }: Props) {
    const navigate = useNavigate();
    const location = useLocation();
    const [settings, setSettings] = useState<any>(null);

    useEffect(() => {
        const loadSettings = async () => {
            if (!user?.tenantId) return;
            try {
                const { data: s } = await supabase
                    .from("business_settings")
                    .select("*")
                    .eq("tenant_id", user.tenantId)
                    .maybeSingle();
                if (s) setSettings(s);
            } catch (err) {
                console.error("Failed to load business settings", err);
            }
        };
        loadSettings();
    }, [user?.tenantId]);

    if (!user) {
        return <Navigate to="/" replace />;
    }

    const handleLogout = async () => {
        try { 
            await supabase.auth.signOut(); 
        } catch (e) { 
            console.error("Logout failed", e); 
        }
        
        localStorage.removeItem("authToken");
        localStorage.removeItem("currentUser");
        localStorage.removeItem("currentUserId");
        localStorage.removeItem("activeTenantId");
        localStorage.removeItem("loggedInUser");
        localStorage.removeItem("trainee");
        localStorage.removeItem("adminDeviceId");
        sessionStorage.clear();
        
        window.dispatchEvent(new Event("authStateChanged"));
        navigate("/", { replace: true });
    };

    const navHeight = 56;
    const activeColor = "#007AFF";
    const inactiveColor = "#8E8E93";
    const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

    const C = {
        bg: "#F2F2F7",
        card: "#FFFFFF",
        separator: "#E5E5EA",
        textPrimary: "#1C1C1E",
        textTertiary: "#8E8E93",
        medBlue: "#0A84FF",
        purple: "#AF52DE",
        purpleBg: "#F5F0FF",
        red: "#FF3B30",
        redBg: "#FFEFEE",
    };

    const businessName = settings?.business_name || "";
    const businessLogo = settings?.logo;
    const phone = settings?.phone || "";

    const navItems = [
        {
            label: "Home", path: "/admin",
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        },
        {
            label: "Courses", path: "/admin/courses",
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        },
        {
            label: "Users", path: "/admin/users",
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        },
        {
            label: "Settings", path: "/admin/settings",
            icon: <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>
        }
    ];

    return (
        <div style={{
            height: "100dvh",
            width: "100%",
            display: "flex",
            flexDirection: "column",
            background: C.bg,
            fontFamily: iosFont,
            color: C.textPrimary,
            overflow: "hidden",
            boxSizing: "border-box"
        }}>
            {/* UNIFIED APP BAR - BUSINESS DETAILS */}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "10px 16px",
                    background: "rgba(255,255,255,0.8)",
                    backdropFilter: "blur(20px)",
                    WebkitBackdropFilter: "blur(20px)",
                    borderBottom: `1px solid ${C.separator}`,
                    position: "sticky",
                    top: 0,
                    zIndex: 10,
                    flexShrink: 0,
                    flexWrap: "wrap",
                    gap: "8px",
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "200px" }}>
                    {businessLogo && (
                        <img src={businessLogo} alt="Logo" style={{ width: "36px", height: "36px", borderRadius: "8px", objectFit: "cover" }} />
                    )}
                    {(businessName || phone) && (
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, justifyContent: "center" }}>
                            {businessName && (
                                <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "17px", fontWeight: 700, letterSpacing: "-0.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {businessName}
                                </h1>
                            )}
                            {phone && (
                                <a href={`tel:${phone}`} style={{ fontSize: "12px", color: C.textTertiary, textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                                    {phone}
                                </a>
                            )}
                        </div>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            background: C.purpleBg,
                            padding: "4px 12px 4px 4px",
                            borderRadius: "20px",
                        }}
                    >
                        {user?.profilePic ? (
                            <img src={user.profilePic} alt="Admin" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} />
                        ) : (
                            <div
                                style={{
                                    width: "28px",
                                    height: "28px",
                                    borderRadius: "50%",
                                    background: C.card,
                                    color: C.purple,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: "12px",
                                    fontWeight: "700",
                                }}
                            >
                                {user?.username?.charAt(0).toUpperCase()}
                            </div>
                        )}
                        <span style={{ fontSize: "13px", fontWeight: "600", color: C.purple }}>
                            {user?.username}
                        </span>
                    </div>

                    <button
                        onClick={() => navigate("/admin/settings")}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "36px",
                            height: "36px",
                            borderRadius: "9px",
                            background: "rgba(118, 118, 128, 0.12)",
                            border: "none",
                            cursor: "pointer",
                            color: C.textPrimary,
                            fontSize: "18px"
                        }}
                        title="Settings"
                    >⚙️</button>

                    <button
                        onClick={handleLogout}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: "36px",
                            height: "36px",
                            borderRadius: "9px",
                            background: C.redBg,
                            border: "none",
                            cursor: "pointer",
                            color: C.red,
                        }}
                        title="Logout"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            </div>

            <main style={{
                flex: 1,
                overflowY: "auto",
                overflowX: "hidden",
                WebkitOverflowScrolling: "touch",
                width: "100%",
                minHeight: 0,
                boxSizing: "border-box"
            }}>
                <Outlet />
            </main>

            <nav style={{
                height: navHeight,
                background: "#FFFFFF",
                display: "flex",
                justifyContent: "space-around",
                alignItems: "center",
                borderTop: `1px solid ${C.separator}`,
                flexShrink: 0,
                width: "100%",
                boxSizing: "border-box"
            }}>
                {navItems.map(item => {
                    const isActive = location.pathname === item.path;
                    return (
                        <button
                            key={item.path}
                            onClick={() => navigate(item.path)}
                            title={item.label}
                            style={{
                                border: "none",
                                background: "transparent",
                                flex: 1,
                                height: "100%",
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "4px",
                                color: isActive ? activeColor : inactiveColor,
                                transition: "color 0.2s ease",
                                padding: 0,
                                boxSizing: "border-box"
                            }}
                        >
                            {item.icon}
                            <span style={{
                                fontSize: "12px",
                                fontWeight: isActive ? "700" : "500",
                                fontFamily: iosFont,
                                letterSpacing: "0.2px"
                            }}>
                                {item.label}
                            </span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}