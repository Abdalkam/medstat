import React, { useEffect, useMemo, useState } from "react";
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

const MEDIA_BUCKET = "assignment-media";

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

interface AssignmentRow {
  id: string;
  title: string;
  description: string | null;
  passmark: number;
  content: AssignmentContent | null;
}

interface SubmissionRow {
  id: string;
  answers: Record<string, string | string[]> | null;
  submitted_at: string | null;
  graded_at: string | null;
  grade: number | null;
}

interface BusinessInfo {
  name: string;
  phone: string;
  logo: string | null;
}

type AnswerValue = string | string[];
type AnswerMap = Record<string, AnswerValue>;

/* ================================ helpers ================================= */

function kindOf(mime: string): MediaKind {
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("image/")) return "image";
  return "file";
}

function mediaUrl(path: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

function normalizeBlock(raw: any): Block | null {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "text") {
    return {
      type: "text",
      id: typeof raw.id === "string" ? raw.id : `b-${Math.random()}`,
      text: typeof raw.text === "string" ? raw.text : "",
      align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
    };
  }
  if (raw.type === "media") {
    if (typeof raw.path !== "string" || !raw.path) return null;
    return {
      type: "media",
      id: typeof raw.id === "string" ? raw.id : `b-${Math.random()}`,
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
      id: typeof raw.id === "string" ? raw.id : `b-${Math.random()}`,
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
        id: typeof s?.id === "string" ? s.id : `s-${i}`,
        title: typeof s?.title === "string" ? s.title : "",
        blocks: Array.isArray(s?.blocks) ? (s.blocks.map(normalizeBlock).filter(Boolean) as Block[]) : [],
      })),
    };
  }
  return { slides: [] };
}

function isAnswered(v: AnswerValue | undefined): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.trim().length > 0;
}

function answerToText(v: AnswerValue | undefined): string {
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "string" ? v : "";
}

/* The trainer's per-question marks live inside the submission's answers
   jsonb under "_marks" (written by TrainerSubmissions.tsx). */
function extractMarks(answers: any): Record<string, "tick" | "cross"> {
  const raw = (answers as any)?._marks;
  const clean: Record<string, "tick" | "cross"> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (v === "tick" || v === "cross") clean[k] = v;
    }
  }
  return clean;
}

/* Always a valid uuid — safe to use for database id columns,
   even if the table has no default on "id". */
function newId(): string {
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

function displayName(u: any): string {
  if (!u) return "Trainee";
  return (
    u.name ??
    u.fullName ??
    u.full_name ??
    u.username ??
    (typeof u.email === "string" ? u.email.split("@")[0] : null) ??
    "Trainee"
  );
}

/* Tolerant reads: different apps store these fields under different names. */
function readTenantId(u: any): string | null {
  if (!u) return null;
  const t =
    u.tenantId ??
    u.tenant_id ??
    u.tenantID ??
    (u.tenant && typeof u.tenant === "object" ? u.tenant.id : null);
  if (typeof t === "string" && t) return t;
  if (typeof t === "number") return String(t);
  return null;
}

function readUserId(u: any): string | null {
  if (!u) return null;
  const v = u.id ?? u.user_id ?? u.userId ?? u.sub;
  if (typeof v === "string" && v) return v;
  if (typeof v === "number") return String(v);
  return null;
}

function initialOf(name: string): string {
  return (name || "?").trim().charAt(0).toUpperCase();
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

/* ================================= icons ================================== */

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const IconCross = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const IconPhone = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 3.18 2 2 0 0 1 4.06 1h2a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const IconFile = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
  </svg>
);

/* ============================== app bar (shared) =========================== */

function TakerAppBar({ business, userName, onBack }: { business: BusinessInfo; userName: string; onBack: () => void }) {
  return (
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
          onClick={onBack}
          title="Back"
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

        <div style={{ minWidth: 0 }}>
          <div style={{ ...TS.headline, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {business.name || "Training"}
          </div>
          {business.phone && (
            <a
              href={`tel:${business.phone.replace(/\s+/g, "")}`}
              style={{
                ...TS.caption,
                color: C.blue,
                textDecoration: "none",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                maxWidth: "100%",
                whiteSpace: "nowrap",
              }}
            >
              <IconPhone />
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{business.phone}</span>
            </a>
          )}
        </div>

        <div style={{ flex: 1 }} />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: C.bg,
            borderRadius: 999,
            padding: "4px 14px 4px 5px",
            border: `1px solid ${C.sep}`,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: `linear-gradient(135deg, ${C.green}, #30B0C7)`,
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            {initialOf(userName)}
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text, whiteSpace: "nowrap" }}>{userName}</span>
        </div>
      </div>
    </div>
  );
}

/* ============================== media renderer ============================= */

function MediaView({ block }: { block: MediaBlock }) {
  const url = mediaUrl(block.path);
  const caption = (
    <div style={{ ...TS.caption, color: C.sub, marginTop: 6, wordBreak: "break-all" }}>{block.name}</div>
  );

  if (block.kind === "image") {
    return (
      <div>
        <img src={url} alt={block.name} style={{ maxWidth: "100%", borderRadius: 14, display: "block", border: `1px solid ${C.sep}` }} />
        {caption}
      </div>
    );
  }
  if (block.kind === "video") {
    return (
      <div>
        <video src={url} controls style={{ width: "100%", maxWidth: 720, borderRadius: 14, display: "block", background: "#000" }} />
        {caption}
      </div>
    );
  }
  if (block.kind === "audio") {
    return (
      <div
        style={{
          background: C.bg,
          border: `1px solid ${C.sep}`,
          borderRadius: 14,
          padding: "12px 14px",
        }}
      >
        <audio src={url} controls style={{ width: "100%", display: "block" }} />
        {caption}
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        background: C.bg,
        border: `1px solid ${C.sep}`,
        borderRadius: 12,
        padding: "11px 15px",
        color: C.blue,
        fontWeight: 600,
        fontSize: 14,
        textDecoration: "none",
      }}
    >
      <IconFile /> {block.name}
    </a>
  );
}

/* ================================ components =============================== */

const FIELD_BG = "#F6F6F9";
const FIELD_BORDER = "#D8D8DE";

const inputStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: FIELD_BG,
  border: `1px solid ${FIELD_BORDER}`,
  borderRadius: 12,
  padding: "13px 15px",
  fontSize: 15.5,
  lineHeight: 1.5,
  fontFamily: FONT,
  color: C.text,
  outline: "none",
  transition: "border-color .15s, box-shadow .15s, background .15s",
};

function focusBorder(on: boolean, e: React.FocusEvent<HTMLElement>) {
  e.currentTarget.style.borderColor = on ? C.blue : FIELD_BORDER;
  e.currentTarget.style.boxShadow = on ? "0 0 0 4px rgba(0,122,255,0.12)" : "none";
  e.currentTarget.style.background = on ? "#FFFFFF" : FIELD_BG;
}

function OptionRow({
  kind,
  selected,
  label,
  onToggle,
}: {
  kind: "single" | "multi";
  selected: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        background: selected ? "rgba(0,122,255,0.07)" : FIELD_BG,
        border: selected ? `2px solid ${C.blue}` : `1px solid ${FIELD_BORDER}`,
        borderRadius: 12,
        padding: "13px 15px",
        cursor: "pointer",
        transition: "border-color .15s, background .15s",
      }}
    >
      {kind === "single" ? (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 999,
            border: selected ? `7px solid ${C.blue}` : `2px solid #B9B9C0`,
            flexShrink: 0,
            boxSizing: "border-box",
            background: "#fff",
            transition: "border .15s",
          }}
        />
      ) : (
        <span
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            border: selected ? `2px solid ${C.blue}` : `2px solid #B9B9C0`,
            background: selected ? C.blue : "#fff",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            boxSizing: "border-box",
            transition: "background .15s, border .15s",
          }}
        >
          {selected && <IconCheck />}
        </span>
      )}
      <span style={{ ...TS.body, fontSize: 15, color: C.text, fontWeight: selected ? 600 : 400 }}>{label}</span>
    </div>
  );
}

/* ================================== page =================================== */

export default function AssignmentTaker() {
  const navigate = useNavigate();
  // Accept any common route-param name so a mismatch in App.tsx routes can't break loading.
  const params = useParams<{
    assignmentId?: string;
    id?: string;
    moduleId?: string;
  }>();
  const assignmentId = params.assignmentId ?? params.id ?? params.moduleId;

  const [userName, setUserName] = useState("Trainee");
  const [business, setBusiness] = useState<BusinessInfo>(
    () => readLocalBusiness() ?? { name: "", phone: "", logo: null }
  );

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [submission, setSubmission] = useState<SubmissionRow | null>(null);

  const [answers, setAnswers] = useState<AnswerMap>({});
  const [current, setCurrent] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showMissing, setShowMissing] = useState(false);

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
    const tenantId = readTenantId(user);
    const uid = readUserId(user);
    if (!assignmentId) {
      setErr("No module selected. Open a module from your Modules list.");
      setLoading(false);
      return;
    }
    if (!tenantId) {
      setErr("Your sign-in record is missing its tenant. Please sign out and sign in again.");
      setLoading(false);
      return;
    }
    if (!uid) {
      setErr("Your sign-in record is missing a user id. Please sign out and sign in again.");
      setLoading(false);
      return;
    }
    setUserName(displayName(user));

    let cancelled = false;

    (async () => {
      try {
        const { data: bs } = await supabase
          .from("business_settings")
          .select("business_name, phone, logo")
          .eq("tenant_id", tenantId)
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

        const { data: a, error: aerr } = await supabase
          .from("assignments")
          .select("id, title, description, passmark, content")
          .eq("id", assignmentId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (aerr) throw aerr;
        if (!a) {
          setErr("Module not found.");
          setLoading(false);
          return;
        }
        setAssignment({
          id: a.id,
          title: a.title ?? "",
          description: a.description ?? "",
          passmark: typeof a.passmark === "number" ? a.passmark : 0,
          content: parseContent(a.content),
        });

        const { data: subs } = await supabase
          .from("assignment_submissions")
          .select("id, answers, submitted_at, graded_at, grade")
          .eq("assignment_id", assignmentId)
          .eq("user_id", uid)
          .order("submitted_at", { ascending: false })
          .limit(1);
        if (cancelled) return;
        const sub = ((subs ?? []) as any[])[0] ?? null;
        if (sub) {
          setSubmission(sub as SubmissionRow);
          setAnswers((sub.answers ?? {}) as AnswerMap);
        }
      } catch (e: any) {
        if (!cancelled) {
          const msg = String(e?.message ?? "Failed to load the module.");
          setErr(
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
  }, [assignmentId, navigate]);

  /* Live grading updates: while this submission is waiting to be marked,
     re-check every 12 seconds (and whenever the window regains focus) so
     the trainer's tick/cross marks appear here without a manual refresh. */
  useEffect(() => {
    if (!submission || submission.graded_at || !assignmentId) return;
    let cancelled = false;
    const check = async () => {
      try {
        const raw = localStorage.getItem("currentUser");
        const user = raw ? JSON.parse(raw) : null;
        const uid = readUserId(user);
        if (!uid) return;
        const { data } = await supabase
          .from("assignment_submissions")
          .select("id, answers, submitted_at, graded_at, grade")
          .eq("assignment_id", assignmentId)
          .eq("user_id", uid)
          .order("submitted_at", { ascending: false })
          .limit(1);
        const row = ((data ?? []) as any[])[0];
        if (!cancelled && row && row.graded_at) {
          setSubmission(row as SubmissionRow);
          setAnswers((row.answers ?? {}) as AnswerMap);
        }
      } catch {
        /* keep polling silently */
      }
    };
    const id = window.setInterval(check, 12000);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", check);
    };
  }, [assignmentId, submission]);

  const slides: Slide[] = useMemo(() => assignment?.content?.slides ?? [], [assignment]);

  const questions = useMemo(
    () =>
      slides.flatMap((s, si) =>
        s.blocks.filter((b): b is QuestionBlock => b.type === "question").map((q) => ({ slideIndex: si, q }))
      ),
    [slides]
  );

  const answeredCount = questions.filter((x) => isAnswered(answers[x.q.id])).length;
  const totalQuestions = questions.length;
  const pct = totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0;

  const questionNumber = useMemo(() => {
    const m: Record<string, number> = {};
    questions.forEach((x, i) => {
      m[x.q.id] = i + 1;
    });
    return m;
  }, [questions]);

  const missingRequired = questions.filter((x) => x.q.required && !isAnswered(answers[x.q.id]));

  const setAnswer = (qid: string, value: AnswerValue) => {
    setAnswers((prev) => ({ ...prev, [qid]: value }));
    setNotice(null);
  };

  const toggleMulti = (qid: string, option: string) => {
    setAnswers((prev) => {
      const cur = prev[qid];
      const list = Array.isArray(cur) ? [...cur] : [];
      const idx = list.indexOf(option);
      if (idx >= 0) list.splice(idx, 1);
      else list.push(option);
      return { ...prev, [qid]: list };
    });
    setNotice(null);
  };

  const handleSubmit = async () => {
    if (missingRequired.length > 0) {
      const first = missingRequired[0];
      const n = missingRequired.length;
      setCurrent(first.slideIndex);
      setShowMissing(true);
      setNotice(
        n === 1
          ? "1 question still needs an answer before you can submit."
          : `${n} questions still need answers before you can submit.`
      );
      window.setTimeout(() => {
        document
          .getElementById(`q-${first.q.id}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
      return;
    }
    const raw = localStorage.getItem("currentUser");
    const user = raw ? JSON.parse(raw) : null;
    const uid = readUserId(user);
    const tenantId = readTenantId(user);
    if (!uid || !assignmentId) return;

    setSubmitting(true);
    setNotice(null);
    setShowMissing(false);
    try {
      const base = {
        id: newId(),
        assignment_id: assignmentId,
        user_id: uid,
        answers,
        submitted_at: new Date().toISOString(),
      };
      // Prefer tenant-scoped insert; fall back if the column does not exist.
      let res = await supabase
        .from("assignment_submissions")
        .insert({ ...base, tenant_id: tenantId })
        .select("id")
        .single();
      if (res.error) {
        // The row may have been created even if reading it back failed
        // (e.g. RLS blocks the select). Check before retrying so the
        // same submission is never inserted twice.
        const existing = await supabase
          .from("assignment_submissions")
          .select("id, answers, submitted_at, graded_at, grade")
          .eq("assignment_id", assignmentId)
          .eq("user_id", uid)
          .order("submitted_at", { ascending: false })
          .limit(1);
        const row = ((existing.data ?? []) as any[])[0];
        if (row && !existing.error) {
          setSubmission(row as SubmissionRow);
          return;
        }
        res = await supabase.from("assignment_submissions").insert(base).select("id").single();
      }
      if (res.error) throw res.error;

      setSubmission({
        id: res.data?.id ?? "",
        answers,
        submitted_at: base.submitted_at,
        graded_at: null,
        grade: null,
      });
    } catch (e: any) {
      setNotice(String(e?.message ?? "Could not submit. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  /* --------------------------------- render --------------------------------- */

  if (loading) {
    return (
      <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, display: "flex", alignItems: "center", justifyContent: "center", color: C.sub, fontSize: 15 }}>
        Loading module…
      </div>
    );
  }

  if (err || !assignment) {
    return (
      <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT }}>
        <TakerAppBar business={business} userName={userName} onBack={() => navigate(-1)} />
        <div style={{ padding: "48px 24px", textAlign: "center" }}>
          <div style={{ ...TS.headline, color: C.red, marginBottom: 8 }}>Could not open this module</div>
          <div style={{ ...TS.body, color: C.sub, maxWidth: 460, margin: "0 auto" }}>{err ?? "Module not found."}</div>
          <button
            onClick={() => navigate(-1)}
            style={{
              marginTop: 18,
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
            Go back
          </button>
        </div>
      </div>
    );
  }

  const alreadySubmitted = Boolean(submission);
  const graded = Boolean(submission?.graded_at);
  const marks = extractMarks(submission?.answers);
  const gradeVal = submission?.grade ?? null;
  const passmark = assignment?.passmark ?? 0;
  const passed = passmark > 0 && gradeVal != null ? gradeVal >= passmark : true;
  const failed = graded && passmark > 0 && !passed;

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text }}>
      <TakerAppBar business={business} userName={userName} onBack={() => navigate(-1)} />

      <div style={{ padding: "26px clamp(18px, 4vw, 44px) 80px" }}>
        {/* ----------------------------- Title card ----------------------------- */}
        <div style={{ ...CARD, padding: "20px 22px", marginBottom: 18 }}>
          <div style={{ ...TS.micro, color: C.sub, marginBottom: 6 }}>Assignment module</div>
          <h1 style={{ ...TS.title, fontSize: 24, margin: 0, marginBottom: 6 }}>{assignment.title || "Untitled module"}</h1>
          {assignment.description && (
            <div style={{ ...TS.body, color: C.sub }}>{assignment.description}</div>
          )}
          {assignment.passmark > 0 && (
            <div style={{ ...TS.caption, color: C.sub, marginTop: 8 }}>
              Pass mark: {assignment.passmark}%
            </div>
          )}
        </div>

        {alreadySubmitted ? (
          /* --------------------------- Completed view --------------------------- */
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ ...CARD, padding: "28px 24px", textAlign: "center" }}>
              <div
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 999,
                  background: failed
                    ? "rgba(255,59,48,0.10)"
                    : graded
                    ? "rgba(52,199,89,0.14)"
                    : "rgba(255,159,10,0.14)",
                  color: failed ? C.red : graded ? C.green : C.orange,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 14px",
                }}
              >
                <IconCheck />
              </div>
              <div style={{ ...TS.headline, fontSize: 18, marginBottom: 4 }}>
                {graded ? "Reviewed" : "Submitted"}
              </div>
              <div style={{ ...TS.caption, color: C.sub }}>
                {formatDateTime(submission?.submitted_at ?? null)}
              </div>
              {graded ? (
                <div
                  style={{
                    display: "inline-block",
                    marginTop: 14,
                    padding: "8px 18px",
                    borderRadius: 999,
                    fontWeight: 800,
                    fontSize: 15,
                    background: failed ? "rgba(255,59,48,0.10)" : "rgba(52,199,89,0.14)",
                    color: failed ? C.red : "#1E8E4A",
                  }}
                >
                  {passmark > 0 ? (passed ? "Passed" : "Below pass mark") : "Marked"}
                  {gradeVal != null ? ` · ${gradeVal}%` : ""}
                  {passmark > 0 ? ` · pass mark ${passmark}%` : ""}
                </div>
              ) : (
                <div style={{ ...TS.caption, color: C.sub, marginTop: 12 }}>
                  Waiting for your trainer to mark your answers — your marks will appear here
                  automatically.
                </div>
              )}
            </div>

            {/* Answer review with the trainer's tick/cross marks */}
            <div style={{ ...CARD, padding: "20px 22px" }}>
              <div style={{ ...TS.headline, marginBottom: 14 }}>
                {graded ? "Your answers and marks" : "Your answers"}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {questions.map(({ q }, i) => {
                  const mark = graded ? marks[q.id] ?? null : null;
                  return (
                    <div
                      key={q.id}
                      style={{
                        background: C.bg,
                        border:
                          mark === "tick"
                            ? "1px solid rgba(52,199,89,0.45)"
                            : mark === "cross"
                            ? "1px solid rgba(255,59,48,0.45)"
                            : `1px solid ${C.sep}`,
                        borderRadius: 12,
                        padding: "13px 15px",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...TS.caption, color: C.sub, marginBottom: 4 }}>
                            Question {i + 1}
                          </div>
                          <div style={{ ...TS.body, fontWeight: 600, marginBottom: 6 }}>
                            {renderFormatted(q.prompt)}
                          </div>
                        </div>
                        {mark && (
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              flexShrink: 0,
                              borderRadius: 999,
                              padding: "5px 11px",
                              fontSize: 12,
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              background: mark === "tick" ? "rgba(52,199,89,0.16)" : "rgba(255,59,48,0.10)",
                              color: mark === "tick" ? "#1E8E4A" : C.red,
                            }}
                          >
                            {mark === "tick" ? <IconCheck /> : <IconCross />}
                            {mark === "tick" ? "Correct" : "Incorrect"}
                          </span>
                        )}
                      </div>
                      <div style={{ ...TS.body, color: C.blue, whiteSpace: "pre-wrap" }}>
                        {answerToText(answers[q.id]) || "—"}
                      </div>
                    </div>
                  );
                })}
                {questions.length === 0 && (
                  <div style={{ ...TS.body, color: C.sub }}>This module had no questions.</div>
                )}
              </div>
            </div>
          </div>
        ) : slides.length === 0 ? (
          <div style={{ ...CARD, padding: "48px 24px", textAlign: "center" }}>
            <div style={{ ...TS.headline, marginBottom: 6 }}>Nothing to do here yet</div>
            <div style={{ ...TS.body, color: C.sub }}>This module has no slides published.</div>
          </div>
        ) : (
          <>
            {/* ----------------- Slide navigation: numbered chips ----------------- */}
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 6, marginBottom: 14 }}>
              {slides.map((s, i) => {
                const active = i === current;
                return (
                  <button
                    key={s.id}
                    onClick={() => setCurrent(i)}
                    title={`Slide ${i + 1}${s.title ? `: ${s.title}` : ""}`}
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      flexShrink: 0,
                      border: active ? "none" : `1px solid ${C.sep}`,
                      background: active ? C.blue : C.card,
                      color: active ? "#fff" : C.text,
                      fontSize: 15,
                      fontWeight: 700,
                      fontFamily: FONT,
                      cursor: "pointer",
                      boxShadow: active ? "0 4px 14px rgba(0,122,255,0.28)" : "none",
                    }}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>

            {/* --- Thin progress bar: colour shows completion, no percentage --- */}
            {totalQuestions > 0 && (
              <div style={{ marginBottom: 18 }}>
                <div style={{ marginBottom: 6 }}>
                  <span style={{ ...TS.caption, color: C.sub }}>
                    {answeredCount} of {totalQuestions} question{totalQuestions === 1 ? "" : "s"} answered
                  </span>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 3,
                    background: answeredCount === 0 ? "rgba(255,59,48,0.22)" : C.sep,
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${pct}%`,
                      borderRadius: 3,
                      background: pct >= 100 ? C.green : C.orange,
                      transition: "width .25s ease",
                    }}
                  />
                </div>
              </div>
            )}

            {/* ------------------------------ Slide ------------------------------ */}
            <div style={{ ...CARD, padding: "22px 24px" }}>
              <div style={{ ...TS.micro, color: C.sub, marginBottom: 4 }}>Slide {current + 1} of {slides.length}</div>
              {slides[current].title && (
                <h2 style={{ ...TS.title, margin: "0 0 14px" }}>{slides[current].title}</h2>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                {slides[current].blocks.map((block) => {
                  if (block.type === "text") {
                    return (
                      <p
                        key={block.id}
                        style={{
                          ...TS.body,
                          fontSize: 15.5,
                          lineHeight: 1.55,
                          margin: 0,
                          whiteSpace: "pre-wrap",
                          textAlign: block.align,
                        }}
                      >
                        {renderFormatted(block.text)}
                      </p>
                    );
                  }
                  if (block.type === "media") {
                    return <MediaView key={block.id} block={block} />;
                  }

                  // question
                  const value = answers[block.id];
                  const answered = isAnswered(value);
                  const flagged = showMissing && block.required && !answered;
                  return (
                    <div
                      key={block.id}
                      id={`q-${block.id}`}
                      style={{
                        background: flagged ? "rgba(255,59,48,0.045)" : C.bg,
                        border: flagged ? "1.5px solid rgba(255,59,48,0.5)" : `1px solid ${C.sep}`,
                        borderRadius: 14,
                        padding: 16,
                        scrollMarginTop: 84,
                        transition: "border-color .2s, background .2s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                        <span
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 999,
                            background: answered ? "rgba(52,199,89,0.16)" : "rgba(0,122,255,0.12)",
                            color: answered ? "#1E8E4A" : C.blue,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: 13,
                            fontWeight: 800,
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          {answered ? <IconCheck /> : questionNumber[block.id] ?? "?"}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              ...TS.body,
                              fontSize: 15.5,
                              fontWeight: 600,
                              lineHeight: 1.45,
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {renderFormatted(block.prompt)}
                          </div>
                          {flagged && (
                            <div style={{ ...TS.caption, color: C.red, marginTop: 4 }}>
                              This question needs an answer before submitting.
                            </div>
                          )}
                        </div>
                      </div>

                      <div style={{ marginTop: 12 }}>
                        {block.kind === "short" && (
                          <input
                            value={typeof value === "string" ? value : ""}
                            onChange={(e) => setAnswer(block.id, e.target.value)}
                            placeholder="Type your answer…"
                            style={inputStyle}
                            onFocus={(e) => focusBorder(true, e)}
                            onBlur={(e) => focusBorder(false, e)}
                          />
                        )}

                        {block.kind === "long" && (
                          <>
                            <textarea
                              value={typeof value === "string" ? value : ""}
                              onChange={(e) => setAnswer(block.id, e.target.value)}
                              rows={5}
                              placeholder="Type your answer…"
                              style={{ ...inputStyle, minHeight: 150, resize: "vertical", display: "block" }}
                              onFocus={(e) => focusBorder(true, e)}
                              onBlur={(e) => focusBorder(false, e)}
                            />
                            {typeof value === "string" && value.length > 0 && (
                              <div style={{ ...TS.caption, color: C.sub, textAlign: "right", marginTop: 6 }}>
                                {value.length} character{value.length === 1 ? "" : "s"}
                              </div>
                            )}
                          </>
                        )}

                        {(block.kind === "single" || block.kind === "multi") && (
                          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            {block.options.map((opt) => {
                              const selected =
                                block.kind === "single" ? value === opt : Array.isArray(value) && value.includes(opt);
                              return (
                                <OptionRow
                                  key={opt}
                                  kind={block.kind as "single" | "multi"}
                                  selected={Boolean(selected)}
                                  label={opt}
                                  onToggle={() =>
                                    block.kind === "single" ? setAnswer(block.id, opt) : toggleMulti(block.id, opt)
                                  }
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {notice && (
              <div
                style={{
                  marginTop: 16,
                  background: "rgba(255,159,10,0.12)",
                  border: "1px solid rgba(255,159,10,0.35)",
                  color: "#8a5300",
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {notice}
              </div>
            )}

            {/* ------------------------------ Nav bar ------------------------------ */}
            <div style={{ display: "flex", gap: 10, marginTop: 18, alignItems: "center" }}>
              {current > 0 ? (
                <button
                  onClick={() => setCurrent(current - 1)}
                  style={{
                    background: C.card,
                    color: C.text,
                    border: `1px solid ${C.sep}`,
                    borderRadius: 12,
                    padding: "12px 20px",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: FONT,
                    cursor: "pointer",
                  }}
                >
                  Previous
                </button>
              ) : (
                <div style={{ flex: 0 }} />
              )}
              <div style={{ flex: 1 }} />
              {current < slides.length - 1 ? (
                <button
                  onClick={() => setCurrent(current + 1)}
                  style={{
                    background: C.blue,
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "12px 24px",
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: FONT,
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(0,122,255,0.28)",
                  }}
                >
                  Next slide
                </button>
              ) : (
                <button
                  onClick={handleSubmit}
                  disabled={submitting}
                  style={{
                    background: C.green,
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "12px 24px",
                    fontSize: 14,
                    fontWeight: 700,
                    fontFamily: FONT,
                    cursor: submitting ? "default" : "pointer",
                    opacity: submitting ? 0.65 : 1,
                    boxShadow: "0 4px 14px rgba(52,199,89,0.30)",
                  }}
                >
                  {submitting ? "Submitting…" : "Submit assignment"}
                </button>
              )}
            </div>

            {totalQuestions > 0 && (
              <div style={{ ...TS.caption, color: C.sub, textAlign: "center", marginTop: 14 }}>
                You can move between slides with the numbered buttons — answers are kept until you submit.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
