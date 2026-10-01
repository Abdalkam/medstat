// src/components/FormFiller.tsx
// Shared by trainers AND trainees. Works ONLINE and OFFLINE:
//   - Forms list + form definitions cached in localStorage (hydrate instantly)
//   - Draft answers auto-saved on every change
//   - Offline submissions queued on-device and auto-synced when back online
//   - Per-form audience (visible_to): only shared roles see the form
// UI: full-width on BOTH FormsHome and FormFiller (no maxWidth caps),
// offline-first profile pic in the app bar, role-aware 🏠 dashboard button.
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

function withTimeout<T>(p: PromiseLike<T>, ms = 8000): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((_, rej) => setTimeout(() => rej(new Error("supabase-timeout")), ms)),
  ]);
}

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F5F5F8", bgSoft: "#FAFAFC", card: "#FFFFFF", separator: "#E7E7EC", separatorLight: "#F0F0F4",
  medBlue: "#0A84FF", medBlueDark: "#0060DF", medBlueBg: "#EAF3FF", medBlueSoft: "#F2F8FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#2FA65A", greenBg: "#E9F7EE",
  orange: "#E88A04", orangeBg: "#FFF6E8", purple: "#9B51E0", purpleBg: "#F4EDFC",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// ---- Professional design tokens (matches AdminFormBuilder) ----
const S = {
  radiusSm: 8, radiusMd: 12, radiusLg: 16,
  shadowXs: "0 1px 2px rgba(16,24,40,0.05)",
  shadowSm: "0 1px 3px rgba(16,24,40,0.08), 0 1px 2px rgba(16,24,40,0.04)",
  shadowMd: "0 4px 10px rgba(16,24,40,0.07), 0 2px 4px rgba(16,24,40,0.04)",
  ringBlue: "0 0 0 3px rgba(10,132,255,0.18)",
  ease: "cubic-bezier(0.4, 0, 0.2, 1)",
};
// Fluid page gutter — used for padding and for section-band bleed
const GUTTER = "clamp(20px, 4vw, 56px)";

const TS = {
  h1: { fontSize: 26, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h2: { fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 16, fontWeight: 600, lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 15, lineHeight: 1.7, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 13, lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 15, fontFamily: FONT, color: C.textPrimary },
};

interface FieldConfig { min?: number; max?: number; step?: number; unit?: string; unitOptions?: string[]; labelColor?: string; sectionColor?: string; }
interface FormField { id: string; type: string; label: string; required: boolean; options: string[]; placeholder: string; config?: FieldConfig; }
interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

// A submission made offline, waiting to sync
interface PendingSub {
  formId: string; userId: string; tenantId: string;
  username: string; role: string;
  answers: Record<string, any>; submittedAt: string;
  serverId?: string; // known server row id (from a previous online submit) → update instead of insert
}

const ANSWERABLE = ["text", "textarea", "paragraph", "number", "range", "radio", "checkbox", "dropdown", "toggle", "date", "time", "phone", "email"];
const QUEUE_KEY = "pendingFormSubmissions";

// NEW — audience check for per-form visibility.
// Unset/empty visible_to = everyone (backward compatible with existing forms).
// Admins always bypass.
function formVisibleToRole(form: any, role?: string): boolean {
  if (role === "admin" || role === "super_admin") return true;
  const vt = Array.isArray(form?.visible_to) ? form.visible_to : null;
  if (!vt || vt.length === 0) return true;
  return vt.includes(role || "trainee");
}

// ---------- offline queue helpers ----------
function readQueue(): PendingSub[] {
  try { const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); return Array.isArray(q) ? q : []; } catch { return []; }
}
function writeQueue(q: PendingSub[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* quota — ignore */ }
}
function readMySubs(userId: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`localFormSubs_${userId}`) || "{}"); } catch { return {}; }
}
function recordMySub(userId: string, formId: string, at: string) {
  try {
    const m = readMySubs(userId);
    m[formId] = at;
    localStorage.setItem(`localFormSubs_${userId}`, JSON.stringify(m));
  } catch {}
}

// Pushes all queued offline submissions to Supabase. Returns how many synced.
export async function flushPendingSubmissions(): Promise<number> {
  const q = readQueue();
  if (q.length === 0) return 0;
  const remaining: PendingSub[] = [];
  let synced = 0;
  for (const item of q) {
    try {
      const payload = {
        tenant_id: item.tenantId, form_id: item.formId, user_id: item.userId,
        username: item.username, role: item.role, answers: item.answers,
        submitted_at: item.submittedAt, // keep the ORIGINAL fill time, not sync time
      };
      if (item.serverId) {
        const { error } = await withTimeout(supabase.from("form_submissions").update(payload).eq("id", item.serverId));
        if (error) throw error;
      } else {
        const { data: existing } = await withTimeout(
          supabase.from("form_submissions").select("id").eq("form_id", item.formId).eq("user_id", item.userId).limit(1)
        );
        if (existing && existing[0]) {
          const { error } = await withTimeout(supabase.from("form_submissions").update(payload).eq("id", existing[0].id));
          if (error) throw error;
        } else {
          const { error } = await withTimeout(supabase.from("form_submissions").insert(payload));
          if (error) throw error;
        }
      }
      recordMySub(item.userId, item.formId, item.submittedAt);
      synced++;
    } catch {
      remaining.push(item); // still offline / failed — retry next time
    }
  }
  writeQueue(remaining);
  return synced;
}

// Flattens any answer shape to a human string (for exports/HTML)
function flattenAnswer(fld: FormField, a: any): string {
  if (a === undefined || a === null || a === "") return "";
  if (Array.isArray(a)) return a.join(", ");
  if (typeof a === "object") {
    if ("v" in (a as any)) return [ (a as any).v, (a as any).u ].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
    return JSON.stringify(a);
  }
  if (typeof a === "boolean") return a ? (fld.options?.[0] ?? "Yes") : (fld.options?.[1] ?? "No");
  return String(a);
}

// ---------- HTML download helpers (work fully offline) ----------
function esc(s: string) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function buildFormHtml(form: any, fields: FormField[], answers: Record<string, any>, filled: boolean): string {
  const rows = fields.map((f) => {
    if (f.type === "header") {
      const sc = f.config?.sectionColor || "#9B51E0";
      return `<div style="border-left:5px solid ${sc};background:${sc}14;padding:10px 16px;margin:22px 0 12px;"><h2 style="margin:0;color:${sc};">${esc(f.label || "")}</h2></div>`;
    }
    if (f.type === "note") {
      const html = /<[a-z][\s\S]*>/i.test(f.label || "");
      return html
        ? `<div style="background:#FFF6E8;border-radius:8px;padding:12px 16px;margin:0 0 16px;color:#7A4A00;">${f.label}</div>`
        : `<p style="margin:0 0 16px;color:#3C3C43;white-space:pre-wrap;">${esc(f.label || "")}</p>`;
    }
    const val = filled ? flattenAnswer(f, answers[f.id]) : "";
    const box = filled
      ? `<div style="border:1px solid #D1D1D6;border-radius:8px;padding:10px 12px;min-height:22px;">${esc(val) || '<span style="color:#8E8E93">—</span>'}</div>`
      : `<div style="border-bottom:1px solid #C7C7CC;min-height:36px;"></div>`;
    return `<div style="margin:0 0 18px;">
      <div style="font-weight:600;margin-bottom:6px;color:${f.config?.labelColor || "#1C1C1E"};">${esc(f.label || "Untitled field")}${f.required ? ' <span style="color:#FF3B30">*</span>' : ""}</div>
      ${box}
    </div>`;
  }).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(form?.title || "Form")}</title></head>
  <body style="font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 20px;color:#1C1C1E;">
    <h1 style="margin:0 0 6px;">${esc(form?.title || "Form")}</h1>
    ${form?.description ? `<p style="color:#3C3C43;margin:0 0 18px;">${esc(form.description)}</p>` : ""}
    <p style="color:#8E8E93;font-size:13px;margin:0 0 26px;">${filled ? "Filled copy" : "Blank form"} — generated ${new Date().toLocaleString()}</p>
    ${rows}
  </body></html>`;
}

function downloadHtmlFile(filename: string, html: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "form"; }

// Cache the avatar as a base64 data URL so it renders even fully offline.
// Same keys as UserDashboard / TrainerDashboard / Classroom / AdminForms —
// all views stay in sync.
async function cacheAvatarImage(userId: string, url: string) {
  try {
    if (!url) return;
    if (url.startsWith("data:")) {
      localStorage.setItem(`cachedAvatar_${userId}`, url);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
      return;
    }
    if (localStorage.getItem(`cachedAvatarUrl_${userId}`) === url) return;

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 1_000_000) return; // protect localStorage quota

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
  } catch { /* offline or quota exceeded — ignore */ }
}

// Role-aware dashboard route: admin → /admin, trainer → /trainer, trainee → /user
function dashboardPathFor(role?: string): string {
  if (role === "admin" || role === "super_admin") return "/admin";
  if (role === "trainer") return "/trainer";
  return "/user";
}

// ---------- Shared app bar: business identity + profile pic + dashboard ----------
function AppBar({ onBack }: { onBack?: () => void }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePicError, setProfilePicError] = useState(false);

  useEffect(() => {
    if (!currentUser?.tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        // Offline-first: hydrate from localStorage instantly
        const localSettings = localStorage.getItem("localBusinessSettings");
        if (localSettings) {
          const p = JSON.parse(localSettings);
          if (!cancelled) setBusiness({ business_name: p.businessName || null, phone: p.phone || null, logo: p.logo || null });
        }
        const { data } = await withTimeout(supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle());
        if (!cancelled && data) setBusiness(data as BusinessData);
      } catch { /* offline — localStorage business info already shown */ }
    })();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  // Offline-first avatar — hydrate instantly from the shared cache, then
  // refresh from Supabase and write back so the pic renders with zero network.
  useEffect(() => {
    const fetchProfilePic = async () => {
      if (!currentUser?.id) return;
      setProfilePicError(false);

      // 1. Offline-first hydration: cached base64 wins, then cached profile, then stored pic
      const cached = localStorage.getItem(`cachedAvatar_${currentUser.id}`);
      let cachedProfile: any = null;
      try { cachedProfile = JSON.parse(localStorage.getItem(`cachedProfile_${currentUser.id}`) || "null"); } catch {}
      if (cached || cachedProfile?.avatar_url || currentUser.profilePic) {
        setProfilePic(cached || cachedProfile?.avatar_url || currentUser.profilePic);
      }

      // 2. Refresh from Supabase + write back to cache
      try {
        const { data } = await supabase.from("profile_settings").select("avatar_url").eq("user_id", currentUser.id).maybeSingle();
        if (data?.avatar_url) {
          setProfilePic(data.avatar_url);
          localStorage.setItem(`cachedProfile_${currentUser.id}`, JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, avatar_url: data.avatar_url }));
          cacheAvatarImage(currentUser.id, data.avatar_url);
        } else {
          // Fallback: some accounts keep the pic on the users table
          const { data: u } = await supabase.from("users").select("profile_pic").eq("id", currentUser.id).maybeSingle();
          if (u?.profile_pic) {
            setProfilePic(u.profile_pic);
            cacheAvatarImage(currentUser.id, u.profile_pic);
          } else if (currentUser.profilePic) {
            setProfilePic(currentUser.profilePic);
            cacheAvatarImage(currentUser.id, currentUser.profilePic);
          } else if (!cached) {
            setProfilePic(null);
          }
        }
      } catch { /* offline — cached avatar already shown */ }
    };
    fetchProfilePic();
  }, [currentUser?.id]);

  function handleLogout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("adminDeviceId");
    localStorage.removeItem("activeAttendanceCourseId");
    window.dispatchEvent(new Event("authStateChanged"));
    navigate("/");
  }

  const iconBtn: React.CSSProperties = { width: 38, height: 38, borderRadius: 10, border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "transform 0.12s" };

  return (
    <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "10px 24px", position: "sticky", top: 0, zIndex: 20, background: "rgba(255,255,255,0.85)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box" }}>
      {onBack && (
        <button onClick={onBack} title="Back to Forms" style={{ ...iconBtn, background: C.card, border: `1px solid ${C.separator}`, color: C.medBlue }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        {business?.logo ? (
          <img src={business.logo} alt={business.business_name || "Business"} style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover", flexShrink: 0, boxShadow: S.shadowXs }} />
        ) : (
          <div style={{ ...TS.h3, width: 36, height: 36, borderRadius: 9, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{(business?.business_name || "B").charAt(0).toUpperCase()}</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
          {business?.phone && (
            <a href={`tel:${business.phone}`} style={{ ...TS.bodySm, fontSize: 12, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
              {business.phone}
            </a>
          )}
        </div>
      </div>

      {/* Profile chip with picture (online + offline) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: 20, flexShrink: 0 }}>
        {profilePic && !profilePicError ? (
          <img
            src={profilePic}
            alt="Profile"
            style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
            // On error (e.g. remote URL while offline) swap to the cached
            // base64 copy; only fall back to the initial letter if none.
            onError={() => {
              const cached = currentUser?.id ? localStorage.getItem(`cachedAvatar_${currentUser.id}`) : null;
              if (cached && profilePic !== cached) {
                setProfilePic(cached);
                setProfilePicError(false);
              } else {
                setProfilePicError(true);
              }
            }}
          />
        ) : (
          <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>
            {currentUser?.username?.charAt(0).toUpperCase()}
          </div>
        )}
        <span style={{ fontSize: 13, fontWeight: 600, color: C.purple, whiteSpace: "nowrap" }}>{currentUser?.username || "User"}</span>
      </div>

      {/* Role-aware dashboard button */}
      <button onClick={() => navigate(dashboardPathFor(currentUser?.role))} title="Back to dashboard" style={{ ...iconBtn, background: C.medBlueBg, color: C.medBlue }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      </button>

      <button onClick={handleLogout} title="Logout" style={{ ...iconBtn, background: C.redBg, color: C.red }}>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
      </button>
    </div>
  );
}

// ================= FORMS HOME — online + offline, FULL WIDTH =================
export function FormsHome() {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [forms, setForms] = useState<any[]>([]);
  const [mySubs, setMySubs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    (async () => {
      const tenantId = currentUser.tenantId;

      // 1. OFFLINE-FIRST: hydrate the cached list instantly (filtered for my role)
      try {
        const cached = JSON.parse(localStorage.getItem(`localForms_${tenantId}`) || "[]");
        if (Array.isArray(cached) && cached.length > 0) {
          setForms(cached.filter((f: any) => formVisibleToRole(f, currentUser.role))); // NEW
        }
      } catch {}

      // Filled badges: cached map + any pending offline submissions
      const local = readMySubs(currentUser.id);
      const pending = readQueue().filter((p) => p.userId === currentUser.id);
      const merged: Record<string, string> = { ...local };
      pending.forEach((p) => { merged[p.formId] = p.submittedAt; });
      setMySubs(merged);
      setPendingCount(pending.length);

      // 2. Sync any queued offline submissions (no-op when queue empty/offline)
      if (navigator.onLine) {
        const synced = await flushPendingSubmissions();
        setPendingCount(readQueue().filter((p) => p.userId === currentUser.id).length);
        if (synced > 0) {
          const refreshed = readMySubs(currentUser.id);
          setMySubs((prev) => ({ ...refreshed, ...prev }));
        }
      }

      // 3. ONLINE refresh + write back to cache
      try {
        const { data: fs } = await withTimeout(
          supabase.from("forms").select("id, title, description, allow_download, visible_to, updated_at")
            .eq("tenant_id", tenantId).eq("status", "published")
            .order("updated_at", { ascending: false })
        );
        if (fs) {
          setForms((fs as any[]).filter((f) => formVisibleToRole(f, currentUser.role))); // NEW: filter for my role
          localStorage.setItem(`localForms_${tenantId}`, JSON.stringify(fs)); // cache RAW — filtered per role on read
        }
        const { data: subs } = await withTimeout(supabase.from("form_submissions").select("form_id, submitted_at").eq("user_id", currentUser.id));
        if (subs) {
          const map: Record<string, string> = {};
          (subs as any[]).forEach((s) => { map[s.form_id] = s.submitted_at; });
          localStorage.setItem(`localFormSubs_${currentUser.id}`, JSON.stringify(map));
          const pendingNow = readQueue().filter((p) => p.userId === currentUser.id);
          pendingNow.forEach((p) => { map[p.formId] = p.submittedAt; });
          setMySubs(map);
        }
      } catch (e) { /* offline — cached data already applied */ }
      finally { setLoading(false); }
    })();
  }, []);

  const filledCount = forms.filter((f) => mySubs[f.id]).length;

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
      `}</style>

      <AppBar />

      {/* ===== FULL-WIDTH CONTENT — no maxWidth anywhere ===== */}
      <div style={{ width: "100%", boxSizing: "border-box", padding: `24px ${GUTTER} 80px` }}>

        {/* Page header card — full bleed width */}
        <div style={{ background: C.card, borderRadius: S.radiusLg, border: `1px solid ${C.separator}`, boxShadow: S.shadowMd, overflow: "hidden", position: "relative", marginBottom: 18 }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.medBlue}, ${C.purple})` }} />
          <div style={{ padding: "22px clamp(20px, 3vw, 36px)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h1 style={{ ...TS.h1, margin: "0 0 8px" }}>Forms</h1>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ ...TS.caption, color: C.textTertiary, background: C.bgSoft, border: `1px solid ${C.separatorLight}`, padding: "4px 11px", borderRadius: 20 }}>{forms.length} form{forms.length === 1 ? "" : "s"}</span>
                <span style={{ ...TS.caption, color: filledCount > 0 ? C.green : C.textTertiary, background: filledCount > 0 ? C.greenBg : C.bgSoft, border: `1px solid ${filledCount > 0 ? C.green + "33" : C.separatorLight}`, padding: "4px 11px", borderRadius: 20 }}>{filledCount} filled</span>
                {!isOnline && <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "4px 11px", borderRadius: 20 }}>⏸ Offline — cached forms shown</span>}
                {pendingCount > 0 && <span style={{ ...TS.caption, color: C.medBlue, background: C.medBlueBg, padding: "4px 11px", borderRadius: 20 }}>⇅ {pendingCount} waiting to sync</span>}
              </div>
              <p style={{ ...TS.bodySm, margin: "10px 0 0" }}>Forms published by your administrator. Fill them anywhere — submissions made offline sync automatically.</p>
            </div>
            {/* Users don't create forms — this slot is a refresh affordance */}
            <button
              onClick={() => window.location.reload()}
              title="Refresh forms"
              style={{ ...TS.input, padding: "11px 20px", background: `linear-gradient(180deg, ${C.medBlue}, ${C.medBlueDark})`, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer", boxShadow: "0 2px 8px rgba(10,132,255,0.35)", flexShrink: 0 }}
            >
              ⟳ Refresh
            </button>
          </div>
        </div>

        {/* List — full-width responsive grid */}
        {loading && <p style={{ ...TS.bodySm, margin: "0 4px" }}>Loading forms...</p>}

        {!loading && forms.length === 0 && (
          <div style={{ padding: "72px 32px", textAlign: "center", background: C.card, borderRadius: S.radiusLg, border: `1px solid ${C.separator}`, boxShadow: S.shadowSm }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 19, fontWeight: 700, margin: "0 0 8px" }}>No Forms Available</h3>
            <p style={{ ...TS.bodySm, margin: 0 }}>{isOnline ? "There are no published forms right now." : "You're offline and there are no cached forms. Connect once to download them."}</p>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 14 }}>
          {forms.map((f) => {
            const filledAt = mySubs[f.id];
            return (
              <div
                key={f.id}
                onClick={() => navigate(`/forms/${f.id}`)}
                onMouseEnter={(e) => { e.currentTarget.style.boxShadow = S.shadowMd; e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.borderColor = filledAt ? C.green + "55" : C.medBlue + "44"; }}
                onMouseLeave={(e) => { e.currentTarget.style.boxShadow = S.shadowSm; e.currentTarget.style.transform = "none"; e.currentTarget.style.borderColor = filledAt ? C.green + "33" : C.separator; }}
                style={{ display: "flex", alignItems: "center", gap: 16, background: C.card, borderRadius: S.radiusLg, padding: "18px 22px", cursor: "pointer", border: `1px solid ${filledAt ? C.green + "33" : C.separator}`, boxShadow: S.shadowSm, transition: "box-shadow 0.15s, transform 0.15s, border-color 0.15s", boxSizing: "border-box" }}
              >
                <div style={{ width: 48, height: 48, borderRadius: 13, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: filledAt ? C.greenBg : C.medBlueBg, color: filledAt ? C.green : C.medBlue, fontSize: 20 }}>📋</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ ...TS.caption, color: filledAt ? C.green : C.textTertiary, background: filledAt ? C.greenBg : C.bgSoft, border: filledAt ? "none" : `1px solid ${C.separatorLight}`, padding: "3px 9px", borderRadius: 20 }}>{filledAt ? "✓ Filled" : "Not filled"}</span>
                    {f.allow_download && <span style={{ ...TS.caption, color: C.textTertiary, background: C.bgSoft, border: `1px solid ${C.separatorLight}`, padding: "3px 9px", borderRadius: 20 }}>⬇ downloadable</span>}
                  </div>
                  <h3 style={{ ...TS.h3, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.title}</h3>
                  {f.description && <p style={{ ...TS.bodySm, margin: "3px 0 0", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.description}</p>}
                </div>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textTertiary} strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ================= FORM FILLER — online + offline, full width =================
export default function FormFiller() {
  const { formId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "super_admin";

  const [form, setForm] = useState<any>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [mySub, setMySub] = useState<any>(null); // { id?, offline?, submitted_at }
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savedMsg, setSavedMsg] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  const draftKey = `localFormDraft_${formId}_${currentUser.id}`;

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    if (!formId) return;
    (async () => {
      const uid = currentUser.id;

      // 1. OFFLINE-FIRST: hydrate form + fields from cache
      try {
        const cached = JSON.parse(localStorage.getItem(`localForm_${formId}`) || "null");
        if (cached && cached.form) {
          setForm(cached.form);
          setFields(cached.fields || []);
        }
      } catch {}

      // My answers: draft (saved as I type) is the offline source of truth
      let localAnswers: Record<string, any> = {};
      try { localAnswers = JSON.parse(localStorage.getItem(draftKey) || "{}"); } catch {}
      // A queued offline submission also counts as "already filled"
      const queued = readQueue().find((p) => p.formId === formId && p.userId === uid);
      if (queued) { localAnswers = { ...localAnswers, ...queued.answers }; }

      // 2. ONLINE refresh: form detail + my server submission
      try {
        const { data: f } = await withTimeout(supabase.from("forms").select("*").eq("id", formId).maybeSingle());
        if (f) setForm(f);
        const { data: ff } = await withTimeout(supabase.from("form_fields").select("*").eq("form_id", formId).order("sort_order", { ascending: true }));
        if (ff) {
          const mapped = (ff as any[]).map((x: any): FormField => ({
            id: x.id,
            type: x.type === "paragraph" ? "textarea" : x.type,
            label: x.label || "", required: x.required || false,
            options: Array.isArray(x.options) ? x.options : (x.type === "toggle" ? ["F", "M"] : []),
            placeholder: x.placeholder || "",
            config: (x.config && typeof x.config === "object") ? x.config : {},
          }));
          setFields(mapped);
          localStorage.setItem(`localForm_${formId}`, JSON.stringify({ form: f, fields: mapped }));
        }
        const { data: mine } = await withTimeout(
          supabase.from("form_submissions").select("*").eq("form_id", formId).eq("user_id", uid).order("submitted_at", { ascending: false }).limit(1)
        );
        if (mine && mine[0]) {
          setMySub(mine[0]);
          // Server wins unless there are NEWER unsynced local edits
          if (queued && queued.submittedAt > (mine[0].submitted_at || "")) {
            setAnswers({ ...(mine[0].answers || {}), ...queued.answers });
          } else if (!queued) {
            setAnswers(mine[0].answers || {});
          }
        } else if (queued) {
          setMySub({ offline: true, submitted_at: queued.submittedAt });
          setAnswers(queued.answers);
        } else {
          setAnswers(localAnswers);
        }
      } catch {
        // OFFLINE: use queued submission or draft
        if (queued) { setMySub({ offline: true, submitted_at: queued.submittedAt }); setAnswers(queued.answers); }
        else if (Object.keys(localAnswers).length > 0) setAnswers(localAnswers);
      }
      finally { setLoading(false); }
    })();
  }, [formId]);

  // Every answer change is also persisted as a local draft immediately
  const setAnswer = (id: string, v: any) => {
    setAnswers((p) => {
      const next = { ...p, [id]: v };
      try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch {}
      return next;
    });
    setSavedMsg(""); setFormError(null);
  };
  const toggleMulti = (id: string, opt: string, on: boolean) => setAnswers((p) => {
    const cur: string[] = Array.isArray(p[id]) ? p[id] : [];
    const next = { ...p, [id]: on ? [...cur, opt] : cur.filter((o) => o !== opt) };
    try { localStorage.setItem(draftKey, JSON.stringify(next)); } catch {}
    return next;
  });

  async function handleSubmit() {
    setFormError(null);
    const missing = fields.filter((x) => ANSWERABLE.includes(x.type)).find((f) => {
      if (!f.required) return false;
      const v = answers[f.id];
      if (v === undefined || v === null || v === "") return true;
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === "object" && "v" in v) return v.v === "" || v.v === undefined || v.v === null;
      return false;
    });
    if (missing) { setFormError(`Please answer: ${missing.label || "Untitled field"}`); return; }

    const submittedAt = new Date().toISOString();
    setSubmitting(true);
    try {
      const payload = {
        tenant_id: currentUser.tenantId, form_id: formId, user_id: currentUser.id,
        username: currentUser.username || "Unknown", role: currentUser.role || "trainee",
        answers, submitted_at: submittedAt,
      };
      if (mySub?.id) {
        const { error } = await withTimeout(supabase.from("form_submissions").update(payload).eq("id", mySub.id));
        if (error) throw error;
        setMySub({ ...mySub, ...payload });
      } else {
        const { data, error } = await withTimeout(supabase.from("form_submissions").insert(payload).select("id").single());
        if (error) throw error;
        setMySub({ id: data.id, ...payload });
      }
      recordMySub(currentUser.id, formId as string, submittedAt);
      try { localStorage.removeItem(draftKey); } catch {}
      setSavedMsg("✓ Your answers have been saved.");
    } catch (e: any) {
      const networkFail = e?.message === "supabase-timeout" || /fetch|network|Failed to fetch/i.test(e?.message || "");
      if (networkFail) {
        // OFFLINE: queue locally and confirm — sync happens automatically later
        const queue = readQueue().filter((p) => !(p.formId === formId && p.userId === currentUser.id));
        queue.push({
          formId: formId as string, userId: currentUser.id, tenantId: currentUser.tenantId,
          username: currentUser.username || "Unknown", role: currentUser.role || "trainee",
          answers, submittedAt, serverId: mySub?.id,
        });
        writeQueue(queue);
        setMySub({ offline: true, submitted_at: submittedAt });
        try { localStorage.removeItem(draftKey); } catch {}
        setSavedMsg("✓ Saved offline — your answers are stored on this device and will sync automatically when you're back online.");
      } else {
        setSavedMsg("");
        setFormError("Failed to save: " + (e.message || e));
      }
    }
    finally { setSubmitting(false); }
  }

  const locked = form && form.status !== "published" && !isAdmin;
  const inputStyle: React.CSSProperties = { ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: S.radiusMd, outline: "none", background: C.bg, boxSizing: "border-box", transition: "border-color 0.15s, box-shadow 0.15s" };

  if (loading) return <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}><span style={{ ...TS.body, fontWeight: 500 }}>Loading form...</span></div>;

  if (!form) return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
      <AppBar onBack={() => navigate("/forms")} />
      <div style={{ padding: "80px 40px", textAlign: "center" }}>
        <h3 style={{ ...TS.h3, fontSize: 19, margin: "0 0 8px" }}>Form not found</h3>
        <p style={{ ...TS.bodySm, margin: 0 }}>This form may have been deleted, or it was never downloaded while online.</p>
      </div>
    </div>
  );

  // NEW — audience gate: block direct URL access when the form isn't shared with this role
  if (!formVisibleToRole(form, currentUser.role)) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <AppBar onBack={() => navigate("/forms")} />
        <div style={{ padding: "80px 40px", textAlign: "center" }}>
          <h3 style={{ ...TS.h3, fontSize: 19, margin: "0 0 8px" }}>No access to this form</h3>
          <p style={{ ...TS.bodySm, margin: 0 }}>
            This form isn't shared with your role ({currentUser.role || "trainee"}). Ask your administrator if you think this is a mistake.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        input:focus, textarea:focus, select:focus { border-color: ${C.medBlue} !important; box-shadow: ${S.ringBlue} !important; }
        button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
      `}</style>

      <AppBar onBack={() => navigate("/forms")} />

      {/* FULL-WIDTH paper — gradient header, fluid gutters */}
      <div style={{ width: "100%", boxSizing: "border-box", padding: `24px ${GUTTER} 80px` }}>
        <div style={{ background: C.card, borderRadius: S.radiusLg, border: `1px solid ${C.separator}`, boxShadow: S.shadowMd, overflow: "hidden" }}>
          {/* Form header */}
          <div style={{ padding: "26px clamp(20px, 3vw, 36px) 18px", borderBottom: `1px solid ${C.separatorLight}`, background: `linear-gradient(180deg, ${C.medBlueSoft} 0%, ${C.card} 100%)`, position: "relative" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg, ${C.medBlue}, ${C.purple})` }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <h1 style={{ ...TS.h1, margin: 0 }}>{form.title}</h1>
              {!isOnline && <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "4px 11px", borderRadius: 20 }}>⏸ Offline — answers save on this device</span>}
            </div>
            {form.description && <p style={{ ...TS.body, color: C.textSecondary, margin: "6px 0 0" }}>{form.description}</p>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
              {mySub?.submitted_at && <span style={{ ...TS.caption, color: C.green, background: C.greenBg, padding: "4px 11px", borderRadius: 20 }}>✓ Last submitted {new Date(mySub.submitted_at).toLocaleString()}{mySub.offline ? " (offline — will sync)" : ""}</span>}
              {form.status === "closed" && <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "4px 11px", borderRadius: 20 }}>⚠ Closed {isAdmin ? "— admin can still edit" : ""}</span>}
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: `20px clamp(20px, 3vw, 36px) 32px` }}>
            {/* Downloads */}
            <div style={{ display: "flex", gap: 10, marginBottom: 24, flexWrap: "wrap" }}>
              {form.allow_download ? (
                <>
                  <button onClick={() => { try { downloadHtmlFile(`${slug(form.title)}-blank.html`, buildFormHtml(form, fields, {}, false)); } catch {} }} style={{ ...TS.input, padding: "10px 18px", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer", boxShadow: S.shadowXs }}>⬇ Blank Form</button>
                  <button onClick={() => { try { downloadHtmlFile(`${slug(form.title)}-filled.html`, buildFormHtml(form, fields, answers, true)); } catch {} }} style={{ ...TS.input, padding: "10px 18px", background: C.greenBg, color: C.green, border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>⬇ My Filled Form</button>
                </>
              ) : (
                <span style={{ ...TS.bodySm, fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>⬇ Downloads are disabled by the administrator.</span>
              )}
            </div>

            {locked ? (
              <div style={{ background: C.orangeBg, borderRadius: S.radiusMd, padding: "24px 28px", color: "#B96A00", fontWeight: 600 }}>This form is not currently available ({form.status}).</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                  {fields.map((f) => {
                    // Section band — bleeds to the paper edges, colored
                    if (f.type === "header") {
                      const sc = f.config?.sectionColor || C.purple;
                      return (
                        <div key={f.id} style={{ margin: `16px calc(-1 * clamp(20px, 3vw, 36px)) 0`, padding: "12px clamp(20px, 3vw, 36px)", background: `linear-gradient(90deg, ${sc}14, ${sc}06)`, borderLeft: `5px solid ${sc}`, borderTop: `1px solid ${C.separatorLight}`, borderBottom: `1px solid ${C.separatorLight}` }}>
                          <h2 style={{ ...TS.h2, margin: 0, color: sc }}>{f.label}</h2>
                        </div>
                      );
                    }
                    if (f.type === "note") {
                      const html = /<[a-z][\s\S]*>/i.test(f.label || "");
                      return html
                        ? <div key={f.id} style={{ background: C.orangeBg, borderRadius: 10, padding: "14px 18px", fontSize: 14, color: "#7A4A00" }} dangerouslySetInnerHTML={{ __html: f.label }} />
                        : <div key={f.id} style={{ background: C.orangeBg, borderRadius: 10, padding: "14px 18px", whiteSpace: "pre-wrap", fontSize: 14, color: "#7A4A00" }}>{f.label}</div>;
                    }
                    if (!ANSWERABLE.includes(f.type)) return null;

                    const val = answers[f.id];
                    const c = f.config || {};
                    const isObj = val && typeof val === "object" && !Array.isArray(val);
                    const numVal = isObj ? (val as any).v : (typeof val === "number" ? val : "");
                    const unitVal = isObj ? ((val as any).u || c.unit || "") : (c.unit || "");
                    const dispUnit = f.type === "range" ? (c.unit || "") : unitVal;

                    return (
                      <div key={f.id} style={{ background: C.bgSoft, borderRadius: S.radiusMd, padding: "18px 22px", border: `1px solid ${C.separatorLight}` }}>
                        <div style={{ marginBottom: 10 }}>
                          <span style={{ ...TS.h3, color: c.labelColor || undefined }}>{f.label || "(untitled)"}</span>
                          {f.required && <span style={{ color: c.labelColor || C.red, fontWeight: 700 }}> *</span>}
                          {f.type === "date" && f.placeholder && <span style={{ ...TS.caption, fontSize: 10, color: C.textTertiary, marginLeft: 8 }}>Format: {f.placeholder}</span>}
                        </div>

                        {f.type === "textarea" ? (
                          <textarea placeholder={f.placeholder || "Type your answer..."} value={typeof val === "string" ? val : ""} onChange={(e) => setAnswer(f.id, e.target.value)} style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} />
                        ) : f.type === "dropdown" ? (
                          <select value={typeof val === "string" ? val : ""} onChange={(e) => setAnswer(f.id, e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                            <option value="">{f.placeholder || "Select an option..."}</option>
                            {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : f.type === "radio" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {f.options.map((o) => (
                              <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15 }}>
                                <input type="radio" name={f.id} checked={val === o} onChange={() => setAnswer(f.id, o)} style={{ width: 18, height: 18, accentColor: c.labelColor || C.medBlue }} />
                                {o}
                              </label>
                            ))}
                          </div>
                        ) : f.type === "checkbox" ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {f.options.map((o) => (
                              <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15 }}>
                                <input type="checkbox" checked={Array.isArray(val) && val.includes(o)} onChange={(e) => toggleMulti(f.id, o, e.target.checked)} style={{ width: 18, height: 18, accentColor: c.labelColor || C.green }} />
                                {o}
                              </label>
                            ))}
                          </div>
                        ) : f.type === "toggle" ? (
                          <div style={{ display: "flex", background: C.card, borderRadius: 10, padding: 4, gap: 4, maxWidth: 260 }}>
                            {(f.options.length === 2 ? f.options : ["F", "M"]).map((o) => (
                              <button key={o} type="button" onClick={() => setAnswer(f.id, o)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", background: val === o ? (c.labelColor || C.medBlue) : "transparent", color: val === o ? "#fff" : C.textTertiary }}>{o}</button>
                            ))}
                          </div>
                        ) : f.type === "range" ? (
                          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <input type="range" min={c.min ?? 0} max={c.max ?? 100} step={c.step ?? 1} value={typeof numVal === "number" ? numVal : (c.min ?? 0)} onChange={(e) => setAnswer(f.id, Number(e.target.value))} style={{ flex: 1, accentColor: c.labelColor || C.medBlue }} />
                            <span style={{ minWidth: 64, textAlign: "right", fontWeight: 700, fontSize: 15, color: c.labelColor || undefined }}>{typeof numVal === "number" ? numVal : (c.min ?? 0)}{dispUnit ? ` ${dispUnit}` : ""}</span>
                          </div>
                        ) : (
                          <div style={{ display: "flex", gap: 8 }}>
                            <input
                              type={f.type === "date" ? "date" : f.type === "time" ? "time" : f.type === "number" ? "number" : f.type === "phone" ? "tel" : f.type === "email" ? "email" : "text"}
                              step={f.type === "number" ? (c.step && c.step < 1 ? c.step : 1) : undefined}
                              inputMode={f.type === "number" ? "numeric" : undefined}
                              placeholder={f.placeholder || ""}
                              value={f.type === "number" ? (numVal ?? "") : (typeof val === "string" ? val : "")}
                              onChange={(e) => {
                                if (f.type === "number") {
                                  const raw = e.target.value;
                                  if (raw === "") { setAnswer(f.id, { v: "", u: unitVal }); return; }
                                  const n = Number(raw);
                                  if (!Number.isNaN(n)) setAnswer(f.id, { v: n, u: unitVal });
                                } else setAnswer(f.id, e.target.value);
                              }}
                              style={{ ...inputStyle, flex: 1 }}
                            />
                            {f.type === "number" && (c.unitOptions || []).length > 0 && (
                              <select value={unitVal} onChange={(e) => setAnswer(f.id, { v: numVal, u: e.target.value })} style={{ ...inputStyle, width: 100, padding: "8px 10px", cursor: "pointer" }}>
                                <option value="">{c.unit || "unit"}</option>
                                {(c.unitOptions || []).map((u) => <option key={u} value={u}>{u}</option>)}
                              </select>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Submit */}
                <div style={{ marginTop: 28, borderTop: `1px solid ${C.separatorLight}`, paddingTop: 20 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <button onClick={handleSubmit} disabled={submitting} style={{ ...TS.input, padding: "13px 32px", background: submitting ? C.textTertiary : `linear-gradient(180deg, ${C.medBlue}, ${C.medBlueDark})`, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 15, cursor: submitting ? "default" : "pointer", boxShadow: "0 2px 8px rgba(10,132,255,0.35)" }}>
                      {submitting ? "Saving…" : mySub ? "Update my answers" : "Submit"}
                    </button>
                    {mySub && form?.allow_multiple_submissions !== false && (
                      <button
                        onClick={() => { setAnswers({}); setMySub(null); try { localStorage.removeItem(draftKey); } catch {} setSavedMsg(""); setFormError(null); }}
                        title="Clear your answers and fill this form again as a new submission"
                        style={{ ...TS.input, padding: "13px 20px", background: C.bg, color: C.textSecondary, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}
                      >＋ New submission</button>
                    )}
                  </div>
                  {savedMsg && <p style={{ ...TS.bodySm, margin: "12px 0 0", color: C.green, fontWeight: 600 }}>{savedMsg}</p>}
                  {formError && <p style={{ ...TS.bodySm, margin: "12px 0 0", color: C.red, fontWeight: 600 }}>{formError}</p>}
                  <p style={{ ...TS.bodySm, margin: "12px 0 0" }}>Fields marked <span style={{ color: C.red, fontWeight: 700 }}>*</span> are required.</p>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}