import { useState, useEffect, useRef, useCallback } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import type { BusinessSettings } from "../types";

function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    const m = raw.match(/^(data:image\/[a-z.+-]+;base64,)([\s\S]*)$/i);
    return m ? m[1] + m[2].replace(/\s+/g, "") : raw;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("<svg") || raw.startsWith("<?xml")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
  }
  const compact = raw.replace(/\s+/g, "");
  if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    let mime = "image/png";
    if (compact.startsWith("/9j/")) mime = "image/jpeg";
    else if (compact.startsWith("R0lGOD")) mime = "image/gif";
    else if (compact.startsWith("UklGR")) mime = "image/webp";
    else if (compact.startsWith("PHN2Zy") || compact.startsWith("PD94bW")) mime = "image/svg+xml";
    return `data:${mime};base64,${compact}`;
  }
  return raw;
}

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
  separatorLight: "#E8EAED",
  error: "#D93025",
};

const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

// Logo rendered flat on the app bar — no badge plate, border, shadow or
// padding — so the artwork reads as part of the bar itself (WhatsApp-style)
// instead of sitting inside an avatar-style chip.
const LOGO = {
  size: 60,
  monoSize: 48,
  maxWidth: 240,
};

export function logoBadgeWidth(aspect: number | null | undefined, size: number = LOGO.size): number {
  const a = typeof aspect === "number" && Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const s = typeof size === "number" && Number.isFinite(size) && size > 0 ? size : LOGO.size;
  return Math.round(Math.min(LOGO.maxWidth, Math.max(s, s * a)));
}

export function logoMaxWidth(windowWidth: number): number {
  if (typeof windowWidth !== "number" || !Number.isFinite(windowWidth) || windowWidth <= 0) {
    return 240;
  }
  return Math.round(Math.min(240, Math.max(48, windowWidth * 0.4)));
}

export function logoStyle(_windowWidth?: number): CSSProperties {
  return {
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "contain",
    objectPosition: "center",
    borderRadius: 0,
    userSelect: "none",
  };
}

const stateNeutral = "inset 0 0 0 9999px rgba(60,64,67,0.08)";
const motion = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

function MaterialIcon({ d, size = 20, style }: { d: string; size?: number; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0, ...style }}>
      <path d={d} />
    </svg>
  );
}

const P = {
  call: "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  place: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  mail: "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V8l8 5 8-5v10zm-8-7L4 6h16l-8 5z",
  language: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.91 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2 0 .68.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43 1.08 2.76 1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2 0-.68.07-1.35.16-2h4.68c.09.65.16 1.32.16 2 0 .68-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2 0-.68-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z",
  moreVert: "M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
  settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
  logout: "M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z",
};

interface SupabaseUser {
  id: string;
  username: string;
  role: string;
  avatar_url?: string | null;
  tenant_id?: string | null;
}

function safeParse<T>(json: string | null, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
}

function mapSettingsFromSupabase(row: Record<string, any>): BusinessSettings {
  return {
    id: row.id || "main",
    tenantId: row.tenant_id || undefined,
    businessName: row.business_name || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    logo: normalizeImageSrc(row.logo),
    loginBackground: normalizeImageSrc(row.login_background),
    website: row.website || "",
    header: row.header || undefined,
    adminProfile: row.admin_profile || undefined,
    themeColor: row.theme_color || undefined,
    appBarItems: row.app_bar_items || [],
    createdAt: row.created_at || new Date().toISOString(),
  };
}

async function cacheAvatarImage(userId: string, url: string) {
  try {
    if (url.startsWith("data:")) {
      localStorage.setItem(`cachedAvatar_${userId}`, url);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
      return;
    }

    if (localStorage.getItem(`cachedAvatarUrl_${userId}`) === url) return;

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 1_000_000) return;

    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    if (dataUrl) {
      localStorage.setItem(`cachedAvatar_${userId}`, dataUrl);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
    }
  } catch {}
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

interface AppBarProps {
  hideLogo?: boolean;
  hideAccount?: boolean;
}

export default function AppBar({ hideLogo = false, hideAccount = false }: AppBarProps = {}) {
  const navigate = useNavigate();
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [currentUser, setCurrentUser] = useState<SupabaseUser | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [logoError, setLogoError] = useState(false);
  const [logoAspect, setLogoAspect] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => { setAvatarError(false); }, [currentUser?.avatar_url]);

  useEffect(() => { setLogoError(false); setLogoAspect(null); }, [settings?.logo]);

  const fetchSettings = useCallback(async () => {
    try {
      const parsedUser = safeParse<Record<string, any>>(localStorage.getItem("currentUser"), {});
      const tenantId = parsedUser?.tenantId || parsedUser?.tenant_id || localStorage.getItem("activeTenantId");

      const localSettings = safeParse<BusinessSettings | null>(localStorage.getItem("localBusinessSettings"), null);
      if (localSettings) {
        setSettings({
          ...localSettings,
          logo: normalizeImageSrc(localSettings.logo),
          loginBackground: normalizeImageSrc(localSettings.loginBackground),
        });
      }

      if (tenantId) {
        try {
          const { data: settingsData } = await supabase
            .from("business_settings")
            .select("*")
            .eq("tenant_id", tenantId)
            .maybeSingle();

          if (settingsData) {
            const mapped = mapSettingsFromSupabase(settingsData);
            setSettings(mapped);
            localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
            return;
          }

          const { data: tenantData } = await supabase
            .from("tenants")
            .select("id, business_name, phone")
            .eq("id", tenantId)
            .maybeSingle();

          if (tenantData) {
            const fallbackSettings = {
              id: "main", tenantId: tenantData.id, businessName: tenantData.business_name || "",
              phone: tenantData.phone || "", email: "", address: "", logo: "", loginBackground: "",
              website: "", header: undefined, adminProfile: undefined, themeColor: undefined,
              appBarItems: [], createdAt: new Date().toISOString(),
            };
            setSettings(fallbackSettings);
            localStorage.setItem("localBusinessSettings", JSON.stringify(fallbackSettings));
          }
        } catch (e) {
          console.warn("Offline: AppBar using local settings");
        }
      }
    } catch (error) {
      console.error("Failed to load settings", error);
    }
  }, []);

  useEffect(() => {
    const loadUser = async () => {
      const parsedUser = safeParse<Record<string, any> | null>(localStorage.getItem("currentUser"), null);
      if (!parsedUser?.id) { setCurrentUser(null); return; }

      const cachedProfile = safeParse<any>(localStorage.getItem(`cachedProfile_${parsedUser.id}`), null);
      const cachedAvatar = localStorage.getItem(`cachedAvatar_${parsedUser.id}`);

      setCurrentUser({
        id: parsedUser.id,
        username: cachedProfile?.username || parsedUser.username,
        role: cachedProfile?.role || parsedUser.role,
        avatar_url: cachedAvatar || cachedProfile?.avatar_url || parsedUser.profilePic || parsedUser.avatar_url || null,
        tenant_id: parsedUser.tenantId,
      });

      try {
        const { data: profileData } = await supabase
          .from("profile_settings")
          .select("username, avatar_url, role")
          .eq("user_id", parsedUser.id)
          .maybeSingle();

        if (profileData) {
          const freshAvatar = profileData.avatar_url || parsedUser.profilePic || null;

          setCurrentUser({
            id: parsedUser.id,
            username: profileData.username || parsedUser.username,
            role: profileData.role || parsedUser.role,
            avatar_url: freshAvatar,
            tenant_id: parsedUser.tenantId,
          });

          localStorage.setItem(`cachedProfile_${parsedUser.id}`, JSON.stringify({
            id: parsedUser.id,
            username: profileData.username || parsedUser.username,
            role: profileData.role || parsedUser.role,
            avatar_url: freshAvatar,
          }));

          if (freshAvatar) {
            cacheAvatarImage(parsedUser.id, freshAvatar);
          } else {
            localStorage.removeItem(`cachedAvatar_${parsedUser.id}`);
            localStorage.removeItem(`cachedAvatarUrl_${parsedUser.id}`);
          }
        }
      } catch (err) {
        console.warn("Profile fetch error (Offline):", err);
      }
    };

    fetchSettings();
    loadUser();
  }, [fetchSettings]);

  useEffect(() => {
    const onSettingsChanged = () => { fetchSettings(); };
    window.addEventListener("settingsChanged", onSettingsChanged);
    return () => window.removeEventListener("settingsChanged", onSettingsChanged);
  }, [fetchSettings]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("activeTenantId");
    localStorage.removeItem("adminDeviceId");
    window.dispatchEvent(new Event("userChanged"));
    window.location.replace("/login");
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
  const hasLeftInfo = Boolean(businessName || (businessLogo && !logoError && !hideLogo) || hasContactInfo);
  const userInitials = initialsOf(currentUser?.username, "?");
  const userRole = currentUser?.role ? currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) : "";
  // Responsive tiers — the bar re-flows at each breakpoint so it never
  // overflows: full contact text → icons only → logo + name only.
  const showContactText = windowWidth > 1120;
  const showContactIcons = windowWidth > 720;
  const showUserText = windowWidth > 480;
  const logoSize = windowWidth <= 420 ? 36 : windowWidth <= 680 ? 42 : windowWidth <= 1100 ? 48 : LOGO.size;
  const monoSize = windowWidth <= 420 ? 32 : windowWidth <= 680 ? 38 : windowWidth <= 1100 ? 42 : LOGO.monoSize;
  const nameSize = windowWidth <= 680 ? 16 : 17;

  const toggleMenu = () => setMenuOpen((v) => !v);

  const renderAvatar = (size: number) =>
    currentUser?.avatar_url && !avatarError ? (
      <img
        src={currentUser.avatar_url}
        alt={currentUser.username || "Profile"}
        onError={() => setAvatarError(true)}
        referrerPolicy="no-referrer"
        decoding="async"
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: C.surfaceVariant, border: `1px solid ${C.outline}`, display: "block" }}
      />
    ) : (
      <div aria-hidden="true" style={{ width: size, height: size, borderRadius: "50%", background: C.primary, color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 500, fontSize: Math.round(size * 0.42), letterSpacing: "0.02em", flexShrink: 0 }}>
        {userInitials}
      </div>
    );

  // Flat logo on the bar surface: no plate, no border, no shadow — the image
  // blends into the white bar exactly like WhatsApp's header wordmark.
  const renderLogo = () => (
    <img
      src={businessLogo}
      alt={businessName ? `${businessName} logo` : "Business logo"}
      onError={() => setLogoError(true)}
      onLoad={(e) => {
        const img = e.currentTarget;
        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
          setLogoAspect(img.naturalWidth / img.naturalHeight);
        }
      }}
      referrerPolicy="no-referrer"
      decoding="async"
      draggable={false}
      style={{
        width: logoBadgeWidth(logoAspect, logoSize),
        height: logoSize,
        maxWidth: `min(${logoMaxWidth(windowWidth)}px, 100%)`,
        objectFit: "contain",
        objectPosition: "left center",
        background: "transparent",
        flexShrink: 0,
        display: "block",
        userSelect: "none",
        transition: "width 0.2s cubic-bezier(0.2, 0, 0, 1), height 0.2s cubic-bezier(0.2, 0, 0, 1)",
      }}
    />
  );

  const linkStyle: CSSProperties = {
    fontSize: 12, color: C.onSurfaceVariant, textDecoration: "none",
    display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap",
    flexShrink: 0, transition: "color 0.15s cubic-bezier(0.2, 0, 0, 1)",
    // Icons-only mode: real tap targets on touch screens
    padding: showContactText ? 0 : 6, borderRadius: 8,
  };

  return (
    <header role="banner" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: windowWidth <= 680 ? 10 : 16, padding: "8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px))", background: C.surface, borderBottom: `1px solid ${C.outline}`, boxShadow: "0 1px 2px rgba(60,64,67,0.06)", flexShrink: 0, zIndex: 1000, width: "100%", boxSizing: "border-box", position: "sticky", top: 0, overflow: "visible", fontFamily: font }}>
      <style>{`
                @keyframes appbarIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
                @keyframes menuIn { from { opacity: 0; transform: translateY(-6px) scale(0.98); } to { opacity: 1; transform: none; } }
                .appbar-press { transition: all 0.2s cubic-bezier(0.2, 0, 0, 1); }
                .appbar-press:active { transform: scale(0.96); }
            `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: windowWidth <= 680 ? 10 : 12, flex: 1, minWidth: 0 }}>
        {hasLeftInfo && (
          <>
            {businessLogo && !logoError && !hideLogo ? (
              renderLogo()
            ) : businessName && !hideLogo ? (
              // Flat fallback monogram — a plain brand-colored initial that
              // sits directly on the bar, matching the seamless logo look.
              <div aria-hidden="true" style={{ width: monoSize, height: monoSize, display: "flex", alignItems: "center", justifyContent: "center", color: C.primary, fontWeight: 500, fontSize: Math.round(monoSize * 0.46), letterSpacing: "0.02em", flexShrink: 0, userSelect: "none" }}>
                {businessName.charAt(0).toUpperCase()}
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flexShrink: 1 }}>
              {businessName && (
                <h1 title={businessName} style={{ margin: 0, fontSize: nameSize, fontWeight: 500, color: C.onSurface, letterSpacing: "-0.01em", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {businessName}
                </h1>
              )}
              {hasContactInfo && showContactIcons && (
                <div style={{ display: "flex", alignItems: "center", gap: "4px 14px", flexWrap: "wrap", marginTop: businessName ? 1 : 0 }}>
                  {businessPhone && (
                    <a href={`tel:${businessPhone}`} title={`Call ${businessPhone}`} aria-label={`Call ${businessPhone}`} style={linkStyle}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.primary)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.onSurfaceVariant)}>
                      <MaterialIcon d={P.call} size={14} />
                      {showContactText && <span>{businessPhone}</span>}
                    </a>
                  )}
                  {businessAddress && showContactText && (
                    <div title={businessAddress} style={{ fontSize: 12, color: C.onSurfaceVariant, display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 200 }}>
                      <MaterialIcon d={P.place} size={14} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessAddress}</span>
                    </div>
                  )}
                  {businessEmail && (
                    <a href={`mailto:${businessEmail}`} title={`Email ${businessEmail}`} aria-label={`Email ${businessEmail}`} style={{ ...linkStyle, overflow: "hidden", maxWidth: showContactText ? 150 : undefined }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.primary)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.onSurfaceVariant)}>
                      <MaterialIcon d={P.mail} size={14} />
                      {showContactText && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessEmail}</span>}
                    </a>
                  )}
                  {businessWebsite && (
                    <a href={businessWebsite.startsWith("http") ? businessWebsite : `https://${businessWebsite}`} target="_blank" rel="noreferrer" title={`Visit ${businessWebsite.replace(/^https?:\/\//, "")}`} aria-label="Visit website" style={{ ...linkStyle, overflow: "hidden", maxWidth: showContactText ? 150 : undefined }}
                      onMouseEnter={(e) => (e.currentTarget.style.color = C.primary)}
                      onMouseLeave={(e) => (e.currentTarget.style.color = C.onSurfaceVariant)}>
                      <MaterialIcon d={P.language} size={14} />
                      {showContactText && <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{businessWebsite.replace(/^https?:\/\//, "")}</span>}
                    </a>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {currentUser && !hideAccount && (
          <div ref={menuRef} style={{ position: "relative", flexShrink: 0, display: "flex", alignItems: "center" }}>
            {/* Single account pill — the round profile icon was removed from the
                bar; the avatar still appears inside the menu header below. */}
            <button
              type="button"
              onClick={toggleMenu}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Account menu"
              title={`${currentUser.username}${userRole ? ` · ${userRole}` : ""}`}
              className="appbar-press"
              style={{ display: "flex", alignItems: "center", gap: 8, height: 42, padding: showUserText ? "0 10px 0 14px" : "0 9px", borderRadius: 21, border: "none", background: "transparent", cursor: "pointer", flexShrink: 0, transition: motion, fontFamily: font }}
              onMouseEnter={(e) => (e.currentTarget.style.boxShadow = stateNeutral)}
              onMouseLeave={(e) => (e.currentTarget.style.boxShadow = "none")}
            >
              {showUserText && (
                <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", lineHeight: 1.25, minWidth: 0, maxWidth: 180 }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{currentUser.username}</span>
                  {userRole && <span style={{ fontSize: 12, color: C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{userRole}</span>}
                </span>
              )}
              <MaterialIcon d={P.moreVert} size={22} style={{ color: C.onSurfaceVariant }} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: "min(252px, calc(100vw - 24px))", background: C.surface, borderRadius: 14, boxShadow: "0 1px 3px rgba(60,64,67,0.16), 0 10px 28px rgba(60,64,67,0.24)", padding: "6px 0", zIndex: 2000, animation: "menuIn 0.15s cubic-bezier(0.2, 0, 0, 1) both", transformOrigin: "top right", fontFamily: font, overflow: "hidden" }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: `1px solid ${C.separatorLight}` }}>
                  {renderAvatar(40)}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{currentUser.username}</div>
                    {userRole && <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 1 }}>{userRole}</div>}
                  </div>
                </div>

                <button type="button" role="menuitem" onClick={handleSettingsClick}
                  style={{ width: "100%", height: 48, padding: "0 16px", border: "none", background: "transparent", color: C.onSurface, fontSize: 14, fontWeight: 500, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: font, boxSizing: "border-box", transition: "background 0.15s cubic-bezier(0.2, 0, 0, 1)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(60,64,67,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <MaterialIcon d={P.settings} size={20} style={{ color: C.onSurfaceVariant }} />
                  Settings
                </button>
                <button type="button" role="menuitem" onClick={handleLogout}
                  style={{ width: "100%", height: 48, padding: "0 16px", border: "none", borderTop: `1px solid ${C.separatorLight}`, background: "transparent", color: C.error, fontSize: 14, fontWeight: 500, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 14, fontFamily: font, boxSizing: "border-box", transition: "background 0.15s cubic-bezier(0.2, 0, 0, 1)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(217,48,37,0.08)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                  <MaterialIcon d={P.logout} size={20} style={{ color: C.error }} />
                  Logout
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
