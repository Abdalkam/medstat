// src/admin/AdminFormSubmissions.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

// Hardened fetch: never let a hung Supabase request spin the page forever.
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
  h3: { fontSize: 17, fontWeight: 600, lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontFamily: FONT, color: C.textPrimary },
};

interface FieldConfig { min?: number; max?: number; step?: number; unit?: string; unitOptions?: string[]; labelColor?: string; sectionColor?: string; }
interface FormField { id: string; type: string; label: string; options?: string[] | null; config?: FieldConfig | null; }
interface Submission { id: string; user_id: string; username: string; role: string | null; answers: Record<string, any>; submitted_at: string | null; }

// Flattens any answer shape to a human string:
//   arrays          -> "Penicillin, Dust"
//   {v,u} objects  -> "170 cm" (number-with-units)
//   booleans        -> toggle's left/right label ("F" / "M")
function flattenAnswer(f: FormField, a: any): string {
  if (a === undefined || a === null || a === "") return "";
  if (Array.isArray(a)) return a.join(", ");
  if (typeof a === "object") {
    if ("v" in (a as any)) {
      return [ (a as any).v, (a as any).u ].filter((x) => x !== undefined && x !== null && x !== "").join(" ");
    }
    return JSON.stringify(a);
  }
  if (typeof a === "boolean") return a ? (f.options?.[0] ?? "Yes") : (f.options?.[1] ?? "No");
  return String(a);
}

function answerText(f: FormField, a: any): string {
  const s = flattenAnswer(f, a);
  return s === "" ? "(no answer)" : s;
}

function csvEscape(v: any): string {
  const s = Array.isArray(v) ? v.join(" | ") : (v ?? "");
  const t = String(s);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export default function AdminFormSubmissions() {
  const { formId } = useParams();
  const navigate = useNavigate();

  const [form, setForm] = useState<any>(null);
  const [questions, setQuestions] = useState<FormField[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [allowDownload, setAllowDownload] = useState(true);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // OFFLINE-FIRST load:
  //   1. Hydrate form meta + submissions from the last online visit (localStorage)
  //   2. Online: refresh from Supabase and re-cache
  useEffect(() => {
    if (!formId) { setLoading(false); return; }
    const SUBS_KEY = `cachedFormSubs_${formId}`;
    const META_KEY = `cachedFormMeta_${formId}`;

    // STEP 1: cached render (offline-safe)
    try {
      const cachedSubs = JSON.parse(localStorage.getItem(SUBS_KEY) || "[]");
      const cachedForm = JSON.parse(localStorage.getItem(META_KEY) || "null");
      if (cachedForm) {
        setForm(cachedForm);
        setAllowDownload(cachedForm.allow_download ?? true);
      }
      if (Array.isArray(cachedSubs) && cachedSubs.length > 0) {
        setSubmissions(cachedSubs);
        setLoading(false);
      }
    } catch { /* corrupt cache — ignore */ }

    if (!navigator.onLine) { setLoading(false); return; }

    // STEP 2: online refresh + re-cache
    (async () => {
      try {
        const { data: f } = await withTimeout(supabase.from("forms").select("*").eq("id", formId).maybeSingle());
        if (f) { setForm(f); setAllowDownload(f.allow_download ?? true); localStorage.setItem(META_KEY, JSON.stringify(f)); }
        // options + config included so unit/toggle answers render correctly
        const { data: ff } = await withTimeout(
          supabase.from("form_fields").select("id, type, label, options, config").eq("form_id", formId).order("sort_order", { ascending: true })
        );
        setQuestions((ff || []) as FormField[]);
        const { data: subs } = await withTimeout(
          supabase.from("form_submissions").select("*").eq("form_id", formId).order("submitted_at", { ascending: false })
        );
        const mapped = (subs || []).map((s: any) => ({ id: s.id, user_id: s.user_id, username: s.username || "Unknown", role: s.role, answers: s.answers || {}, submitted_at: s.submitted_at }));
        setSubmissions(mapped);
        localStorage.setItem(SUBS_KEY, JSON.stringify(mapped));
        setLoadError(null);
      } catch (e: any) {
        console.warn("Responses offline or timed out:", e);
        setLoadError(e?.message === "supabase-timeout"
          ? "Couldn't reach the server — showing cached responses."
          : "Couldn't load the latest responses. Showing cached data.");
      }
      finally { setLoading(false); }
    })();
  }, [formId]);

  // Admin can flip the download gate right from this page (online only)
  async function toggleAllowDownload() {
    if (!navigator.onLine) {
      setLoadError("Toggling downloads requires a connection. Try again when online.");
      return;
    }
    const next = !allowDownload;
    setAllowDownload(next);
    const { error } = await supabase.from("forms").update({ allow_download: next, updated_at: new Date().toISOString() }).eq("id", formId);
    if (error) { setAllowDownload(!next); setLoadError("Could not update downloads: " + error.message); }
    else {
      try { localStorage.setItem(`cachedFormMeta_${formId}`, JSON.stringify({ ...form, allow_download: next })); } catch {}
    }
  }

  // Admin CSV export — works from cached data too; always allowed regardless of allow_download.
  function downloadCsv() {
    const header = ["User", "Role", "Submitted At", ...questions.map((q) => q.label || "Untitled")];
    const lines = [header.map(csvEscape).join(",")];
    submissions.forEach((s) => {
      const cells: any[] = [s.username, s.role || "", s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "(not submitted)"];
      questions.forEach((q) => { cells.push(flattenAnswer(q, s.answers[q.id])); });
      lines.push(cells.map(csvEscape).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(form?.title || "form").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-responses.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (loading) return <div style={{ minHeight: "100%", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}><span style={{ ...TS.body, fontWeight: 500 }}>Loading responses...</span></div>;

  const selectedSub = submissions.find((s) => s.id === selectedSubId);

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      {/* ===== STICKY TOOLBAR — back · title (identity bar comes from AdminLayout) ===== */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: C.bg, width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px" }}>
          <button onClick={() => (selectedSubId ? setSelectedSubId(null) : navigate("/admin/forms"))} title="Back" style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selectedSubId ? (selectedSub?.username || "Response detail") : (form?.title || "Responses")}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 48px 64px", width: "100%", boxSizing: "border-box" }}>
        <p style={{ ...TS.bodySm, margin: "0 0 20px" }}>{submissions.length} response{submissions.length === 1 ? "" : "s"} from trainers and trainees</p>

        {loadError && (
          <div style={{ background: C.redBg, color: C.red, borderRadius: 12, padding: "18px 24px", marginBottom: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{loadError}</span>
            <button onClick={() => window.location.reload()} style={{ ...TS.input, padding: "8px 18px", background: C.card, color: C.textPrimary, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>Retry</button>
          </div>
        )}

        {/* Admin controls: download gate + CSV export */}
        <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap", alignItems: "center" }}>
          <div onClick={toggleAllowDownload} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", padding: "10px 14px", background: allowDownload ? C.greenBg : C.redBg, border: `1px solid ${allowDownload ? C.green + "44" : C.red + "33"}`, borderRadius: 10 }}>
            <div style={{ width: 34, height: 20, borderRadius: 10, background: allowDownload ? C.green : C.red, position: "relative", flexShrink: 0 }}>
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: allowDownload ? 16 : 2, transition: "left 0.2s" }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 700, color: allowDownload ? C.green : C.red }}>⬇ User downloads {allowDownload ? "allowed" : "blocked"}</span>
          </div>
          <button onClick={downloadCsv} style={{ ...TS.input, padding: "10px 20px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, fontSize: 14, cursor: "pointer" }}>⬇ Export CSV</button>
        </div>

        {selectedSub ? (
          /* ===== DETAIL VIEW ===== */
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <div style={{ ...TS.h3, width: 48, height: 48, borderRadius: "50%", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{selectedSub.username?.charAt(0).toUpperCase()}</div>
              <div>
                <div style={{ ...TS.h3, fontSize: 18 }}>{selectedSub.username}</div>
                <div style={{ ...TS.bodySm, marginTop: 2 }}>
                  <span style={{ ...TS.caption, color: selectedSub.role === "trainer" ? C.purple : C.medBlue, background: selectedSub.role === "trainer" ? C.purpleBg : C.medBlueBg, padding: "2px 8px", borderRadius: 6, marginRight: 8 }}>{selectedSub.role || "user"}</span>
                  {selectedSub.submitted_at ? `Submitted ${new Date(selectedSub.submitted_at).toLocaleString()}` : "Not submitted"}
                </div>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {questions.map((q, i) => (
                <div key={q.id} style={{ background: C.card, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.separator}` }}>
                  <span style={{ ...TS.caption, fontSize: 12, color: "#fff", background: C.medBlue, padding: "3px 10px", borderRadius: 8 }}>{q.type === "header" || q.type === "note" ? "—" : `Q${i + 1}`}</span>
                  <h3 style={{ ...TS.h3, margin: "10px 0 10px", color: q.config?.labelColor || C.textPrimary }}>{q.label || "(untitled)"}</h3>
                  <div style={{ background: C.bg, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.separator}` }}>
                    <div style={{ ...TS.caption, fontSize: 10, marginBottom: 4 }}>Answer:</div>
                    {/* answer flattened via field config/options (units, toggles, arrays) */}
                    <div style={{ ...TS.body, fontSize: 15, whiteSpace: "pre-wrap" }}>{answerText(q, selectedSub.answers[q.id])}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          /* ===== LIST ===== */
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {submissions.length === 0 && (
              <div style={{ padding: "80px 40px", textAlign: "center" }}>
                <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Responses Yet</h3>
                <p style={{ ...TS.bodySm, margin: 0 }}>Once users fill this form, their responses appear here.</p>
              </div>
            )}
            {submissions.map((s) => (
              <div key={s.id} onClick={() => setSelectedSubId(s.id)} style={{ display: "flex", alignItems: "center", gap: 16, background: C.card, borderRadius: 12, padding: "16px 24px", cursor: "pointer", border: `1px solid ${C.separator}` }}>
                <div style={{ width: 44, height: 44, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: s.role === "trainer" ? C.purpleBg : C.medBlueBg, color: s.role === "trainer" ? C.purple : C.medBlue, fontSize: 16, fontWeight: 700 }}>
                  {s.username?.charAt(0).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h3 style={{ ...TS.h3, margin: 0, fontSize: 15 }}>{s.username}</h3>
                  <p style={{ ...TS.bodySm, margin: "2px 0 0" }}>{s.submitted_at ? new Date(s.submitted_at).toLocaleString() : "Not submitted"}</p>
                </div>
                <span style={{ ...TS.caption, color: s.role === "trainer" ? C.purple : C.medBlue, background: s.role === "trainer" ? C.purpleBg : C.medBlueBg, padding: "3px 8px", borderRadius: 6 }}>{s.role || "user"}</span>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textTertiary} strokeWidth="2" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}