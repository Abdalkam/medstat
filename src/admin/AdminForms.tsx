// src/admin/AdminForms.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { db as localDb } from "../database/db";
import { cacheForms, flushPendingFormOps, deleteFormOnlineFirst } from "../database/formDB";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF", medBlueSoft: "#F0F7FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const TS = {
  h1: { fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, fontFamily: FONT, color: C.textPrimary },
};

interface FormRow {
  id: string;
  title: string;
  description: string | null;
  status: "draft" | "published" | "closed";
  updated_at: string;
  visible_to?: string[] | null;
  submission_count?: number;
}

const STATUS_META: Record<FormRow["status"], { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: C.orangeBg, fg: C.orange },
  published: { label: "Published", bg: C.greenBg, fg: C.green },
  closed: { label: "Closed", bg: C.redBg, fg: C.red },
};

const AUDIENCE_META = {
  everyone: { label: "Everyone", bg: C.medBlueBg, fg: C.medBlue },
  trainers: { label: "Trainers", bg: C.orangeBg, fg: C.orange },
  trainees: { label: "Trainees", bg: C.greenBg, fg: C.green },
} as const;

const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

export default function AdminForms() {
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  // OFFLINE-FIRST list:
  //   1. Instant render from Dexie cache
  //   2. Online: flush queued writes → fetch from Supabase → re-cache
  async function loadForms() {
    if (!currentUser?.tenantId) { setLoading(false); return; }

    // STEP 1: local cache render (offline-safe)
    try {
      const cached = await localDb.formCache.toArray();
      if (cached.length > 0) {
        setForms(cached.map((f: any) => ({ ...f, submission_count: f.submission_count ?? 0 })));
        setLoading(false);
      }
    } catch { /* cache unavailable */ }

    if (!navigator.onLine) { setLoading(false); return; }

    // STEP 2: online refresh + silent sync
    setLoading(true);
    try {
      await flushPendingFormOps();

      const { data, error } = await supabase
        .from("forms")
        .select("id, title, description, status, updated_at, visible_to")
        .eq("tenant_id", currentUser.tenantId)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      let counts: Record<string, number> = {};
      try {
        const { data: subs } = await supabase.from("form_submissions").select("form_id").eq("tenant_id", currentUser.tenantId);
        counts = (subs || []).reduce((acc: Record<string, number>, s: any) => { acc[s.form_id] = (acc[s.form_id] || 0) + 1; return acc; }, {});
      } catch {}

      setForms((data || []).map((f: any) => ({ ...f, submission_count: counts[f.id] || 0 })));
      await cacheForms(currentUser.tenantId);
    } catch (e) {
      console.error("Failed to load forms:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadForms(); }, [currentUser?.tenantId]);

  // SILENT SYNC — refresh whenever the device comes back online
  useEffect(() => {
    const onOnline = () => loadForms();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  async function handleDelete(id: string) {
    setDeletingId(id);
    try {
      // Local cache delete always; cloud delete attempted or queued silently
      await deleteFormOnlineFirst(id);
    } catch (e) {
      console.error("Delete failed:", e);
    }
    setForms((p) => p.filter((x) => x.id !== id));
    setConfirmId(null);
    setDeletingId(null);
  }

  const filtered = forms.filter((f) =>
    (f.title || "").toLowerCase().includes(search.toLowerCase().trim())
  );
  const totalResponses = forms.reduce((sum, f) => sum + (f.submission_count ?? 0), 0);

  const statusChip = (s: FormRow["status"]) => {
    const m = STATUS_META[s] || STATUS_META.draft;
    return <span style={{ ...TS.caption, fontSize: 10, background: m.bg, color: m.fg, padding: "4px 10px", borderRadius: 20 }}>{m.label}</span>;
  };

  const audienceChip = (vt?: string[] | null) => {
    const arr = Array.isArray(vt) ? vt : [];
    const key = arr.length === 0 || (arr.includes("trainer") && arr.includes("trainee")) ? "everyone"
      : arr.includes("trainer") ? "trainers" : "trainees";
    const m = AUDIENCE_META[key];
    return <span title="Who can see this form" style={{ ...TS.caption, fontSize: 10, background: m.bg, color: m.fg, padding: "4px 10px", borderRadius: 20 }}>👁 {m.label}</span>;
  };

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 72px`, boxSizing: "border-box" }}>

        {/* PAGE HEADER — back · title · counts */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", marginBottom: 18, minWidth: 0 }}>
          <button
            onClick={() => navigate("/admin")}
            title="Back to Dashboard"
            style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ ...TS.h1, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Forms</h1>
            <p style={{ ...TS.bodySm, margin: "2px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {loading
                ? "Loading…"
                : `${forms.length} form${forms.length === 1 ? "" : "s"} · ${totalResponses} response${totalResponses === 1 ? "" : "s"}`}
            </p>
          </div>
        </div>

        {/* CONTROLS — search LEFT · "New form" RIGHT */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20, width: "100%", flexWrap: "wrap" }}>

          {/* SEARCH */}
          <div style={{ position: "relative", flex: "1 1 240px", maxWidth: 480, minWidth: 0 }}>
            <svg
              width="16" height="16" viewBox="0 0 24 24" fill="none"
              stroke={C.textTertiary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }}
            >
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search forms…"
              style={{ ...TS.input, width: "100%", padding: "10px 36px 10px 38px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.card, boxSizing: "border-box" }}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                title="Clear search"
                style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: C.textTertiary, cursor: "pointer", fontSize: 14, padding: 4, lineHeight: 1 }}
              >✕</button>
            )}
          </div>

          {/* Spacer */}
          <div style={{ flex: 1, minWidth: 0 }} />

          {/* NEW FORM */}
          <button
            onClick={() => navigate("/admin/forms/new")}
            title="Create a new form"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, cursor: "pointer", padding: "11px 20px", fontSize: 14, fontWeight: 700, fontFamily: FONT, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,122,255,0.25)" }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New form
          </button>
        </div>

        {/* FORM CARDS */}
        {loading ? (
          <div style={{ padding: "60px 0", textAlign: "center" }}>
            <span style={{ ...TS.body, fontWeight: 500 }}>Loading forms...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: "60px 24px", textAlign: "center", border: `2px dashed ${C.separator}`, borderRadius: 14, background: C.card }}>
            <p style={{ ...TS.body, margin: "0 0 6px", fontWeight: 600 }}>{search ? "No forms match your search." : "No forms yet."}</p>
            <p style={{ ...TS.bodySm, margin: 0 }}>{search ? "Try a different keyword." : "Press “New form” to build your first form."}</p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(360px, 100%), 1fr))", gap: 16, width: "100%", boxSizing: "border-box" }}>
            {filtered.map((form) => (
              <div
                key={form.id}
                style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.separator}`, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", transition: "border-color 0.15s, box-shadow 0.15s", boxSizing: "border-box", minWidth: 0 }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.medBlue + "55"; e.currentTarget.style.boxShadow = "0 4px 18px rgba(0,122,255,0.10)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.separator; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.04)"; }}
              >
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minWidth: 0 }}>
                  <div style={{ ...TS.h3, fontSize: 16, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
                    {form.title || "Untitled form"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {audienceChip(form.visible_to)}
                    {statusChip(form.status)}
                  </div>
                </div>

                {form.description && (
                  <div style={{ ...TS.bodySm, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as any, overflow: "hidden" }}>
                    {form.description}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: "auto", paddingTop: 6, borderTop: `1px solid ${C.separatorLight}`, flexWrap: "wrap" }}>
                  <span style={{ ...TS.bodySm, fontSize: 12, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {form.submission_count ?? 0} response{(form.submission_count ?? 0) === 1 ? "" : "s"} · {new Date(form.updated_at).toLocaleDateString()}
                  </span>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
                    <button
                      onClick={() => navigate(`/admin/forms/${form.id}/edit`)}
                      title="Edit this form"
                      style={{ background: C.medBlueSoft, color: C.medBlue, border: `1px solid ${C.medBlue}22`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
                    >Edit</button>
                    <button
                      onClick={() => navigate(`/admin/forms/${form.id}/responses`)}
                      title="View responses"
                      style={{ background: C.bg, color: C.textSecondary, border: `1px solid ${C.separator}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
                    >Responses</button>
                    <button
                      onClick={() => setConfirmId(form.id)}
                      title="Delete this form"
                      style={{ background: C.redBg, color: C.red, border: `1px solid ${C.red}22`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: FONT }}
                    >Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DELETE CONFIRM MODAL */}
      {confirmId && (
        <div onClick={() => setConfirmId(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 110, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, width: "100%", maxWidth: 420, padding: 24, boxSizing: "border-box" }}>
            <div style={TS.h3}>Delete this form?</div>
            <p style={{ ...TS.bodySm, margin: "10px 0 18px" }}>This permanently removes the form, its fields and all submissions. This action cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirmId(null)} style={{ ...TS.input, padding: "9px 16px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={() => handleDelete(confirmId)} disabled={deletingId === confirmId} style={{ ...TS.input, padding: "9px 16px", background: C.red, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 13 }}>{deletingId === confirmId ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}