// src/trainer/AssignmentBuilder.tsx
import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { AssignmentFieldType } from "../types";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#0A84FF", medBlueBg: "#E8F2FF", medBlueSoft: "#F0F7FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EDFAF0",
  orange: "#FF9F0A", orangeBg: "#FFF8ED", purple: "#AF52DE", purpleBg: "#F8F0FF",
  shadow: "0 4px 24px rgba(0,0,0,0.06)", shadowHover: "0 8px 32px rgba(0,0,0,0.1)",
};

interface FormField {
  id: string; type: AssignmentFieldType | "note" | "header"; label: string;
  required: boolean; options: string[]; fileTypes: string[];
  blocksNext?: boolean; blockMessage?: string; sort_order?: number;
  maxChars?: number; points?: number; placeholder?: string;
  correctAnswer?: string; // ✅ Added for auto-grading
}

const FIELD_TYPES: Array<[string, string, string, string, string]> = [
  ["note", "📝", "Topic Note", C.orangeBg, C.orange],
  ["header", "📌", "Section Header", C.purpleBg, C.purple],
  ["text", "💬", "Short Text", C.medBlueBg, C.medBlue],
  ["paragraph", "📄", "Essay / Notes", C.medBlueSoft, C.medBlue],
  ["dropdown", "📋", "Single Choice", C.purpleBg, C.purple],
  ["checkbox", "☑️", "Multiple Choice", C.greenBg, C.green],
  ["toggle", "🔀", "Yes/No", C.orangeBg, C.orange],
  ["file", "📎", "Material Upload", C.redBg, C.red],
];

type ViewMode = "edit" | "preview";

export default function AssignmentBuilder() {
  const { courseId, assignmentId } = useParams<{ courseId: string; assignmentId: string }>();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [allowDownload, setAllowDownload] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("edit");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<"draft" | "published" | "closed">("draft");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [passmark, setPassmark] = useState(50); // ✅ Default 50%

  useEffect(() => {
    if (!assignmentId) { setLoadingData(false); return; }
    setIsEditing(true);
    const loadData = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        if (a) {
          setTitle(a.title || ""); setDescription(a.description || ""); setAllowDownload(a.allow_download || false);
          setDueDate(a.due_date ? a.due_date.slice(0, 16) : "");
          setStatus(a.status || "draft");
          setPassmark(a.passmark || 50); // ✅ Load passmark
        }
        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        setFields((f || []).map((field: Record<string, unknown>): FormField => ({
          id: field.id as string, type: (field.type as string) as AssignmentFieldType | "note" | "header",
          label: (field.label as string) || "", required: (field.required as boolean) || false,
          options: (field.options as string[]) || [], fileTypes: (field.file_types as string[]) || [],
          blocksNext: (field.blocks_next as boolean) || false, blockMessage: (field.block_message as string) || "",
          sort_order: (field.sort_order as number) ?? 0, maxChars: (field.max_chars as number) || undefined,
          points: (field.points as number) || undefined, placeholder: (field.placeholder as string) || "",
          correctAnswer: (field.correct_answer as string) || "", // ✅ Load correct answer
        })));
      } catch (err) { console.error("Failed to load:", err); }
      finally { setLoadingData(false); }
    };
    loadData();
  }, [assignmentId]);

  useEffect(() => {
    if (!assignmentId || !isEditing || viewMode === "preview") return;
    const interval = setInterval(() => { autoSaveDraft(); }, 30000);
    return () => clearInterval(interval);
  }, [assignmentId, isEditing, fields, title, description, dueDate, status, viewMode, passmark]);

  const autoSaveDraft = async () => {
    if (!assignmentId || !title.trim()) return;
    setAutoSaving(true);
    try {
      const { error } = await supabase.from("assignments").update({
        title: title.trim(), description: description.trim(), due_date: dueDate ? new Date(dueDate).toISOString() : null,
        status: "draft", passmark: passmark, updated_at: new Date().toISOString(),
      }).eq("id", assignmentId);

      if (error && (error.message.includes("JWT") || error.message.includes("401"))) {
        window.location.href = "/"; return;
      }
    } catch (e) { console.warn("Auto-save failed", e); } 
    finally { setAutoSaving(false); }
  };

  const reorderFields = useCallback((nf: FormField[]) => setFields(nf.map((f, i) => ({ ...f, sort_order: i }))), []);
  const addField = (type: AssignmentFieldType | "note" | "header") => setFields((p) => [...p, { id: crypto.randomUUID(), type, label: "", required: false, options: type === "dropdown" || type === "checkbox" ? ["Option 1", "Option 2"] : [], fileTypes: type === "file" ? ["image", "pdf"] : [], blocksNext: false, blockMessage: "", sort_order: p.length, maxChars: undefined, points: undefined, placeholder: "", correctAnswer: "" }]);
  const updateField = (id: string, key: keyof FormField, value: unknown) => setFields((p) => p.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  const removeField = (id: string) => setFields((p) => p.filter((f) => f.id !== id).map((f, i) => ({ ...f, sort_order: i })));
  const moveFieldUp = (i: number) => { if (i <= 0) return; const n = [...fields]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; reorderFields(n); };
  const moveFieldDown = (i: number) => { if (i >= fields.length - 1) return; const n = [...fields]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; reorderFields(n); };
  const addOption = (fid: string) => setFields((p) => p.map((f) => (f.id === fid ? { ...f, options: [...f.options, `Option ${f.options.length + 1}`] } : f)));
  const removeOption = (fid: string, oi: number) => setFields((p) => p.map((f) => { if (f.id !== fid) return f; const o = [...f.options]; const removed = o.splice(oi, 1)[0]; return { ...f, options: o, correctAnswer: f.correctAnswer === removed ? "" : f.correctAnswer }; }));
  const updateOption = (fid: string, oi: number, v: string) => setFields((p) => p.map((f) => { if (f.id !== fid) return f; const o = [...f.options]; const oldVal = o[oi]; o[oi] = v; return { ...f, options: o, correctAnswer: f.correctAnswer === oldVal ? v : f.correctAnswer }; }));
  const duplicateField = (i: number) => { const s = fields[i]; const n = [...fields]; n.splice(i + 1, 0, { ...s, id: crypto.randomUUID(), label: (s.label || "Untitled") + " (copy)", options: [...s.options], fileTypes: [...s.fileTypes], sort_order: fields.length }); reorderFields(n); };
  const clearAllFields = () => { if (fields.length > 0 && confirm("Remove all fields?")) setFields([]); };

  const totalPoints = fields.reduce((sum, f) => sum + (f.points || 0), 0);
  const questionFields = fields.filter((f) => f.type !== "note" && f.type !== "header");
  const noteFields = fields.filter((f) => f.type === "note" || f.type === "header");
  const blockedCount = noteFields.filter((f) => f.blocksNext).length;

  async function handleSave() {
    if (!courseId || !title.trim()) return alert("Please enter a module title.");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      let tid = assignmentId;
      const { data: aData, error: aErr } = await supabase.from("assignments").upsert({
        id: tid || crypto.randomUUID(), tenant_id: currentUser.tenantId, course_id: courseId, trainer_id: currentUser.id,
        title: title.trim(), description: description.trim(), allow_download: allowDownload,
        due_date: dueDate ? new Date(dueDate).toISOString() : null, status: status,
        passmark: passmark, // ✅ Save passmark
        created_at: isEditing ? undefined : now, updated_at: now,
      }, { onConflict: "id" }).select("id").single();
      if (aErr) throw aErr;
      tid = aData.id;
      if (isEditing) await supabase.from("assignment_fields").delete().eq("assignment_id", tid);
      if (fields.length > 0) {
        // ✅ FIX: Changed 'tIdx' back to 'i' to fix the TS error
        const { error: fErr } = await supabase.from("assignment_fields").upsert(fields.map((f, i) => ({
          id: f.id, tenant_id: currentUser.tenantId, assignment_id: tid, type: f.type, label: f.label || "",
          required: f.required, options: f.options.length > 0 ? f.options : null,
          file_types: f.fileTypes.length > 0 ? f.fileTypes : null, blocks_next: f.blocksNext || false,
          block_message: f.blockMessage || null, sort_order: i, max_chars: f.maxChars || null,
          points: f.points || null, placeholder: f.placeholder || null,
          correct_answer: f.correctAnswer || null, // ✅ Save correct answer
        })), { onConflict: "id" });
        if (fErr) throw fErr;
      }
      alert(`Module ${isEditing ? "updated" : "created"}!`);
      navigate(`/trainer/assignments/${courseId}`);
    } catch (e: unknown) { 
      const err = e as Error;
      if (err.message.includes("JWT") || err.message.includes("401")) window.location.href = "/";
      else alert("Failed: " + err.message); 
    } finally { setSaving(false); }
  }

  async function handleDelete() {
    if (!assignmentId) return;
    try {
      await supabase.from("assignment_fields").delete().eq("assignment_id", assignmentId);
      await supabase.from("assignment_submissions").delete().eq("assignment_id", assignmentId);
      await supabase.from("assignments").delete().eq("id", assignmentId);
      navigate(`/trainer/assignments/${courseId}`);
    } catch (e: unknown) { alert("Delete failed: " + (e as Error).message); }
  }

  const inputStyle: React.CSSProperties = { width: "100%", padding: "12px 16px", border: `1.5px solid ${C.separator}`, borderRadius: 12, fontSize: 15, outline: "none", fontFamily: "inherit", boxSizing: "border-box", transition: "border-color 0.2s, box-shadow 0.2s", background: C.card, color: C.textPrimary };
  const moveBtnStyle: React.CSSProperties = { background: C.card, border: `1px solid ${C.separator}`, borderRadius: 8, padding: "5px 7px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textTertiary, fontSize: 13, transition: "all 0.15s" };

  if (loadingData) return (
    <div style={{ padding: 40, textAlign: "center", color: C.textTertiary }}>
      <style>{`@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>
      <div style={{ width: 180, height: 12, borderRadius: 6, background: `linear-gradient(90deg,${C.separator} 25%,${C.separatorLight} 50%,${C.separator} 75%)`, backgroundSize: "200% 100%", animation: "shimmer 1.5s infinite", margin: "0 auto" }} />
    </div>
  );

  const statusColors: Record<string, { bg: string; color: string }> = {
    draft: { bg: C.bg, color: C.textTertiary }, published: { bg: C.greenBg, color: C.green }, closed: { bg: C.redBg, color: C.red },
  };

  return (
    <div style={{ padding: "24px", maxWidth: "780px", margin: "0 auto" }}>
      <style>{`
        @keyframes fadeSlideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .field-card { animation: fadeSlideIn 0.25s ease-out; }
        input:focus, textarea:focus { border-color: ${C.medBlue} !important; box-shadow: 0 0 0 3px ${C.medBlueBg} !important; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 24 }}>
        <button onClick={() => navigate(-1)} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: C.textPrimary }}>{isEditing ? "Edit Module" : "Create Module"}</h1>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
            <span style={{ fontSize: 12, color: C.textTertiary }}>{courseId && isEditing ? "Modify topics & questions" : "Build your module structure"}</span>
            {autoSaving && <span style={{ fontSize: 11, color: C.orange, fontWeight: 600 }}>Auto-saving...</span>}
          </div>
        </div>
        <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 3, gap: 2, flexShrink: 0 }}>
          {(["edit", "preview"] as const).map((mode) => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "7px 14px", border: "none", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.15s", background: viewMode === mode ? C.card : "transparent", color: viewMode === mode ? C.textPrimary : C.textTertiary, boxShadow: viewMode === mode ? "0 1px 4px rgba(0,0,0,0.08)" : "none", textTransform: "capitalize" }}>
              {mode === "edit" ? "✏️" : "👁️"} {mode}
            </button>
          ))}
        </div>
      </div>

      <div style={{ background: C.card, borderRadius: 20, padding: "24px 28px 20px", marginBottom: 16, boxShadow: C.shadow, border: `1px solid ${C.separatorLight}` }}>
        <input placeholder="Module Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...inputStyle, fontSize: 22, fontWeight: 700, border: "none", padding: "0 0 16px", marginBottom: 0, borderRadius: 0, borderBottom: `2px solid ${C.separator}`, boxShadow: "none !important" }} />
        <textarea placeholder="Description (optional)..." value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, border: "none", padding: "16px 0 0", resize: "none", color: C.textTertiary, boxShadow: "none !important", fontSize: 14, lineHeight: 1.5 }} />

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 18, paddingTop: 18, borderTop: `1px solid ${C.separatorLight}` }}>
          <div style={{ flex: "1 1 180px" }}>
            <label style={{ display: "block", fontSize: 11, color: C.textTertiary, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Due Date</label>
            <input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} style={{ ...inputStyle, padding: "10px 14px", fontSize: 13 }} />
          </div>
          <div style={{ flex: "1 1 120px" }}>
            <label style={{ display: "block", fontSize: 11, color: C.textTertiary, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Passmark (%)</label>
            <input type="number" min={0} max={100} value={passmark} onChange={(e) => setPassmark(parseInt(e.target.value) || 0)} style={{ ...inputStyle, padding: "10px 14px", fontSize: 13 }} />
          </div>
          <div style={{ flex: "1 1 140px" }}>
            <label style={{ display: "block", fontSize: 11, color: C.textTertiary, marginBottom: 6, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ ...inputStyle, padding: "10px 14px", fontSize: 13, cursor: "pointer", appearance: "none", backgroundImage: `url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%238E8E93' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center" }}>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end", paddingBottom: 2 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", color: C.textTertiary, userSelect: "none" }}>
              <div style={{ width: 40, height: 24, borderRadius: 12, background: allowDownload ? C.green : C.separator, transition: "background 0.2s", position: "relative", flexShrink: 0 }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: allowDownload ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 4px rgba(0,0,0,0.15)" }} />
              </div>
              <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} style={{ display: "none" }} />
              Allow DL
            </label>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        {questionFields.length > 0 && <span style={{ fontSize: 12, padding: "6px 14px", borderRadius: 20, background: C.medBlueBg, color: C.medBlue, fontWeight: 600 }}>{questionFields.length} Question{questionFields.length !== 1 ? "s" : ""}</span>}
        {totalPoints > 0 && <span style={{ fontSize: 12, padding: "6px 14px", borderRadius: 20, background: C.purpleBg, color: C.purple, fontWeight: 600 }}>⭐ {totalPoints} pts</span>}
        {blockedCount > 0 && <span style={{ fontSize: 12, padding: "6px 14px", borderRadius: 20, background: C.redBg, color: C.red, fontWeight: 600 }}>🔒 {blockedCount} Blocker{blockedCount !== 1 ? "s" : ""}</span>}
        {questionFields.length === 0 && noteFields.length > 0 && <span style={{ fontSize: 12, padding: "6px 14px", borderRadius: 20, background: C.purpleBg, color: C.purple, fontWeight: 600 }}>📝 Notes Only</span>}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {fields.length > 0 && <button onClick={clearAllFields} style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Clear All</button>}
          {isEditing && <button onClick={() => setShowDeleteConfirm(true)} style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>}
        </div>
      </div>

      {viewMode === "preview" && (
        <div style={{ background: C.card, borderRadius: 20, padding: "32px 28px", boxShadow: C.shadow, border: `1px solid ${C.separatorLight}`, marginBottom: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24, paddingBottom: 20, borderBottom: `1px solid ${C.separatorLight}` }}>
            <div>
              <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 700 }}>{title || "Untitled Module"}</h2>
              {description && <p style={{ margin: 0, color: C.textTertiary, fontSize: 14, lineHeight: 1.5 }}>{description}</p>}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, fontWeight: 600, ...statusColors[status] }}>{status.toUpperCase()}</span>
              {passmark > 0 && <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, background: C.orangeBg, color: C.orange, fontWeight: 600 }}>Target: {passmark}%</span>}
            </div>
          </div>
          {fields.length === 0 ? <p style={{ textAlign: "center", color: C.textTertiary, padding: "40px 0" }}>No fields added yet.</p> : fields.map((field, idx) => {
              if (field.type === "header") return <h3 key={field.id} style={{ margin: `${idx > 0 ? 24 : 0}px 0 12px`, fontSize: 18, fontWeight: 700, color: C.purple }}>{field.label || "Section Header"}</h3>;
              if (field.type === "note") return <div key={field.id} style={{ background: C.orangeBg, borderRadius: 12, padding: "14px 18px", marginBottom: 16, fontSize: 14, lineHeight: 1.6, borderLeft: `3px solid ${C.orange}` }}>{field.label || "Instruction note"}</div>;
              const qIdx = questionFields.indexOf(field) + 1;
              return (
                <div key={field.id} style={{ marginBottom: 24 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.textTertiary }}>Q{qIdx}.</span>
                    {field.required && <span style={{ fontSize: 10, color: C.red, fontWeight: 600 }}>*</span>}
                    {field.points && <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 6, background: C.purpleBg, color: C.purple, fontWeight: 600 }}>{field.points} pts</span>}
                  </div>
                  <p style={{ margin: "0 0 10px", fontSize: 15, fontWeight: 500 }}>{field.label || "Question text"}</p>
                  {field.type === "text" && <div style={{ padding: "12px 16px", background: C.bg, borderRadius: 10, border: `1.5px solid ${C.separator}`, color: C.textTertiary, fontSize: 14 }}>{field.placeholder || "Type your answer..."}</div>}
                  {field.type === "paragraph" && <div style={{ padding: "12px 16px", background: C.bg, borderRadius: 10, border: `1.5px solid ${C.separator}`, color: C.textTertiary, fontSize: 14, minHeight: 80 }}>{field.placeholder || "Type your answer..."}</div>}
                  {field.type === "dropdown" && <div style={{ padding: "12px 16px", background: C.bg, borderRadius: 10, border: `1.5px solid ${C.separator}`, color: C.textTertiary, fontSize: 14 }}>Select an option...</div>}
                  {(field.type === "dropdown" || field.type === "checkbox") && field.options.map((opt, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                      <div style={{ width: 18, height: 18, borderRadius: field.type === "checkbox" ? 5 : "50%", border: `2px solid ${C.separator}` }} />
                      <span style={{ fontSize: 14, fontWeight: field.correctAnswer === opt ? 700 : 400, color: field.correctAnswer === opt ? C.green : C.textPrimary }}>{opt} {field.correctAnswer === opt && "✓"}</span>
                    </div>
                  ))}
                </div>
              );
            })
          }
        </div>
      )}

      {viewMode === "edit" && (
        <>
          {fields.length === 0 && (
            <div style={{ background: C.card, borderRadius: 24, padding: "56px 40px", textAlign: "center", boxShadow: C.shadow, marginBottom: 20, border: `2px dashed ${C.separator}` }}>
              <div style={{ width: 76, height: 76, borderRadius: 22, background: `linear-gradient(135deg, ${C.medBlueBg}, ${C.purpleBg})`, margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              </div>
              <h3 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 600, color: C.textPrimary }}>Start Building</h3>
              <p style={{ color: C.textTertiary, fontSize: 13, margin: 0 }}>Add topics, materials, or questions below</p>
            </div>
          )}

          <div style={{ marginBottom: 20 }}>
            <p style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", fontWeight: 700, letterSpacing: "1px", margin: "0 0 10px" }}>Add Content</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
              {FIELD_TYPES.map(([type, icon, label, bg, color]) => (
                <button key={type} onClick={() => addField(type as AssignmentFieldType | "note" | "header")}
                  style={{ padding: "12px 6px", background: bg, color, border: "none", borderRadius: 14, fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, transition: "all 0.2s", minHeight: 64, boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(0,0,0,0.08)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)"; }}>
                  <span style={{ fontSize: 18 }}>{icon}</span><span>{label}</span>
                </button>
              ))}
            </div>
          </div>

          {fields.map((field, index) => {
            if (field.type === "header") {
              return (
                <div key={field.id} className="field-card" style={{ margin: "0 0 12px", padding: "18px 22px", background: `linear-gradient(135deg, ${C.purpleBg}, ${C.card})`, borderRadius: 16, borderLeft: `4px solid ${C.purple}`, boxShadow: C.shadow }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.purple, textTransform: "uppercase", letterSpacing: "0.8px" }}>📌 Section Header</span>
                    <div style={{ display: "flex", gap: 4 }}>{FieldActions(index, field.id)}</div>
                  </div>
                  <textarea placeholder="Section header..." value={field.label || ""} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ width: "100%", padding: "6px 0", border: "none", outline: "none", fontSize: 18, fontWeight: 700, color: C.purple, background: "transparent", resize: "vertical", fontFamily: "inherit", lineHeight: 1.4 }} />
                </div>
              );
            }
            if (field.type === "note") {
              const blocked = field.blocksNext === true;
              return (
                <div key={field.id} className="field-card" style={{ background: C.card, borderRadius: 16, overflow: "hidden", borderLeft: `4px solid ${C.orange}`, marginBottom: 12, boxShadow: C.shadow }}>
                  <div style={{ padding: "14px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.orange, textTransform: "uppercase", letterSpacing: "0.8px" }}>📝 Note / Essay</span>
                      {blocked && <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 10, background: C.redBg, color: C.red, fontWeight: 600 }}>🔒 Blocks</span>}
                    </div>
                    <div style={{ display: "flex", gap: 4 }}>{FieldActions(index, field.id)}</div>
                  </div>
                  <div style={{ padding: "0 18px 16px" }}>
                    <textarea placeholder="Instructions or essay text for learners..." value={field.label || ""} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ width: "100%", padding: "12px 14px", border: `1.5px solid ${C.separator}`, borderRadius: 12, outline: "none", fontSize: 14, background: `${C.orange}06`, boxSizing: "border-box", minHeight: 64, resize: "vertical", fontFamily: "inherit", lineHeight: 1.6, color: C.textSecondary }} />
                    <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, cursor: "pointer", color: C.textTertiary, marginTop: 10, userSelect: "none" }}>
                      <div style={{ width: 36, height: 20, borderRadius: 10, background: blocked ? C.red : C.separator, transition: "background 0.2s", position: "relative", flexShrink: 0 }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: blocked ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                      </div>
                      <input type="checkbox" checked={blocked} onChange={(e) => updateField(field.id, "blocksNext", e.target.checked)} style={{ display: "none" }} />
                      Block progression until acknowledged
                    </label>
                    {blocked && <input placeholder="Block message..." value={field.blockMessage || ""} onChange={(e) => updateField(field.id, "blockMessage", e.target.value)} style={{ ...inputStyle, marginTop: 8, fontSize: 12, background: C.redBg, border: `1.5px solid ${C.red}22`, color: C.red }} />}
                  </div>
                </div>
              );
            }
            const typeInfo: Record<string, [string, string, string]> = { text: ["💬", "Short Text", C.medBlueBg], paragraph: ["📄", "Essay / Notes", C.medBlueSoft], dropdown: ["📋", "Single Choice", C.purpleBg], checkbox: ["☑️", "Multiple Choice", C.greenBg], toggle: ["🔀", "Yes/No", C.orangeBg], file: ["📎", "Material Upload", C.redBg] };
            const [icon, label, bg] = typeInfo[field.type] || ["❓", field.type, C.bg];
            return (
              <div key={field.id} className="field-card" style={{ background: C.card, borderRadius: 16, padding: "20px 22px", marginBottom: 12, border: `1px solid ${C.separatorLight}`, boxShadow: C.shadow }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: C.textTertiary, background: C.bg, padding: "3px 10px", borderRadius: 8 }}>Q{questionFields.indexOf(field) + 1}</span>
                    <span style={{ fontSize: 11, color: C.medBlue, background: bg, padding: "3px 10px", borderRadius: 8, fontWeight: 600 }}>{icon} {label}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: C.purple, fontWeight: 600 }}>⭐</span>
                      <input type="number" min={0} max={100} value={field.points || ""} onChange={(e) => updateField(field.id, "points", parseInt(e.target.value) || undefined)} placeholder="pts" style={{ width: 52, padding: "4px 8px", border: `1px solid ${C.separator}`, borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none", fontFamily: "inherit" }} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textTertiary, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ width: 34, height: 20, borderRadius: 10, background: field.required ? C.red : C.separator, transition: "background 0.2s", position: "relative", flexShrink: 0 }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: field.required ? 16 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.15)" }} />
                      </div>
                      <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.id, "required", e.target.checked)} style={{ display: "none" }} />
                      Req
                    </label>
                    {FieldActions(index, field.id)}
                  </div>
                </div>
                <textarea placeholder="Write your question..." value={field.label} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ ...inputStyle, minHeight: 48, resize: "vertical", marginBottom: (field.type === "dropdown" || field.type === "checkbox" || field.type === "file") ? 12 : 0, fontSize: 15, lineHeight: 1.5 }} />
                {(field.type === "text" || field.type === "paragraph") && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: C.textTertiary }}>Max chars:</span>
                    <input type="number" min={0} value={field.maxChars || ""} onChange={(e) => updateField(field.id, "maxChars", parseInt(e.target.value) || undefined)} placeholder="None" style={{ width: 80, padding: "4px 8px", border: `1px solid ${C.separator}`, borderRadius: 6, fontSize: 12, outline: "none", fontFamily: "inherit" }} />
                  </div>
                )}
                {(field.type === "text" || field.type === "paragraph") && (
                  <input placeholder="Placeholder text (optional)" value={field.placeholder || ""} onChange={(e) => updateField(field.id, "placeholder", e.target.value)} style={{ ...inputStyle, marginTop: 8, fontSize: 12, padding: "8px 12px", color: C.textTertiary }} />
                )}
                {(field.type === "dropdown" || field.type === "checkbox") && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4 }}>
                    <p style={{ margin: "0 0 4px 0", fontSize: 11, color: C.textTertiary, fontWeight: 600 }}>Select the correct answer:</p>
                    {field.options.map((opt, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="radio" name={`correct-${field.id}`} checked={field.correctAnswer === opt} onChange={() => updateField(field.id, "correctAnswer", opt)} style={{ cursor: "pointer", accentColor: C.green }} />
                        <div style={{ width: 18, height: 18, borderRadius: field.type === "checkbox" ? 5 : "50%", border: `2px solid ${C.separator}`, flexShrink: 0, background: C.card }} />
                        <input style={{ flex: 1, ...inputStyle, padding: "8px 12px", fontSize: 13, border: `1.5px solid ${C.separatorLight}` }} value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} />
                        {field.options.length > 1 && <button onClick={() => removeOption(field.id, i)} style={{ background: C.redBg, border: "none", color: C.red, cursor: "pointer", width: 26, height: 26, borderRadius: 6, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7 }}>✕</button>}
                      </div>
                    ))}
                    <button onClick={() => addOption(field.id)} style={{ background: "none", border: `1.5px dashed ${C.separator}`, borderRadius: 10, padding: "8px", color: C.medBlue, cursor: "pointer", fontSize: 12, fontWeight: 600, transition: "all 0.15s" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.medBlue; (e.currentTarget as HTMLElement).style.background = C.medBlueBg; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.separator; (e.currentTarget as HTMLElement).style.background = "none"; }}>+ Add Option</button>
                  </div>
                )}
                {field.type === "file" && (
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {["image", "video", "audio", "pdf", "document"].map((ft) => (
                      <label key={ft} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, cursor: "pointer", padding: "6px 10px", background: field.fileTypes.includes(ft) ? C.medBlueBg : C.bg, borderRadius: 8, color: field.fileTypes.includes(ft) ? C.medBlue : C.textTertiary, border: `1.5px solid ${field.fileTypes.includes(ft) ? C.medBlue + "33" : C.separatorLight}`, fontWeight: 600, userSelect: "none" }}>
                        <input type="checkbox" checked={field.fileTypes.includes(ft)} onChange={() => updateField(field.id, "fileTypes", field.fileTypes.includes(ft) ? field.fileTypes.filter((t) => t !== ft) : [...field.fileTypes, ft])} style={{ display: "none" }} /> {ft.toUpperCase()}
                      </label>
                    ))}
                  </div>
                )}
                <div style={{ marginTop: 12, padding: "8px 12px", background: C.bg, borderRadius: 8, fontSize: 11, color: C.textTertiary, fontWeight: 500 }}>
                  {field.type === "text" && `Short text${field.maxChars ? ` • Max ${field.maxChars} chars` : ""}`}
                  {field.type === "paragraph" && `Multi-line${field.maxChars ? ` • Max ${field.maxChars} chars` : ""}`}
                  {field.type === "dropdown" && `${field.options.length} option${field.options.length !== 1 ? "s" : ""} • Single select`}
                  {field.type === "checkbox" && `${field.options.length} option${field.options.length !== 1 ? "s" : ""} • Multi select`}
                  {field.type === "toggle" && "Yes / No"}
                  {field.type === "file" && `Upload: ${field.fileTypes.join(", ") || "none"}`}
                  {field.points && ` • ${field.points} pts`}
                </div>
              </div>
            );
          })}
        </>
      )}

      <div style={{ position: "sticky", bottom: 0, background: "rgba(255,255,255,0.92)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", padding: "16px 0 8px", marginTop: 24, borderRadius: "20px 20px 0 0", boxShadow: "0 -4px 24px rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: `1px solid ${C.separatorLight}` }}>
        <div style={{ display: "flex", gap: 8 }}>
          <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, fontWeight: 600, ...statusColors[status] }}>{status.toUpperCase()}</span>
          {totalPoints > 0 && <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, background: C.purpleBg, color: C.purple, fontWeight: 600 }}>{totalPoints} pts</span>}
          {passmark > 0 && <span style={{ fontSize: 11, padding: "4px 12px", borderRadius: 8, background: C.orangeBg, color: C.orange, fontWeight: 600 }}>Passmark: {passmark}%</span>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => navigate(-1)} style={{ padding: "10px 20px", background: C.bg, color: C.textPrimary, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</button>
          <button onClick={handleSave} disabled={saving || !title.trim()} style={{ padding: "10px 28px", background: saving || !title.trim() ? C.textTertiary : `linear-gradient(135deg, ${C.medBlue}, #0055D4)`, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: saving || !title.trim() ? "default" : "pointer", fontSize: 14, boxShadow: saving || !title.trim() ? "none" : "0 4px 16px rgba(0,122,255,0.35)", transition: "all 0.2s" }}>{saving ? "Saving..." : isEditing ? "Save Changes" : "Publish Module"}</button>
        </div>
      </div>

      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 20, padding: 28, maxWidth: 400, width: "100%", boxShadow: "0 20px 50px rgba(0,0,0,0.2)", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: C.redBg, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🗑️</div>
            <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700 }}>Delete Module?</h3>
            <p style={{ margin: "0 0 24px", color: C.textTertiary, fontSize: 14, lineHeight: 1.5 }}>This will permanently delete the module, all topics, questions, and submissions. This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ flex: 1, padding: "12px", background: C.bg, color: C.textPrimary, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={handleDelete} style={{ flex: 1, padding: "12px", background: C.red, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  function FieldActions(index: number, fieldId: string) {
    return (
      <>
        <button onClick={() => moveFieldUp(index)} disabled={index === 0} style={{ ...moveBtnStyle, opacity: index === 0 ? 0.3 : 1 }}>↑</button>
        <button onClick={() => moveFieldDown(index)} disabled={index === fields.length - 1} style={{ ...moveBtnStyle, opacity: index === fields.length - 1 ? 0.3 : 1 }}>↓</button>
        <button onClick={() => duplicateField(index)} style={moveBtnStyle} title="Duplicate">📋</button>
        <button onClick={() => removeField(fieldId)} style={{ ...moveBtnStyle, color: C.red, borderColor: C.red + "22", background: C.redBg }}>✕</button>
      </>
    );
  }
}