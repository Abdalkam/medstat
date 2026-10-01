// src/components/FormFiller.tsx
// Shared by trainers AND trainees. Works ONLINE and OFFLINE:
//   - Forms list + form definitions cached in localStorage (hydrate instantly)
//   - Draft answers auto-saved on every change
//   - Offline submissions queued on-device and auto-synced when back online
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
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE", purpleBg: "#F5F0FF",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TS = {
  h1: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h2: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 17, fontWeight: 600, lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontFamily: FONT, color: C.textPrimary },
};

interface FieldConfig { min?: number; max?: number; step?: number; unit?: string; unitOptions?: string[]; }
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
        // No known server row — check for one (e.g. submitted from another device)
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
    if (f.type === "header") return `<h2 style="margin:26px 0 8px;color:#1C1C1E;">${esc(f.label || "")}</h2>`;
    if (f.type === "note") {
      const html = /<[a-z][\s\S]*>/i.test(f.label || "");
      return html
        ? `<div style="background:#FFF6EB;border-radius:8px;padding:12px 16px;margin:0 0 16px;color:#7A4A00;">${f.label}</div>`
        : `<p style="margin:0 0 16px;color:#3C3C43;white-space:pre-wrap;">${esc(f.label || "")}</p>`;
    }
    const val = filled ? flattenAnswer(f, answers[f.id]) : "";
    const box = filled
      ? `<div style="border:1px solid #D1D1D6;border-radius:8px;padding:10px 12px;min-height:22px;">${esc(val) || '<span style="color:#8E8E93">—</span>'}</div>`
      : `<div style="border-bottom:1px solid #C7C7CC;min-height:36px;"></div>`;
    return `<div style="margin:0 0 18px;">
      <div style="font-weight:600;margin-bottom:6px;color:#1C1C1E;">${esc(f.label || "Untitled field")}${f.required ? ' <span style="color:#FF3B30">*</span>' : ""}</div>
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

// ---------- Shared app bar ----------
function AppBar({ onBack }: { onBack?: () => void }) {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [business, setBusiness] = useState<BusinessData | null>(null);

  useEffect(() => {
    if (!currentUser?.tenantId) return;
    let cancelled = false;
    (async () => {
      try {
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

  function handleLogout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("adminDeviceId");
    localStorage.removeItem("activeAttendanceCourseId");
    window.dispatchEvent(new Event("authStateChanged"));
    navigate("/");
  }

  return (
    <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, background: C.card, display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box" }}>
      {onBack && (
        <button onClick={onBack} style={{ background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
        {business?.logo ? (
          <img src={business.logo} alt={business.business_name || "Business"} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{ ...TS.h3, width: 36, height: 36, borderRadius: 8, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{(business?.business_name || "B").charAt(0).toUpperCase()}</div>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
          {business?.phone && (
            <a href={`tel:${business.phone}`} style={{ ...TS.bodySm, fontSize: 12, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
              {business.phone}
            </a>
          )}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: 20, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{currentUser?.username?.charAt(0).toUpperCase()}</div>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.purple, whiteSpace: "nowrap" }}>{currentUser?.username || "User"}</span>
      </div>
      <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
      </button>
    </div>
  );
}

// ================= FORMS HOME — online + offline =================
export function FormsHome() {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [forms, setForms] = useState<any[]>([]);
  const [mySubs, setMySubs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    const on = () => { setIsOnline(true); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  useEffect(() => {
    (async () => {
      const tenantId = currentUser.tenantId;

      // 1. OFFLINE-FIRST: hydrate the cached list instantly
      try {
        const cached = JSON.parse(localStorage.getItem(`localForms_${tenantId}`) || "[]");
        if (Array.isArray(cached) && cached.length > 0) setForms(cached);
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
          supabase.from("forms").select("id, title, description, allow_download, updated_at")
            .eq("tenant_id", tenantId).eq("status", "published")
            .order("updated_at", { ascending: false })
        );
        if (fs) {
          setForms(fs as any[]);
          localStorage.setItem(`localForms_${tenantId}`, JSON.stringify(fs));
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

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <AppBar />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "40px 48px 64px", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h1 style={{ ...TS.h1, margin: "0 0 4px" }}>Forms</h1>
          {(!isOnline || pendingCount > 0) && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {!isOnline && <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "5px 12px", borderRadius: 8 }}>⏸ Offline — cached forms shown</span>}
              {pendingCount > 0 && <span style={{ ...TS.caption, color: C.medBlue, background: C.medBlueBg, padding: "5px 12px", borderRadius: 8 }}>⇅ {pendingCount} submission{pendingCount === 1 ? "" : "s"} waiting to sync</span>}
            </div>
          )}
        </div>
        <p style={{ ...TS.bodySm, margin: "0 0 24px" }}>Forms published by your administrator. Fill them anywhere — submissions made offline sync automatically.</p>

        {loading && <p style={{ ...TS.bodySm }}>Loading forms...</p>}

        {!loading && forms.length === 0 && (
          <div style={{ padding: "80px 40px", textAlign: "center" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Forms Available</h3>
            <p style={{ ...TS.bodySm, margin: 0 }}>{isOnline ? "There are no published forms right now." : "You're offline and there are no cached forms. Connect once to download them."}</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {forms.map((f) => {
            const filledAt = mySubs[f.id];
            return (
              <div key={f.id} onClick={() => navigate(`/forms/${f.id}`)} style={{ display: "flex", alignItems: "center", gap: 16, background: C.bg, borderRadius: 12, padding: "18px 24px", cursor: "pointer", border: `1px solid ${filledAt ? C.green + "33" : C.separator}` }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: filledAt ? C.greenBg : C.medBlueBg, color: filledAt ? C.green : C.medBlue, fontSize: 20 }}>📋</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 4, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ ...TS.caption, color: filledAt ? C.green : C.textTertiary, background: filledAt ? C.greenBg : C.card, border: filledAt ? "none" : `1px solid ${C.separator}`, padding: "3px 8px", borderRadius: 6 }}>{filledAt ? "✓ Filled" : "Not filled"}</span>
                    {f.allow_download && <span style={{ ...TS.caption, color: C.textTertiary, background: C.card, border: `1px solid ${C.separator}`, padding: "3px 8px", borderRadius: 6 }}>⬇ downloadable</span>}
                  </div>
                  <h3 style={{ ...TS.h3, margin: 0 }}>{f.title}</h3>
                  {f.description && <p style={{ ...TS.bodySm, margin: "4px 0 0", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{f.description}</p>}
                </div>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textTertiary} strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ================= FORM FILLER — online + offline =================
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
  const inputStyle: React.CSSProperties = { ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box" };

  if (loading) return <div style={{ minHeight: "100vh", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}><span style={{ ...TS.body, fontWeight: 500 }}>Loading form...</span></div>;

  if (!form) return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT }}>
      <AppBar onBack={() => navigate("/forms")} />
      <div style={{ padding: "80px 40px", textAlign: "center" }}>
        <h3 style={{ ...TS.h3, fontSize: 20, margin: "0 0 8px" }}>Form not found</h3>
        <p style={{ ...TS.bodySm, margin: 0 }}>This form may have been deleted, or it was never downloaded while online.</p>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <AppBar onBack={() => navigate("/forms")} />
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "40px 48px 64px", width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ ...TS.h1, margin: "0 0 6px" }}>{form.title}</h1>
          {!isOnline && <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "5px 12px", borderRadius: 8, marginBottom: 6 }}>⏸ Offline — answers save on this device</span>}
        </div>
        {form.description && <p style={{ ...TS.body, color: C.textSecondary, margin: "0 0 8px" }}>{form.description}</p>}
        {mySub?.submitted_at && <p style={{ ...TS.bodySm, margin: "0 0 8px" }}>You last submitted on {new Date(mySub.submitted_at).toLocaleString()}{mySub.offline ? " (offline — will sync)" : ""} — submitting again updates your answers.</p>}
        {form.status === "closed" && <p style={{ ...TS.bodySm, margin: "0 0 8px", color: C.orange, fontWeight: 600 }}>⚠ This form is closed. {isAdmin ? "You can still edit as admin." : ""}</p>}

        <div style={{ display: "flex", gap: 10, margin: "16px 0 28px", flexWrap: "wrap" }}>
          {form.allow_download ? (
            <>
              <button onClick={() => downloadHtmlFile(`${slug(form.title)}-blank.html`, buildFormHtml(form, fields, {}, false))} style={{ ...TS.input, padding: "10px 18px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>⬇ Blank Form</button>
              <button onClick={() => downloadHtmlFile(`${slug(form.title)}-filled.html`, buildFormHtml(form, fields, answers, true))} style={{ ...TS.input, padding: "10px 18px", background: C.greenBg, color: C.green, border: "none", borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>⬇ My Filled Form</button>
            </>
          ) : (
            <span style={{ ...TS.bodySm, fontSize: 13, color: C.textTertiary, fontStyle: "italic" }}>⬇ Downloads are disabled by the administrator.</span>
          )}
        </div>

        {locked ? (
          <div style={{ background: C.orangeBg, borderRadius: 12, padding: "24px 28px", color: "#B96A00", fontWeight: 600 }}>This form is not currently available ({form.status}).</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {fields.map((f) => {
                if (f.type === "header") return <h2 key={f.id} style={{ ...TS.h2, margin: "12px 0 0", color: C.purple }}>{f.label}</h2>;
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
                const qNumber = fields.slice(0, fields.indexOf(f)).filter((x) => ANSWERABLE.includes(x.type)).length + 1;
                const dispUnit = f.type === "range" ? (c.unit || "") : unitVal;

                return (
                  <div key={f.id} style={{ background: C.bg, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.separator}` }}>
                    <div style={{ marginBottom: 10 }}>
                      <span style={{ ...TS.caption, fontSize: 12, color: "#fff", background: C.medBlue, padding: "3px 10px", borderRadius: 8, marginRight: 8 }}>Q{qNumber}</span>
                      <span style={{ ...TS.h3 }}>{f.label || "(untitled)"}</span>
                      {f.required && <span style={{ color: C.red, fontWeight: 700 }}> *</span>}
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
                            <input type="radio" name={f.id} checked={val === o} onChange={() => setAnswer(f.id, o)} style={{ width: 18, height: 18, accentColor: C.medBlue }} />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : f.type === "checkbox" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {f.options.map((o) => (
                          <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15 }}>
                            <input type="checkbox" checked={Array.isArray(val) && val.includes(o)} onChange={(e) => toggleMulti(f.id, o, e.target.checked)} style={{ width: 18, height: 18, accentColor: C.green }} />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : f.type === "toggle" ? (
                      <div style={{ display: "flex", background: C.card, borderRadius: 10, padding: 4, gap: 4, maxWidth: 260 }}>
                        {(f.options.length === 2 ? f.options : ["F", "M"]).map((o) => (
                          <button key={o} type="button" onClick={() => setAnswer(f.id, o)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", background: val === o ? C.medBlue : "transparent", color: val === o ? "#fff" : C.textTertiary }}>{o}</button>
                        ))}
                      </div>
                    ) : f.type === "range" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <input type="range" min={c.min ?? 0} max={c.max ?? 100} step={c.step ?? 1} value={typeof numVal === "number" ? numVal : (c.min ?? 0)} onChange={(e) => setAnswer(f.id, Number(e.target.value))} style={{ flex: 1, accentColor: C.medBlue }} />
                        <span style={{ minWidth: 64, textAlign: "right", fontWeight: 700, fontSize: 15 }}>{typeof numVal === "number" ? numVal : (c.min ?? 0)}{dispUnit ? ` ${dispUnit}` : ""}</span>
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

            {formError && <div style={{ background: C.redBg, color: C.red, borderRadius: 10, padding: "12px 18px", fontWeight: 700, marginTop: 20 }}>⚠ {formError}</div>}
            {savedMsg && <div style={{ background: savedMsg.startsWith("✓ Saved offline") ? C.orangeBg : C.greenBg, color: savedMsg.startsWith("✓ Saved offline") ? "#B96A00" : C.green, borderRadius: 10, padding: "12px 18px", fontWeight: 700, marginTop: 20 }}>{savedMsg}</div>}

            <button onClick={handleSubmit} disabled={submitting} style={{ ...TS.input, width: "100%", padding: "16px 24px", background: submitting ? C.textTertiary : C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 17, cursor: submitting ? "wait" : "pointer", marginTop: 24 }}>
              {submitting ? "Saving..." : mySub ? "Update My Answers" : "Submit Form"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}