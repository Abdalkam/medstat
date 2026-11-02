// src/admin/AdminFormBuilder.tsx

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { saveFormOfflineFirst, flushPendingFormOps, countPendingFormOps, queueFormOp } from "../database/formDB";

// ============================ design tokens (same system as AdminForms) ============================

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF", medBlueSoft: "#F0F7FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE", purpleBg: "#F5F0FF",
};
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TS = {
  h3: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, fontFamily: FONT, color: C.textPrimary },
};

// ============================ types ============================

export type FieldType = "header" | "note" | "text" | "longtext" | "number" | "date" | "select" | "multiselect" | "toggle";
export type FormStatus = "draft" | "published" | "closed";
export type AudienceKey = "everyone" | "trainers" | "trainees";
export type WidthKey = "full" | "half";

export interface FieldConfig {
  width?: WidthKey;            // "half" → two fields share one row; "full" → whole line
  required?: boolean;
  placeholder?: string;
  min?: number; max?: number; step?: number;
  unit?: string; unitOptions?: string[];
  sectionColor?: string;
}
export interface BuilderField { id: string; type: FieldType; label: string; options: string[] | null; config: FieldConfig; }
export interface FormMetaRow {
  id: string; tenant_id?: string | null; created_by?: string | null;
  title: string; description: string | null; status: FormStatus;
  visible_to: string[] | null; allow_download: boolean; updated_at?: string;
}
interface MetaState { title: string; description: string; status: FormStatus; audience: AudienceKey; allowDownload: boolean; }

const FIELD_TYPES: { type: FieldType; label: string; icon: string }[] = [
  { type: "header", label: "Section title", icon: "H" },
  { type: "note", label: "Note text", icon: "¶" },
  { type: "text", label: "Short text", icon: "Ab" },
  { type: "longtext", label: "Paragraph", icon: "≡" },
  { type: "number", label: "Number", icon: "#" },
  { type: "date", label: "Date", icon: "📅" },
  { type: "select", label: "Dropdown", icon: "▾" },
  { type: "multiselect", label: "Multi-select", icon: "☑" },
  { type: "toggle", label: "Toggle", icon: "⏻" },
];
const ANSWERABLE: FieldType[] = ["text", "longtext", "number", "date", "select", "multiselect", "toggle"];
const needsOptions = (t: FieldType) => t === "select" || t === "multiselect" || t === "toggle";

const STATUS_META: Record<FormStatus, { label: string; bg: string; fg: string }> = {
  draft: { label: "Draft", bg: C.orangeBg, fg: C.orange },
  published: { label: "Published", bg: C.greenBg, fg: C.green },
  closed: { label: "Closed", bg: C.redBg, fg: C.red },
};
const AUDIENCE_META: Record<AudienceKey, { label: string; bg: string; fg: string }> = {
  everyone: { label: "Everyone", bg: C.medBlueBg, fg: C.medBlue },
  trainers: { label: "Trainers", bg: C.orangeBg, fg: C.orange },
  trainees: { label: "Trainees", bg: C.greenBg, fg: C.green },
};
const SECTION_COLORS = [C.medBlue, C.green, C.orange, C.purple, C.textPrimary];

// ============================ small utilities ============================

let __seq = 0;
export function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch { /* older engine */ }
  __seq += 1;
  return `f-${Date.now().toString(36)}-${__seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isOnline(): boolean {
  try { return typeof navigator === "undefined" ? true : navigator.onLine !== false; } catch { return true; }
}

function withTimeout<T = any>(p: any, ms = 8000): Promise<T> {
  return Promise.race([Promise.resolve(p), new Promise<T>((_, rej) => setTimeout(() => rej(new Error("supabase-timeout")), ms))]);
}

// localStorage with in-memory fallback (keeps pure helpers testable everywhere)
const __mem = new Map<string, string>();
function lsGet(key: string): string | null { try { return localStorage.getItem(key); } catch { return __mem.get(key) ?? null; } }
function lsSet(key: string, val: string): void { try { localStorage.setItem(key, val); } catch { __mem.set(key, val); } }

export function audienceKeyOf(vt?: string[] | null): AudienceKey {
  const arr = Array.isArray(vt) ? vt : [];
  return arr.length === 0 || (arr.includes("trainer") && arr.includes("trainee")) ? "everyone"
    : arr.includes("trainer") ? "trainers" : "trainees";
}
export function visibleToOf(key: AudienceKey): string[] {
  return key === "trainers" ? ["trainer"] : key === "trainees" ? ["trainee"] : ["trainer", "trainee"];
}

export function newField(type: FieldType): BuilderField {
  const base: BuilderField = {
    id: uid(), type, label: "",
    options: null,
    config: { width: type === "header" || type === "note" ? "full" : "half" },
  };
  if (type === "number") base.config.step = 1;
  if (type === "select" || type === "multiselect") base.options = ["Option 1", "Option 2"];
  if (type === "toggle") base.options = ["Yes", "No"]; // [true-label, false-label]
  return base;
}

// Applied when the admin switches a field's TYPE after creation.
// Never touches width (the admin controls layout explicitly).
export function ensureTypeDefaults(f: BuilderField): BuilderField {
  const out: BuilderField = { ...f, config: { ...f.config } };
  if (f.type === "header" || f.type === "note") {
    out.config.width = "full";
    out.options = null;
    return out;
  }
  if (needsOptions(f.type)) {
    if (f.type === "toggle") {
      if (!Array.isArray(out.options) || out.options.length !== 2) out.options = ["Yes", "No"];
    } else if (!Array.isArray(out.options)) {
      out.options = ["Option 1", "Option 2"];
    }
  }
  if (f.type === "number" && out.config.step === undefined) out.config.step = 1;
  return out;
}

export function moveField(list: BuilderField[], idx: number, dir: -1 | 1): BuilderField[] {
  const to = idx + dir;
  if (idx < 0 || idx >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(idx, 1);
  next.splice(to, 0, item);
  return next;
}

export function duplicateField(list: BuilderField[], idx: number): BuilderField[] {
  const src = list[idx];
  if (!src) return [...list];
  const clone: BuilderField = { ...src, id: uid(), options: src.options ? [...src.options] : null, config: { ...src.config } };
  const next = [...list];
  next.splice(idx + 1, 0, clone);
  return next;
}

export function buildFieldRows(formId: string, fields: BuilderField[], tenantId?: string | null): Record<string, any>[] {
  return fields.map((f, i) => ({
    id: f.id,
    form_id: formId,
    tenant_id: tenantId ?? null,
    type: f.type,
    label: f.label,
    options: f.options,
    config: f.config,
    sort_order: i,
  }));
}

function normalizeFieldRow(r: any): BuilderField {
  const cfg: FieldConfig = r && typeof r.config === "object" && r.config !== null ? { ...r.config } : {};
  const type = (r?.type as FieldType) || "text";
  return {
    id: r?.id || uid(),
    type,
    label: r?.label || "",
    options: Array.isArray(r?.options) ? r.options.map(String) : null,
    config: cfg,
  };
}

function snapshotOf(m: MetaState, list: BuilderField[]): string {
  return JSON.stringify({
    t: m.title, d: m.description, s: m.status, a: m.audience, dl: m.allowDownload,
    f: list.map((f) => ({ id: f.id, type: f.type, label: f.label, options: f.options, config: f.config })),
  });
}

// ============================ cloud persistence (hardened, offline-queued) ============================

// The cloud persistence + offline queue now live in formDB.ts — one shared
// offline-first engine for the Forms list, this builder and the responses
// page. The helpers below are kept for compatibility and route through it.
export { upsertRows } from "../database/formDB";

// Compatibility wrapper: persists via the shared engine (local caches update
// instantly; cloud write attempted when online; queued automatically when
// offline or on failure).
export async function persistForm(form: FormMetaRow, fields: BuilderField[], removedFieldIds: string[], isExisting: boolean): Promise<void> {
  await saveFormOfflineFirst(form, fields, removedFieldIds, isExisting);
}

// ============================ responsive hook (2-per-row collapses on phones) ============================

function useIsNarrow(px = 720): boolean {
  const [narrow, setNarrow] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(`(max-width: ${px}px)`).matches
      : false
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(`(max-width: ${px}px)`);
    const fn = () => setNarrow(mq.matches);
    try { mq.addEventListener("change", fn); } catch { /* older engines */ }
    return () => { try { mq.removeEventListener("change", fn); } catch { /* noop */ } };
  }, [px]);
  return narrow;
}

// ============================ shared inline styles ============================

const bigInput: CSSProperties = { ...TS.input, width: "100%", padding: "12px 14px", fontSize: 18, fontWeight: 700, border: `1px solid ${C.separator}`, borderRadius: 12, background: C.card, outline: "none", boxSizing: "border-box" };
const metaInput: CSSProperties = { ...TS.input, width: "100%", padding: "10px 14px", border: `1px solid ${C.separator}`, borderRadius: 10, background: C.card, outline: "none", boxSizing: "border-box" };
const previewInput: CSSProperties = { ...TS.input, width: "100%", padding: "10px 12px", border: `1px solid ${C.separator}`, borderRadius: 10, background: "#fff", outline: "none", boxSizing: "border-box" };
const smallInput: CSSProperties = { ...TS.input, fontSize: 13, padding: "7px 10px", border: `1px solid ${C.separator}`, borderRadius: 8, background: "#fff", outline: "none", boxSizing: "border-box", width: "100%" };
const iconBtn: CSSProperties = { width: 30, height: 30, borderRadius: 8, border: `1px solid ${C.separator}`, background: C.card, color: C.textSecondary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontFamily: FONT, flexShrink: 0, lineHeight: 1, padding: 0 };
const cardShell: CSSProperties = { background: C.card, borderRadius: 14, border: `1px solid ${C.separator}`, padding: "18px 20px", boxSizing: "border-box" };

// ============================ component ============================

export default function AdminFormBuilder() {
  const params = useParams();
  const routeFormId: string | undefined = params.formId;
  const navigate = useNavigate();
  const location = useLocation();

  const currentUser = useMemo<any>(() => {
    try { return JSON.parse(lsGet("currentUser") || "{}"); } catch { return {}; }
  }, []);

  const generatedIdRef = useRef<string>(uid());
  const formId: string = routeFormId || generatedIdRef.current;
  const isNewRoute = !routeFormId;

  const [meta, setMeta] = useState<MetaState>({ title: "", description: "", status: "draft", audience: "everyone", allowDownload: true });
  const [fields, setFields] = useState<BuilderField[]>([]);
  const [loading, setLoading] = useState<boolean>(!!routeFormId);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ kind: "info" | "warn" | "ok" | "error"; text: string } | null>(null);
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [preview, setPreview] = useState<Record<string, any>>({});
  const [testOut, setTestOut] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const [savedSnapshot, setSavedSnapshot] = useState<string>("");

  const dirty = useMemo(() => snapshotOf(meta, fields) !== savedSnapshot, [meta, fields, savedSnapshot]);
  const dirtyRef = useRef<boolean>(false);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  const savedFieldIdsRef = useRef<Set<string>>(new Set());
  const removedIdsRef = useRef<Set<string>>(new Set());
  const isExistingRef = useRef<boolean>(!!routeFormId);
  const titleRef = useRef<HTMLInputElement | null>(null);

  // -------- hydration helpers --------
  function hydrateFromRow(row: any, list: any[]): void {
    const m: MetaState = {
      title: row?.title || "",
      description: row?.description || "",
      status: (row?.status as FormStatus) || "draft",
      audience: audienceKeyOf(row?.visible_to),
      allowDownload: row?.allow_download !== false,
    };
    const list2 = (Array.isArray(list) ? list : []).map(normalizeFieldRow);
    setMeta(m);
    setFields(list2);
    setSavedSnapshot(snapshotOf(m, list2));
    savedFieldIdsRef.current = new Set(list2.map((f) => f.id));
  }

  // -------- OFFLINE-FIRST load (cached render → online refresh) --------
  useEffect(() => {
    let cancelled = false;
    setPendingCount(countPendingFormOps());
    // "Saved ✓" survives the new→edit remount via history state (set in handleSave)
    const justSaved = !!(location.state as any)?.justSaved;
    setBanner(justSaved
      ? { kind: "ok", text: "Saved ✓" }
      : (isOnline() ? null : { kind: "warn", text: "You're offline — you can keep editing; saves will sync when you reconnect." }));

    if (isOnline()) {
      flushPendingFormOps()
        .then((n) => { if (n > 0 && !cancelled) setPendingCount(countPendingFormOps()); })
        .catch(() => { /* kept queued */ });
    }

    if (!routeFormId) { setLoading(false); return; } // NEW form — nothing to load

    (async () => {
      // STEP 1: cached render (offline-safe)
      let hadCache = false;
      try {
        const cm = lsGet(`cachedFormMeta_${routeFormId}`);
        const cf = lsGet(`cachedFormFields_${routeFormId}`);
        if (cm) {
          hadCache = true;
          if (!dirtyRef.current) hydrateFromRow(JSON.parse(cm), cf ? JSON.parse(cf) : []);
          setLoading(false);
        }
      } catch { /* corrupt cache — ignore */ }

      if (!isOnline()) { if (!cancelled) setLoading(false); return; }

      // STEP 2: online refresh + re-cache
      try {
        const { data: row } = (await withTimeout(
          supabase.from("forms").select("*").eq("id", routeFormId).maybeSingle(), 8000
        )) as any;
        const { data: ff } = (await withTimeout(
          supabase.from("form_fields").select("id, type, label, options, config")
            .eq("form_id", routeFormId).order("sort_order", { ascending: true }), 8000
        )) as any;
        if (cancelled) return;
        const list = (ff || []).map(normalizeFieldRow);
        if (row) {
          if (!dirtyRef.current) hydrateFromRow(row, list);
          isExistingRef.current = true;
          try {
            lsSet(`cachedFormMeta_${routeFormId}`, JSON.stringify(row));
            lsSet(`cachedFormFields_${routeFormId}`, JSON.stringify(list));
          } catch { /* storage full — ignore */ }
        } else if (!hadCache && !dirtyRef.current) {
          setNotFound(true);
        }
      } catch (e) {
        console.warn("AdminFormBuilder: load failed; using cache:", e);
        if (!cancelled && !hadCache) setBanner({ kind: "warn", text: "Couldn't reach the server — showing the last saved copy." });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeFormId]);

  // -------- silent re-flush when the device comes back online --------
  useEffect(() => {
    const onOnline = () => {
      setBanner((b) => (b && b.kind === "warn" ? null : b));
      flushPendingFormOps()
        .then(() => setPendingCount(countPendingFormOps()))
        .catch(() => { /* kept queued */ });
    };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  // -------- field operations --------
  const addField = (type: FieldType) => setFields((p) => [...p, newField(type)]);
  const updateField = (id: string, patch: Partial<BuilderField>) => setFields((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const updateConfig = (id: string, patch: Partial<FieldConfig>) => setFields((p) => p.map((f) => (f.id === id ? { ...f, config: { ...f.config, ...patch } } : f)));
  const changeType = (id: string, type: FieldType) => setFields((p) => p.map((f) => (f.id === id ? ensureTypeDefaults({ ...f, type }) : f)));
  const removeField = (idx: number) => {
    const f = fields[idx];
    if (!f) return;
    if (savedFieldIdsRef.current.has(f.id)) removedIdsRef.current.add(f.id);
    setFields((p) => p.filter((x) => x.id !== f.id));
  };

  // -------- SAVE (online → cloud; offline/failed → queue + cache) --------
  // -------- SAVE (offline-first: local instantly, cloud when possible) --------
  async function handleSave() {
    if (!meta.title.trim()) {
      setBanner({ kind: "error", text: "Please give the form a name before saving." });
      titleRef.current?.focus();
      return;
    }
    const nextMeta: MetaState = { ...meta, title: meta.title.trim() };
    const form: FormMetaRow = {
      id: formId,
      tenant_id: currentUser?.tenantId ?? null,
      created_by: currentUser?.id ?? null,
      title: nextMeta.title,
      description: nextMeta.description || null,
      status: nextMeta.status,
      visible_to: visibleToOf(nextMeta.audience),
      allow_download: nextMeta.allowDownload,
    };
    const removed = Array.from(removedIdsRef.current);

    setSaving(true);
    setBanner(null);
    try {
      // One shared offline-first engine (formDB.ts): local caches update
      // instantly (Dexie + localStorage), the cloud write is attempted when
      // online, and the whole intent is queued automatically on failure —
      // nothing is ever lost and the UI never blocks on the network.
      const reachedCloud = await saveFormOfflineFirst(form, fields, removed, isExistingRef.current);
      removedIdsRef.current.clear();
      setMeta(nextMeta);
      setSavedSnapshot(snapshotOf(nextMeta, fields));
      setPendingCount(countPendingFormOps());
      setBanner(
        reachedCloud
          ? { kind: "ok", text: "Saved to cloud \u2713" }
          : isOnline()
            ? { kind: "warn", text: "Cloud save failed \u2014 kept on this device and queued to retry." }
            : { kind: "info", text: "Saved on this device \u2014 it will sync automatically when you're back online." }
      );
    } catch (e: any) {
      // Never lose work, even if the local cache layer itself throws.
      queueFormOp({ kind: "upsert_form", payload: form, fields, removedFieldIds: removed });
      removedIdsRef.current.clear();
      setMeta(nextMeta);
      setSavedSnapshot(snapshotOf(nextMeta, fields));
      setPendingCount(countPendingFormOps());
      setBanner({ kind: "info", text: "Saved on this device \u2014 it will sync automatically when you're back online." });
    } finally {
      setSaving(false);
      if (!isExistingRef.current) {
        isExistingRef.current = true;
        navigate(`/admin/forms/${formId}/edit`, { replace: true, state: { justSaved: true } });
      }
    }
  }

  // -------- preview helpers (mirrors exactly what trainees/trainers fill) --------
  const narrow = useIsNarrow();
  const gridStyle: CSSProperties = { display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: 16, alignItems: "start" };
  const spanStyle = (f: BuilderField): CSSProperties =>
    !narrow && f.config.width === "half" && ANSWERABLE.includes(f.type) ? {} : { gridColumn: "1 / -1" };

  function setPreviewValue(id: string, value: any) { setPreview((p) => ({ ...p, [id]: value })); }

  function renderPreviewField(f: BuilderField) {
    const label = f.label || "(untitled field)";
    if (f.type === "header") {
      return (
        <div key={f.id} style={{ ...spanStyle(f), paddingTop: 6 }}>
          <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: f.config.sectionColor || C.textPrimary, fontFamily: FONT }}>{label}</div>
          <div style={{ height: 1, background: C.separator, marginTop: 8 }} />
        </div>
      );
    }
    if (f.type === "note") {
      return (
        <div key={f.id} style={{ ...spanStyle(f), ...TS.bodySm, fontSize: 14 }}>{label}</div>
      );
    }
    const asterisk = f.config.required ? <span style={{ color: C.red }}> *</span> : null;
    return (
      <div key={f.id} style={{ ...cardShell, padding: "16px 18px", ...spanStyle(f) }}>
        <div style={{ ...TS.bodySm, color: C.textSecondary, fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
          {label}{asterisk}
        </div>

        {f.type === "text" && (
          <input type="text" value={preview[f.id] ?? ""} placeholder={f.config.placeholder || ""} onChange={(e) => setPreviewValue(f.id, e.target.value)} style={previewInput} />
        )}

        {f.type === "longtext" && (
          <textarea rows={3} value={preview[f.id] ?? ""} placeholder={f.config.placeholder || ""} onChange={(e) => setPreviewValue(f.id, e.target.value)} style={{ ...previewInput, resize: "vertical" }} />
        )}

        {f.type === "number" && (() => {
          const pv = preview[f.id] ?? {};
          const units = Array.isArray(f.config.unitOptions) ? f.config.unitOptions : [];
          const v = pv?.v ?? "";
          const u = pv?.u ?? f.config.unit ?? "";
          return (
            <div style={{ display: "flex", gap: 8 }}>
              <input type="number" value={v} min={f.config.min} max={f.config.max} step={f.config.step || 1} onChange={(e) => setPreviewValue(f.id, { v: e.target.value, u: u || null })} style={previewInput} />
              {units.length > 0 && (
                <select value={u} onChange={(e) => setPreviewValue(f.id, { v, u: e.target.value })} style={{ ...previewInput, width: 96, flexShrink: 0 }}>
                  <option value="">—</option>
                  {units.map((un) => <option key={un} value={un}>{un}</option>)}
                </select>
              )}
            </div>
          );
        })()}

        {f.type === "date" && (
          <input type="date" value={preview[f.id] ?? ""} onChange={(e) => setPreviewValue(f.id, e.target.value)} style={previewInput} />
        )}

        {f.type === "select" && (
          <select value={preview[f.id] ?? ""} onChange={(e) => setPreviewValue(f.id, e.target.value)} style={previewInput}>
            <option value="">Select…</option>
            {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )}

        {f.type === "multiselect" && (() => {
          const arr: string[] = Array.isArray(preview[f.id]) ? preview[f.id] : [];
          return (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {(f.options || []).map((o) => (
                <label key={o} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontFamily: FONT, color: C.textPrimary, cursor: "pointer" }}>
                  <input type="checkbox" checked={arr.includes(o)} onChange={(e) => setPreviewValue(f.id, e.target.checked ? [...arr, o] : arr.filter((x) => x !== o))} />
                  {o}
                </label>
              ))}
            </div>
          );
        })()}

        {f.type === "toggle" && (() => {
          const opts = Array.isArray(f.options) && f.options.length === 2 ? f.options : ["Yes", "No"];
          const on = preview[f.id] === true;
          return (
            <div onClick={() => setPreviewValue(f.id, !on)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
              <div style={{ width: 40, height: 24, borderRadius: 12, background: on ? C.green : C.separator, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                <div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: on ? 18 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </div>
              <span style={{ ...TS.body, fontSize: 15 }}>{on ? opts[0] : opts[1]}</span>
            </div>
          );
        })()}
      </div>
    );
  }

  // -------- edit-mode field card --------
  function renderFieldCard(f: BuilderField, idx: number) {
    const staticType = f.type === "header" || f.type === "note";
    const width: WidthKey = f.config.width === "half" ? "half" : "full";
    return (
      <div key={f.id} style={{ ...cardShell, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* row 1: type · label · actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select value={f.type} onChange={(e) => changeType(f.id, e.target.value as FieldType)} title="Field type" style={{ ...smallInput, width: 128, flexShrink: 0, fontWeight: 700 }}>
            {FIELD_TYPES.map((t) => <option key={t.type} value={t.type}>{t.icon} {t.label}</option>)}
          </select>
          <input value={f.label} onChange={(e) => updateField(f.id, { label: e.target.value })} placeholder={staticType ? (f.type === "header" ? "Section title (e.g. Vital Signs)" : "Note text shown to the user") : "Field label (e.g. Weight)"} style={{ ...smallInput, flex: 1, minWidth: 160, fontSize: 14, fontWeight: 600 }} />
          <button onClick={() => setFields((p) => moveField(p, idx, -1))} disabled={idx === 0} title="Move up" style={{ ...iconBtn, opacity: idx === 0 ? 0.35 : 1 }}>↑</button>
          <button onClick={() => setFields((p) => moveField(p, idx, 1))} disabled={idx === fields.length - 1} title="Move down" style={{ ...iconBtn, opacity: idx === fields.length - 1 ? 0.35 : 1 }}>↓</button>
          <button onClick={() => setFields((p) => duplicateField(p, idx))} title="Duplicate field" style={iconBtn}>⧉</button>
          <button onClick={() => removeField(idx)} title="Delete field" style={{ ...iconBtn, color: C.red, background: C.redBg, borderColor: `${C.red}22` }}>✕</button>
        </div>

        {/* row 2: layout width · required */}
        <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {!staticType && (
            <div style={{ display: "inline-flex", border: `1px solid ${C.separator}`, borderRadius: 9, overflow: "hidden" }}>
              {(["full", "half"] as WidthKey[]).map((w) => (
                <button key={w} onClick={() => updateConfig(f.id, { width: w })} title={w === "full" ? "Takes the whole line" : "Two fields share one row"}
                  style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: "pointer", border: "none", background: width === w ? C.medBlue : C.card, color: width === w ? "#fff" : C.textSecondary }}>
                  {w === "full" ? "▭ Full (1/1)" : "◨ Half (1/2)"}
                </button>
              ))}
            </div>
          )}
          {ANSWERABLE.includes(f.type) && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, fontFamily: FONT, color: C.textSecondary, cursor: "pointer" }}>
              <input type="checkbox" checked={!!f.config.required} onChange={(e) => updateConfig(f.id, { required: e.target.checked })} />
              Required
            </label>
          )}
        </div>

        {/* row 3: type-specific config */}
        {f.type === "number" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([["Min", "min"], ["Max", "max"], ["Step", "step"]] as const).map(([lbl, key]) => (
              <div key={key} style={{ width: 84 }}>
                <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary, marginBottom: 3 }}>{lbl}</div>
                <input type="number" value={f.config[key] ?? ""} onChange={(e) => { const s = e.target.value.trim(); updateConfig(f.id, { [key]: s === "" ? undefined : Number(s) } as Partial<FieldConfig>); }} style={smallInput} />
              </div>
            ))}
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary, marginBottom: 3 }}>Units (comma separated)</div>
              <input value={(f.config.unitOptions || []).join(", ")} onChange={(e) => {
                const units = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                updateConfig(f.id, { unitOptions: units.length ? units : undefined, unit: units.length ? (f.config.unit && units.includes(f.config.unit) ? f.config.unit : units[0]) : undefined });
              }} placeholder="e.g. kg, g, mg" style={smallInput} />
            </div>
          </div>
        )}

        {needsOptions(f.type) && f.type !== "toggle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary }}>{f.type === "select" ? "Dropdown options" : "Checkbox options"}</div>
            {(f.options || []).map((o, oi) => (
              <div key={oi} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input value={o} onChange={(e) => { const arr = [...(f.options || [])]; arr[oi] = e.target.value; updateField(f.id, { options: arr }); }} placeholder={`Option ${oi + 1}`} style={smallInput} />
                <button onClick={() => updateField(f.id, { options: (f.options || []).filter((_, x) => x !== oi) })} title="Remove option" style={{ ...iconBtn, color: C.red }}>✕</button>
              </div>
            ))}
            <button onClick={() => updateField(f.id, { options: [...(f.options || []), `Option ${(f.options?.length || 0) + 1}`] })} style={{ ...smallInput, width: "auto", alignSelf: "flex-start", background: C.medBlueSoft, color: C.medBlue, border: `1px solid ${C.medBlue}22`, fontWeight: 700, cursor: "pointer", padding: "6px 12px" }}>+ Add option</button>
          </div>
        )}

        {f.type === "toggle" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([["ON label (true)", 0], ["OFF label (false)", 1]] as const).map(([lbl, i]) => {
              const opts = Array.isArray(f.options) && f.options.length === 2 ? f.options : ["Yes", "No"];
              return (
                <div key={i} style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary, marginBottom: 3 }}>{lbl}</div>
                  <input value={opts[i]} onChange={(e) => { const arr = [...opts]; arr[i] = e.target.value; updateField(f.id, { options: arr }); }} style={smallInput} />
                </div>
              );
            })}
          </div>
        )}

        {(f.type === "text" || f.type === "longtext") && (
          <div>
            <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary, marginBottom: 3 }}>Placeholder (optional)</div>
            <input value={f.config.placeholder || ""} onChange={(e) => updateConfig(f.id, { placeholder: e.target.value || undefined })} placeholder="e.g. Type here…" style={smallInput} />
          </div>
        )}

        {f.type === "header" && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ ...TS.caption, fontSize: 9, color: C.textTertiary }}>Title colour</div>
            {SECTION_COLORS.map((col) => (
              <button key={col} onClick={() => updateConfig(f.id, { sectionColor: col })} title={col}
                style={{ width: 24, height: 24, borderRadius: "50%", background: col, cursor: "pointer", border: (f.config.sectionColor || C.textPrimary) === col ? "2px solid #fff" : "none", boxShadow: (f.config.sectionColor || C.textPrimary) === col ? `0 0 0 2px ${col}` : "0 0 0 1px rgba(0,0,0,0.08)", padding: 0 }} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ============================ render ============================

  if (loading) {
    return (
      <div style={{ minHeight: "100%", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT }}>
        <span style={{ ...TS.body, fontWeight: 500 }}>Loading form…</span>
      </div>
    );
  }

  const bannerColors: Record<string, { bg: string; fg: string }> = {
    info: { bg: C.medBlueBg, fg: C.medBlue },
    warn: { bg: C.orangeBg, fg: C.orange },
    ok: { bg: C.greenBg, fg: C.green },
    error: { bg: C.redBg, fg: C.red },
  };

  const answerableFields = fields.filter((f) => ANSWERABLE.includes(f.type));

  return (
    <div style={{ minHeight: "100%", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <style>{`button:focus-visible { outline: 2px solid ${C.medBlue}; outline-offset: 1px; }`}</style>

      {/* ===== STICKY TOOLBAR — back · mode · save ===== */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: C.bg }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 24px", maxWidth: 940, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
          <button onClick={() => navigate("/admin/forms")} title="Back to Forms" style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {isNewRoute ? "New form" : "Edit form"}{dirty ? " •" : ""}
            </div>
            <div style={{ ...TS.bodySm, fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {meta.title || "Untitled form"} · {fields.length} field{fields.length === 1 ? "" : "s"}
            </div>
          </div>
          <button onClick={handleSave} disabled={saving} style={{ background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, cursor: saving ? "default" : "pointer", padding: "9px 22px", fontSize: 14, fontWeight: 700, fontFamily: FONT, flexShrink: 0, boxShadow: "0 2px 8px rgba(0,122,255,0.25)", opacity: saving ? 0.7 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div style={{ maxWidth: 940, margin: "0 auto", padding: "16px 24px 110px", width: "100%", boxSizing: "border-box" }}>
        {/* ===== status banners ===== */}
        {pendingCount > 0 && (
          <div style={{ background: C.medBlueBg, color: C.medBlue, borderRadius: 12, padding: "12px 18px", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>
            ⇅ {pendingCount} unsynced form change{pendingCount === 1 ? "" : "s"} — they'll upload automatically when you're online.
          </div>
        )}
        {banner && (
          <div style={{ background: bannerColors[banner.kind].bg, color: bannerColors[banner.kind].fg, borderRadius: 12, padding: "12px 18px", marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{banner.text}</span>
            <button onClick={() => setBanner(null)} title="Dismiss" style={{ background: "none", border: "none", color: bannerColors[banner.kind].fg, cursor: "pointer", fontSize: 14, fontWeight: 700, padding: 2 }}>✕</button>
          </div>
        )}

        {notFound ? (
          <div style={{ ...cardShell, padding: "60px 40px", textAlign: "center" }}>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Form not found</h3>
            <p style={{ ...TS.bodySm, margin: 0 }}>This form may have been deleted. <button onClick={() => navigate("/admin/forms")} style={{ background: "none", border: "none", color: C.medBlue, fontWeight: 700, cursor: "pointer", fontSize: 14, fontFamily: FONT, padding: 0 }}>Back to Forms</button></p>
          </div>
        ) : (
          <>
            {/* ===== FORM META — name · description · settings ===== */}
            <div style={{ ...cardShell, display: "flex", flexDirection: "column", gap: 14, marginBottom: 18 }}>
              <div>
                <div style={{ ...TS.caption, fontSize: 10, color: C.textTertiary, marginBottom: 6 }}>Form name</div>
                <input ref={titleRef} value={meta.title} onChange={(e) => setMeta((m) => ({ ...m, title: e.target.value }))} placeholder="e.g. Patient Vitals Intake" style={bigInput} />
              </div>
              <div>
                <div style={{ ...TS.caption, fontSize: 10, color: C.textTertiary, marginBottom: 6 }}>Description (optional)</div>
                <input value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} placeholder="Short instructions shown at the top of the form" style={metaInput} />
              </div>
              <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...TS.caption, fontSize: 10, color: C.textTertiary }}>Status</div>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    {(["draft", "published", "closed"] as FormStatus[]).map((s) => (
                      <button key={s} onClick={() => setMeta((m) => ({ ...m, status: s }))}
                        style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: "pointer", borderRadius: 8, border: meta.status === s ? `1px solid ${STATUS_META[s].fg}44` : `1px solid ${C.separator}`, background: meta.status === s ? STATUS_META[s].bg : C.card, color: meta.status === s ? STATUS_META[s].fg : C.textSecondary }}>
                        {STATUS_META[s].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ ...TS.caption, fontSize: 10, color: C.textTertiary }}>Audience</div>
                  <div style={{ display: "inline-flex", gap: 4 }}>
                    {(["everyone", "trainers", "trainees"] as AudienceKey[]).map((a) => (
                      <button key={a} onClick={() => setMeta((m) => ({ ...m, audience: a }))}
                        style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, fontFamily: FONT, cursor: "pointer", borderRadius: 8, border: meta.audience === a ? `1px solid ${AUDIENCE_META[a].fg}44` : `1px solid ${C.separator}`, background: meta.audience === a ? AUDIENCE_META[a].bg : C.card, color: meta.audience === a ? AUDIENCE_META[a].fg : C.textSecondary }}>
                        {AUDIENCE_META[a].label}
                      </button>
                    ))}
                  </div>
                </div>
                <div onClick={() => setMeta((m) => ({ ...m, allowDownload: !m.allowDownload }))} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", userSelect: "none" }}>
                  <div style={{ width: 34, height: 20, borderRadius: 10, background: meta.allowDownload ? C.green : C.separator, position: "relative", flexShrink: 0, transition: "background 0.2s" }}>
                    <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: meta.allowDownload ? 16 : 2, transition: "left 0.2s" }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: meta.allowDownload ? C.green : C.textTertiary }}>⬇ User downloads {meta.allowDownload ? "allowed" : "blocked"}</span>
                </div>
              </div>
            </div>

            {/* ===== TABS — edit fields | preview ===== */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
              <div style={{ display: "inline-flex", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, overflow: "hidden" }}>
                {([["edit", "✎ Edit fields"], ["preview", "▷ Preview"]] as const).map(([key, lbl]) => (
                  <button key={key} onClick={() => setTab(key)}
                    style={{ padding: "9px 18px", fontSize: 13, fontWeight: 700, fontFamily: FONT, cursor: "pointer", border: "none", background: tab === key ? C.medBlue : C.card, color: tab === key ? "#fff" : C.textSecondary }}>
                    {lbl}
                  </button>
                ))}
              </div>
              <span style={{ ...TS.bodySm, fontSize: 12 }}>◨ Half = two fields share a row · ▭ Full = whole line</span>
            </div>

            {tab === "edit" ? (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {fields.length === 0 && (
                    <div style={{ padding: "40px 24px", textAlign: "center", border: `2px dashed ${C.separator}`, borderRadius: 14, background: C.card }}>
                      <p style={{ ...TS.body, margin: "0 0 4px", fontWeight: 600 }}>No fields yet</p>
                      <p style={{ ...TS.bodySm, margin: 0 }}>Add your first entry field below — e.g. Short text for a name, Number for a measurement.</p>
                    </div>
                  )}
                  {fields.map((f, idx) => renderFieldCard(f, idx))}
                </div>

                {/* add-field palette */}
                <div style={{ ...cardShell, marginTop: 14 }}>
                  <div style={{ ...TS.caption, fontSize: 10, color: C.textTertiary, marginBottom: 10 }}>Add a field</div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {FIELD_TYPES.map((t) => (
                      <button key={t.type} onClick={() => addField(t.type)} title={`Add a ${t.label.toLowerCase()} field`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", fontSize: 13, fontWeight: 600, fontFamily: FONT, cursor: "pointer", borderRadius: 9, border: `1px solid ${C.medBlue}22`, background: C.medBlueSoft, color: C.medBlue }}>
                        <span style={{ fontWeight: 800 }}>{t.icon}</span> {t.label}
                      </button>
                    ))}
                  </div>
                  <p style={{ ...TS.bodySm, fontSize: 12, margin: "10px 0 0" }}>New entry fields start at ½ width, so two of them sit side by side on one line.</p>
                </div>
              </>
            ) : (
              <>
                {/* ===== LIVE PREVIEW — exactly how users will see & fill the form ===== */}
                <div style={{ ...cardShell, marginBottom: 14 }}>
                  <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: C.textPrimary, fontFamily: FONT }}>{meta.title || "Untitled form"}</div>
                  {meta.description && <div style={{ ...TS.bodySm, marginTop: 4 }}>{meta.description}</div>}
                </div>
                <div style={gridStyle}>
                  {fields.length === 0 && (
                    <div style={{ gridColumn: "1 / -1", padding: "40px 24px", textAlign: "center", border: `2px dashed ${C.separator}`, borderRadius: 14, background: C.card }}>
                      <p style={{ ...TS.bodySm, margin: 0 }}>Add fields in the Edit tab to see the form preview here.</p>
                    </div>
                  )}
                  {fields.map((f) => renderPreviewField(f))}
                </div>
                {answerableFields.length > 0 && (
                  <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                    <button onClick={() => {
                      const answers: Record<string, any> = {};
                      fields.forEach((f) => {
                        if (!ANSWERABLE.includes(f.type)) return;
                        const a = preview[f.id];
                        if (a !== undefined && a !== "" && !(Array.isArray(a) && a.length === 0)) answers[f.id] = a;
                      });
                      setTestOut(JSON.stringify(answers, null, 2));
                      console.log("AdminFormBuilder test submit payload:", answers);
                    }} style={{ background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 700, fontFamily: FONT, cursor: "pointer" }}>
                      ▷ Test submit
                    </button>
                    {testOut && (
                      <pre style={{ width: "100%", boxSizing: "border-box", background: C.textPrimary, color: "#7CFC9B", borderRadius: 12, padding: 14, fontSize: 12, fontFamily: "Menlo, monospace", overflowX: "auto", margin: 0 }}>{testOut}</pre>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ===== UNSAVED-CHANGES BAR ===== */}
      {dirty && (
        <div style={{ position: "fixed", bottom: 16, left: 0, right: 0, display: "flex", justifyContent: "center", zIndex: 60, pointerEvents: "none" }}>
          <div style={{ pointerEvents: "auto", background: C.textPrimary, color: "#fff", borderRadius: 14, padding: "10px 14px", display: "flex", gap: 12, alignItems: "center", boxShadow: "0 8px 30px rgba(0,0,0,0.25)" }}>
            <span style={{ fontSize: 13, fontWeight: 600, fontFamily: FONT }}>Unsaved changes</span>
            <button onClick={handleSave} disabled={saving} style={{ background: C.medBlue, border: "none", color: "#fff", borderRadius: 9, padding: "8px 16px", fontWeight: 700, fontSize: 13, fontFamily: FONT, cursor: saving ? "default" : "pointer", opacity: saving ? 0.7 : 1 }}>
              {saving ? "Saving…" : "Save form"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
