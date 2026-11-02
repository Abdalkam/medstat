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

/* ================================= types ================================== */

type QuestionKind = "short" | "long" | "single" | "multi";
type Mark = "tick" | "cross";
type AnswerValue = string | string[];

interface QuestionBlock {
  id: string;
  prompt: string;
  kind: QuestionKind;
  options: string[];
  required: boolean;
}

interface AssignmentRow {
  id: string;
  title: string;
  passmark: number;
  course_id: string | null;
  content: { slides: { id: string; title: string; blocks: any[] }[] } | null;
}

interface SubRow {
  id: string;
  user_id: string | null;
  answers: any; // jsonb: { [questionId]: answer, _marks?: { [questionId]: "tick" | "cross" } }
  submitted_at: string | null;
  graded_at: string | null;
  grade: number | null;
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

function normalizeQuestion(raw: any): QuestionBlock | null {
  if (!raw || typeof raw !== "object" || raw.type !== "question") return null;
  return {
    id: typeof raw.id === "string" ? raw.id : `b-${Math.random()}`,
    prompt: typeof raw.prompt === "string" ? raw.prompt : "",
    kind: (["short", "long", "single", "multi"] as QuestionKind[]).includes(raw.kind)
      ? raw.kind
      : "long",
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    required: raw.required !== false,
  };
}

function parseQuestions(content: AssignmentRow["content"]): QuestionBlock[] {
  const slides = content && Array.isArray(content.slides) ? content.slides : [];
  return slides.flatMap((s) =>
    (Array.isArray(s?.blocks) ? s.blocks : [])
      .map(normalizeQuestion)
      .filter((b): b is QuestionBlock => b !== null)
  );
}

function isAnswered(v: AnswerValue | undefined): boolean {
  if (Array.isArray(v)) return v.length > 0;
  return typeof v === "string" && v.trim().length > 0;
}

function answerToText(v: AnswerValue | undefined): string {
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "string" ? v : "";
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function scoreOf(marks: Record<string, Mark>, total: number): number {
  if (total <= 0) return 0;
  const ticks = Object.values(marks).filter((m) => m === "tick").length;
  return Math.round((ticks / total) * 100);
}

function extractMarks(answers: any): Record<string, Mark> {
  const raw = (answers as any)?._marks;
  const clean: Record<string, Mark> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) {
      if (v === "tick" || v === "cross") clean[k] = v;
    }
  }
  return clean;
}

/* ================================= icons ================================== */

const IconChevronLeft = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const IconCross = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
);

const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

/* ============================== small pieces ============================== */

function StatusPill({ graded, grade }: { graded: boolean; grade: number | null }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: graded ? "rgba(52,199,89,0.14)" : "rgba(255,159,10,0.16)",
        color: graded ? C.green : C.orange,
        borderRadius: 999,
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {graded ? <IconCheck /> : <IconClock />}
      {graded ? `Marked · ${grade != null ? `${grade}%` : "—"}` : "To mark"}
    </span>
  );
}

function MarkButton({
  kind,
  active,
  onClick,
}: {
  kind: Mark;
  active: boolean;
  onClick: () => void;
}) {
  const color = kind === "tick" ? C.green : C.red;
  return (
    <button
      onClick={onClick}
      title={kind === "tick" ? "Correct" : "Incorrect"}
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: active ? color : C.card,
        color: active ? "#FFFFFF" : color,
        border: `2px solid ${active ? color : "rgba(0,0,0,0.12)"}`,
        cursor: "pointer",
        transition: "background .15s, border .15s",
        flexShrink: 0,
      }}
    >
      {kind === "tick" ? <IconCheck /> : <IconCross />}
    </button>
  );
}

/* Answer rendering for one question */
function AnswerView({ q, value }: { q: QuestionBlock; value: AnswerValue | undefined }) {
  if (!isAnswered(value)) {
    return (
      <div style={{ ...TS.body, color: C.sub, fontStyle: "italic" }}>
        No answer given{q.required ? " (required question)" : ""}
      </div>
    );
  }
  if (q.kind === "single" || q.kind === "multi") {
    const chosen = Array.isArray(value) ? value.map(String) : [String(value)];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {q.options.map((opt, i) => {
          const on = chosen.includes(opt);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "9px 12px",
                borderRadius: 10,
                background: on ? "rgba(0,122,255,0.08)" : "transparent",
                border: `1px solid ${on ? "rgba(0,122,255,0.35)" : "transparent"}`,
                ...TS.body,
                fontWeight: on ? 600 : 400,
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: q.kind === "single" ? 9 : 5,
                  border: `2px solid ${on ? C.blue : "rgba(0,0,0,0.2)"}`,
                  background: on ? C.blue : "transparent",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {on && <IconCheck />}
              </span>
              {opt}
            </div>
          );
        })}
        {chosen.some((c) => !q.options.includes(c)) && (
          <div style={{ ...TS.caption, color: C.sub }}>
            Other answer: {chosen.filter((c) => !q.options.includes(c)).join(", ")}
          </div>
        )}
      </div>
    );
  }
  return (
    <div
      style={{
        ...TS.body,
        whiteSpace: "pre-wrap",
        background: C.bg,
        border: `1px solid ${C.sep}`,
        borderRadius: 10,
        padding: "12px 14px",
      }}
    >
      {answerToText(value)}
    </div>
  );
}

/* ================================== page =================================== */

export default function TrainerSubmissions() {
  const navigate = useNavigate();
  const params = useParams<{ assignmentId?: string; id?: string; moduleId?: string }>();
  const assignmentId = params.assignmentId ?? params.id ?? params.moduleId;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [subs, setSubs] = useState<SubRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [marksBySub, setMarksBySub] = useState<Record<string, Record<string, Mark>>>({});
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

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
    if (!assignmentId) {
      setErr("No module selected. Open marking from a module card.");
      setLoading(false);
      return;
    }
    if (!tenantId) {
      setErr("Your sign-in record is missing its tenant. Please sign out and sign in again.");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data: a, error: aerr } = await supabase
          .from("assignments")
          .select("id, title, passmark, content, course_id")
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
          passmark: typeof a.passmark === "number" ? a.passmark : 0,
          course_id: a.course_id ?? null,
          content: a.content as AssignmentRow["content"],
        });

        // Submissions for this module — tenant-scoped, tolerant of older rows.
        let list: SubRow[] = [];
        const sel = "id, user_id, answers, submitted_at, graded_at, grade";
        const scoped = await supabase
          .from("assignment_submissions")
          .select(sel)
          .eq("assignment_id", assignmentId)
          .or(`tenant_id.eq.${tenantId},tenant_id.is.null`)
          .order("submitted_at", { ascending: false });
        if (scoped.error) {
          const plain = await supabase
            .from("assignment_submissions")
            .select(sel)
            .eq("assignment_id", assignmentId)
            .order("submitted_at", { ascending: false });
          if (plain.error) throw plain.error;
          list = (plain.data ?? []) as SubRow[];
        } else {
          list = (scoped.data ?? []) as SubRow[];
        }
        if (cancelled) return;
        setSubs(list);

        // Friendly trainee names — best effort across common user tables.
        const ids = Array.from(
          new Set(list.map((s) => String(s.user_id ?? "")).filter(Boolean))
        );
        const found: Record<string, string> = {};
        if (ids.length > 0) {
          for (const table of ["users", "profiles"]) {
            const r = await supabase.from(table).select("*").in("id", ids);
            if (!r.error && r.data && r.data.length > 0) {
              for (const u of r.data as any[]) {
                const id = String(u?.id ?? "");
                if (!id) continue;
                found[id] =
                  u.name ??
                  u.full_name ??
                  u.fullName ??
                  u.username ??
                  (typeof u.email === "string" ? u.email.split("@")[0] : null) ??
                  "Trainee";
              }
              break;
            }
          }
        }
        if (cancelled) return;
        setNames(found);
      } catch (e: any) {
        if (!cancelled) setErr(String(e?.message ?? "Failed to load submissions."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [assignmentId, navigate]);

  const questions = useMemo(() => parseQuestions(assignment?.content ?? null), [assignment]);

  const selected = useMemo(
    () => subs.find((s) => s.id === selectedId) ?? null,
    [subs, selectedId]
  );

  const marks = selected ? marksBySub[selected.id] ?? {} : {};
  const totalQ = questions.length;
  const liveScore = scoreOf(marks, totalQ);
  const passmark = assignment?.passmark ?? 0;
  const willPass = totalQ > 0 && liveScore >= passmark;

  const gradedCount = subs.filter((s) => s.graded_at).length;
  const pendingCount = subs.length - gradedCount;

  // Submissions waiting for marking first, already-marked ones after.
  const orderedSubs = useMemo(
    () => [...subs].sort((a, b) => (a.graded_at ? 1 : 0) - (b.graded_at ? 1 : 0)),
    [subs]
  );

  function openSubmission(s: SubRow) {
    setSaveErr(null);
    setMarksBySub((prev) => ({ ...prev, [s.id]: extractMarks(s.answers) }));
    setSelectedId(s.id);
  }

  function toggleMark(qid: string, kind: Mark) {
    if (!selected) return;
    setMarksBySub((prev) => {
      const cur = { ...(prev[selected.id] ?? {}) };
      if (cur[qid] === kind) delete cur[qid];
      else cur[qid] = kind;
      return { ...prev, [selected.id]: cur };
    });
  }

  async function saveGrading() {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    const m = marksBySub[selected.id] ?? {};
    const score = scoreOf(m, totalQ);
    const gradedAt = new Date().toISOString();
    const merged = { ...(selected.answers ?? {}), _marks: m };

    let error: any = (
      await supabase
        .from("assignment_submissions")
        .update({ graded_at: gradedAt, grade: score, answers: merged })
        .eq("id", selected.id)
    ).error;
    if (error) {
      // Retry without touching the answers blob (RLS may restrict it)
      // so the grade itself still lands.
      error = (
        await supabase
          .from("assignment_submissions")
          .update({ graded_at: gradedAt, grade: score })
          .eq("id", selected.id)
      ).error;
    }
    setSaving(false);
    if (error) {
      setSaveErr(String(error.message ?? "Could not save the grading."));
      return;
    }
    setSubs((prev) =>
      prev.map((s) =>
        s.id === selected.id ? { ...s, graded_at: gradedAt, grade: score, answers: merged } : s
      )
    );
    setSelectedId(null);
  }

  async function undoGrading() {
    if (!selected) return;
    setSaving(true);
    setSaveErr(null);
    const { error } = await supabase
      .from("assignment_submissions")
      .update({ graded_at: null, grade: null })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      setSaveErr(String(error.message ?? "Could not undo the grading."));
      return;
    }
    setSubs((prev) =>
      prev.map((s) => (s.id === selected.id ? { ...s, graded_at: null, grade: null } : s))
    );
    setSelectedId(null);
  }

  const nameOf = (s: SubRow) =>
    (s.user_id && names[s.user_id]) || "Trainee";

  const backToList = () => {
    setSelectedId(null);
    setSaveErr(null);
  };

  /* ------------------------------ render ------------------------------ */

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text }}>
      {/* Top bar */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "saturate(180%) blur(16px)",
          borderBottom: `1px solid ${C.sep}`,
        }}
      >
        <div
          style={{
            width: "100%",
            boxSizing: "border-box",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <button
            onClick={() => (selected ? backToList() : navigate(assignment?.course_id ? `/trainer/assignments/${assignment.course_id}` : "/trainer"))}
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              border: "none",
              background: "rgba(0,122,255,0.10)",
              color: C.blue,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            <IconChevronLeft />
          </button>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...TS.headline, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {selected ? "Mark submission" : "Marking"}
            </div>
            <div style={{ ...TS.caption, color: C.sub, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {assignment?.title || "Module"}
            </div>
          </div>
        </div>
      </div>

      {/* Full-width body — no max-width container, matching the trainer console */}
      <div style={{ width: "100%", boxSizing: "border-box", padding: "24px clamp(18px, 4vw, 40px) 90px" }}>
        {err && (
          <div
            style={{
              background: "rgba(255,59,48,0.10)",
              border: "1px solid rgba(255,59,48,0.35)",
              color: C.red,
              borderRadius: 12,
              padding: "12px 16px",
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            {err}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "64px 0", textAlign: "center", ...TS.body, color: C.sub }}>
            Loading submissions…
          </div>
        ) : !selected ? (
          /* ------------------------------ list view ----------------------------- */
          subs.length === 0 ? (
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.sep}`,
                borderRadius: 20,
                boxShadow: SHADOW,
                padding: "56px 32px",
                textAlign: "center",
              }}
            >
              <div style={{ ...TS.headline, fontSize: 18 }}>No submissions yet</div>
              <div style={{ ...TS.body, color: C.sub, marginTop: 6 }}>
                When trainees submit this module, their answers appear here for marking.
              </div>
            </div>
          ) : (
            <>
              <div style={{ ...TS.caption, color: C.sub, marginBottom: 12 }}>
                {subs.length === 0
                  ? "No submissions"
                  : `${pendingCount} to mark · ${gradedCount} marked`}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {orderedSubs.map((s) => (
                  <div
                    key={s.id}
                    onClick={() => openSubmission(s)}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.sep}`,
                      borderRadius: 16,
                      boxShadow: SHADOW,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                      cursor: "pointer",
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        background: "rgba(0,122,255,0.10)",
                        color: C.blue,
                        fontWeight: 800,
                        fontSize: 17,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {nameOf(s).trim().charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TS.headline, fontSize: 16 }}>{nameOf(s)}</div>
                      <div style={{ ...TS.caption, color: C.sub, marginTop: 2 }}>
                        Submitted {formatDateTime(s.submitted_at)}
                      </div>
                    </div>
                    <StatusPill graded={!!s.graded_at} grade={s.grade} />
                  </div>
                ))}
              </div>
            </>
          )
        ) : (
          /* ----------------------------- marking view ---------------------------- */
          <>
            {/* Trainee header card */}
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.sep}`,
                borderRadius: 16,
                boxShadow: SHADOW,
                padding: "16px 18px",
                display: "flex",
                alignItems: "center",
                gap: 14,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  background: "rgba(0,122,255,0.10)",
                  color: C.blue,
                  fontWeight: 800,
                  fontSize: 17,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {nameOf(selected).trim().charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ ...TS.headline, fontSize: 16 }}>{nameOf(selected)}</div>
                <div style={{ ...TS.caption, color: C.sub, marginTop: 2 }}>
                  Submitted {formatDateTime(selected.submitted_at)}
                </div>
              </div>
              <StatusPill graded={!!selected.graded_at} grade={selected.grade} />
            </div>

            {/* Live score card */}
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.sep}`,
                borderRadius: 16,
                boxShadow: SHADOW,
                padding: "16px 18px",
                marginBottom: 14,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div style={{ ...TS.headline, fontSize: 16 }}>
                  {Object.values(marks).filter((m) => m === "tick").length} of {totalQ} questions marked correct
                </div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 22, fontWeight: 800, color: willPass ? C.green : C.orange }}>
                    {totalQ > 0 ? `${liveScore}%` : "—"}
                  </span>
                  {totalQ > 0 && (
                    <span
                      style={{
                        background: willPass ? "rgba(52,199,89,0.14)" : "rgba(255,159,10,0.16)",
                        color: willPass ? C.green : C.orange,
                        borderRadius: 999,
                        padding: "5px 12px",
                        fontSize: 13,
                        fontWeight: 700,
                      }}
                    >
                      {willPass ? "Pass" : "Below pass mark"}
                    </span>
                  )}
                </div>
              </div>
              {passmark > 0 && (
                <div style={{ ...TS.caption, color: C.sub, marginTop: 6 }}>
                  Pass mark {passmark}% — tick the correct answers, cross the wrong ones, then save.
                </div>
              )}
            </div>

            {/* Questions */}
            {totalQ === 0 ? (
              <div
                style={{
                  background: C.card,
                  border: `1px solid ${C.sep}`,
                  borderRadius: 16,
                  boxShadow: SHADOW,
                  padding: "24px 20px",
                  marginBottom: 14,
                  ...TS.body,
                  color: C.sub,
                }}
              >
                This module has no question slides, so there is nothing to tick or cross.
                The submitted answer data is shown below.
                <pre
                  style={{
                    marginTop: 12,
                    fontSize: 12,
                    background: C.bg,
                    borderRadius: 10,
                    padding: 12,
                    overflowX: "auto",
                  }}
                >
                  {JSON.stringify(selected.answers ?? {}, null, 2)}
                </pre>
              </div>
            ) : (
              /* Full width: question cards flow into columns on wide screens */
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 470px), 1fr))",
                  gap: 12,
                  alignItems: "start",
                  marginBottom: 16,
                }}
              >
                {questions.map((q, i) => {
                  const value = ((selected.answers ?? {}) as Record<string, AnswerValue>)[q.id];
                  const mark = marks[q.id] ?? null;
                  return (
                    <div
                      key={q.id}
                      style={{
                        background: C.card,
                        border: `1px solid ${mark === "tick" ? "rgba(52,199,89,0.45)" : mark === "cross" ? "rgba(255,59,48,0.4)" : C.sep}`,
                        borderRadius: 16,
                        boxShadow: SHADOW,
                        padding: "16px 18px",
                      }}
                    >
                      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            background: mark === "tick" ? C.green : mark === "cross" ? C.red : "rgba(0,122,255,0.10)",
                            color: mark ? "#fff" : C.blue,
                            fontSize: 13,
                            fontWeight: 800,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginTop: 1,
                          }}
                        >
                          {i + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ ...TS.headline, fontSize: 15, marginBottom: 8 }}>{q.prompt}</div>
                          <AnswerView q={q} value={value} />
                        </div>
                        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                          <MarkButton kind="cross" active={mark === "cross"} onClick={() => toggleMark(q.id, "cross")} />
                          <MarkButton kind="tick" active={mark === "tick"} onClick={() => toggleMark(q.id, "tick")} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {saveErr && (
              <div
                style={{
                  background: "rgba(255,59,48,0.10)",
                  border: "1px solid rgba(255,59,48,0.35)",
                  color: C.red,
                  borderRadius: 12,
                  padding: "12px 16px",
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 12,
                }}
              >
                {saveErr}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
                onClick={saveGrading}
                disabled={saving}
                style={{
                  flex: 1,
                  minWidth: 200,
                  background: C.blue,
                  color: "#fff",
                  border: "none",
                  borderRadius: 12,
                  padding: "14px 18px",
                  fontSize: 15,
                  fontWeight: 700,
                  fontFamily: FONT,
                  cursor: saving ? "default" : "pointer",
                  opacity: saving ? 0.6 : 1,
                  boxShadow: "0 4px 14px rgba(0,122,255,0.28)",
                }}
              >
                {saving ? "Saving…" : selected.graded_at ? `Update grading · ${liveScore}%` : `Save grading · ${totalQ > 0 ? `${liveScore}%` : ""}`}
              </button>
              {selected.graded_at && (
                <button
                  onClick={undoGrading}
                  disabled={saving}
                  style={{
                    background: C.card,
                    color: C.red,
                    border: `1px solid rgba(255,59,48,0.4)`,
                    borderRadius: 12,
                    padding: "14px 18px",
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: FONT,
                    cursor: saving ? "default" : "pointer",
                  }}
                >
                  Undo marking
                </button>
              )}
            </div>
            <div style={{ ...TS.caption, color: C.sub, textAlign: "center", marginTop: 12 }}>
              Saving marks the submission as reviewed — the trainee's next module unlocks automatically.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
