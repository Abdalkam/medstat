import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { loginTenant } from "../api/authApi";
import * as supabaseModule from "../auth/supabase";

/* ================= VERSION-PROOF AUTH BINDING =================
   Compiles against BOTH supabase.ts versions:
   - current:  tryReauthenticate()              (no parameters)
   - upgraded: tryReauthenticate(force = false) + getReauthReason()
   On the upgraded version `true` really skips the 30 s cooldown;
   on the current version the argument is safely ignored. */
const tryReauthenticate = supabaseModule.tryReauthenticate as unknown as (
  force?: boolean
) => Promise<string | null>;

/* ================= LOGO SOURCE NORMALIZER (self-contained) =================
   Works with ANY version of authApi.ts — no import needed for this part. */
function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    // Strip whitespace/line-wraps inside the base64 payload (DB dumps wrap it
    // across lines, which silently kills CSS/HTML images)
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

/** Safe for embedding inside a CSS url("...") — strips line breaks and quotes. */
function cssUrl(src: string): string {
  return src.replace(/[\r\n]+/g, "").replace(/"/g, "%22");
}

/* ================= MD3 COLOR TOKENS ================= */
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
  error: "#D93025",
  errorBg: "#FCE8E6",
  errorBorder: "#F6CFCB",
  errorText: "#C5221F",
};

const font =
  "'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* ================= SMALL HELPERS ================= */
function safeParse<T>(json: string | null, fallback: T): T {
  try {
    return json ? (JSON.parse(json) as T) : fallback;
  } catch {
    return fallback;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "0722 123 456" / "+254-722-123-456" → phone-like; else business name. */
function asPhone(identifier: string): string | null {
  const compact = identifier.replace(/[\s\-().]/g, "");
  return /^\+?\d{7,15}$/.test(compact) ? compact : null;
}

const P = {
  eye: "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff:
    "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78l3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
  check: "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z",
  phone:
    "M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z",
  email:
    "M20 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z",
  place:
    "M12 2C8.13 2 5 5.13 5 8.95c0 5.25 7 13.05 7 13.05s7-7.8 7-13.05C19 5.13 15.87 2 12 2zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z",
  briefcase:
    "M20 6h-4V4c0-1.11-.89-2-2-2h-4c-1.11 0-2 .89-2 2v2H4c-1.11 0-1.99.89-1.99 2L2 19c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V8c0-1.11-.89-2-2-2zm-6 0h-4V4h4v2z",
};

/* ================= BRANDING (business_settings) ================= */
interface Branding {
  tenantId?: string;
  businessName: string;
  phone: string;
  email: string;
  address: string;
  website: string;
  logo: string;            // normalized, kept in the cache for other screens
  loginBackground: string; // ready-to-render source (normalized)
}

function mapBrandingRow(row: Record<string, any>): Branding {
  return {
    tenantId: row.tenant_id || undefined,
    businessName: row.business_name || "",
    phone: row.phone || "",
    email: row.email || "",
    address: row.address || "",
    website: row.website || "",
    logo: normalizeImageSrc(row.logo),
    loginBackground: normalizeImageSrc(row.login_background),
  };
}

/** Best-known branding from EITHER cache:
 *  • institutionBranding — written by the Startup lookup flow + Settings (most
 *    reliable source before login, survives offline)
 *  • localBusinessSettings — written by the admin Settings page (richer)
 *  Fields are merged per-key (first non-empty wins) and normalized. */
function readCachedBranding(): Branding | null {
  const inst = safeParse<Partial<Branding> | null>(localStorage.getItem("institutionBranding"), null);
  const local = safeParse<Partial<Branding> | null>(localStorage.getItem("localBusinessSettings"), null);
  const pick = (...vals: Array<string | undefined>) =>
    vals.find((v) => typeof v === "string" && v.trim() !== "") || "";
  const merged: Branding = {
    tenantId: local?.tenantId || inst?.tenantId || undefined,
    businessName: pick(local?.businessName, inst?.businessName),
    phone: pick(local?.phone, inst?.phone),
    email: pick(local?.email, inst?.email),
    address: pick(local?.address, inst?.address),
    website: pick(local?.website, inst?.website),
    logo: normalizeImageSrc(pick(local?.logo, inst?.logo)),
    loginBackground: normalizeImageSrc(pick(local?.loginBackground, inst?.loginBackground)),
  };
  return merged.businessName || merged.logo || merged.phone || merged.loginBackground ? merged : null;
}

/* ================= LOGO TILE (seamless) =================
   • object-fit: contain — never stretched, never cropped
   • Rendered FLAT: no plate, no border, no shadow — the artwork is
     continuous with the app bar background (WhatsApp-style)
   • graceful monogram / icon fallback if the source fails to load */
function SafeLogo({
  src,
  name,
  size = 44,
  radius = 12,
}: {
  src: string;
  name?: string;
  size?: number;
  radius?: number;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  const showImg = !!src && !failed;
  return (
    <div
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: radius,
        background: "transparent",
        border: "none",
        boxShadow: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {showImg ? (
        <img
          src={src}
          alt={name ? `${name} logo` : "Business logo"}
          onError={() => setFailed(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            objectPosition: "center",
            display: "block",
          }}
        />
      ) : name ? (
        <span
          aria-hidden="true"
          style={{
            fontSize: Math.round(size * 0.42),
            fontWeight: 500,
            color: C.primary,
            fontFamily: font,
            lineHeight: 1,
          }}
        >
          {name.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <svg
          aria-hidden="true"
          width={Math.round(size * 0.5)}
          height={Math.round(size * 0.5)}
          viewBox="0 0 24 24"
          fill={C.primary}
        >
          <path d={P.briefcase} />
        </svg>
      )}
    </div>
  );
}

/* ================= COLOUR-CYCLING PROGRESS BAR =================
   Indeterminate bar that slides while its rainbow gradient FLOWS through it
   (background-position animation — reliable in every webview, unlike
   filter: hue-rotate which some Tauri webviews never animate). */
function TopLoader({ show, flush = false }: { show: boolean; flush?: boolean }) {
  if (!show) return null;
  const trackStyle: CSSProperties = flush
    ? {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 4,
        overflow: "hidden",
        pointerEvents: "none",
      }
    : {
        width: "100%",
        height: 6,
        borderRadius: 999,
        overflow: "hidden",
        position: "relative",
        background: "rgba(26,115,232,0.12)",
        marginBottom: 14,
      };
  return (
    <div aria-hidden="true" style={trackStyle}>
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "40%",
          borderRadius: 999,
          backgroundImage:
            "linear-gradient(90deg, #1A73E8 0%, #9334E6 25%, #E8710A 50%, #00897B 75%, #1A73E8 100%)",
          backgroundSize: "300% 100%",
          animation:
            "md3Slide 1.3s cubic-bezier(0.45, 0.05, 0.55, 0.95) infinite, md3Flow 2.4s linear infinite",
        }}
      />
    </div>
  );
}

/* ================= LOGIN APP BAR =================
   Balanced MD3 top bar — LEFT: logo tile + business name + phone;
   RIGHT: email + address stack.
   No avatar, no account icon, no menu — this is the login screen.
   The right stack hides on very narrow screens (stylesheet class
   .appbar-contact). */
function LoginAppBar({
  logo,
  businessName,
  phone,
  email,
  address,
}: {
  logo: string;
  businessName: string;
  phone: string;
  email: string;
  address: string;
}) {
  const contactRow = (icon: string, text: string, key: string) =>
    text ? (
      <div
        key={key}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
          minWidth: 0,
          maxWidth: "100%",
        }}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill={C.onSurfaceVariant}
          style={{ flexShrink: 0 }}
        >
          <path d={icon} />
        </svg>
        <span
          style={{
            fontSize: 12,
            lineHeight: 1.2,
            color: C.onSurfaceVariant,
            letterSpacing: "0.01em",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            textAlign: "right",
          }}
        >
          {text}
        </span>
      </div>
    ) : null;

  return (
    <header
      style={{
        position: "relative",
        zIndex: 2,
        background: C.surface,
        borderBottom: `1px solid ${C.outline}`,
        boxShadow: "0 1px 2px rgba(60,64,67,0.12), 0 2px 6px 2px rgba(60,64,67,0.06)",
      }}
    >
      <div
        style={{
          width: "100%",
          minHeight: 64,
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "8px 8px",
          boxSizing: "border-box",
        }}
      >
        {/* LEFT — identity: logo tile + business name + phone */}
        <SafeLogo src={logo} name={businessName || undefined} size={48} />
        <div style={{ flex: "1 1 0", minWidth: 0 }}>
          <div
            style={{
              fontSize: "clamp(16px, 4.2vw, 19px)",
              fontWeight: 500,
              color: C.onSurface,
              lineHeight: 1.25,
              letterSpacing: "-0.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              textAlign: "left",
            }}
          >
            {businessName || "Welcome"}
          </div>
          {phone && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                marginTop: 2,
                minWidth: 0,
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill={C.onSurfaceVariant}
                style={{ flexShrink: 0 }}
              >
                <path d={P.phone} />
              </svg>
              <span
                style={{
                  fontSize: 12,
                  lineHeight: 1.2,
                  color: C.onSurfaceVariant,
                  letterSpacing: "0.01em",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textAlign: "left",
                }}
              >
                {phone}
              </span>
            </div>
          )}
        </div>

        {/* RIGHT — email + address stack (visibility handled by the stylesheet) */}
        {(email || address) && (
          <div className="appbar-contact">
            {contactRow(P.email, email, "bar-email")}
            {contactRow(P.place, address, "bar-address")}
          </div>
        )}
      </div>
    </header>
  );
}

export default function Login() {
  const navigate = useNavigate();

  /* ---------- form state ---------- */
  const [business, setBusiness] = useState(
    () => localStorage.getItem("rememberedBusiness") || ""
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberBusiness, setRememberBusiness] = useState(
    () => !!localStorage.getItem("rememberedBusiness")
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusedField, setFocusedField] = useState<"" | "business" | "username" | "password">("");

  // Offline fallback login: set when loginTenant() could not reach the
  // backend and returned a placeholder session instead of a real JWT.
  const [offlineResult, setOfflineResult] = useState<{ authToken: string } | null>(null);
  const [checkingOnline, setCheckingOnline] = useState(false);

  /* ---------- branding state ----------
     Seeded synchronously from EITHER branding cache (institutionBranding /
     localBusinessSettings) so the app bar already carries the logo, business
     name and phone on the VERY FIRST paint — no flash, works offline.
     The effect below then refreshes it live from Supabase. */
  const [settings, setSettings] = useState<Branding | null>(() => readCachedBranding());

  // Optional deep-link: /login?tenant=<tenantId> pins the business instantly
  const [urlTenantId] = useState(
    () => new URLSearchParams(window.location.search).get("tenant") || ""
  );

  // App-bar name: branding first, then whatever business identifier the user
  // typed or remembered — so the bar shows meaningful content immediately,
  // even before (or without) a network fetch.
  const businessName = settings?.businessName || business.trim() || "";

  /* ---------- branding loaders ---------- */
  const applyBrandingRow = useCallback((row: Record<string, any>) => {
    const fresh = mapBrandingRow(row);
    setSettings((prev) => {
      // Field-wise merge: a non-empty DB value wins, but an EMPTY field never
      // wipes a good cached value — e.g. Settings.tsx saved offline or its
      // Supabase write failed, so the DB still has the old/empty background.
      const merged: Branding = {
        tenantId: fresh.tenantId || prev?.tenantId || undefined,
        businessName: fresh.businessName || prev?.businessName || "",
        phone: fresh.phone || prev?.phone || "",
        email: fresh.email || prev?.email || "",
        address: fresh.address || prev?.address || "",
        website: fresh.website || prev?.website || "",
        logo: fresh.logo || prev?.logo || "",
        loginBackground: fresh.loginBackground || prev?.loginBackground || "",
      };
      try {
        // Mirror Settings.tsx: write BOTH caches so Startup's login screen
        // picks up the same background on its next mount.
        localStorage.setItem("localBusinessSettings", JSON.stringify(merged));
        localStorage.setItem(
          "institutionBranding",
          JSON.stringify({
            businessName: merged.businessName,
            logo: merged.logo,
            phone: merged.phone,
            email: merged.email,
            address: merged.address,
            loginBackground: merged.loginBackground,
          })
        );
      } catch { /* quota exceeded — branding stays in memory only */ }
      return merged;
    });
    // Screens listening for "settingsChanged" refresh live, no reload needed.
    window.dispatchEvent(new Event("settingsChanged"));
  }, []);

  /** business identifier → tenant id (UUID | phone | business name), mirroring
   *  the exact lookup order loginTenant() uses internally. */
  const resolveTenantId = useCallback(async (identifier: string): Promise<string> => {
    const b = identifier.trim();
    if (!b) return "";
    if (UUID_RE.test(b)) return b;
    const phone = asPhone(b);
    if (phone) {
      const { data } = await supabase.from("tenants").select("id").eq("phone", phone).maybeSingle();
      if (data?.id) return data.id as string;
    }
    const { data: byName } = await supabase
      .from("tenants")
      .select("id")
      .ilike("business_name", `%${b}%`)
      .maybeSingle();
    return (byName?.id as string) || "";
  }, []);

  /** Fetch business_settings for the best-known tenant and paint the branding.
   *  Falls back to direct phone/name lookups on business_settings when the
   *  tenant can't be resolved (e.g. RLS blocks guest reads on `tenants`). */
  const prefetchBranding = useCallback(async () => {
    try {
      const cached = readCachedBranding();
      let tenantId = urlTenantId || cached?.tenantId || "";
      if (!tenantId) tenantId = await resolveTenantId(business);
      if (tenantId) {
        const { data: row } = await supabase
          .from("business_settings")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (row) {
          applyBrandingRow(row);
          return;
        }
      }
      // Fallbacks: some setups disallow anonymous reads on `tenants` but
      // allow business_settings — try phone, then business name, directly.
      const b = business.trim();
      if (!b) return;
      const phone = asPhone(b);
      if (phone) {
        const { data: byPhone } = await supabase
          .from("business_settings")
          .select("*")
          .eq("phone", phone)
          .maybeSingle();
        if (byPhone) {
          applyBrandingRow(byPhone);
          return;
        }
      }
      const { data: byName } = await supabase
        .from("business_settings")
        .select("*")
        .ilike("business_name", `%${b}%`)
        .maybeSingle();
      if (byName) applyBrandingRow(byName);
    } catch {
      /* offline / table missing — cached branding (if any) keeps showing */
    }
  }, [urlTenantId, business, resolveTenantId, applyBrandingRow]);

  // First paint: instant cached branding (either cache), then refresh
  useEffect(() => {
    const cached = readCachedBranding();
    if (cached) setSettings(cached);
    if (urlTenantId || cached?.tenantId || business.trim()) void prefetchBranding();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live refresh: Settings.tsx dispatches "settingsChanged" right after saving
  // a new logo/background — re-read the cache so the login page updates
  // instantly, even while it is already open ("storage" covers other tabs).
  useEffect(() => {
    const refresh = () => {
      const cached = readCachedBranding();
      if (cached) setSettings(cached);
    };
    window.addEventListener("settingsChanged", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("settingsChanged", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  /* ---------- submit ---------- */
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError("");

    const u = username.trim();
    const b = business.trim();
    if (!b && !urlTenantId) { setError("Please enter your business name or phone number."); return; }
    if (!u || !password) { setError("Please enter your username and password."); return; }

    // Load branding in the background as soon as we know the business —
    // the app bar's logo + name appear even before credentials are verified.
    void prefetchBranding();

    // Let loginTenant() resolve the tenant itself: pass through whichever
    // identifier we have (tenantId beats phone beats business_name).
    const payload: {
      username: string; password: string;
      tenantId?: string; phone?: string; business_name?: string;
    } = { username: u, password };

    if (urlTenantId) payload.tenantId = urlTenantId;
    else if (UUID_RE.test(b)) payload.tenantId = b;
    else {
      const phone = asPhone(b);
      if (phone) payload.phone = phone;
      else payload.business_name = b;
    }

    try {
      setBusy(true);
      const result = await loginTenant(payload);
      const { authToken, user } = result;

      // Keys match what AppLayout.tsx reads after login. The password is
      // cached alongside the profile (same pattern startup.tsx already
      // uses) so tryReauthenticate() can silently re-login this device
      // whenever the backend was unreachable at sign-in time.
      localStorage.setItem(
        "currentUser",
        JSON.stringify({ ...user, password })
      );
      localStorage.setItem("authToken", authToken);
      const tenantId = user.tenantId || (user as any).tenant_id || "";
      if (tenantId) localStorage.setItem("activeTenantId", tenantId);

      if (rememberBusiness && b) localStorage.setItem("rememberedBusiness", b);
      else localStorage.removeItem("rememberedBusiness");

      window.dispatchEvent(new Event("userChanged"));

      // Offline fallback session (backend unreachable): show the notice
      // instead of entering the app as if everything were online.
      if (result.offline) {
        setOfflineResult({ authToken });
        return;
      }

      // NOTE: if your app routes by role instead, replace with:
      //   navigate(user.role === "admin" ? "/admin" : user.role === "trainer" ? "/trainer" : "/user", { replace: true });
      navigate("/", { replace: true });
    } catch (err: any) {
      setError(err?.message || "Login failed. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  /* ---------- offline fallback actions ---------- */

  const continueOffline = () => {
    navigate("/", { replace: true });
  };

  /** Wakes the backend, then re-logs-in silently with the credentials
   *  cached a moment ago; on success the app continues with a real JWT
   *  and the session never was "offline" from the user's perspective. */
  const tryOnlineNow = async () => {
    if (checkingOnline) return;
    setCheckingOnline(true);
    setError("");
    try {
      // `true` skips the 30 s cooldown so this click always really retries.
      const token = await tryReauthenticate(true);

      if (token) {
        setOfflineResult(null);
        window.dispatchEvent(new Event("userChanged"));
        navigate("/", { replace: true });
      } else {
        setError(
          "Server is still waking up. You can continue offline — everything will sync automatically."
        );
      }
    } catch {
      setError(
        "Could not reach the server. You can continue offline and try again later."
      );
    } finally {
      setCheckingOnline(false);
    }
  };

  /* ---------- styles ---------- */
  const fieldBox = (focused: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 52,
    padding: "0 14px",
    boxSizing: "border-box",
    background: "#FFFFFF",
    borderRadius: 12,
    border: `1px solid ${focused ? C.primary : C.outline}`,
    boxShadow: focused ? "0 0 0 3px rgba(26,115,232,0.14)" : "none",
    transition: "border-color 0.15s ease, box-shadow 0.15s ease",
  });

  const inputStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 15,
    color: C.onSurface,
    fontFamily: font,
    padding: 0,
  };

  const labelStyle: CSSProperties = {
    display: "block",
    fontSize: 13,
    fontWeight: 500,
    color: C.onSurfaceVariant,
    margin: "0 0 6px 2px",
    textAlign: "left",
  };

  const bgSrc = settings?.loginBackground || "";

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        boxSizing: "border-box",
        fontFamily: font,
        background: C.background,
      }}
    >
      <style>{`
        @keyframes loginIn { from { opacity: 0; transform: translateY(10px) scale(0.99); } to { opacity: 1; transform: none; } }
        @keyframes loginSpin { to { transform: rotate(360deg); } }
        @keyframes md3Slide { from { left: -40%; } to { left: 100%; } }
        @keyframes md3Flow { from { background-position: 0% 50%; } to { background-position: 150% 50%; } }
        input:-webkit-autofill { -webkit-box-shadow: 0 0 0 1000px #FFFFFF inset; -webkit-text-fill-color: #202124; }
        /* App bar balance: logo + business name + phone on the LEFT, email +
           address stack on the RIGHT (stack hides on very narrow screens) */
        .appbar-contact { display: none; flex-direction: column; align-items: flex-end; gap: 2px; max-width: 42%; min-width: 0; }
        @media (min-width: 481px) {
          .appbar-contact { display: flex; }
        }
      `}</style>

      {/* Full-bleed background image (cover is intentional for a backdrop —
          this is a decorative layer, not the logo) */}
      {bgSrc && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage: `url("${cssUrl(bgSrc)}")`,
            backgroundSize: "cover",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}
      {/* Light wash so the card always stays readable over any background */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: bgSrc
            ? "linear-gradient(180deg, rgba(248,249,250,0.40) 0%, rgba(227,238,252,0.58) 100%)"
            : "linear-gradient(180deg, #F8F9FA 0%, #E3EEFC 100%)",
        }}
      />

      {/* Content column: branding app bar pinned on top, sign-in card centered below */}
      <div
        style={{
          position: "relative",
          zIndex: 1,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Login app bar: logo + business name + contact stack. No avatar/menu. */}
        <LoginAppBar
          logo={settings?.logo || ""}
          businessName={settings?.businessName || business.trim() || ""}
          phone={settings?.phone || ""}
          email={settings?.email || ""}
          address={settings?.address || ""}
        />

        <main
          style={{
            flex: 1,
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "24px 16px",
            boxSizing: "border-box",
          }}
        >
          <section
            style={{
              width: "min(420px, 100%)",
              background: C.surface,
              borderRadius: 28,
              boxShadow: "0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)",
              padding: "32px 28px 28px",
              boxSizing: "border-box",
              textAlign: "center",
              position: "relative",
              overflow: "hidden",
              animation: "loginIn 0.25s cubic-bezier(0.2, 0, 0, 1) both",
            }}
          >
            {/* Colour-cycling progress bar — slides across the card's top edge while signing in */}
            <TopLoader show={busy} flush />

            <h1
              style={{
                margin: "0 0 4px",
                fontSize: 24,
                fontWeight: 500,
                color: C.onSurface,
                letterSpacing: "-0.01em",
              }}
            >
              Sign in
            </h1>
            <p
              style={{
                margin: "0 0 22px",
                fontSize: 14,
                color: C.onSurfaceVariant,
                overflowWrap: "anywhere",
              }}
            >
              {businessName ? `to continue to ${businessName}` : "Use your business account to continue"}
            </p>

            {offlineResult && (
              <div
                role="status"
                style={{
                  background: "#FEF7E0",
                  border: "1px solid #F0E3B3",
                  borderRadius: 12,
                  padding: "14px 16px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  textAlign: "left",
                  color: "#6B5A14",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  Signed in offline
                </div>
                Your data is saved on this device and will sync automatically
                once the server is reachable. SMS sending stays disabled until
                then.
                <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
                  <button
                    type="button"
                    onClick={tryOnlineNow}
                    disabled={checkingOnline}
                    style={{
                      flex: 1,
                      height: 42,
                      border: "none",
                      borderRadius: 999,
                      background: C.primary,
                      color: C.onPrimary,
                      fontSize: 14,
                      fontWeight: 500,
                      fontFamily: font,
                      cursor: checkingOnline ? "default" : "pointer",
                    }}
                  >
                    {checkingOnline ? "Connecting…" : "Try online now"}
                  </button>
                  <button
                    type="button"
                    onClick={continueOffline}
                    style={{
                      flex: 1,
                      height: 42,
                      border: `1px solid ${C.outline}`,
                      borderRadius: 999,
                      background: "#FFFFFF",
                      color: C.onSurface,
                      fontSize: 14,
                      fontWeight: 500,
                      fontFamily: font,
                      cursor: "pointer",
                    }}
                  >
                    Continue offline
                  </button>
                </div>
                {error && (
                  <div
                    style={{
                      marginTop: 10,
                      fontSize: 12,
                      lineHeight: 1.45,
                      color: C.errorText,
                    }}
                  >
                    {error}
                  </div>
                )}
              </div>
            )}

            {offlineResult === null && (
            <form onSubmit={handleSubmit} noValidate style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Business identifier */}
              <div>
                <label htmlFor="login-business" style={labelStyle}>Business (name or phone)</label>
                <div style={fieldBox(focusedField === "business")}>
                  <input
                    id="login-business"
                    type="text"
                    value={business}
                    onChange={(e) => setBusiness(e.target.value)}
                    onFocus={() => setFocusedField("business")}
                    onBlur={() => { setFocusedField(""); if (business.trim()) void prefetchBranding(); }}
                    placeholder="e.g. Medstat Initiative or 07…"
                    autoComplete="organization"
                    spellCheck={false}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Username */}
              <div>
                <label htmlFor="login-username" style={labelStyle}>Username</label>
                <div style={fieldBox(focusedField === "username")}>
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    onFocus={() => setFocusedField("username")}
                    onBlur={() => setFocusedField("")}
                    placeholder="Your username"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label htmlFor="login-password" style={labelStyle}>Password</label>
                <div style={fieldBox(focusedField === "password")}>
                  <input
                    id="login-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField("password")}
                    onBlur={() => setFocusedField("")}
                    placeholder="Your password"
                    autoComplete="current-password"
                    style={inputStyle}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: C.onSurfaceVariant,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      padding: 4,
                      flexShrink: 0,
                    }}
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d={showPassword ? P.eyeOff : P.eye} />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Remember this business */}
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  cursor: "pointer",
                  alignSelf: "flex-start",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={rememberBusiness}
                  onChange={(e) => setRememberBusiness(e.target.checked)}
                  style={{ display: "none" }}
                />
                <span
                  aria-hidden="true"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 6,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `2px solid ${rememberBusiness ? C.primary : C.outline}`,
                    background: rememberBusiness ? C.primary : "#FFFFFF",
                    transition: "all 0.15s ease",
                    boxSizing: "border-box",
                  }}
                >
                  {rememberBusiness && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="#FFFFFF">
                      <path d={P.check} />
                    </svg>
                  )}
                </span>
                <span style={{ fontSize: 13, color: C.onSurfaceVariant }}>Remember this business</span>
              </label>

              {error && (
                <div
                  role="alert"
                  style={{
                    background: C.errorBg,
                    border: `1px solid ${C.errorBorder}`,
                    color: C.errorText,
                    borderRadius: 12,
                    padding: "10px 14px",
                    fontSize: 13,
                    lineHeight: 1.45,
                    textAlign: "left",
                  }}
                >
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy}
                style={{
                  width: "100%",
                  height: 50,
                  border: "none",
                  borderRadius: 999,
                  background: busy ? "rgba(32,33,36,0.12)" : C.primary,
                  color: busy ? "rgba(32,33,36,0.38)" : C.onPrimary,
                  fontSize: 15,
                  fontWeight: 500,
                  letterSpacing: "0.2px",
                  fontFamily: font,
                  cursor: busy ? "default" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  marginTop: 4,
                  boxShadow: busy ? "none" : "0 1px 2px rgba(60,64,67,0.3), 0 1px 3px 1px rgba(60,64,67,0.15)",
                  transition: "background 0.15s ease, box-shadow 0.15s ease",
                }}
              >
                {busy && (
                  <span
                    aria-hidden="true"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "2px solid rgba(26,115,232,0.25)",
                      borderTopColor: C.primary,
                      animation: "loginSpin 0.8s linear infinite",
                    }}
                  />
                )}
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
