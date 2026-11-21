import { useState, useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginUser, addUser } from "../database/userDB";
import { loginTenant } from "../api/authApi";
import {
  pullAllTenantData,
  enableSyncHooks,
  startPeriodicPull,
  stopPeriodicPull,
  pullSettings,
} from "../database/sync";
import { supabase } from "../auth/supabase";
import LoadingButton from "../components/LoadingButton";
import { getVersion } from "@tauri-apps/api/app";

const iosFont =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

type AppScreen = "main" | "login";

/* ── Nav routes — full page navigation to the blog (app is mounted at /app/) ── */
const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Blog", href: "/articles" },
  { label: "About", href: "/about" },
  { label: "E-Learning", href: "/app/" },
];

/* ── Startup media type detection (mirrors settings.tsx) ── */
type MediaType = "image" | "video" | "pdf";

function detectMediaType(url: string): MediaType | null {
  if (!url) return null;
  const clean = url.split("?")[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg)$/.test(clean)) return "image";
  if (/\.(mp4|webm|mov|m4v|ogg)$/.test(clean)) return "video";
  if (/\.pdf$/.test(clean)) return "pdf";
  return null;
}

/* ── Full-bleed media background: image / video / pdf, edge to edge ── */
function MediaBackground({
  url,
  type,
}: {
  url: string;
  type: MediaType | null;
}) {
  if (!url) return null;
  const t = type || detectMediaType(url);

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        overflow: "hidden",
        zIndex: 0,
      }}
    >
      {t === "video" ? (
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        >
          <source src={url} />
        </video>
      ) : t === "pdf" ? (
        <iframe
          src={url}
          title="Startup media"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: "none",
          }}
        />
      ) : (
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: `url(${url})`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}

      {/* Scrim for card readability (light for PDF, dark for image/video) */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background:
            t === "pdf" ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.38)",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

/* ── Fixed bottom footer: tagline with app logo beneath it ── */
function PoweredByBar() {
  return (
    <div
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        padding: "10px 0 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        background: "rgba(255,255,255,0.9)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderTop: "1px solid rgba(0,0,0,0.06)",
        zIndex: 200,
        fontFamily: iosFont,
      }}
    >
      <span
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "#6b7280",
          letterSpacing: "0.2px",
        }}
      >
        Powered by Smartpage © 2026
      </span>
      <img
        src="/applogo.png"
        alt="Smartpage"
        style={{
          width: 30,
          height: 30,
          objectFit: "contain",
          borderRadius: 6,
          opacity: 0.9,
        }}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    </div>
  );
}

/* ── Medstat-style app bar + shell — branding comes only from Supabase ── */
function StartupShell({
  children,
  brandName,
  tagline,
  logo,
  version,
  showSubscribe,
}: {
  children: React.ReactNode;
  brandName?: string;
  tagline?: string;
  logo?: string;
  version?: string;
  showSubscribe?: boolean;
}) {
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "#FFFFFF",
        fontFamily: iosFont,
      }}
    >
      <style>{`
        .msb-bar {
          position: sticky;
          top: 0;
          z-index: 1000;
          width: 100%;
          flex-shrink: 0;
          background: #ffffff;
          border-bottom: 1px solid #e5e7eb;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .msb-inner {
          max-width: 1280px;
          margin: 0 auto;
          padding: 0 32px;
          height: 72px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }
        .msb-brand {
          display: flex;
          align-items: center;
          gap: 12px;
          text-decoration: none;
          min-width: 0;
        }
        .msb-logo {
          width: 44px;
          height: 44px;
          object-fit: contain;
          flex-shrink: 0;
        }
        .msb-logo-fallback {
          width: 44px;
          height: 44px;
          border-radius: 10px;
          background: #1e3a8a;
          color: #ffffff;
          font-family: Georgia, "Times New Roman", serif;
          font-size: 20px;
          font-weight: 700;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }
        .msb-brand-text {
          display: flex;
          flex-direction: column;
          line-height: 1.25;
          min-width: 0;
        }
        .msb-name {
          font-family: Georgia, "Times New Roman", serif;
          font-size: 20px;
          font-weight: 700;
          color: #111827;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .msb-tagline {
          font-size: 12px;
          color: #6b7280;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .msb-right {
          display: flex;
          align-items: center;
          gap: 28px;
          flex-shrink: 0;
        }
        .msb-links {
          display: flex;
          align-items: center;
          gap: 28px;
        }
        .msb-link {
          position: relative;
          font-size: 15px;
          color: #374151;
          text-decoration: none;
          padding: 6px 2px;
          transition: color 0.15s ease;
        }
        .msb-link:hover {
          color: #1d4ed8;
        }
        .msb-link.active {
          color: #1d4ed8;
          font-weight: 500;
        }
        .msb-link.active::after {
          content: "";
          position: absolute;
          left: 0;
          right: 0;
          bottom: -2px;
          height: 2px;
          border-radius: 2px;
          background: #1d4ed8;
        }
        .msb-version {
          font-size: 12px;
          color: #9ca3af;
        }
        .msb-cta {
          display: inline-flex;
          align-items: center;
          height: 44px;
          padding: 0 26px;
          border: none;
          border-radius: 8px;
          background: #1e3a8a;
          color: #ffffff;
          font-size: 15px;
          font-weight: 700;
          text-decoration: none;
          cursor: pointer;
          transition: background 0.15s ease;
        }
        .msb-cta:hover {
          background: #1e40af;
        }
        @media (max-width: 900px) {
          .msb-links {
            display: none;
          }
        }
      `}</style>

      <header className="msb-bar">
        <div className="msb-inner">
          <a href="/" className="msb-brand">
            {logo ? (
              <img
                src={logo}
                alt={brandName || ""}
                className="msb-logo"
                onError={(e) => {
                  e.currentTarget.style.display = "none";
                }}
              />
            ) : brandName ? (
              <div className="msb-logo-fallback">
                {brandName.charAt(0).toUpperCase()}
              </div>
            ) : null}

            {(brandName || tagline) && (
              <span className="msb-brand-text">
                {brandName && (
                  <span className="msb-name">{brandName}</span>
                )}
                {tagline && (
                  <span className="msb-tagline">{tagline}</span>
                )}
              </span>
            )}
          </a>

          <div className="msb-right">
            <nav className="msb-links">
              {NAV_LINKS.map((l) => {
                /* The app itself IS e-learning — always active here */
                const isActive = l.label === "E-Learning";

                return (
                  <a
                    key={l.label}
                    href={l.href}
                    className={"msb-link" + (isActive ? " active" : "")}
                  >
                    {l.label}
                  </a>
                );
              })}
            </nav>

            {version && (
              <span className="msb-version">v{version}</span>
            )}

            {showSubscribe && (
              <a href="/subscribe" className="msb-cta">
                Subscribe
              </a>
            )}
          </div>
        </div>
      </header>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          position: "relative",
          overflowY: "auto",
        }}
      >
        {children}
      </div>
    </div>
  );
}

const AuthLayout = ({
  children,
  background,
  showBack,
  onBack,
  watermark,
  transparent = false,
}: {
  children: React.ReactNode;
  background?: string;
  showBack?: boolean;
  onBack?: () => void;
  watermark?: boolean;
  transparent?: boolean;
}) => (
  <div
    style={{
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundImage: watermark
        ? "none"
        : transparent
        ? "none"
        : background
        ? `url(${background})`
        : "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
      backgroundSize: watermark ? "auto" : "cover",
      backgroundPosition: "center",
      backgroundColor: watermark
        ? "#FFFFFF"
        : transparent
        ? "transparent"
        : "#F2F2F7",
      fontFamily: iosFont,
      overflow: "hidden",
      position: "relative",
      padding: transparent ? 0 : 24,
      boxSizing: "border-box",
    }}
  >
    <style>{`
      @keyframes fadeUp {
        from {
          opacity: 0;
          transform: translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }

      @keyframes scrollBg {
        0% {
          background-position: 0px 0px;
        }
        100% {
          background-position: 120px 120px;
        }
      }
    `}</style>

    {watermark && (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: "url(/loadlogo.png)",
          backgroundRepeat: "repeat",
          backgroundSize: "120px 120px",
          opacity: 0.08,
          animation: "scrollBg 30s linear infinite",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    )}

    {!watermark && !transparent && background && (
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: "rgba(0,0,0,0.4)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
    )}

    {showBack && onBack && (
      <button
        onClick={onBack}
        style={{
          position: "absolute",
          top: 24,
          left: 24,
          width: 44,
          height: 44,
          borderRadius: "50%",
          background: "rgba(255,255,255,0.2)",
          backdropFilter: "blur(10px)",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          zIndex: 10,
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>
    )}

    <div
      style={{
        position: "relative",
        zIndex: 1,
        width: "100%",
        maxWidth: 400,
        background: "#FFFFFF",
        borderRadius: 28,
        padding: "40px 32px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.10)",
        border: "1px solid rgba(0,0,0,0.05)",
        animation: "fadeUp 0.6s ease-out",
        boxSizing: "border-box",
      }}
    >
      {children}
    </div>
  </div>
);

export default function Startup() {
  const location = useLocation();

  const [redirectRoute, setRedirectRoute] =
    useState<string | null>(null);

  const [screen, setScreen] =
    useState<AppScreen>("main");

  /* ── All empty until fetched from Supabase ── */
  const [siteLogo, setSiteLogo] = useState("");
  const [siteName, setSiteName] = useState("");
  const [siteTagline, setSiteTagline] = useState("");

  /* ── Startup page media (image / video / pdf) ── */
  const [startupMediaUrl, setStartupMediaUrl] = useState("");
  const [startupMediaType, setStartupMediaType] = useState("");

  const [branding, setBranding] = useState<{
    businessName: string;
    logo: string;
    phone: string;
    loginBackground: string;
  } | null>(null);

  const [appVersion, setAppVersion] = useState("");

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const [businessName, setBusinessName] = useState("");
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [lookupLoading, setLookupLoading] = useState(false);

  const [requiresUnlock, setRequiresUnlock] = useState(false);

  /* ── Fetch from Supabase only: site_settings first, supadmin_settings fallback ── */
  async function fetchSiteSettings() {
    let logo: string | null = null;
    let name: string | null = null;
    let tag: string | null = null;
    let mediaUrl: string | null = null;
    let mediaType: string | null = null;

    // Try site_settings
    try {
      const r1 = await supabase
        .from("site_settings")
        .select("*")
        .eq("id", "main")
        .maybeSingle();

      if (!r1.error && r1.data) {
        const d: any = r1.data;
        logo = d.logo_url || null;
        name = d.site_name || null;
        tag = d.tagline || null;
        mediaUrl = d.startup_media_url || null;
        mediaType = d.startup_media_type || null;
      }
    } catch {
      // Skipped.
    }

    // Try supadmin_settings — fills in anything site_settings didn't provide
    try {
      const r2 = await supabase
        .from("supadmin_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!r2.error && r2.data) {
        const d2: any = r2.data;
        if (!logo && d2.logo_url) logo = d2.logo_url;
        if (!name && d2.business_name) name = d2.business_name;
        if (!tag && d2.tagline) tag = d2.tagline;
        if (!mediaUrl && d2.startup_media_url) {
          mediaUrl = d2.startup_media_url;
          mediaType = d2.startup_media_type || mediaType;
        }
      }
    } catch {
      // Skipped.
    }

    // Apply only what Supabase returned
    if (logo) setSiteLogo(logo);
    if (name) setSiteName(name);
    if (tag) setSiteTagline(tag);
    if (mediaUrl) {
      setStartupMediaUrl(mediaUrl);
      setStartupMediaType(mediaType || "");
    }
  }

  useEffect(() => {
    getVersion()
      .then((v) => setAppVersion(v))
      .catch(() => {});

    fetchSiteSettings();

    const storedUser =
      localStorage.getItem("currentUser");

    if (storedUser && location.pathname === "/") {
      try {
        const userObj = JSON.parse(storedUser);

        if (userObj?.id) {
          setRequiresUnlock(true);
          setUsername(userObj.username || "");
          setTenantId(userObj.tenantId || null);

          const savedBranding =
            localStorage.getItem(
              "institutionBranding"
            );

          if (savedBranding) {
            setBranding(JSON.parse(savedBranding));
          }

          if (userObj.tenantId) {
            try {
              supabase
                .from("business_settings")
                .select(
                  "business_name, logo, phone, login_background"
                )
                .eq("tenant_id", userObj.tenantId)
                .maybeSingle()
                .then(({ data }) => {
                  if (data) {
                    const b = {
                      businessName:
                        data.business_name || "",
                      logo: data.logo || "",
                      phone: data.phone || "",
                      loginBackground:
                        data.login_background || "",
                    };

                    setBranding(b);

                    localStorage.setItem(
                      "institutionBranding",
                      JSON.stringify(b)
                    );
                  }
                });
            } catch {
              // Offline — cached branding shown.
            }
          }
        }
      } catch {
        localStorage.removeItem("currentUser");
      }
    }

    return () => {
      stopPeriodicPull();
    };
  }, [location.pathname]);

  async function handleTrainerLookup() {
    setLookupError("");

    if (!businessName.trim()) {
      return setLookupError(
        "Institution name is required"
      );
    }

    setLookupLoading(true);

    const enteredName = businessName.trim();

    const savedInstName =
      localStorage.getItem("institutionName");

    const savedInstId =
      localStorage.getItem("institutionTenantId");

    const savedBranding =
      localStorage.getItem("institutionBranding");

    if (
      savedInstName &&
      savedInstId &&
      savedInstName === enteredName
    ) {
      setTenantId(savedInstId);

      if (savedBranding) {
        setBranding(JSON.parse(savedBranding));
      }

      setScreen("login");
      setLookupLoading(false);

      (async () => {
        try {
          const { data: settings } =
            await supabase
              .from("business_settings")
              .select("*")
              .eq("tenant_id", savedInstId)
              .maybeSingle();

          if (settings) {
            const b = {
              businessName:
                settings.business_name || "",
              logo: settings.logo || "",
              phone: settings.phone || "",
              loginBackground:
                settings.login_background || "",
            };

            setBranding(b);

            localStorage.setItem(
              "institutionBranding",
              JSON.stringify(b)
            );
          }
        } catch {
          // Background branding sync failed.
        }
      })();

      return;
    }

    try {
      const { data: tenants, error } =
        await supabase
          .from("tenants")
          .select("id, business_name")
          .eq("business_name", enteredName);

      if (error) throw error;

      if (!tenants || tenants.length === 0) {
        setLookupError(
          "Institution not found. Check the name or your connection."
        );
        setLookupLoading(false);
        return;
      }

      if (tenants.length > 1) {
        setLookupError(
          "Multiple institutions share this name. Please contact support."
        );
        setLookupLoading(false);
        return;
      }

      const tenant = tenants[0];

      localStorage.setItem(
        "institutionName",
        tenant.business_name || enteredName
      );

      localStorage.setItem(
        "institutionTenantId",
        tenant.id
      );

      try {
        const { data: settings } =
          await supabase
            .from("business_settings")
            .select("*")
            .eq("tenant_id", tenant.id)
            .maybeSingle();

        if (settings) {
          const b = {
            businessName:
              settings.business_name || "",
            logo: settings.logo || "",
            phone: settings.phone || "",
            loginBackground:
              settings.login_background || "",
          };

          setBranding(b);

          localStorage.setItem(
            "institutionBranding",
            JSON.stringify(b)
          );
        }
      } catch {
        // Branding fetch failed.
      }

      setTenantId(tenant.id);
      setScreen("login");
      setLookupLoading(false);
    } catch {
      setLookupError(
        "Institution not found. Check the name or your connection."
      );
      setLookupLoading(false);
    }
  }

  async function handleLogin() {
    setMessage("");

    if (!username.trim() || !password.trim()) {
      return setMessage(
        "Username and password are required"
      );
    }

    if (!tenantId) {
      return setMessage(
        "Session error. Please re-select your institution."
      );
    }

    setLoading(true);

    try {
      try {
        const result = await loginTenant({
          tenantId,
          username,
          password,
        });

        if (
          typeof result.user.username !== "string" ||
          result.user.username !== username.trim()
        ) {
          throw new Error(
            "Invalid username or password"
          );
        }

        const safeUser = {
          id: result.user.id,
          username: result.user.username,
          email: result.user.email || "",
          phone: result.user.phone || "",
          profilePic:
            (result.user as any).profile_pic || "",
          role: result.user.role,
          tenantId: result.user.tenantId,
          assignedCourses:
            result.user.assigned_courses || [],
          createdAt:
            (result.user as any).created_at ||
            new Date().toISOString(),
          password,
          synced: true,
        };

        await addUser(safeUser);

        localStorage.setItem(
          "currentUser",
          JSON.stringify(safeUser)
        );

        localStorage.setItem(
          "authToken",
          result.authToken
        );

        window.dispatchEvent(
          new Event("authStateChanged")
        );

        enableSyncHooks();
        startPeriodicPull(60000);

        if (safeUser.tenantId) {
          pullAllTenantData(
            safeUser.tenantId
          ).catch(() => {});

          pullSettings().catch(() => {});
        }

        redirectUser(safeUser.role);
        return;
      } catch (backendError: any) {
        if (backendError?.noOfflineFallback) {
          throw backendError;
        }

        if (import.meta.env.DEV) {
          console.warn(
            "Backend login failed, trying offline DB.",
            backendError
          );
        }
      }

      const user = await loginUser(
        username.trim(),
        password,
        tenantId
      );

      if (
        !user ||
        typeof user.username !== "string" ||
        user.username !== username.trim()
      ) {
        throw new Error(
          "Invalid username or password."
        );
      }

      const safeUser = {
        id: user.id,
        username: user.username,
        email: user.email || "",
        phone: user.phone || "",
        profilePic: user.profilePic || "",
        role: user.role,
        tenantId: user.tenantId,
        assignedCourses: user.assignedCourses || [],
        createdAt: user.createdAt,
        synced: false,
      };

      localStorage.setItem(
        "currentUser",
        JSON.stringify(safeUser)
      );

      localStorage.setItem(
        "authToken",
        "offline-mode-pending-sync"
      );

      window.dispatchEvent(
        new Event("authStateChanged")
      );

      redirectUser(safeUser.role);
    } catch {
      setMessage("Invalid username or password.");
    } finally {
      setLoading(false);
    }
  }

  function redirectUser(role: string) {
    if (role === "admin") {
      setRedirectRoute("/admin");
    } else if (role === "trainer") {
      setRedirectRoute("/trainer");
    } else {
      setRedirectRoute("/user");
    }
  }

  if (redirectRoute) {
    return <Navigate to={redirectRoute} replace />;
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    height: 54,
    padding: "0 16px",
    border: "none",
    outline: "none",
    background: "rgba(0,0,0,0.03)",
    fontSize: 17,
    color: "#1C1C1E",
    boxSizing: "border-box",
    borderRadius: 14,
    marginBottom: 12,
    transition: "background 0.2s",
  };

  if (requiresUnlock) {
    return (
      <StartupShell
        brandName={siteName || undefined}
        tagline={siteTagline || undefined}
        logo={siteLogo || undefined}
        version={appVersion}
      >
        <AuthLayout
          background={branding?.loginBackground}
          showBack
          onBack={() => {
            stopPeriodicPull();
            localStorage.removeItem("currentUser");
            localStorage.removeItem("authToken");
            setRequiresUnlock(false);
            setPassword("");
            setUsername("");
          }}
        >
          <h2
            style={{
              textAlign: "center",
              fontSize: 24,
              color: "#1C1C1E",
              fontWeight: 700,
              marginBottom: 8,
            }}
          >
            Welcome back
          </h2>

          <p
            style={{
              textAlign: "center",
              fontSize: 15,
              color: "#8E8E93",
              marginBottom: 24,
            }}
          >
            Enter your password to continue.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            style={{ width: "100%" }}
          >
            <input
              type="password"
              placeholder="Enter Password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setMessage("");
              }}
              style={inputStyle}
              autoFocus
              autoComplete="current-password"
            />

            {message && (
              <p
                style={{
                  textAlign: "center",
                  color: "#FF3B30",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                {message}
              </p>
            )}

            <LoadingButton
              type="submit"
              loading={loading}
              loadingLabel="Signing in…"
              disabled={!password}
              style={{
                height: 54,
                padding: 0,
              }}
            >
              Unlock
            </LoadingButton>
          </form>
        </AuthLayout>
      </StartupShell>
    );
  }

  if (screen === "login") {
    return (
      <StartupShell
        brandName={siteName || undefined}
        tagline={siteTagline || undefined}
        logo={siteLogo || undefined}
        version={appVersion}
      >
        <AuthLayout
          background={branding?.loginBackground}
          showBack
          onBack={() => {
            stopPeriodicPull();
            setScreen("main");
            setTenantId(null);
            setMessage("");
          }}
        >
          <h1
            style={{
              textAlign: "center",
              fontSize: 24,
              color: "#1C1C1E",
              fontWeight: 700,
              marginBottom: 24,
            }}
          >
            Welcome Back
          </h1>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleLogin();
            }}
            style={{ width: "100%" }}
          >
            <input
              name="username"
              placeholder="Username"
              value={username}
              onChange={(e) =>
                setUsername(e.target.value)
              }
              style={inputStyle}
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />

            <input
              type="password"
              name="password"
              placeholder="Password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              style={inputStyle}
              autoComplete="current-password"
            />

            {message && (
              <p
                style={{
                  textAlign: "center",
                  color: "#FF3B30",
                  fontSize: 14,
                  marginBottom: 12,
                }}
              >
                {message}
              </p>
            )}

            <LoadingButton
              type="submit"
              loading={loading}
              loadingLabel="Signing in…"
              style={{
                height: 54,
                padding: 0,
              }}
            >
              Login
            </LoadingButton>
          </form>
        </AuthLayout>
      </StartupShell>
    );
  }

  return (
    <StartupShell
      brandName={siteName || undefined}
      tagline={siteTagline || undefined}
      logo={siteLogo || undefined}
      version={appVersion}
      showSubscribe
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          background:
            "linear-gradient(135deg, #F2F2F7 0%, #E5E5EA 100%)",
        }}
      >
        {/* Full-width media background (image / video / pdf) */}
        <MediaBackground
          url={startupMediaUrl}
          type={(startupMediaType || null) as MediaType | null}
        />

        {/* Card layer — no logo in the page body */}
        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            height: "100%",
            paddingBottom: 96,
            boxSizing: "border-box",
          }}
        >
          <AuthLayout transparent>
            <h1
              style={{
                textAlign: "center",
                fontSize: 24,
                color: "#1C1C1E",
                fontWeight: 700,
                marginBottom: 8,
              }}
            >
              Welcome
            </h1>

            <p
              style={{
                textAlign: "center",
                fontSize: 15,
                color: "#8E8E93",
                marginBottom: 24,
              }}
            >
              Enter your institution to continue
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleTrainerLookup();
              }}
              style={{ width: "100%" }}
            >
              <input
                type="text"
                placeholder="Enter Institution Name"
                value={businessName}
                onChange={(e) => {
                  setBusinessName(e.target.value);
                  setLookupError("");
                }}
                style={inputStyle}
                autoFocus
                autoComplete="organization"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />

              {lookupError && (
                <p
                  style={{
                    textAlign: "center",
                    color: "#FF3B30",
                    fontSize: 14,
                    marginBottom: 12,
                  }}
                >
                  {lookupError}
                </p>
              )}

              <LoadingButton
                type="submit"
                loading={lookupLoading}
                loadingLabel="Finding…"
                disabled={!businessName.trim()}
                style={{
                  height: 54,
                  padding: 0,
                }}
              >
                Continue
              </LoadingButton>
            </form>
          </AuthLayout>
        </div>

        {/* Bottom footer: tagline + app logo */}
        <PoweredByBar />
      </div>
    </StartupShell>
  );
}