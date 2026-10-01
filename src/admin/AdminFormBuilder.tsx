// src/admin/AdminFormBuilder.tsx
import React, { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { getFormFromCache, saveFormOnlineFirst, deleteFormOnlineFirst } from "../database/formDB";

// ======================= RICHTEXT INTEGRATION =======================
import RichTextEditor from "../components/RichTextEditor";
const USE_RICHTEXT = true;
// ====================================================================

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
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
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, fontFamily: FONT, color: C.textPrimary },
};

type FieldType =
  | "header" | "note"
  | "text" | "textarea"
  | "number" | "range"
  | "radio" | "checkbox" | "dropdown" | "toggle"
  | "date" | "time"
  | "phone" | "email";

interface FieldConfig {
  min?: number; max?: number; step?: number;
  unit?: string; unitOptions?: string[];
  labelColor?: string;
  sectionColor?: string;
}
interface FormField {
  id: string; type: FieldType; label: string; required: boolean;
  options: string[];
  placeholder: string;
  config: FieldConfig;
}

const TYPE_META: Record<FieldType, { icon: string; label: string; group: string }> = {
  header:   { icon: "▤", label: "Section",        group: "Layout" },
  note:     { icon: "✎", label: "Rich Note",      group: "Layout" },
  text:     { icon: "Ab", label: "Short Text",    group: "Basic" },
  textarea: { icon: "¶", label: "Long Text",      group: "Basic" },
  number:   { icon: "#", label: "Number",         group: "Basic" },
  range:    { icon: "⬌", label: "Slider",         group: "Basic" },
  dropdown: { icon: "▾", label: "Dropdown",       group: "Choices" },
  radio:    { icon: "◯", label: "Radio Buttons",  group: "Choices" },
  checkbox: { icon: "☑", label: "Checkboxes",     group: "Choices" },
  toggle:   { icon: "⇄", label: "Toggle",         group: "Choices" },
  date:     { icon: "📅", label: "Date",          group: "Date & Time" },
  time:     { icon: "🕐", label: "Time",          group: "Date & Time" },
  phone:    { icon: "📞", label: "Phone",         group: "Contact" },
  email:    { icon: "✉️", label: "Email",         group: "Contact" },
};

function f(type: FieldType, label: string, o: Partial<{ required: boolean; placeholder: string; options: string[]; cfg: FieldConfig }> = {}): FormField {
  return {
    id: crypto.randomUUID(),
    type,
    label,
    required: o.required || false,
    options: o.options || (type === "toggle" ? ["F", "M"] : []),
    placeholder: o.placeholder || "",
    config: o.cfg || {},
  };
}

function buildMedicalExample(): { title: string; description: string; fields: FormField[] } {
  return {
    title: "Medical Assessment Form",
    description: "Please complete all required (*) fields before your visit. All information is confidential.",
    fields: [
      f("header", "Patient Information", { cfg: { sectionColor: "#FF3B30" } }),
      f("text", "Full Name", { required: true, placeholder: "First and last name" }),
      f("toggle", "Sex", { required: true, options: ["F", "M"] }),
      f("date", "Date of Birth", { required: true, placeholder: "DD/MM/YYYY" }),
      f("number", "Age", { required: true, cfg: { min: 0, max: 120, unit: "years" } }),
      f("dropdown", "Blood Group", { options: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"] }),
      f("number", "Weight", { cfg: { min: 0, max: 400, unit: "kg", unitOptions: ["kg", "lb"] } }),
      f("number", "Height", { cfg: { min: 0, max: 260, unit: "cm", unitOptions: ["cm", "m"] } }),
      f("range", "Pain Level (0 = none, 10 = worst)", { cfg: { min: 0, max: 10, step: 1 } }),
      f("phone", "Phone Number", { required: true }),
      f("email", "Email"),
      f("checkbox", "Known Allergies", { options: ["Penicillin", "Peanuts", "Latex", "Dust", "None"] }),
      f("textarea", "Current Medications"),
      f("textarea", "Medical History / Notes"),
      f("header", "Appointment", { cfg: { sectionColor: "#007AFF" } }),
      f("date", "Appointment Date", { placeholder: "DD/MM/YYYY" }),
      f("time", "Arrival Time"),
      f("checkbox", "Consent", { required: true, options: ["I consent to examination and treatment"] }),
    ],
  };
}

function buildSchoolExample(): { title: string; description: string; fields: FormField[] } {
  return {
    title: "School Admission Application",
    description: "Complete this admission application. Fields marked * are required.",
    fields: [
      f("header", "Student Details", { cfg: { sectionColor: "#007AFF" } }),
      f("text", "Student Full Name", { required: true }),
      f("date", "Date of Birth", { required: true, placeholder: "DD/MM/YYYY" }),
      f("toggle", "Sex", { options: ["F", "M"] }),
      f("dropdown", "Class Applying For", { required: true, options: ["Nursery", "KG 1", "KG 2", "Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5", "Grade 6"] }),
      f("text", "Previous School"),
      f("header", "Guardian Information", { cfg: { sectionColor: "#34C759" } }),
      f("text", "Parent / Guardian Name", { required: true }),
      f("phone", "Guardian Phone", { required: true }),
      f("email", "Guardian Email"),
      f("textarea", "Home Address"),
      f("header", "Academics", { cfg: { sectionColor: "#FF9F0A" } }),
      f("checkbox", "Subjects / Stream", { options: ["Sciences", "Arts", "Commercial", "Languages"] }),
      f("number", "Age", { cfg: { min: 2, max: 20, unit: "years" } }),
      f("date", "Preferred Start Date", { placeholder: "DD/MM/YYYY" }),
      f("note", "📎 Supporting documents (birth certificate, previous report card) are submitted at the school office."),
      f("checkbox", "Declaration", { required: true, options: ["I confirm the information provided is accurate"] }),
    ],
  };
}

function NoteEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  if (!USE_RICHTEXT) {
    return (
      <textarea placeholder={placeholder || "Type your note..."} value={value || ""} onChange={(e) => onChange(e.target.value)}
        style={{ width: "100%", minHeight: 90, padding: 12, border: `1px solid ${C.separator}`, borderRadius: 12, outline: "none", background: C.bg, fontFamily: FONT, fontSize: 15, resize: "vertical", boxSizing: "border-box" }} />
    );
  }
  const R = RichTextEditor as unknown as React.ComponentType<{ value: string; onChange: (v: string) => void; placeholder?: string }>;
  return <R value={value} onChange={onChange} placeholder={placeholder} />;
}

// Maps a raw field row (cache or Supabase) into the editor's FormField shape
function mapFieldRow(x: any): FormField {
  return {
    id: x.id,
    type: (x.type === "paragraph" ? "textarea" : x.type) as FieldType,
    label: x.label || "",
    required: x.required || false,
    options: Array.isArray(x.options) ? x.options : (x.type === "toggle" ? ["F", "M"] : []),
    placeholder: x.placeholder || "",
    config: (x.config && typeof x.config === "object") ? x.config : {},
  };
}

export default function AdminFormBuilder() {
  const { formId } = useParams<{ formId: string }>();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<FormField[]>([]);
  const [status, setStatus] = useState<"draft" | "published" | "closed">("draft");
  const [allowDownload, setAllowDownload] = useState(true);
  const [allowMultiple, setAllowMultiple] = useState(true); // submission mode
  const [visibleTo, setVisibleTo] = useState<string[]>(["trainer", "trainee"]); // audience
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loadingData, setLoadingData] = useState(!!formId);
  const [isEditing, setIsEditing] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [offlineSaved, setOfflineSaved] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, any>>({});

  const dragArmed = useRef(false);
  const dragFrom = useRef<number | null>(null);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const gutter = "clamp(12px, 3vw, 24px)";
  const canvasPad = "clamp(18px, 4vw, 40px)";
  const PAGE_MAX = 1440;

  // OFFLINE-FIRST load:
  //   1. Hydrate instantly from Dexie cache (works fully offline)
  //   2. Silent refresh from Supabase when online
  useEffect(() => {
    let cancelled = false;
    if (formId) setIsEditing(true);
    (async () => {
      if (formId) {
        const cached = await getFormFromCache(formId);
        if (cached && !cancelled) {
          setTitle(cached.title || "");
          setDescription(cached.description || "");
          setStatus((cached.status as any) || "draft");
          setAllowDownload(cached.allow_download ?? true);
          setAllowMultiple(cached.allow_multiple_submissions !== false);
          setVisibleTo(Array.isArray(cached.visible_to) && cached.visible_to.length > 0 ? cached.visible_to : ["trainer", "trainee"]);
          setFields((cached.fields || []).map(mapFieldRow));
          setLoadingData(false);
        }
      }

      if (formId && navigator.onLine) {
        try {
          const { data: fData } = await supabase.from("forms").select("*").eq("id", formId).maybeSingle();
          if (fData && !cancelled) {
            setTitle(fData.title || "");
            setDescription(fData.description || "");
            setStatus(fData.status || "draft");
            setAllowDownload(fData.allow_download ?? true);
            setAllowMultiple(fData.allow_multiple_submissions !== false);
            setVisibleTo(Array.isArray(fData.visible_to) && fData.visible_to.length > 0 ? fData.visible_to : ["trainer", "trainee"]);
          }
          const { data: ff } = await supabase.from("form_fields").select("*").eq("form_id", formId).order("sort_order", { ascending: true });
          if (ff && !cancelled) setFields(ff.map(mapFieldRow));
        } catch (e) { console.warn("Form refresh failed, using cache:", e); }
      }

      if (!cancelled) setLoadingData(false);
    })();
    return () => { cancelled = true; };
  }, [formId]);

  const addField = (type: FieldType) => setFields((p) => [...p, {
    id: crypto.randomUUID(), type, label: "", required: false,
    options: type === "radio" || type === "checkbox" || type === "dropdown" ? ["Option 1", "Option 2"]
      : type === "toggle" ? ["F", "M"] : [],
    placeholder: "", config: type === "range" ? { min: 0, max: 10, step: 1 } : {},
  }]);
  const updateField = (id: string, key: keyof FormField, value: any) => setFields((p) => p.map((x) => (x.id === id ? { ...x, [key]: value } : x)));
  const updateConfig = (id: string, key: keyof FieldConfig, value: any) => setFields((p) => p.map((x) => (x.id === id ? { ...x, config: { ...x.config, [key]: value } } : x)));
  const setColorKey = (id: string, key: "labelColor" | "sectionColor", value?: string) =>
    setFields((p) => p.map((x) => {
      if (x.id !== id) return x;
      const cfg: FieldConfig = { ...x.config };
      if (!value) delete (cfg as any)[key];
      else (cfg as any)[key] = value;
      return { ...x, config: cfg };
    }));
  const removeField = (id: string) => setFields((p) => p.filter((x) => x.id !== id));
  const duplicateField = (id: string) => setFields((p) => {
    const i = p.findIndex((x) => x.id === id);
    if (i === -1) return p;
    const copy: FormField = { ...p[i], id: crypto.randomUUID() };
    const n = [...p];
    n.splice(i + 1, 0, copy);
    return n;
  });
  const moveField = (i: number, dir: "up" | "down") => {
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= fields.length) return;
    const n = [...fields];
    [n[i], n[j]] = [n[j], n[i]];
    setFields(n);
  };
  const moveTo = (from: number, insertAt: number) => {
    if (from < 0 || from >= fields.length) return;
    if (insertAt === from || insertAt === from + 1) return;
    const n = [...fields];
    const [m] = n.splice(from, 1);
    const adjusted = insertAt > from ? insertAt - 1 : insertAt;
    n.splice(adjusted, 0, m);
    setFields(n);
  };
  const handleDragStart = (e: React.DragEvent, index: number) => {
    if (!dragArmed.current) { e.preventDefault(); return; }
    try { e.dataTransfer.setData("text/plain", String(index)); } catch {}
    e.dataTransfer.effectAllowed = "move";
    dragFrom.current = index;
    setDragFromIdx(index);
  };
  const handleDragEnd = () => {
    dragArmed.current = false;
    dragFrom.current = null;
    setDragFromIdx(null);
    setDropIndex(null);
  };
  const handleDragOverCard = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    setDropIndex(before ? index : index + 1);
  };
  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragFrom.current !== null && dropIndex !== null) moveTo(dragFrom.current, dropIndex);
    handleDragEnd();
  };

  const addOption = (fid: string) => setFields((p) => p.map((x) => (x.id === fid ? { ...x, options: [...x.options, `Option ${x.options.length + 1}`] } : x)));
  const removeOption = (fid: string, oi: number) => setFields((p) => p.map((x) => { if (x.id !== fid) return x; const o = [...x.options]; o.splice(oi, 1); return { ...x, options: o }; }));
  const updateOption = (fid: string, oi: number, v: string) => setFields((p) => p.map((x) => { if (x.id !== fid) return x; const o = [...x.options]; o[oi] = v; return { ...x, options: o }; }));

  const setPreviewAnswer = (id: string, v: any) => setPreviewAnswers((p) => ({ ...p, [id]: v }));

  function loadExample(kind: "medical" | "school") {
    const ex = kind === "medical" ? buildMedicalExample() : buildSchoolExample();
    setTitle(ex.title); setDescription(ex.description); setFields(ex.fields); setSaveError(null);
  }

  // Audience helpers
  const everyoneVisible = visibleTo.includes("trainer") && visibleTo.includes("trainee");
  function toggleVisibleRole(role: "trainer" | "trainee") {
    setVisibleTo((cur) => {
      if (cur.includes(role)) {
        const next = cur.filter((r) => r !== role);
        return next.length > 0 ? next : ["trainer", "trainee"]; // never allow a zero audience
      }
      return [...cur, role];
    });
  }

  // OFFLINE-AWARE save: cloud when possible, queued + local-cache when not.
  async function handleSave() {
    setSaveError(null);
    setOfflineSaved(false);
    if (!title.trim()) {
      setSaveError('Please enter the form title at the top (e.g. "Incident Report"), then press Save again.');
      titleRef.current?.focus();
      titleRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const payload: any = {
        id: formId || crypto.randomUUID(),
        tenant_id: currentUser.tenantId,
        title: title.trim(),
        description: description.trim(),
        status,
        allow_download: allowDownload,
        allow_multiple_submissions: allowMultiple,
        visible_to: visibleTo,
        created_by: currentUser.id,
        updated_at: now,
      };
      if (!isEditing) payload.created_at = now;

      const fieldRows = fields.map((x, i) => ({
        id: x.id, tenant_id: currentUser.tenantId, form_id: payload.id, type: x.type,
        label: x.label || "", required: x.required,
        options: (["radio", "checkbox", "dropdown", "toggle"].includes(x.type) && x.options.length > 0) ? x.options : null,
        sort_order: i, placeholder: x.placeholder || null,
        config: (x.config && Object.keys(x.config).length > 0) ? x.config : null,
      }));

      // Cloud when online; mirrors to local cache + queues silently when offline
      const reachedCloud = await saveFormOnlineFirst(payload, fieldRows);
      if (!reachedCloud) setOfflineSaved(true);
      navigate("/admin/forms");
    } catch (e: unknown) {
      const err = e as Error;
      if (err.message.includes("JWT") || err.message.includes("401")) window.location.href = "/";
      else {
        const rlsHint = /row-level|permission denied/i.test(err.message) ? " — check the RLS policies on forms / form_fields in Supabase." : "";
        const colHint = /allow_multiple_submissions/i.test(err.message) ? " — run the SQL: alter table forms add column if not exists allow_multiple_submissions boolean not null default true;" : "";
        const cfgHint = /config/i.test(err.message) ? " — run the SQL: alter table form_fields add column if not exists config jsonb;" : "";
        const visHint = /visible_to/i.test(err.message) ? " — run the SQL: alter table forms add column if not exists visible_to text[] not null default '{trainer,trainee}';" : "";
        setSaveError("Save failed: " + err.message + rlsHint + colHint + cfgHint + visHint);
      }
    } finally { setSaving(false); }
  }

  // OFFLINE-AWARE delete: local immediately, cloud or queued
  async function handleDelete() {
    if (!formId) return;
    try {
      setDeleting(true);
      await deleteFormOnlineFirst(formId);
      navigate("/admin/forms");
    } catch (e: unknown) {
      setSaveError("Delete failed: " + (e as Error).message);
      setShowDeleteConfirm(false);
    } finally {
      setDeleting(false);
    }
  }

  const inputStyle: React.CSSProperties = { ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box" };
  const miniLabel: React.CSSProperties = { ...TS.caption, fontSize: 10, color: C.textTertiary, display: "block", marginBottom: 4 };
  const miniInput: React.CSSProperties = { ...TS.input, width: "100%", padding: "7px 10px", border: `1px solid ${C.separator}`, borderRadius: 8, fontSize: 13, outline: "none", background: C.card, boxSizing: "border-box" };
  const hoverBtn: React.CSSProperties = { background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 7, padding: "4px 8px", cursor: "pointer", color: C.textSecondary, fontSize: 12, display: "flex", alignItems: "center", gap: 4 };
  const paletteChip: React.CSSProperties = { ...TS.input, padding: "6px 11px", background: C.card, color: C.textSecondary, border: `1px solid ${C.separator}`, borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer" };

  const segBtn = (active: boolean, activeColor: string): React.CSSProperties => ({
    border: "none", cursor: "pointer", padding: "5px 12px", borderRadius: 6,
    fontSize: 12, fontWeight: 700, fontFamily: FONT,
    background: active ? activeColor : "transparent",
    color: active ? "#fff" : C.textTertiary,
    transition: "background 0.15s, color 0.15s", whiteSpace: "nowrap",
  });

  if (loadingData) return <div style={{ minHeight: "100%", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}><span style={{ ...TS.body, fontWeight: 500 }}>Loading form...</span></div>;

  const groups = Array.from(new Set(Object.values(TYPE_META).map((m) => m.group)));

  const DropLine = ({ slot }: { slot: number }) =>
    dropIndex === slot && dragFromIdx !== null ? (
      <div style={{ height: 4, borderRadius: 2, background: C.medBlue, margin: "2px 0", boxShadow: "0 0 0 3px " + C.medBlue + "22", transition: "all 0.1s" }} />
    ) : null;

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`
        button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }
      `}</style>

      {/* ===== STICKY TOOLBAR — back · context · Save ===== */}
      <div
        style={{
          position: "sticky", top: 0, zIndex: 20, width: "100%", boxSizing: "border-box",
          background: C.bg,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: `10px ${gutter}`, width: "100%", boxSizing: "border-box" }}>

          {/* BACK → Forms list */}
          <button
            onClick={() => navigate("/admin/forms")}
            title="Back to Forms"
            style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>

          {/* CONTEXT — title truncates */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title || (isEditing ? "Editing form" : "New form")}
            </div>
            <div style={{ ...TS.bodySm, fontSize: 12, color: C.textTertiary }}>
              {isEditing ? "Editing form" : "New form"}
            </div>
          </div>

          {/* SAVE — always visible */}
          <button
            onClick={handleSave}
            disabled={saving}
            title="Save this form"
            style={{ height: 38, padding: "0 18px", borderRadius: 10, border: "none", background: saving ? C.textTertiary : C.medBlue, color: "#fff", fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: saving ? "default" : "pointer", flexShrink: 0, boxShadow: "0 2px 8px rgba(0,122,255,0.25)", transition: "transform 0.12s ease" }}
            onMouseEnter={(e) => { if (!saving) e.currentTarget.style.transform = "translateY(-1px)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
          >
            {saving ? "Saving…" : "Save Form"}
          </button>
        </div>
      </div>

      {/* ===== SETTINGS TOOLBAR ===== */}
      <div
        style={{
          borderBottom: `1px solid ${C.separator}`, background: C.card,
          padding: "10px 24px", display: "flex", alignItems: "center",
          justifyContent: "flex-start", gap: 14, flexWrap: "wrap", width: "100%", boxSizing: "border-box",
        }}
      >
        {/* STATUS */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }} title="Draft = hidden from users · Published = live · Closed = visible but locked">
          <span style={{ fontSize: 12, fontWeight: 700, color: C.textTertiary }}>Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={{ ...TS.input, padding: "7px 10px", border: `1px solid ${C.separator}`, borderRadius: 8, fontSize: 13, background: C.bg, cursor: "pointer", outline: "none" }}>
            <option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option>
          </select>
        </div>

        {/* SUBMISSION MODE */}
        <div
          title={allowMultiple
            ? "Multiple: the same person can submit this form many times"
            : "Single: each person can submit this form only once"}
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: C.textTertiary }}>Submissions</span>
          <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 8, padding: 3, gap: 2 }}>
            <button onClick={() => setAllowMultiple(false)} style={segBtn(!allowMultiple, C.medBlue)}>Single</button>
            <button onClick={() => setAllowMultiple(true)} style={segBtn(allowMultiple, C.medBlue)}>Multiple</button>
          </div>
        </div>

        {/* VISIBILITY */}
        <div
          title="Choose which roles see this form in their Forms list. 'Everyone' = trainers + trainees."
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
        >
          <span style={{ fontSize: 12, fontWeight: 700, color: C.textTertiary }}>Visible to</span>
          <div style={{ display: "flex", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 8, padding: 3, gap: 2 }}>
            <button onClick={() => setVisibleTo(["trainer", "trainee"])} style={segBtn(everyoneVisible, C.medBlue)}>👥 All</button>
            <button onClick={() => toggleVisibleRole("trainer")} style={segBtn(visibleTo.includes("trainer"), C.purple)}>🎓 Trainers</button>
            <button onClick={() => toggleVisibleRole("trainee")} style={segBtn(visibleTo.includes("trainee"), C.green)}>🧑‍🎓 Trainees</button>
          </div>
        </div>

        {/* DOWNLOADS */}
        <div
          onClick={() => setAllowDownload(!allowDownload)}
          title="Allow users to download the blank form and their filled copy"
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none", padding: "7px 12px", background: allowDownload ? C.greenBg : C.bg, border: `1px solid ${allowDownload ? C.green + "44" : C.separator}`, borderRadius: 8, flexShrink: 0 }}
        >
          <div style={{ width: 30, height: 18, borderRadius: 9, background: allowDownload ? C.green : C.separator, position: "relative", flexShrink: 0 }}>
            <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: allowDownload ? 14 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 700, color: allowDownload ? C.green : C.textTertiary }}>⬇ Downloads {allowDownload ? "ON" : "OFF"}</span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }} />

        {/* PREVIEW + DELETE */}
        <button onClick={() => { setPreviewAnswers({}); setPreviewOpen(true); }} style={{ ...TS.input, padding: "8px 14px", background: C.medBlueSoft, color: C.medBlue, border: `1px solid ${C.medBlue}22`, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, flexShrink: 0 }} title="Preview the form as users will see it">👁 Preview</button>
        {isEditing && (
          <button onClick={() => setShowDeleteConfirm(true)} style={{ ...TS.input, padding: "8px 14px", background: C.redBg, color: C.red, border: `1px solid ${C.red}22`, borderRadius: 8, fontWeight: 600, cursor: "pointer", fontSize: 13, flexShrink: 0 }} title="Delete this form permanently">Delete</button>
        )}
      </div>

      {saveError && (
        <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} 0`, boxSizing: "border-box" }}>
          <div style={{ background: C.redBg, color: C.red, borderRadius: 12, padding: "14px 20px", fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <span>⚠ {saveError}</span>
            <button onClick={() => setSaveError(null)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", fontWeight: 700, fontSize: 14 }}>✕</button>
          </div>
        </div>
      )}

      {offlineSaved && (
        <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} 0`, boxSizing: "border-box" }}>
          <div style={{ background: C.greenBg, color: C.green, borderRadius: 12, padding: "14px 20px", fontWeight: 600, fontSize: 14 }}>
            ✓ Saved offline — this form is stored on this device and will sync automatically when you're back online.
          </div>
        </div>
      )}

      {/* ============ CONTENT ============ */}
      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 72px`, boxSizing: "border-box" }}>

        {/* PALETTE BAR */}
        <div style={{ background: C.card, borderRadius: 14, border: `1px solid ${C.separator}`, padding: "10px 16px", marginBottom: 18, display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", boxShadow: "0 2px 12px rgba(0,0,0,0.04)" }}>
          {groups.map((g, gi) => (
            <React.Fragment key={g}>
              {gi > 0 && <div style={{ width: 1, height: 22, background: C.separator, flexShrink: 0 }} />}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ ...TS.caption, fontSize: 10, color: C.textTertiary }}>{g}</span>
                {(Object.keys(TYPE_META) as FieldType[]).filter((t) => TYPE_META[t].group === g).map((t) => (
                  <button key={t} onClick={() => addField(t)} title={`Add ${TYPE_META[t].label}`} style={{ ...paletteChip, display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ color: C.medBlue }}>{TYPE_META[t].icon}</span> {TYPE_META[t].label}
                  </button>
                ))}
              </div>
            </React.Fragment>
          ))}
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
          onDrop={handleDropOnCanvas}
          style={{ width: "100%", background: C.card, borderRadius: 16, border: `1px solid ${C.separator}`, boxShadow: "0 2px 12px rgba(0,0,0,0.04)", overflow: "hidden", boxSizing: "border-box", minWidth: 0 }}
        >
          {/* Form header */}
          <div style={{ padding: `28px ${canvasPad} 20px`, borderBottom: `3px solid ${C.medBlue}` }}>
            <input ref={titleRef} value={title} onChange={(e) => { setTitle(e.target.value); setSaveError(null); }} placeholder="Form title" style={{ ...TS.h1, width: "100%", border: "none", outline: "none", background: "transparent" }} />
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Form description or instructions (optional)" style={{ ...TS.body, width: "100%", minHeight: 24, border: "none", outline: "none", background: "transparent", resize: "none", color: C.textSecondary, marginTop: 4 }} />
            <div style={{ marginTop: 8 }}>
              <span style={{ ...TS.caption, fontSize: 10, display: "inline-block", color: everyoneVisible ? C.green : C.medBlue, background: everyoneVisible ? C.greenBg : C.medBlueBg, padding: "3px 9px", borderRadius: 20 }}>
                👁 Visible to: {everyoneVisible ? "Everyone (trainers + trainees)" : visibleTo.includes("trainer") ? "Trainers only" : "Trainees only"}
              </span>
            </div>
          </div>

          {/* Fields */}
          <div style={{ padding: `20px ${canvasPad} 32px` }}>
            <DropLine slot={0} />

            {fields.length === 0 && (
              <div style={{ padding: "48px 24px", textAlign: "center", border: `2px dashed ${C.separator}`, borderRadius: 12, background: C.bg }}>
                <p style={{ ...TS.bodySm, margin: "0 0 12px" }}>This form is empty. Add a field from the bar above{!isEditing ? ", or load a ready-made example." : "."}</p>
                {!isEditing && (
                  <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
                    <button onClick={() => loadExample("medical")} style={{ ...TS.input, padding: "9px 16px", background: C.redBg, color: C.red, border: `1px solid ${C.red}22`, borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🩺 Medical Form example</button>
                    <button onClick={() => loadExample("school")} style={{ ...TS.input, padding: "9px 16px", background: C.medBlueBg, color: C.medBlue, border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>🏫 School Admission example</button>
                  </div>
                )}
              </div>
            )}

            {fields.map((field, index) => {
              const meta = TYPE_META[field.type] || { icon: "?", label: field.type, group: "" };
              const isHover = hoverId === field.id;
              const isDragging = dragFromIdx === index;
              const cfg = field.config || {};

              const labelColor = cfg.labelColor;
              const sectionColor = cfg.sectionColor || C.purple;

              const toolbar = (
                <div
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{ position: "absolute", top: 8, right: 10, display: "flex", gap: 5, alignItems: "center", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, padding: "4px 6px", boxShadow: "0 4px 14px rgba(0,0,0,0.10)", opacity: isHover || isDragging ? 1 : 0, pointerEvents: isHover || isDragging ? "auto" : "none", transition: "opacity 0.15s", zIndex: 5 }}
                >
                  <span
                    title="Drag to move"
                    onMouseDown={() => { dragArmed.current = true; }}
                    onMouseUp={() => { dragArmed.current = false; }}
                    style={{ cursor: "grab", color: C.textTertiary, fontSize: 14, padding: "2px 4px" }}
                  >⠿</span>
                  <label title="Text colour" style={{ ...hoverBtn, position: "relative", overflow: "hidden" }}>
                    🎨
                    <input
                      type="color"
                      value={labelColor || "#1C1C1E"}
                      onChange={(e) => setColorKey(field.id, "labelColor", e.target.value)}
                      style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }}
                    />
                  </label>
                  {labelColor && (
                    <button onClick={() => setColorKey(field.id, "labelColor", undefined)} title="Reset colour to default" style={{ ...hoverBtn, color: C.textTertiary }}>⟲</button>
                  )}
                  <button onClick={() => updateField(field.id, "required", !field.required)} title="Required" style={{ ...hoverBtn, color: field.required ? C.red : C.textTertiary, borderColor: field.required ? C.red + "55" : C.separator, fontWeight: 700 }}>*</button>
                  <button onClick={() => duplicateField(field.id)} title="Duplicate" style={hoverBtn}>⧉</button>
                  <button onClick={() => moveField(index, "up")} disabled={index === 0} style={{ ...hoverBtn, opacity: index === 0 ? 0.35 : 1 }}>↑</button>
                  <button onClick={() => moveField(index, "down")} disabled={index === fields.length - 1} style={{ ...hoverBtn, opacity: index === fields.length - 1 ? 0.35 : 1 }}>↓</button>
                  <button onClick={() => removeField(field.id)} title="Remove" style={{ ...hoverBtn, color: C.red }}>✕</button>
                </div>
              );

              const dragProps = {
                draggable: true,
                onDragStart: (e: React.DragEvent) => handleDragStart(e, index),
                onDragEnd: handleDragEnd,
                onDragOver: (e: React.DragEvent) => handleDragOverCard(e, index),
                onDrop: handleDropOnCanvas,
              };

              /* ---------- SECTION ---------- */
              if (field.type === "header") {
                return (
                  <React.Fragment key={field.id}>
                    <div
                      {...dragProps}
                      onMouseEnter={() => setHoverId(field.id)}
                      onMouseLeave={() => setHoverId((h) => (h === field.id ? null : h))}
                      style={{ position: "relative", margin: `26px calc(-1 * ${canvasPad}) 4px`, padding: `14px ${canvasPad} 14px 28px`, background: sectionColor + "14", borderLeft: `5px solid ${sectionColor}`, borderTop: `1px solid ${C.separator}`, borderBottom: `1px solid ${C.separator}`, cursor: dragArmed.current ? "grabbing" : "default", opacity: isDragging ? 0.35 : 1, transition: "opacity 0.15s" }}
                    >
                      {toolbar}
                      <div style={{ ...TS.caption, fontSize: 10, color: sectionColor, marginBottom: 4 }}>Section</div>
                      <input placeholder="Section title (e.g. Patient Information)" value={field.label || ""} onChange={(e) => updateField(field.id, "label", e.target.value)} style={{ ...TS.h2, width: "100%", border: "none", outline: "none", background: "transparent", color: sectionColor }} />
                    </div>
                    <DropLine slot={index + 1} />
                  </React.Fragment>
                );
              }

              /* ---------- RICH NOTE ---------- */
              if (field.type === "note") {
                return (
                  <React.Fragment key={field.id}>
                    <div
                      {...dragProps}
                      onMouseEnter={() => setHoverId(field.id)}
                      onMouseLeave={() => setHoverId((h) => (h === field.id ? null : h))}
                      style={{ position: "relative", margin: "10px 0 4px", padding: 16, background: C.orangeBg, borderRadius: 12, border: `1px solid ${C.orange}33`, opacity: isDragging ? 0.35 : 1, transition: "opacity 0.15s" }}
                    >
                      {toolbar}
                      <div style={{ ...TS.caption, fontSize: 10, color: C.orange, marginBottom: 8 }}>Rich Note</div>
                      <NoteEditor value={field.label} onChange={(v: string) => updateField(field.id, "label", v)} placeholder="Note shown to users — add formatting, images or video..." />
                    </div>
                    <DropLine slot={index + 1} />
                  </React.Fragment>
                );
              }

              /* ---------- ANSWERABLE FIELDS ---------- */
              return (
                <React.Fragment key={field.id}>
                  <div
                    {...dragProps}
                    onMouseEnter={() => setHoverId(field.id)}
                    onMouseLeave={() => setHoverId((h) => (h === field.id ? null : h))}
                    style={{ position: "relative", margin: "10px 0 4px", padding: "16px 16px 14px", borderRadius: 12, border: `1px solid ${isHover ? C.medBlue + "55" : C.separator}`, background: isDragging ? C.bg : (isHover ? "#FBFDFF" : C.card), opacity: isDragging ? 0.45 : 1, transition: "border-color 0.15s, background 0.15s, opacity 0.15s", cursor: dragArmed.current ? "grabbing" : "default" }}
                  >
                    {toolbar}

                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 10, minWidth: 0 }}>
                      <input
                        placeholder="Field label (e.g. Age, Height, Sex)"
                        value={field.label}
                        onChange={(e) => updateField(field.id, "label", e.target.value)}
                        style={{ ...TS.h3, flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", padding: 0, color: labelColor || C.textPrimary }}
                      />
                      {field.required && <span style={{ color: labelColor || C.red, fontWeight: 700, fontSize: 16, flexShrink: 0 }}>*</span>}
                      <span title={meta.label} style={{ ...TS.caption, fontSize: 9, color: C.textTertiary, background: C.bg, border: `1px solid ${C.separator}`, padding: "2px 7px", borderRadius: 6, flexShrink: 0 }}>{meta.icon} {meta.label}</span>
                    </div>

                    {field.type === "textarea" ? (
                      <textarea readOnly placeholder={field.placeholder || "Long answer"} value="" style={{ ...inputStyle, minHeight: 64, resize: "none", color: C.textTertiary }} />
                    ) : field.type === "dropdown" ? (
                      <div>
                        <div style={{ ...inputStyle, color: C.textTertiary, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "default" }}>
                          <span>{field.placeholder || "Select an option"}</span><span style={{ color: C.textTertiary }}>▾</span>
                        </div>
                        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                          {field.options.map((opt, i) => (
                            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                              <span style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${C.separator}`, flexShrink: 0 }} />
                              <input style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 14, color: C.textPrimary }} value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} placeholder={`Option ${i + 1}`} />
                              {field.options.length > 1 && <button onMouseDown={(e) => e.preventDefault()} onClick={() => removeOption(field.id, i)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", opacity: 0.6, fontSize: 13, flexShrink: 0 }}>✕</button>}
                            </div>
                          ))}
                          <button onMouseDown={(e) => e.preventDefault()} onClick={() => addOption(field.id)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.medBlue, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>+ Add option</button>
                        </div>
                      </div>
                    ) : field.type === "radio" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {field.options.map((opt, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ width: 15, height: 15, borderRadius: "50%", border: `2px solid ${C.separator}`, flexShrink: 0 }} />
                            <input style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 14, color: C.textPrimary }} value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} placeholder={`Option ${i + 1}`} />
                            {field.options.length > 1 && <button onMouseDown={(e) => e.preventDefault()} onClick={() => removeOption(field.id, i)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", opacity: 0.6, fontSize: 13, flexShrink: 0 }}>✕</button>}
                          </div>
                        ))}
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => addOption(field.id)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.medBlue, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>+ Add option</button>
                      </div>
                    ) : field.type === "checkbox" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {field.options.map((opt, i) => (
                          <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            <span style={{ width: 15, height: 15, borderRadius: 4, border: `2px solid ${C.separator}`, flexShrink: 0 }} />
                            <input style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontSize: 14, color: C.textPrimary }} value={opt} onChange={(e) => updateOption(field.id, i, e.target.value)} placeholder={`Option ${i + 1}`} />
                            {field.options.length > 1 && <button onMouseDown={(e) => e.preventDefault()} onClick={() => removeOption(field.id, i)} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", opacity: 0.6, fontSize: 13, flexShrink: 0 }}>✕</button>}
                          </div>
                        ))}
                        <button onMouseDown={(e) => e.preventDefault()} onClick={() => addOption(field.id)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: C.medBlue, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: 0 }}>+ Add option</button>
                      </div>
                    ) : field.type === "toggle" ? (
                      <div>
                        <div style={{ display: "flex", background: C.bg, borderRadius: 10, padding: 4, gap: 4, maxWidth: 240 }}>
                          <span style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, background: labelColor || C.medBlue, color: "#fff", fontWeight: 700, fontSize: 13 }}>{field.options[0] || "F"}</span>
                          <span style={{ flex: 1, textAlign: "center", padding: "8px 0", borderRadius: 8, color: C.textTertiary, fontWeight: 700, fontSize: 13 }}>{field.options[1] || "M"}</span>
                        </div>
                        <div style={{ display: "flex", gap: 8, marginTop: 8, maxWidth: 340 }}>
                          <input value={field.options[0] ?? ""} onChange={(e) => { const o = [...field.options]; o[0] = e.target.value; updateField(field.id, "options", o); }} style={miniInput} placeholder="Left label (e.g. F)" />
                          <input value={field.options[1] ?? ""} onChange={(e) => { const o = [...field.options]; o[1] = e.target.value; updateField(field.id, "options", o); }} style={miniInput} placeholder="Right label (e.g. M)" />
                        </div>
                      </div>
                    ) : field.type === "range" ? (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: C.separator, position: "relative" }}>
                            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: "50%", background: labelColor || C.medBlue, borderRadius: 2 }} />
                            <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: 18, height: 18, borderRadius: "50%", background: "#fff", border: `2px solid ${labelColor || C.medBlue}`, boxShadow: "0 1px 4px rgba(0,0,0,0.2)" }} />
                          </div>
                          <span style={{ minWidth: 48, fontWeight: 700, fontSize: 14, color: labelColor || C.textTertiary }}>{Math.floor(((cfg.min ?? 0) + (cfg.max ?? 100)) / 2)}{cfg.unit ? ` ${cfg.unit}` : ""}</span>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100px, 100%), 1fr))", gap: 8, marginTop: 10, maxWidth: 340 }}>
                          <div><label style={miniLabel}>Min</label><input type="number" value={cfg.min ?? ""} onChange={(e) => updateConfig(field.id, "min", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} /></div>
                          <div><label style={miniLabel}>Max</label><input type="number" value={cfg.max ?? ""} onChange={(e) => updateConfig(field.id, "max", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} /></div>
                          <div><label style={miniLabel}>Step</label><input type="number" value={cfg.step ?? ""} onChange={(e) => updateConfig(field.id, "step", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} /></div>
                        </div>
                      </div>
                    ) : field.type === "number" ? (
                      <div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <div style={{ ...inputStyle, color: C.textTertiary, flex: 1, minWidth: 0 }}>0</div>
                          {(cfg.unitOptions || []).length > 0 && (
                            <div style={{ ...inputStyle, width: 90, flexShrink: 0, color: C.textTertiary, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                              <span>{cfg.unit || "unit"}</span><span style={{ color: C.textTertiary }}>▾</span>
                            </div>
                          )}
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: 8, marginTop: 10 }}>
                          <div><label style={miniLabel}>Min</label><input type="number" value={cfg.min ?? ""} onChange={(e) => updateConfig(field.id, "min", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} /></div>
                          <div><label style={miniLabel}>Max</label><input type="number" value={cfg.max ?? ""} onChange={(e) => updateConfig(field.id, "max", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} /></div>
                          <div><label style={miniLabel}>Decimals (step)</label><input type="number" value={cfg.step ?? ""} onChange={(e) => updateConfig(field.id, "step", e.target.value === "" ? undefined : Number(e.target.value))} style={miniInput} placeholder="1 = whole" /></div>
                          <div><label style={miniLabel}>Unit</label><input value={cfg.unit ?? ""} onChange={(e) => updateConfig(field.id, "unit", e.target.value)} style={miniInput} placeholder="cm / kg" /></div>
                          <div><label style={miniLabel}>Unit choices</label><input value={(cfg.unitOptions || []).join(", ")} onChange={(e) => updateConfig(field.id, "unitOptions", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} style={miniInput} placeholder="cm, m" /></div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ ...inputStyle, flex: 1, minWidth: 0, color: C.textTertiary }}>
                          {field.placeholder || (field.type === "date" ? "DD/MM/YYYY" : field.type === "time" ? "--:--" : field.type === "phone" ? "+1 555 000 0000" : field.type === "email" ? "name@example.com" : "Short answer")}
                        </div>
                      </div>
                    )}

                    {(field.type === "text" || field.type === "phone" || field.type === "email" || field.type === "textarea" || field.type === "date" || field.type === "time") && (
                      <input
                        placeholder={field.type === "date" ? 'Hint — date format e.g. "DD/MM/YYYY"' : "Hint / placeholder (optional)"}
                        value={field.placeholder}
                        onChange={(e) => updateField(field.id, "placeholder", e.target.value)}
                        style={{ marginTop: 10, width: "100%", padding: "6px 10px", border: "none", outline: "none", background: "transparent", fontSize: 12, color: C.textTertiary, borderBottom: `1px dashed ${C.separator}`, boxSizing: "border-box" }}
                      />
                    )}
                  </div>
                  <DropLine slot={index + 1} />
                </React.Fragment>
              );
            })}
          </div>
        </div>

        <p style={{ ...TS.bodySm, margin: "12px 4px 0", fontSize: 12 }}>
          Tip: grab the ⠿ handle and drag any field to reorder it — a blue drop line shows where it will land. Hover a field to reveal its toolbar (colour, required, duplicate, move, delete).
        </p>
      </div>

      {/* ============ PREVIEW MODAL ============ */}
      {previewOpen && (
        <div onClick={() => setPreviewOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, width: "100%", maxWidth: 640, maxHeight: "85vh", overflowY: "auto", boxSizing: "border-box" }}>
            <div style={{ position: "sticky", top: 0, background: C.card, padding: "20px 24px 14px", borderBottom: `1px solid ${C.separator}`, display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, zIndex: 2 }}>
              <div style={{ minWidth: 0 }}>
                <div style={TS.h2}>{title || "Untitled form"}</div>
                {description && <div style={{ ...TS.bodySm, marginTop: 4 }}>{description}</div>}
              </div>
              <button onClick={() => setPreviewOpen(false)} title="Close preview" style={{ background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 8, width: 32, height: 32, cursor: "pointer", color: C.textSecondary, fontSize: 14, flexShrink: 0 }}>✕</button>
            </div>

            <div style={{ padding: "20px 24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
              {fields.length === 0 && (
                <p style={{ ...TS.bodySm, margin: 0 }}>Nothing to preview yet — add some fields first.</p>
              )}

              {fields.map((f) => {
                if (f.type === "header") {
                  const sc = f.config?.sectionColor || C.purple;
                  return (
                    <div key={f.id} style={{ margin: "10px -24px 0", padding: "12px 24px", background: sc + "14", borderLeft: `5px solid ${sc}`, borderTop: `1px solid ${C.separator}`, borderBottom: `1px solid ${C.separator}` }}>
                      <h2 style={{ ...TS.h2, margin: 0, color: sc }}>{f.label || "Untitled section"}</h2>
                    </div>
                  );
                }
                if (f.type === "note") {
                  const html = /<[a-z][\s\S]*>/i.test(f.label || "");
                  return html
                    ? <div key={f.id} style={{ background: C.orangeBg, borderRadius: 10, padding: "14px 18px", fontSize: 14, color: "#7A4A00" }} dangerouslySetInnerHTML={{ __html: f.label }} />
                    : <div key={f.id} style={{ background: C.orangeBg, borderRadius: 10, padding: "14px 18px", whiteSpace: "pre-wrap", fontSize: 14, color: "#7A4A00" }}>{f.label}</div>;
                }

                const val = previewAnswers[f.id];
                const c = f.config || {};
                const isObj = val && typeof val === "object" && !Array.isArray(val);
                const numVal = isObj ? (val as any).v : (typeof val === "number" ? val : "");
                const unitVal = isObj ? ((val as any).u || c.unit || "") : (c.unit || "");
                const dispUnit = f.type === "range" ? (c.unit || "") : unitVal;

                return (
                  <div key={f.id} style={{ background: C.bg, borderRadius: 12, padding: "18px 22px", border: `1px solid ${C.separator}` }}>
                    <div style={{ marginBottom: 10 }}>
                      <span style={{ ...TS.h3, color: c.labelColor || undefined }}>{f.label || "(untitled)"}</span>
                      {f.required && <span style={{ color: c.labelColor || C.red, fontWeight: 700 }}> *</span>}
                    </div>

                    {f.type === "textarea" ? (
                      <textarea placeholder={f.placeholder || "Type your answer..."} value={typeof val === "string" ? val : ""} onChange={(e) => setPreviewAnswer(f.id, e.target.value)} style={{ ...inputStyle, minHeight: 90, resize: "vertical" }} />
                    ) : f.type === "dropdown" ? (
                      <select value={typeof val === "string" ? val : ""} onChange={(e) => setPreviewAnswer(f.id, e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                        <option value="">{f.placeholder || "Select an option..."}</option>
                        {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                      </select>
                    ) : f.type === "radio" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {f.options.map((o) => (
                          <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15 }}>
                            <input type="radio" name={`preview_${f.id}`} checked={val === o} onChange={() => setPreviewAnswer(f.id, o)} style={{ width: 18, height: 18, accentColor: c.labelColor || C.medBlue }} />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : f.type === "checkbox" ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {f.options.map((o) => (
                          <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 15 }}>
                            <input type="checkbox" checked={Array.isArray(val) && val.includes(o)} onChange={(e) => {
                              const cur: string[] = Array.isArray(val) ? val : [];
                              setPreviewAnswer(f.id, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o));
                            }} style={{ width: 18, height: 18, accentColor: c.labelColor || C.green }} />
                            {o}
                          </label>
                        ))}
                      </div>
                    ) : f.type === "toggle" ? (
                      <div style={{ display: "flex", background: C.card, borderRadius: 10, padding: 4, gap: 4, maxWidth: 260 }}>
                        {(f.options.length === 2 ? f.options : ["F", "M"]).map((o) => (
                          <button key={o} type="button" onClick={() => setPreviewAnswer(f.id, o)} style={{ flex: 1, padding: "10px 0", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: "pointer", background: val === o ? (c.labelColor || C.medBlue) : "transparent", color: val === o ? "#fff" : C.textTertiary }}>{o}</button>
                        ))}
                      </div>
                    ) : f.type === "range" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                        <input type="range" min={c.min ?? 0} max={c.max ?? 100} step={c.step ?? 1} value={typeof numVal === "number" ? numVal : (c.min ?? 0)} onChange={(e) => setPreviewAnswer(f.id, Number(e.target.value))} style={{ flex: 1, accentColor: c.labelColor || C.medBlue }} />
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
                              if (raw === "") { setPreviewAnswer(f.id, { v: "", u: unitVal }); return; }
                              const n = Number(raw);
                              if (!Number.isNaN(n)) setPreviewAnswer(f.id, { v: n, u: unitVal });
                            } else setPreviewAnswer(f.id, e.target.value);
                          }}
                          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                        />
                        {f.type === "number" && (c.unitOptions || []).length > 0 && (
                          <select value={unitVal} onChange={(e) => setPreviewAnswer(f.id, { v: numVal, u: e.target.value })} style={{ ...inputStyle, width: 100, flexShrink: 0, padding: "8px 10px", cursor: "pointer" }}>
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

            <div style={{ position: "sticky", bottom: 0, background: C.card, borderTop: `1px solid ${C.separator}`, padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span style={{ ...TS.bodySm, fontSize: 12 }}>Preview only — nothing is saved.</span>
              <button onClick={() => setPreviewAnswers({})} style={{ ...TS.input, padding: "8px 14px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Reset answers</button>
            </div>
          </div>
        </div>
      )}

      {/* ============ DELETE CONFIRM MODAL ============ */}
      {showDeleteConfirm && (
        <div onClick={() => setShowDeleteConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, width: "100%", maxWidth: 420, padding: 24, boxSizing: "border-box" }}>
            <div style={TS.h3}>Delete this form?</div>
            <p style={{ ...TS.bodySm, margin: "10px 0 18px" }}>This permanently removes the form, its fields and all submissions. This action cannot be undone.</p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setShowDeleteConfirm(false)} style={{ ...TS.input, padding: "9px 16px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} style={{ ...TS.input, padding: "9px 16px", background: C.red, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: deleting ? "default" : "pointer", fontSize: 13, opacity: deleting ? 0.6 : 1 }}>{deleting ? "Deleting…" : "Delete"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}