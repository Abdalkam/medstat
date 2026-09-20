// src/trainer/AssignmentBuilder.tsx
import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { AssignmentFieldType } from "../types";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  sidebarBg: "#F8F8FA",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF", medBlueSoft: "#F0F7FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE", purpleBg: "#F5F0FF",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

const TS = {
  h1: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h2: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  label: { fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em", lineHeight: 1.4, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, fontFamily: FONT, color: C.textPrimary },
};

interface FormField {
  id: string; type: AssignmentFieldType | "note" | "header" | "file"; label: string;
  required: boolean; options: string[]; fileTypes: string[];
  blocksNext?: boolean; blockMessage?: string; sort_order?: number;
  maxChars?: number; points?: number; placeholder?: string;
  correctAnswer?: string; page_id?: string; file_url?: string;
}
interface SlidePage { id: string; title: string; }
interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

export default function AssignmentBuilder() {
  const { courseId, assignmentId } = useParams<{ courseId: string; assignmentId: string }>();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [pages, setPages] = useState<SlidePage[]>([{ id: "page-1", title: "Slide 1" }]);
  const [activePageId, setActivePageId] = useState("page-1");
  const [saving, setSaving] = useState(false);
  const [loadingData, setLoadingData] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [status, setStatus] = useState<"draft" | "published" | "closed">("draft");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [uploadingFieldId, setUploadingFieldId] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);

  function handleLogout() {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("adminDeviceId");
    localStorage.removeItem("activeAttendanceCourseId");
    window.dispatchEvent(new Event("authStateChanged"));
    navigate("/");
  }

  useEffect(() => {
    if (!currentUser?.tenantId) return;
    let cancelled = false;
    const fetchBusiness = async () => {
      try {
        const { data } = await supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) setBusiness(data as BusinessData);
      } catch (err: unknown) { console.error("Business fetch failed:", err); }
    };
    fetchBusiness();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (!assignmentId) { setLoadingData(false); return; }
    setIsEditing(true);
    const loadData = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        if (a) { setTitle(a.title || ""); setDescription(a.description || ""); setStatus(a.status || "draft"); }
        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        const loadedFields = (f || []).map((field: Record<string, unknown>): FormField => ({
          id: field.id as string, type: (field.type as string) as AssignmentFieldType | "note" | "header" | "file",
          label: (field.label as string) || "", required: (field.required as boolean) || false,
          options: (field.options as string[]) || [], fileTypes: (field.file_types as string[]) || [],
          sort_order: (field.sort_order as number) ?? 0, maxChars: (field.max_chars as number) || undefined,
          points: (field.points as number) || undefined, placeholder: (field.placeholder as string) || "",
          correctAnswer: (field.correct_answer as string) || "", page_id: (field.page_id as string) || "page-1",
          file_url: (field.file_url as string) || undefined
        }));
        setFields(loadedFields);
        const uniquePages = Array.from(new Set(loadedFields.map(f => f.page_id).filter(Boolean))) as string[];
        if (uniquePages.length > 0) { setPages(uniquePages.map((id, i) => ({ id, title: `Slide ${i+1}`}))); setActivePageId(uniquePages[0]); }
      } catch (err) { console.error("Failed to load:", err); } finally { setLoadingData(false); }
    };
    loadData();
  }, [assignmentId]);

  const addPage = () => {
    const newId = `page-${Date.now()}`;
    setPages(prev => [...prev, { id: newId, title: `Slide ${prev.length + 1}` }]);
    setActivePageId(newId);
  };
  const deletePage = (pageId: string) => {
    if (pages.length === 1) return alert("You must have at least one slide.");
    setPages(prev => prev.filter(p => p.id !== pageId));
    setFields(prev => prev.filter(f => f.page_id !== pageId));
    if (activePageId === pageId) setActivePageId(pages[0].id);
  };
  const addField = (type: AssignmentFieldType | "note" | "header" | "file") =>
    setFields((p) => [...p, { id: crypto.randomUUID(), type, label: "", required: false, options: type === "dropdown" || type === "checkbox" ? ["Option 1", "Option 2"] : [], fileTypes: [], sort_order: p.length, points: undefined, correctAnswer: "", page_id: activePageId }]);
  const updateField = (id: string, key: keyof FormField, value: any) => setFields((p) => p.map((f) => (f.id === id ? { ...f, [key]: value } : f)));
  const removeField = (id: string) => setFields((p) => p.filter((f) => f.id !== id).map((f, i) => ({ ...f, sort_order: i })));
  const moveField = (i: number, dir: "up" | "down") => {
    const pageFields = fields.filter(f => f.page_id === activePageId);
    const globalIndex = fields.findIndex(f => f.id === pageFields[i].id);
    const swapIndex = dir === "up" ? globalIndex - 1 : globalIndex + 1;
    if (swapIndex < 0 || swapIndex >= fields.length) return;
    const n = [...fields];
    [n[globalIndex], n[swapIndex]] = [n[swapIndex], n[globalIndex]];
    setFields(n.map((f, idx) => ({ ...f, sort_order: idx })));
  };
  const addOption = (fid: string) => setFields((p) => p.map((f) => (f.id === fid ? { ...f, options: [...f.options, `Option ${f.options.length + 1}`] } : f)));
  const removeOption = (fid: string, oi: number) => setFields((p) => p.map((f) => { if (f.id !== fid) return f; const o = [...f.options]; o.splice(oi, 1); return { ...f, options: o }; }));
  const updateOption = (fid: string, oi: number, v: string) => setFields((p) => p.map((f) => { if (f.id !== fid) return f; const o = [...f.options]; o[oi] = v; return { ...f, options: o }; }));

  const handleFileUpload = async (fieldId: string, file: File) => {
    setUploadingFieldId(fieldId);
    const fileName = `${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from('slide-materials').upload(fileName, file);
    if (error) { alert("Upload failed: " + error.message); }
    else {
      const { data: publicUrlData } = supabase.storage.from('slide-materials').getPublicUrl(fileName);
      updateField(fieldId, "file_url", publicUrlData.publicUrl);
      updateField(fieldId, "label", file.name);
    }
    setUploadingFieldId(null);
  };

  async function handleSave() {
    if (!courseId || !title.trim()) return alert("Please enter a module title.");
    setSaving(true);
    try {
      const now = new Date().toISOString();
      let tid = assignmentId;
      const { data: aData, error: aErr } = await supabase.from("assignments").upsert({
        id: tid || crypto.randomUUID(), tenant_id: currentUser.tenantId, course_id: courseId, trainer_id: currentUser.id,
        title: title.trim(), description: description.trim(), status: status,
        created_at: isEditing ? undefined : now, updated_at: now,
      }, { onConflict: "id" }).select("id").single();
      if (aErr) throw aErr;
      tid = aData.id;
      if (isEditing) await supabase.from("assignment_fields").delete().eq("assignment_id", tid);
      if (fields.length > 0) {
        const { error: fErr } = await supabase.from("assignment_fields").upsert(fields.map((f, i) => ({
          id: f.id, tenant_id: currentUser.tenantId, assignment_id: tid, type: f.type, label: f.label || "",
          required: f.required, options: f.options.length > 0 ? f.options : null,
          file_types: f.fileTypes.length > 0 ? f.fileTypes : null, sort_order: i, max_chars: f.maxChars || null,
          points: f.points || null, placeholder: f.placeholder || null, correct_answer: f.correctAnswer || null,
          page_id: f.page_id || pages[0].id, file_url: f.file_url || null,
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

  const inputStyle: React.CSSProperties = { ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box" };
  const moveBtnStyle: React.CSSProperties = { background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 8, padding: "5px 7px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textTertiary, fontSize: 13 };

  if (loadingData) return <div style={{ minHeight: "100vh", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}><span style={{ ...TS.body, fontWeight: 500 }}>Loading slides...</span></div>;

  const activeFields = fields.filter(f => f.page_id === activePageId);
  const questionFields = activeFields.filter((f) => f.type !== "note" && f.type !== "header" && f.type !== "file");

  return (
    <div style={{ display: "flex", height: "100vh", background: C.card, overflow: "hidden", fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      <style>{`@keyframes fadeSlideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } .field-card { animation: fadeSlideIn 0.25s ease-out; } input:focus, textarea:focus { border-color: ${C.medBlue} !important; box-shadow: 0 0 0 3px ${C.medBlueBg} !important; }`}</style>

      {/* SIDEBAR */}
      <div style={{ width: 240, background: C.sidebarBg, borderRight: `1px solid ${C.separator}`, display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px", borderBottom: `1px solid ${C.separator}`, display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => navigate("/trainer")} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 8, color: C.medBlue, cursor: "pointer", width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <h2 style={{ ...TS.h2, fontSize: 16, fontWeight: 700 }}>Slides</h2>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 8px" }}>
          {pages.map((page, index) => (
            <div key={page.id} onClick={() => setActivePageId(page.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", marginBottom: 6, borderRadius: 10, cursor: "pointer", background: activePageId === page.id ? C.medBlueBg : "transparent", border: activePageId === page.id ? `1px solid ${C.medBlue}33` : `1px solid transparent` }}>
              <span style={{ ...TS.caption, fontSize: 12, color: activePageId === page.id ? C.medBlue : C.textTertiary }}>{index + 1}</span>
              <span style={{ ...TS.label, fontSize: 14, fontWeight: 600, color: activePageId === page.id ? C.medBlue : C.textSecondary, flex: 1 }}>Slide {index + 1}</span>
              {pages.length > 1 && (<button onClick={(e) => { e.stopPropagation(); deletePage(page.id); }} style={{ background: "transparent", border: "none", color: C.textTertiary, cursor: "pointer", opacity: 0.6 }}>✕</button>)}
            </div>
          ))}
          <button onClick={addPage} style={{ ...TS.input, width: "100%", padding: "12px", marginTop: 8, background: C.card, border: `1px dashed ${C.separator}`, borderRadius: 10, color: C.textTertiary, fontWeight: 600, fontSize: 13, cursor: "pointer" }}>+ Add Slide</button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* APP BAR */}
        <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "16px 32px", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0, background: C.card }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <input placeholder="Presentation Title" value={title} onChange={(e) => setTitle(e.target.value)} style={{ ...TS.h2, fontSize: 20, fontWeight: 700, border: "none", outline: "none", padding: 0, margin: 0, background: "transparent", width: "100%" }} />
              <input placeholder="Add a subtitle or description..." value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...TS.label, border: "none", outline: "none", padding: 0, margin: "4px 0 0", background: "transparent", width: "100%" }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
              <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ ...TS.input, padding: "8px 12px", border: `1px solid ${C.separator}`, borderRadius: 8, fontSize: 13, background: C.bg, cursor: "pointer", outline: "none" }}>
                <option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option>
              </select>
              <button onClick={() => setShowDeleteConfirm(true)} style={{ ...TS.input, padding: "8px 14px", background: C.redBg, color: C.red, border: `1px solid ${C.red}22`, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Delete</button>
              <button onClick={handleSave} disabled={saving || !title.trim()} style={{ ...TS.input, padding: "10px 24px", background: saving || !title.trim() ? C.textTertiary : C.medBlue, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: saving || !title.trim() ? "default" : "pointer", fontSize: 13 }}>{saving ? "Saving..." : "Save Module"}</button>
              <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              </button>
            </div>
          </div>

          {/* BUSINESS DETAILS */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: C.bg, borderRadius: 10, border: `1px solid ${C.separator}` }}>
            {business?.logo ? (
              <img src={business.logo} alt={business.business_name || "Business"} style={{ width: 32, height: 32, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ ...TS.h3, width: 32, height: 32, borderRadius: 8, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 }}>
                {(business?.business_name || "B").charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TS.h3, fontSize: 14, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
              {business?.phone && (
                <a href={`tel:${business.phone}`} style={{ ...TS.label, fontSize: 12, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {business.phone}
                </a>
              )}
            </div>
          </div>
        </div>

        {/* SLIDE CONTENT */}
        <div style={{ flex: 1, overflowY: "auto", padding: "32px 48px" }}>
          <div style={{ marginBottom: 24, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ ...TS.caption, marginRight: 8 }}>Add to Slide:</span>
            <button onClick={() => addField("header")} style={{ ...TS.input, padding: "8px 14px", background: C.purpleBg, color: C.purple, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>📌 Title / Header</button>
            <button onClick={() => addField("note")} style={{ ...TS.input, padding: "8px 14px", background: C.orangeBg, color: C.orange, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>📝 Rich Text Note</button>
            <button onClick={() => addField("file")} style={{ ...TS.input, padding: "8px 14px", background: C.redBg, color: C.red, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>📎 Upload Material</button>
            <button onClick={() => addField("text")} style={{ ...TS.input, padding: "8px 14px", background: C.medBlueBg, color: C.medBlue, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>💬 Short Answer</button>
            <button onClick={() => addField("paragraph")} style={{ ...TS.input, padding: "8px 14px", background: C.medBlueSoft, color: C.medBlue, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>📄 Essay Question</button>
            <button onClick={() => addField("dropdown")} style={{ ...TS.input, padding: "8px 14px", background: C.purpleBg, color: C.purple, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>📋 Single Choice</button>
            <button onClick={() => addField("checkbox")} style={{ ...TS.input, padding: "8px 14px", background: C.greenBg, color: C.green, border: "none", borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>☑️ Multiple Choice</button>
          </div>

          {activeFields.length === 0 && (
            <div style={{ background: C.bg, borderRadius: 16, padding: "56px 40px", textAlign: "center", border: `2px dashed ${C.separator}`, marginTop: 20 }}>
              <div style={{ width: 76, height: 76, borderRadius: 22, background: C.medBlueBg, margin: "0 auto 18px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
              </div>
              <h3 style={{ ...TS.h3, margin: "0 0 6px" }}>Empty Slide</h3>
              <p style={{ ...TS.bodySm, margin: 0 }}>Use the buttons above to add titles, notes, files, or questions to this slide.</p>
            </div>
          )}

          {activeFields.map((field, index) => {
            if (field.type === "header") {
              return (
                <div key={field.id} className="field-card" style={{ margin: "0 0 16px", padding: "18px 22px", background: C.purpleBg, borderRadius: 12, borderLeft: `4px solid ${C.purple}`, border: `1px solid ${C.separator}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <span style={{ ...TS.caption, color: C.purple }}>Slide Title / Header</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => moveField(index, "up")} disabled={index === 0} style={{ ...moveBtnStyle, opacity: index === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => moveField(index, "down")} disabled={index === activeFields.length - 1} style={{ ...moveBtnStyle, opacity: index === activeFields.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={() => removeField(field.id)} style={{ ...moveBtnStyle, color: C.red, borderColor: C.red + "22", background: C.redBg }}>✕</button>
                    </div>
                  </div>
                  <textarea placeholder="Enter slide title..." value={field.label || ""} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ ...TS.h2, width: "100%", padding: "6px 0", border: "none", outline: "none", background: "transparent", resize: "vertical" }} />
                </div>
              );
            }
            if (field.type === "note") {
              return (
                <div key={field.id} className="field-card" style={{ width: "100%", boxSizing: "border-box", background: C.card, overflow: "hidden", borderLeft: `4px solid ${C.orange}`, marginBottom: 16, border: `1px solid ${C.separator}`, borderRadius: 0 }}>
                  <div style={{ padding: "14px 18px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: `1px solid ${C.separatorLight}` }}>
                    <span style={{ ...TS.caption, color: C.orange }}>Teaching Note / Text</span>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => moveField(index, "up")} disabled={index === 0} style={{ ...moveBtnStyle, opacity: index === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => moveField(index, "down")} disabled={index === activeFields.length - 1} style={{ ...moveBtnStyle, opacity: index === activeFields.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={() => removeField(field.id)} style={{ ...moveBtnStyle, color: C.red, borderColor: C.red + "22", background: C.redBg }}>✕</button>
                    </div>
                  </div>
                  <div style={{ padding: "0 18px 16px" }}>
                    <textarea placeholder="Type your notes, paragraphs, or lesson text here..." value={field.label || ""} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ ...TS.body, width: "100%", padding: "12px 14px", border: `1px solid ${C.separator}`, borderRadius: 12, outline: "none", background: C.bg, boxSizing: "border-box", minHeight: 64, resize: "vertical" }} />
                  </div>
                </div>
              );
            }
            if (field.type === "file") {
              return (
                <div key={field.id} className="field-card" style={{ background: C.card, borderRadius: 12, padding: "20px 22px", marginBottom: 16, border: `1px solid ${C.separator}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <span style={{ ...TS.caption, color: C.red }}>📎 Uploaded Material</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button onClick={() => moveField(index, "up")} disabled={index === 0} style={{ ...moveBtnStyle, opacity: index === 0 ? 0.3 : 1 }}>↑</button>
                      <button onClick={() => moveField(index, "down")} disabled={index === activeFields.length - 1} style={{ ...moveBtnStyle, opacity: index === activeFields.length - 1 ? 0.3 : 1 }}>↓</button>
                      <button onClick={() => removeField(field.id)} style={{ ...moveBtnStyle, color: C.red, borderColor: C.red + "22", background: C.redBg }}>✕</button>
                    </div>
                  </div>
                  {field.file_url ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px", background: C.redBg, borderRadius: 10, border: `1px solid ${C.red}22` }}>
                      <span style={{ fontSize: 24 }}>📄</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ ...TS.h3, fontSize: 14, margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{field.label || "Uploaded File"}</p>
                        <a href={field.file_url} target="_blank" rel="noreferrer" style={{ ...TS.label, fontSize: 12, color: C.medBlue, textDecoration: "none" }}>View File</a>
                      </div>
                      <button onClick={() => updateField(field.id, "file_url", "")} style={{ ...TS.input, padding: "6px 12px", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 8, fontSize: 12, cursor: "pointer", color: C.textTertiary }}>Replace</button>
                    </div>
                  ) : (
                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px", border: `2px dashed ${C.separator}`, borderRadius: 12, cursor: "pointer", background: C.bg }}>
                      <input type="file" style={{ display: "none" }} onChange={(e) => e.target.files && handleFileUpload(field.id, e.target.files[0])} accept="image/*,application/pdf,audio/*,video/*,.doc,.docx,.ppt,.pptx" />
                      {uploadingFieldId === field.id ? (<p style={{ ...TS.body, color: C.medBlue, fontWeight: 600 }}>Uploading...</p>) : (<><span style={{ fontSize: 24, marginBottom: 8 }}>⬆️</span><span style={{ ...TS.bodySm, fontWeight: 600 }}>Click to upload PDF, PPT, Word, Image, Video, or Audio</span></>)}
                    </label>
                  )}
                </div>
              );
            }
            const typeInfo: Record<string, [string, string, string]> = { text: ["💬", "Short Answer", C.medBlueBg], paragraph: ["📄", "Essay Question", C.medBlueSoft], dropdown: ["📋", "Single Choice", C.purpleBg], checkbox: ["☑️", "Multiple Choice", C.greenBg] };
            const [icon, typeLabel, bg] = typeInfo[field.type] || ["❓", field.type, C.bg];
            return (
              <div key={field.id} className="field-card" style={{ background: C.card, borderRadius: 12, padding: "20px 22px", marginBottom: 16, border: `1px solid ${C.separator}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ ...TS.caption, fontSize: 13, color: C.textTertiary, background: C.bg, padding: "3px 10px", borderRadius: 8 }}>Q{questionFields.indexOf(field) + 1}</span>
                    <span style={{ ...TS.label, fontSize: 11, color: C.medBlue, background: bg, padding: "3px 10px", borderRadius: 8, fontWeight: 600 }}>{icon} {typeLabel}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ fontSize: 10, color: C.purple, fontWeight: 600 }}>⭐</span>
                      <input type="number" min={0} max={100} value={field.points || ""} onChange={(e) => updateField(field.id, "points", parseInt(e.target.value) || undefined)} placeholder="pts" style={{ ...TS.input, width: 52, padding: "4px 8px", border: `1px solid ${C.separator}`, borderRadius: 6, fontSize: 12, textAlign: "center", outline: "none" }} />
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: C.textTertiary, cursor: "pointer", userSelect: "none" }}>
                      <div style={{ width: 34, height: 20, borderRadius: 10, background: field.required ? C.red : C.separator, transition: "background 0.2s", position: "relative", flexShrink: 0 }}>
                        <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: field.required ? 16 : 2, transition: "left 0.2s" }} />
                      </div>
                      <input type="checkbox" checked={field.required} onChange={(e) => updateField(field.id, "required", e.target.checked)} style={{ display: "none" }} />
                      Req
                    </label>
                    <button onClick={() => moveField(index, "up")} disabled={index === 0} style={{ ...moveBtnStyle, opacity: index === 0 ? 0.3 : 1 }}>↑</button>
                    <button onClick={() => moveField(index, "down")} disabled={index === activeFields.length - 1} style={{ ...moveBtnStyle, opacity: index === activeFields.length - 1 ? 0.3 : 1 }}>↓</button>
                    <button onClick={() => removeField(field.id)} style={{ ...moveBtnStyle, color: C.red, borderColor: C.red + "22", background: C.redBg }}>✕</button>
                  </div>
                </div>
                <textarea placeholder="Write your question..." value={field.label} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ ...inputStyle, minHeight: 48, resize: "vertical", marginBottom: (field.type === "dropdown" || field.type === "checkbox") ? 12 : 0 }} />
                {(field.type === "dropdown" || field.type === "checkbox") && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6, paddingLeft: 4 }}>
                    <p style={{ ...TS.caption, fontSize: 11, margin: "0 0 4px 0" }}>Select the correct answer:</p>
                    {field.options.map((opt, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <input type="radio" name={`correct-${field.id}`} checked={field.correctAnswer === opt} onChange={() => updateField(field.id, "correctAnswer", opt)} style={{ cursor: "pointer", accentColor: C.green }} />
                        <div style={{ width: 18, height: 18, borderRadius: field.type === "checkbox" ? 5 : "50%", border: `2px solid ${C.separator}`, flexShrink: 0, background: C.card }} />
                        <input style={{ ...inputStyle, flex: 1, padding: "8px 12px", fontSize: 13, border: `1px solid ${C.separatorLight}` }} value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} />
                        {field.options.length > 1 && <button onClick={() => removeOption(field.id, i)} style={{ background: C.redBg, border: "none", color: C.red, cursor: "pointer", width: 26, height: 26, borderRadius: 6, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7 }}>✕</button>}
                      </div>
                    ))}
                    <button onClick={() => addOption(field.id)} style={{ background: "none", border: `1px dashed ${C.separator}`, borderRadius: 10, padding: "8px", color: C.medBlue, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>+ Add Option</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, padding: 28, maxWidth: 400, width: "100%", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: C.redBg, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🗑️</div>
            <h3 style={{ ...TS.h3, fontSize: 18, margin: "0 0 8px" }}>Delete Module?</h3>
            <p style={{ ...TS.bodySm, margin: "0 0 24px" }}>This will permanently delete the module, all slide pages, questions, and submissions. This cannot be undone.</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ ...TS.input, flex: 1, padding: "12px", background: C.bg, color: C.textPrimary, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={handleDelete} style={{ ...TS.input, flex: 1, padding: "12px", background: C.red, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}