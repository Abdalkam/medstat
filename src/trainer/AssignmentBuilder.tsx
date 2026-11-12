// src/trainer/AssignmentBuilder.tsx
// Builds/edits a training module: title & details, unlock rule, and slides of
// text / media / question blocks.
import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../auth/supabase";

/* ============================== design tokens ============================= */

const C = {
  bg: "#F2F2F7",
  card: "#FFFFFF",
  text: "#1C1C1E",
  sub: "#8E8E93",
  sep: "#E5E5EA",
  blue: "#007AFF",
  green: "#34C759",
  orange: "#FF9F0A",
  red: "#FF3B30",
  purple: "#AF52DE",
};

const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const TS = {
  title: { fontSize: 20, fontWeight: 700, letterSpacing: -0.3 } as React.CSSProperties,
  headline: { fontSize: 16, fontWeight: 600 } as React.CSSProperties,
  body: { fontSize: 15, fontWeight: 400 } as React.CSSProperties,
  caption: { fontSize: 13, fontWeight: 500 } as React.CSSProperties,
  micro: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.8,
    textTransform: "uppercase" as const,
  } as React.CSSProperties,
};

const SHADOW = "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.06)";
const CARD: React.CSSProperties = {
  background: C.card,
  border: `1px solid ${C.sep}`,
  borderRadius: 16,
  boxShadow: SHADOW,
  width: "100%",
  boxSizing: "border-box",
};

/* Container for each block (text / media / question) inside a slide. */
const BLOCK_BOX: React.CSSProperties = {
  background: C.bg,
  border: `1px solid ${C.sep}`,
  borderRadius: 12,
  padding: 14,
};

const MEDIA_BUCKET = "assignment-media";

/* Markup markers for the bold/italic/underline toolbar. */
const MARKERS: Record<"bold" | "italic" | "underline", string> = {
  bold: "**",
  italic: "*",
  underline: "__",
};

/* ================================= types ================================== */

type Align = "left" | "center" | "right";
type MediaKind = "image" | "video" | "audio" | "file";
type QuestionKind = "short" | "long" | "single" | "multi";

interface TextBlock {
  type: "text";
  id: string;
  text: string;
  align: Align;
}

interface MediaBlock {
  type: "media";
  id: string;
  path: string;
  name: string;
  mime: string;
  size: number;
  kind: MediaKind;
}

interface QuestionBlock {
  type: "question";
  id: string;
  prompt: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
}

type Block = TextBlock | MediaBlock | QuestionBlock;

interface Slide {
  id: string;
  title: string;
  blocks: Block[];
}

interface AssignmentContent {
  slides: Slide[];
}

interface BusinessInfo {
  name: string;
  phone: string;
  logo: string | null;
}

/* ================================ helpers ================================= */

/* Always a valid uuid — safe to use for database id columns (even when the
   table has no default on "id") and for local block/slide ids alike. */
function uid(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function kindOf(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

function formatBytes(n: number): string {
  if (!n && n !== 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function mediaUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/* Inline text formatting: **bold**  *italic*  __underline__.
   Rendered with React nodes (no innerHTML), so it is XSS-safe by construction. */
const MARKUP_RE = /(\*\*([^*]+)\*\*)|(__([^_]+)__)|(\*([^*]+)\*)/g;

function renderFormatted(text: string): React.ReactNode[] {
  if (!text) return [];
  const nodes: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  MARKUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKUP_RE.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1]) nodes.push(<b key={key++}>{m[2]}</b>);
    else if (m[3]) nodes.push(<u key={key++}>{m[4]}</u>);
    else nodes.push(<i key={key++}>{m[6]}</i>);
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function normalizeBlock(raw: any): Block | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "text") {
    return {
      type: "text",
      id: typeof raw.id === "string" ? raw.id : uid(),
      text: typeof raw.text === "string" ? raw.text : "",
      align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
    };
  }
  if (raw.type === "media") {
    if (typeof raw.path !== "string" || !raw.path) return null;
    return {
      type: "media",
      id: typeof raw.id === "string" ? raw.id : uid(),
      path: raw.path,
      name: typeof raw.name === "string" ? raw.name : "Media",
      mime: typeof raw.mime === "string" ? raw.mime : "application/octet-stream",
      size: typeof raw.size === "number" ? raw.size : 0,
      kind: (["image", "video", "audio", "file"] as MediaKind[]).includes(raw.kind) ? raw.kind : kindOf(raw.mime ?? ""),
    };
  }
  if (raw.type === "question") {
    return {
      type: "question",
      id: typeof raw.id === "string" ? raw.id : uid(),
      prompt: typeof raw.prompt === "string" ? raw.prompt : "",
      kind: (["short", "long", "single", "multi"] as QuestionKind[]).includes(raw.kind) ? raw.kind : "long",
      options: Array.isArray(raw.options) ? raw.options.map(String) : [],
      required: raw.required !== false,
    };
  }
  return null;
}

function parseContent(raw: any): AssignmentContent {
  if (raw && Array.isArray(raw.slides)) {
    return {
      slides: raw.slides.map((s: any, i: number) => ({
        id: typeof s?.id === "string" ? s.id : uid(),
        title: typeof s?.title === "string" ? s.title : `Slide ${i + 1}`,
        blocks: Array.isArray(s?.blocks) ? (s.blocks.map(normalizeBlock).filter(Boolean) as Block[]) : [],
      })),
    };
  }
  return { slides: [] };
}

function readLocalBusiness(): BusinessInfo | null {
  try {
    const raw = localStorage.getItem("localBusinessSettings");
    if (!raw) return null;
    const o = JSON.parse(raw);
    return { name: o.businessName ?? o.business_name ?? "", phone: o.phone ?? "", logo: o.logo ?? null };
  } catch {
    return null;
  }
}

/* ================================= icons ================================== */

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconTrash = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
  </svg>
);

const IconArrowUp = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5" />
    <path d="M5 12l7-7 7 7" />
  </svg>
);

const IconArrowDown = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5v14" />
    <path d="M19 12l-7 7-7-7" />
  </svg>
);

const IconImage = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M21 15.5l-4.5-4.5L7 20.5" />
  </svg>
);

const IconVideo = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2.5" y="5" width="14" height="14" rx="2.5" />
    <path d="M22 8l-5.5 4L22 16z" />
  </svg>
);

const IconAudio = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l11-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="17" cy="16" r="3" />
  </svg>
);

const IconFile = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
  </svg>
);

const IconUpload = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4" />
    <path d="M7 9l5-5 5 5" />
    <path d="M4 20h16" />
  </svg>
);

const AlignGlyph = ({ kind }: { kind: Align }) => {
  const short =
    kind === "left" ? { x1: 3, x2: 12 } : kind === "center" ? { x1: 5.5, x2: 14.5 } : { x1: 8, x2: 17 };
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <line x1="3" y1="4.5" x2="17" y2="4.5" />
      <line x1={short.x1} y1="10" x2={short.x2} y2="10" />
      <line x1="3" y1="15.5" x2="13" y2="15.5" />
    </svg>
  );
};

/* ============================== small controls ============================= */

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: C.bg,
  border: `1px solid ${C.sep}`,
  borderRadius: 10,
  padding: "12px 14px",
  fontSize: 15,
  fontFamily: FONT,
  color: C.text,
  outline: "none",
};

function focusBorder(on: boolean, e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = on ? C.blue : C.sep;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ ...TS.caption, color: C.sub, marginBottom: 6, fontWeight: 600 }}>{children}</div>;
}

/* Selectable card for the "next module unlocks" setting */
function unlockOptionStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "rgba(0,122,255,0.06)" : C.card,
    border: active ? "2px solid rgba(0,122,255,0.55)" : `1.5px solid ${C.sep}`,
    borderRadius: 12,
    padding: "12px 14px",
    cursor: "pointer",
    fontFamily: FONT,
    textAlign: "left",
  };
}

function MiniIconBtn({
  onClick,
  disabled,
  danger,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      style={{
        width: 32,
        height: 32,
        borderRadius: 9,
        border: `1px solid ${C.sep}`,
        background: C.card,
        color: danger ? C.red : C.sub,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {children}
    </button>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 46,
        height: 28,
        borderRadius: 14,
        background: on ? C.green : "#D1D1D6",
        border: "none",
        position: "relative",
        cursor: "pointer",
        transition: "background .2s",
        flexShrink: 0,
      }}
      aria-pressed={on}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 20 : 2,
          width: 24,
          height: 24,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "0 1px 3px rgba(0,0,0,0.25)",
          transition: "left .2s",
          display: "block",
        }}
      />
    </button>
  );
}

function AlignPicker({ value, onChange }: { value: Align; onChange: (a: Align) => void }) {
  const opts: { key: Align; label: string }[] = [
    { key: "left", label: "Left" },
    { key: "center", label: "Centre" },
    { key: "right", label: "Right" },
  ];
  return (
    <div style={{ display: "inline-flex", background: C.bg, border: `1px solid ${C.sep}`, borderRadius: 10, padding: 3, gap: 2 }}>
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 11px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 12.5,
              fontWeight: 600,
              fontFamily: FONT,
              background: active ? C.card : "transparent",
              color: active ? C.blue : C.sub,
              boxShadow: active ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}
          >
            <AlignGlyph kind={o.key} />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function FormatBar({ onFormat }: { onFormat: (format: "bold" | "italic" | "underline") => void }) {
  const items: { key: "bold" | "italic" | "underline"; label: string; title: string; style: React.CSSProperties }[] = [
    { key: "bold", label: "B", title: "Bold \u2014 **text** (Ctrl+B)", style: { fontWeight: 800 } },
    { key: "italic", label: "I", title: "Italic \u2014 *text* (Ctrl+I)", style: { fontStyle: "italic", fontFamily: "Georgia, 'Times New Roman', serif" } },
    { key: "underline", label: "U", title: "Underline \u2014 __text__ (Ctrl+U)", style: { textDecoration: "underline" } },
  ];
  return (
    <div style={{ display: "inline-flex", gap: 4, marginBottom: 8, background: C.bg, border: `1px solid ${C.sep}`, borderRadius: 10, padding: 3 }}>
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          title={it.title}
          onClick={() => onFormat(it.key)}
          style={{
            width: 34,
            height: 28,
            borderRadius: 8,
            border: "none",
            background: "transparent",
            color: C.text,
            fontSize: 14,
            cursor: "pointer",
            fontFamily: FONT,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...it.style,
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function BlockTag({ tone, children }: { tone: "blue" | "purple" | "green"; children: React.ReactNode }) {
  const map = {
    blue: { bg: "rgba(0,122,255,0.10)", fg: C.blue },
    purple: { bg: "rgba(175,82,222,0.12)", fg: C.purple },
    green: { bg: "rgba(52,199,89,0.14)", fg: "#1E8E4A" },
  }[tone];
  return (
    <span
      style={{
        ...TS.micro,
        color: map.fg,
        background: map.bg,
        padding: "4px 9px",
        borderRadius: 7,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* ================================== page =================================== */

export default function AssignmentBuilder() {
  const navigate = useNavigate();
  // Accept any common route-param name so a mismatch in App.tsx routes can't break loading.
  const params = useParams<{
    courseId?: string;
    assignmentId?: string;
    id?: string;
    moduleId?: string;
  }>();
  const courseId = params.courseId;
  const assignmentId = params.assignmentId ?? params.id ?? params.moduleId;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [passmark, setPassmark] = useState("50");
  const [status, setStatus] = useState("published");
  /* Trainer's choice for WHEN the next module unlocks:
     "completed" (default) = after the trainee submits everything and the
     trainer marks it; "any" = as soon as the trainee submits, even with
     skipped questions. Stored in content jsonb as unlockNext. */
  const [unlockNext, setUnlockNext] = useState<"completed" | "any">("completed");
  const [slides, setSlides] = useState<Slide[]>([]);

  const [loading, setLoading] = useState(Boolean(assignmentId));
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [business, setBusiness] = useState<BusinessInfo>(
    () => readLocalBusiness() ?? { name: "", phone: "", logo: null }
  );

  const fileRef = useRef<HTMLInputElement | null>(null);
  const targetSlideRef = useRef<number>(0);
  const taRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  /* ------------------------------ data loading ----------------------------- */

  useEffect(() => {
    const raw = localStorage.getItem("currentUser");
    if (!raw) {
      navigate("/");
      return;
    }
    let user: any = null;
    try {
      user = JSON.parse(raw);
    } catch {
      navigate("/");
      return;
    }
    if (!user?.tenantId || !courseId) {
      setLoadErr("No course selected.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: bs } = await supabase
          .from("business_settings")
          .select("business_name, phone, logo")
          .eq("tenant_id", user.tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (bs) {
          const mapped: BusinessInfo = { name: bs.business_name ?? "", phone: bs.phone ?? "", logo: bs.logo ?? null };
          setBusiness(mapped);
          try {
            localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
          } catch {
            /* ignore */
          }
        }

        if (assignmentId) {
          const { data, error } = await supabase
            .from("assignments")
            .select("id, title, description, passmark, status, content")
            .eq("id", assignmentId)
            .eq("tenant_id", user.tenantId)
            .maybeSingle();
          if (cancelled) return;
          if (error) throw error;
          if (!data) {
            setLoadErr("Module not found.");
          } else {
            setTitle(data.title ?? "");
            setDescription(data.description ?? "");
            setPassmark(data.passmark != null ? String(data.passmark) : "0");
            setStatus(data.status ?? "published");
            setSlides(parseContent(data.content).slides);
            const rawContent = (data.content ?? {}) as any;
            setUnlockNext(rawContent.unlockNext === "any" ? "any" : "completed");
          }
        }
      } catch (e: any) {
        if (!cancelled) {
          const msg = String(e?.message ?? "Failed to load the module.");
          setLoadErr(
            msg.toLowerCase().includes("content")
              ? `${msg} — run the included SQL setup (it adds the "content" column).`
              : msg
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, assignmentId, navigate]);

  /* ------------------------------ slide helpers ----------------------------- */

  const setSlide = (idx: number, fn: (s: Slide) => Slide) =>
    setSlides((prev) => prev.map((s, i) => (i === idx ? fn(s) : s)));

  const addSlide = () =>
    setSlides((prev) => [
      ...prev,
      { id: uid(), title: "", blocks: [] },
    ]);

  const removeSlide = (idx: number) =>
    setSlides((prev) => prev.filter((_, i) => i !== idx));

  const moveSlide = (idx: number, dir: -1 | 1) =>
    setSlides((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });

  const addBlock = (slideIdx: number, block: Block) =>
    setSlide(slideIdx, (s) => ({ ...s, blocks: [...s.blocks, block] }));

  const updateBlock = (slideIdx: number, blockId: string, patch: Record<string, unknown>) =>
    setSlide(slideIdx, (s) => ({
      ...s,
      blocks: s.blocks.map((b) => (b.id === blockId ? ({ ...b, ...patch } as Block) : b)),
    }));

  const removeBlock = (slideIdx: number, blockId: string) => {
    const slide = slides[slideIdx];
    const block = slide?.blocks.find((b) => b.id === blockId);
    if (block && block.type === "media") {
      // Best-effort cleanup of the storage object; ignore failures.
      supabase.storage.from(MEDIA_BUCKET).remove([block.path]).then(() => undefined, () => undefined);
    }
    setSlide(slideIdx, (s) => ({ ...s, blocks: s.blocks.filter((b) => b.id !== blockId) }));
  };

  /* ----------------------------- text formatting ---------------------------- */

  const applyMarkup = (
    si: number,
    blockId: string,
    format: "bold" | "italic" | "underline",
    field: "text" | "prompt" = "text"
  ) => {
    const marker = MARKERS[format];
    const ta = taRefs.current[blockId];
    if (!ta) return;
    const value = ta.value;
    const s = ta.selectionStart ?? value.length;
    const e = ta.selectionEnd ?? value.length;
    const sel = value.slice(s, e);
    const before = value.slice(Math.max(0, s - marker.length), s);
    const after = value.slice(e, e + marker.length);

    let newValue: string;
    let selStart: number;
    let selEnd: number;

    if (before === marker && after === marker) {
      // Already wrapped just outside the selection — unwrap (toggle off).
      newValue = value.slice(0, s - marker.length) + sel + value.slice(e + marker.length);
      selStart = s - marker.length;
      selEnd = e - marker.length;
    } else if (sel.startsWith(marker) && sel.endsWith(marker) && sel.length >= marker.length * 2) {
      // Selection itself is wrapped — unwrap.
      const inner = sel.slice(marker.length, sel.length - marker.length);
      newValue = value.slice(0, s) + inner + value.slice(e);
      selStart = s;
      selEnd = s + inner.length;
    } else {
      // Wrap the selection (or insert sample text if empty).
      const base = sel || "text";
      newValue = value.slice(0, s) + marker + base + marker + value.slice(e);
      selStart = s + marker.length;
      selEnd = selStart + base.length;
    }

    updateBlock(si, blockId, { [field]: newValue });
    requestAnimationFrame(() => {
      const el = taRefs.current[blockId];
      if (el) {
        el.focus();
        el.setSelectionRange(selStart, selEnd);
      }
    });
  };

  const handleFormatShortcut = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    si: number,
    blockId: string,
    field: "text" | "prompt"
  ) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i" || k === "u") {
        e.preventDefault();
        applyMarkup(si, blockId, k === "b" ? "bold" : k === "i" ? "italic" : "underline", field);
      }
    }
  };

  /* ------------------------------- media upload ----------------------------- */

  const handleUpload = async (file: File) => {
    const raw = localStorage.getItem("currentUser");
    const user = raw ? JSON.parse(raw) : null;
    if (!user?.tenantId || !courseId) {
      setSaveErr("Cannot upload media: missing course or account context.");
      return;
    }
    setUploading(true);
    setSaveErr(null);
    try {
      const path = `${user.tenantId}/${courseId}/${uid()}-${file.name}`;
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
          upsert: false,
        });
      if (error) throw error;
      const block: MediaBlock = {
        type: "media",
        id: uid(),
        path,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        kind: kindOf(file.type || ""),
      };
      addBlock(targetSlideRef.current, block);
    } catch (e: any) {
      setSaveErr(
        String(e?.message ?? "Upload failed.").toLowerCase().includes("bucket")
          ? `Upload failed: storage bucket "${MEDIA_BUCKET}" not found — run the included SQL setup first.`
          : String(e?.message ?? "Upload failed.")
      );
    } finally {
      setUploading(false);
    }
  };

  /* ---------------------------------- save ---------------------------------- */

  const questionCount = slides.reduce(
    (n, s) => n + s.blocks.filter((b) => b.type === "question").length,
    0
  );

  const handleSave = async () => {
    const raw = localStorage.getItem("currentUser");
    const user = raw ? JSON.parse(raw) : null;
    if (!user?.tenantId || !courseId) {
      setSaveErr("Missing course or account context.");
      return;
    }
    if (!title.trim()) {
      setSaveErr("Please give the module a title before saving.");
      return;
    }
    setSaving(true);
    setSaveErr(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim(),
        passmark: Number(passmark) || 0,
        status,
        content: { slides, unlockNext },
        tenant_id: user.tenantId,
        course_id: courseId,
      };
      let error: any = null;
      if (assignmentId) {
        const r = await supabase
          .from("assignments")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", assignmentId)
          .eq("tenant_id", user.tenantId);
        error = r.error;
      } else {
        // Creating: fill every column the table requires itself.
        // trainer_id is NOT NULL on this schema; created_at is sent in
        // case the column has no default.
        const created = {
          ...payload,
          id: uid(),
          trainer_id: user.id,
          created_at: new Date().toISOString(),
        };
        const r = await supabase.from("assignments").insert(created);
        error = r.error;
      }
      if (error) throw error;
      navigate(`/trainer/assignments/${courseId}`);
    } catch (e: any) {
      const msg = String(e?.message ?? "Could not save the module.");
      setSaveErr(
        msg.toLowerCase().includes("content")
          ? `${msg} — run the included SQL setup (it adds the "content" column).`
          : msg
      );
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------- render --------------------------------- */

  const logoInitial = (business.name || "B").trim().charAt(0).toUpperCase();

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text }}>
      {/* ------------------------------- App bar ------------------------------ */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "rgba(255,255,255,0.86)",
          backdropFilter: "saturate(180%) blur(20px)",
          WebkitBackdropFilter: "saturate(180%) blur(20px)",
          borderBottom: `1px solid ${C.sep}`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", width: "100%", boxSizing: "border-box" }}>
          <button
            onClick={() => navigate(`/trainer/assignments/${courseId}`)}
            title="Back to modules"
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: C.blue,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
            }}
          >
            <IconChevronLeft />
          </button>
          {business.logo ? (
            <img src={business.logo} alt="" style={{ width: 38, height: 38, borderRadius: 10, objectFit: "cover" }} />
          ) : (
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 10,
                background: `linear-gradient(135deg, ${C.blue}, #5856D6)`,
                color: "#fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 16,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {logoInitial}
            </div>
          )}
          <div style={{ minWidth: 0 }}>
            <div style={{ ...TS.headline, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {business.name || "Business"}
            </div>
            <div style={{ ...TS.caption, color: C.sub }}>Assignment builder</div>
          </div>
          <div style={{ flex: 1 }} />
          {uploading && (
            <span style={{ ...TS.caption, color: C.orange, fontWeight: 700 }}>Uploading media…</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving || uploading}
            style={{
              background: C.blue,
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: saving || uploading ? "default" : "pointer",
              opacity: saving || uploading ? 0.6 : 1,
              boxShadow: "0 4px 14px rgba(0,122,255,0.28)",
              whiteSpace: "nowrap",
            }}
          >
            {saving ? "Saving…" : assignmentId ? "Save changes" : "Create module"}
          </button>
        </div>
      </div>

      {/* -------------------------- Body: full width --------------------------- */}
      <div style={{ padding: "28px clamp(20px, 4vw, 48px) 96px" }}>
        <div style={{ ...TS.micro, color: C.sub, marginBottom: 6 }}>
          {assignmentId ? "Editing module" : "New module"}
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 22 }}>
          <h1 style={{ ...TS.title, fontSize: 26, margin: 0 }}>Assignment Builder</h1>
          <span style={{ ...TS.caption, color: C.sub }}>
            {slides.length} slide{slides.length === 1 ? "" : "s"} · {questionCount} question{questionCount === 1 ? "" : "s"}
          </span>
        </div>

        {loadErr && (
          <div style={{ background: "rgba(255,59,48,0.10)", border: "1px solid rgba(255,59,48,0.35)", color: C.red, borderRadius: 12, padding: "12px 16px", fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
            {loadErr}
          </div>
        )}
        {saveErr && (
          <div style={{ background: "rgba(255,59,48,0.10)", border: "1px solid rgba(255,59,48,0.35)", color: C.red, borderRadius: 12, padding: "12px 16px", fontSize: 14, fontWeight: 600, marginBottom: 16 }}>
            {saveErr}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "64px 0", textAlign: "center", ...TS.body, color: C.sub }}>Loading module…</div>
        ) : (
          <>
            {/* ------------------------------ Basics ------------------------------ */}
            <div style={{ ...TS.micro, color: C.sub, marginBottom: 8 }}>Details</div>
            <div style={{ ...CARD, padding: "20px 22px", marginBottom: 28 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{ gridColumn: "1 / -1" }}>
                  <FieldLabel>Module title</FieldLabel>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Workplace Safety — Week 1"
                    style={inputStyle}
                    onFocus={(e) => focusBorder(true, e)}
                    onBlur={(e) => focusBorder(false, e)}
                  />
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <FieldLabel>Description</FieldLabel>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    placeholder="What will trainees learn in this module?"
                    style={{ ...inputStyle, resize: "vertical" }}
                    onFocus={(e) => focusBorder(true, e)}
                    onBlur={(e) => focusBorder(false, e)}
                  />
                </div>
                <div>
                  <FieldLabel>Pass mark (%)</FieldLabel>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={passmark}
                    onChange={(e) => setPassmark(e.target.value)}
                    style={inputStyle}
                    onFocus={(e) => focusBorder(true, e)}
                    onBlur={(e) => focusBorder(false, e)}
                  />
                </div>
                <div>
                  <FieldLabel>Status</FieldLabel>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    style={{ ...inputStyle, appearance: "none", cursor: "pointer" }}
                  >
                    <option value="published">Published</option>
                    <option value="draft">Draft</option>
                  </select>
                </div>
                <div style={{ gridColumn: "1 / -1" }}>
                  <FieldLabel>Next module unlocks…</FieldLabel>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => setUnlockNext("completed")}
                      style={unlockOptionStyle(unlockNext === "completed")}
                    >
                      <div
                        style={{
                          ...TS.caption,
                          fontWeight: 700,
                          color: unlockNext === "completed" ? C.blue : C.text,
                          marginBottom: 3,
                        }}
                      >
                        After all questions are completed
                      </div>
                      <div style={{ ...TS.caption, fontWeight: 400, color: C.sub }}>
                        Default — the next module opens once the trainee has submitted and you have
                        marked their answers (tick/cross).
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUnlockNext("any")}
                      style={unlockOptionStyle(unlockNext === "any")}
                    >
                      <div
                        style={{
                          ...TS.caption,
                          fontWeight: 700,
                          color: unlockNext === "any" ? C.blue : C.text,
                          marginBottom: 3,
                        }}
                      >
                        Even without completing all questions
                      </div>
                      <div style={{ ...TS.caption, fontWeight: 400, color: C.sub }}>
                        The next module opens as soon as the trainee submits — skipped questions are
                        allowed and marking is not required first.
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* ------------------------------ Slides ------------------------------ */}
            <div style={{ ...TS.micro, color: C.sub, marginBottom: 8 }}>Slides</div>

            {slides.length === 0 && (
              <div
                style={{
                  ...CARD,
                  padding: "48px 24px",
                  textAlign: "center",
                  borderStyle: "dashed",
                  marginBottom: 20,
                }}
              >
                <div style={{ ...TS.headline, marginBottom: 6 }}>No slides yet</div>
                <div style={{ ...TS.body, color: C.sub, marginBottom: 18 }}>
                  Slides are numbered 1, 2, 3… — add learning content, media and questions to each one.
                </div>
                <button
                  onClick={addSlide}
                  style={{
                    background: C.blue,
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "11px 20px",
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: FONT,
                    cursor: "pointer",
                  }}
                >
                  Create the first slide
                </button>
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {slides.map((slide, si) => (
                <div key={slide.id} style={{ ...CARD, padding: "18px 20px" }}>
                  {/* Slide header — numbered 1, 2, 3… */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: 10,
                        background: "rgba(0,122,255,0.10)",
                        color: C.blue,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 800,
                        fontSize: 15,
                        flexShrink: 0,
                      }}
                    >
                      {si + 1}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TS.headline, fontSize: 17 }}>Slide {si + 1}</div>
                      <div style={{ ...TS.caption, color: C.sub }}>
                        {slide.blocks.length} block{slide.blocks.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <MiniIconBtn title="Move up" onClick={() => moveSlide(si, -1)} disabled={si === 0}>
                      <IconArrowUp />
                    </MiniIconBtn>
                    <MiniIconBtn title="Move down" onClick={() => moveSlide(si, 1)} disabled={si === slides.length - 1}>
                      <IconArrowDown />
                    </MiniIconBtn>
                    <MiniIconBtn title="Delete slide" danger onClick={() => removeSlide(si)}>
                      <IconTrash />
                    </MiniIconBtn>
                  </div>

                  <FieldLabel>Slide title (optional)</FieldLabel>
                  <input
                    value={slide.title}
                    onChange={(e) => setSlide(si, (s) => ({ ...s, title: e.target.value }))}
                    placeholder={`Slide ${si + 1} title`}
                    style={{ ...inputStyle, marginBottom: 12 }}
                    onFocus={(e) => focusBorder(true, e)}
                    onBlur={(e) => focusBorder(false, e)}
                  />

                  {/* Blocks */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {slide.blocks.map((block) => {
                      if (block.type === "text") {
                        return (
                          <div key={block.id} style={BLOCK_BOX}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                              <BlockTag tone="blue">Text</BlockTag>
                              <div style={{ flex: 1 }} />
                              <AlignPicker value={block.align} onChange={(al) => updateBlock(si, block.id, { align: al })} />
                              <MiniIconBtn title="Remove text block" danger onClick={() => removeBlock(si, block.id)}>
                                <IconTrash />
                              </MiniIconBtn>
                            </div>
                            <FormatBar onFormat={(f) => applyMarkup(si, block.id, f, "text")} />
                            <textarea
                              ref={(el) => { taRefs.current[block.id] = el; }}
                              value={block.text}
                              onChange={(e) => updateBlock(si, block.id, { text: e.target.value })}
                              onKeyDown={(e) => handleFormatShortcut(e, si, block.id, "text")}
                              rows={3}
                              placeholder="Write the learning content…"
                              style={{ ...inputStyle, background: C.card, resize: "vertical", textAlign: block.align }}
                              onFocus={(e) => focusBorder(true, e)}
                              onBlur={(e) => focusBorder(false, e)}
                            />
                            {block.text.trim().length > 0 && (
                              <div
                                style={{
                                  marginTop: 8,
                                  fontSize: 14,
                                  lineHeight: 1.5,
                                  color: C.text,
                                  background: C.card,
                                  border: `1px dashed ${C.sep}`,
                                  borderRadius: 10,
                                  padding: "9px 12px",
                                  textAlign: block.align,
                                  whiteSpace: "pre-wrap",
                                }}
                              >
                                <span style={{ ...TS.micro, color: C.sub, display: "block", marginBottom: 4 }}>Preview</span>
                                {renderFormatted(block.text)}
                              </div>
                            )}
                          </div>
                        );
                      }

                      if (block.type === "media") {
                        const url = mediaUrl(block.path);
                        return (
                          <div key={block.id} style={BLOCK_BOX}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
                              <BlockTag tone="purple">Media</BlockTag>
                              <span style={{ color: C.purple, display: "inline-flex", flexShrink: 0 }}>
                                {block.kind === "image" ? (
                                  <IconImage />
                                ) : block.kind === "video" ? (
                                  <IconVideo />
                                ) : block.kind === "audio" ? (
                                  <IconAudio />
                                ) : (
                                  <IconFile />
                                )}
                              </span>
                              <span style={{ ...TS.caption, color: C.text, fontWeight: 600, wordBreak: "break-all" }}>{block.name}</span>
                              <span style={{ ...TS.caption, color: C.sub }}>
                                {formatBytes(block.size)}
                              </span>
                              <div style={{ flex: 1 }} />
                              <MiniIconBtn title="Remove media" danger onClick={() => removeBlock(si, block.id)}>
                                <IconTrash />
                              </MiniIconBtn>
                            </div>
                            {block.kind === "image" && (
                              <img src={url} alt={block.name} style={{ maxWidth: "100%", maxHeight: 280, borderRadius: 10, display: "block" }} />
                            )}
                            {block.kind === "video" && (
                              <video src={url} controls style={{ width: "100%", maxWidth: 560, borderRadius: 10, display: "block", background: "#000" }} />
                            )}
                            {block.kind === "audio" && (
                              <audio src={url} controls style={{ width: "100%", maxWidth: 480, display: "block" }} />
                            )}
                            {block.kind === "file" && (
                              <a href={url} target="_blank" rel="noreferrer" style={{ ...TS.caption, color: C.blue, display: "inline-flex", alignItems: "center", gap: 7, textDecoration: "none" }}>
                                <IconFile /> Open file
                              </a>
                            )}
                          </div>
                        );
                      }

                      // question
                      return (
                        <div key={block.id} style={BLOCK_BOX}>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                            <BlockTag tone="green">Question</BlockTag>
                            <div style={{ flex: 1 }} />
                            <MiniIconBtn title="Remove question" danger onClick={() => removeBlock(si, block.id)}>
                              <IconTrash />
                            </MiniIconBtn>
                          </div>
                          <FormatBar onFormat={(f) => applyMarkup(si, block.id, f, "prompt")} />
                          <textarea
                            ref={(el) => { taRefs.current[block.id] = el; }}
                            value={block.prompt}
                            onChange={(e) => updateBlock(si, block.id, { prompt: e.target.value })}
                            onKeyDown={(e) => handleFormatShortcut(e, si, block.id, "prompt")}
                            rows={2}
                            placeholder="Type the question…"
                            style={{ ...inputStyle, background: C.card, resize: "vertical", marginBottom: 10 }}
                            onFocus={(e) => focusBorder(true, e)}
                            onBlur={(e) => focusBorder(false, e)}
                          />
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
                            <div>
                              <FieldLabel>Answer type</FieldLabel>
                              <select
                                value={block.kind}
                                onChange={(e) => updateBlock(si, block.id, { kind: e.target.value as QuestionKind })}
                                style={{ ...inputStyle, background: C.card, appearance: "none", cursor: "pointer" }}
                              >
                                <option value="short">Short answer</option>
                                <option value="long">Long answer</option>
                                <option value="single">Single choice</option>
                                <option value="multi">Multiple select</option>
                              </select>
                            </div>
                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                background: C.card,
                                border: `1px solid ${C.sep}`,
                                borderRadius: 10,
                                padding: "12px 14px",
                                minHeight: 47,
                                boxSizing: "border-box",
                              }}
                            >
                              <Toggle on={block.required} onChange={(v) => updateBlock(si, block.id, { required: v })} />
                              <span style={{ ...TS.caption, color: C.sub }}>
                                Required — trainee must answer before submitting
                              </span>
                            </div>
                          </div>

                          {(block.kind === "single" || block.kind === "multi") && (
                            <div style={{ marginTop: 10 }}>
                              <FieldLabel>Options</FieldLabel>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                {block.options.map((opt, oi) => (
                                  <div key={oi} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                    <span
                                      style={{
                                        width: 22,
                                        height: 22,
                                        borderRadius: block.kind === "single" ? 999 : 6,
                                        border: `2px solid ${C.sep}`,
                                        flexShrink: 0,
                                      }}
                                    />
                                    <input
                                      value={opt}
                                      onChange={(e) =>
                                        updateBlock(si, block.id, {
                                          options: block.options.map((o, k) => (k === oi ? e.target.value : o)),
                                        })
                                      }
                                      placeholder={`Option ${oi + 1}`}
                                      style={{ ...inputStyle, background: C.card }}
                                      onFocus={(e) => focusBorder(true, e)}
                                      onBlur={(e) => focusBorder(false, e)}
                                    />
                                    <MiniIconBtn
                                      title="Remove option"
                                      danger
                                      onClick={() =>
                                        updateBlock(si, block.id, {
                                          options: block.options.filter((_, k) => k !== oi),
                                        })
                                      }
                                    >
                                      <IconTrash />
                                    </MiniIconBtn>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  onClick={() => updateBlock(si, block.id, { options: [...block.options, ""] })}
                                  style={{
                                    alignSelf: "flex-start",
                                    background: "transparent",
                                    border: `1.5px dashed ${C.sep}`,
                                    color: C.blue,
                                    borderRadius: 9,
                                    padding: "8px 14px",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    fontFamily: FONT,
                                    cursor: "pointer",
                                  }}
                                >
                                  + Add option
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add-block row */}
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    {[
                      {
                        label: "Text",
                        icon: <span style={{ fontWeight: 800 }}>T</span>,
                        onClick: () => addBlock(si, { type: "text", id: uid(), text: "", align: "left" }),
                      },
                      {
                        label: uploading ? "Uploading…" : "Media",
                        icon: <IconUpload />,
                        onClick: () => {
                          if (uploading) return;
                          targetSlideRef.current = si;
                          fileRef.current?.click();
                        },
                      },
                      {
                        label: "Question",
                        icon: <span style={{ fontWeight: 800 }}>?</span>,
                        onClick: () =>
                          addBlock(si, { type: "question", id: uid(), prompt: "", kind: "long", options: [], required: true }),
                      },
                    ].map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        onClick={b.onClick}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 8,
                          background: C.card,
                          border: `1.5px dashed ${C.sep}`,
                          color: C.text,
                          borderRadius: 10,
                          padding: "9px 16px",
                          fontSize: 13,
                          fontWeight: 600,
                          fontFamily: FONT,
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ color: C.blue, display: "inline-flex" }}>{b.icon}</span>
                        {b.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {/* Add slide */}
            <button
              type="button"
              onClick={addSlide}
              style={{
                marginTop: 16,
                width: "100%",
                background: C.card,
                border: `1.5px dashed ${C.blue}`,
                color: C.blue,
                borderRadius: 16,
                padding: "16px",
                fontSize: 15,
                fontWeight: 700,
                fontFamily: FONT,
                cursor: "pointer",
              }}
            >
              + Add slide {slides.length + 1}
            </button>

            {/* Hidden media input */}
            <input
              ref={fileRef}
              type="file"
              accept="image/*,audio/*,video/*,.pdf,.doc,.docx,.ppt,.pptx,.txt"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void handleUpload(f);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
