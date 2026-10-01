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

            // 1. Load from Local Storage INSTANTLY
            const localSettings = localStorage.getItem("localBusinessSettings");
            if (localSettings) {
                setSettings(JSON.parse(localSettings));
            }

            // 2. Try Supabase
            try {
                const { data: s } = await supabase
                    .from("business_settings")
                    .select("*")
                    .eq("tenant_id", user.tenantId)
                    .maybeSingle();
                if (s) setSettings(s);
            } catch {
                /* offline — cached settings shown */
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
        } catch {
            // signOut failure shouldn't block local logout
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

    const navHeight = 58;
    const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

    // ---- Design tokens (matches the rest of the admin suite) ----
    const C = {
        bg: "#F2F2F7",
        card: "#FFFFFF",
        separator: "#E5E5EA",
        separatorLight: "#F0F0F2",
        textPrimary: "#1C1C1E",
        textTertiary: "#8E8E93",
        medBlue: "#0A84FF",
        medBlueDark: "#0060DF",
        medBlueBg: "#E8F2FF",
        purple: "#AF52DE",
        purpleBg: "#F5F0FF",
        red: "#FF3B30",
        redBg: "#FFEFEE",
        green: "#34C759",
        greenBg: "#EAF9EE",
    };
    const S = {
        shadowXs: "0 1px 2px rgba(16,24,40,0.06)",
        shadowSm: "0 2px 8px rgba(16,24,40,0.08)",
        ease: "cubic-bezier(0.4, 0, 0.2, 1)",
    };
    const gutter = "clamp(10px, 2.5vw, 20px)";
    const isNarrow = typeof window !== "undefined" && window.innerWidth < 560;

    const businessName = settings?.businessName || settings?.business_name || "";
    const businessLogo = settings?.logo;
    const phone = settings?.phone || "";

    // Unified icon button with hover feedback
    const iconBtn = (bg: string, color: string): React.CSSProperties => ({
        display: "flex", alignItems: "center", justifyContent: "center",
        width: 34, height: 34, borderRadius: 10, background: bg, border: "none",
        cursor: "pointer", color, flexShrink: 0,
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
    });
    const hoverLift = (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.transform = "translateY(-1px)";
        e.currentTarget.style.boxShadow = S.shadowSm;
    };
    const hoverReset = (e: React.MouseEvent<HTMLElement>) => {
        e.currentTarget.style.transform = "none";
        e.currentTarget.style.boxShadow = "none";
    };

    const navItems = [
        {
            label: "Home", path: "/admin",
            icon: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
        },
        {
            label: "Courses", path: "/admin/courses",
            icon: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        },
        {
            label: "Users", path: "/admin/users",
            icon: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
        },
        {
            label: "Forms", path: "/admin/forms",
            icon: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
        },
        {
            // SINGLE settings entry point — bottom nav only (app-bar ⚙️ removed)
            label: "Settings", path: "/admin/settings",
            icon: <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1.08 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1.08z"/></svg>
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
            <style>{`
                button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
            `}</style>

            {/* UNIFIED APP BAR — fully transparent, clean top edge (no accent strip, no line) */}
            <div
                style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: `8px ${gutter}`,
                    rowGap: 6,
                    columnGap: 10,
                    zIndex: 10,
                    flexShrink: 0,
                    width: "100%",
                    boxSizing: "border-box",
                    position: "relative",
                }}
            >
                {/* Left Side - Business Info */}
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: "1 1 160px", minWidth: 0, overflow: "hidden" }}>
                    {businessLogo ? (
                        <img src={businessLogo} alt="Logo" style={{ width: 34, height: 34, borderRadius: 9, objectFit: "cover", flexShrink: 0, boxShadow: S.shadowXs }} />
                    ) : (
                        <div style={{ width: 34, height: 34, borderRadius: 9, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 700, flexShrink: 0 }}>
                            {(businessName || "B").charAt(0).toUpperCase()}
                        </div>
                    )}
                    {(businessName || phone) && (
                        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, justifyContent: "center", overflow: "hidden" }}>
                            {businessName && (
                                <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "clamp(15px, 2.5vw, 17px)", fontWeight: 700, letterSpacing: "-0.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {businessName}
                                </h1>
                            )}
                            {phone && !isNarrow && (
                                <a href={`tel:${phone}`} style={{ fontSize: 12, color: C.textTertiary, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                                    {phone}
                                </a>
                            )}
                        </div>
                    )}
                </div>

                {/* Right Side - Actions */}
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginLeft: "auto" }}>
                    {/* Admin icon — identifies the signed-in admin */}
                    <div
                        title="Admin"
                        style={{
                            display: "flex", alignItems: "center", justifyContent: "center",
                            width: 34, height: 34, borderRadius: 10,
                            background: C.purpleBg, color: C.purple,
                            flexShrink: 0, boxShadow: S.shadowXs,
                        }}
                    >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            <circle cx="12" cy="10" r="2.2" />
                            <path d="M8.8 15.2c.7-1.3 1.9-2 3.2-2s2.5.7 3.2 2" />
                        </svg>
                    </div>

                    {/* SMS quick action */}
                    <button
                        onClick={() => navigate("/admin/sms")}
                        onMouseEnter={hoverLift}
                        onMouseLeave={hoverReset}
                        style={iconBtn(C.greenBg, C.green)}
                        title="Send SMS"
                    >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                            <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8.5L4 21v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"></path>
                        </svg>
                    </button>

                    <button
                        onClick={handleLogout}
                        onMouseEnter={hoverLift}
                        onMouseLeave={hoverReset}
                        style={iconBtn(C.redBg, C.red)}
                        title="Logout"
                    >
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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

            {/* BOTTOM NAV — elevated active pill, single Settings entry */}
            <nav style={{
                height: navHeight,
                background: "#FFFFFF",
                display: "flex",
                justifyContent: "space-around",
                alignItems: "center",
                borderTop: `1px solid ${C.separator}`,
                flexShrink: 0,
                width: "100%",
                boxSizing: "border-box",
                padding: "0 4px",
                boxShadow: "0 -2px 12px rgba(16,24,40,0.04)",
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
                                background: isActive ? C.medBlueBg : "transparent",
                                borderRadius: 12,
                                flex: 1,
                                height: "88%",
                                maxWidth: 96,
                                cursor: "pointer",
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 3,
                                color: isActive ? C.medBlue : C.textTertiary,
                                transition: "color 0.2s ease, background 0.2s ease",
                                padding: 0,
                                boxSizing: "border-box",
                                minWidth: 0,
                            }}
                            onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.separatorLight; }}
                            onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                        >
                            {item.icon}
                            <span style={{
                                fontSize: "clamp(10px, 2.4vw, 12px)",
                                fontWeight: isActive ? 700 : 500,
                                fontFamily: iosFont,
                                letterSpacing: "0.2px",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: "100%",
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