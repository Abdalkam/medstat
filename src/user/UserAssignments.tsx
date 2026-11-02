import React, { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
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
  largeTitle: { fontSize: 28, fontWeight: 700, letterSpacing: -0.6 } as React.CSSProperties,
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

interface UserAssignment {
  id: string;
  title: string;
  description: string;
  created_at: string;
  status: string;
  passmark: number;
  course_id?: string | null;
  /* Trainer-set unlock rule, stored in the content jsonb by the builder:
     undefined/"completed" = next module opens after marking;
     "any" = next module opens as soon as the trainee submits. */
  content?: { unlockNext?: string } | null;
}

interface CourseInfo {
  id: string;
  title: string;
}

interface SubmissionRow {
  id: string;
  assignment_id: string;
  submitted_at: string | null;
  graded_at: string | null;
  grade: number | null;
}

interface BusinessInfo {
  name: string;
  phone: string;
  logo: string | null;
}

type ModuleState = "graded" | "pending" | "locked" | "open";

/* ================================= icons ================================== */

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4.5" y="11" width="15" height="9.5" rx="2.5" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
);

const IconCheck = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

const IconClock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

const IconCross = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

const IconPhone = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v2a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.08 3.18 2 2 0 0 1 4.06 1h2a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L7.09 8.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const IconBook = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
);

/* ================================ helpers ================================= */

function readLocalBusiness(): BusinessInfo | null {
  try {
    const raw = localStorage.getItem("localBusinessSettings");
    if (!raw) return null;
    const o = JSON.parse(raw);
    return {
      name: o.businessName ?? o.business_name ?? "",
      phone: o.phone ?? "",
      logo: o.logo ?? null,
    };
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

/* ============================== app bar (shared) =========================== */

function UserAppBar({ business, userName }: { business: BusinessInfo; userName: string }) {
  const navigate = useNavigate();
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
          onClick={() => navigate(-1)}
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

/* ================================== pills ================================== */

function Pill({
  tone,
  label,
  icon,
  filled,
}: {
  tone: "green" | "orange" | "gray" | "blue" | "red";
  label: string;
  icon?: React.ReactNode;
  filled?: boolean;
}) {
  const palette = {
    green: { bg: "rgba(52,199,89,0.14)", fg: "#1E8E4A" },
    orange: { bg: "rgba(255,159,10,0.16)", fg: "#9a5b00" },
    gray: { bg: "rgba(142,142,147,0.16)", fg: "#636366" },
    blue: { bg: C.blue, fg: "#FFFFFF" },
    red: { bg: "rgba(255,59,48,0.12)", fg: C.red },
  }[tone];

  const base: React.CSSProperties = filled
    ? { background: palette.bg, color: palette.fg, boxShadow: "0 4px 14px rgba(0,122,255,0.28)" }
    : { background: palette.bg, color: palette.fg };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 12,
        fontWeight: 700,
        padding: "7px 13px",
        borderRadius: 999,
        whiteSpace: "nowrap",
        ...base,
      }}
    >
      {icon}
      {label}
    </span>
  );
}

/* ================================== page =================================== */

export default function UserAssignments() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ courseId?: string; course_id?: string }>();
  // Course id can come from the route (:courseId / :course_id) or the query (?courseId= / ?course=).
  const courseId = useMemo(() => {
    const q = new URLSearchParams(location.search);
    return (
      params.courseId ??
      params.course_id ??
      q.get("courseId") ??
      q.get("course") ??
      undefined
    );
  }, [params.courseId, params.course_id, location.search]);

  const [assignments, setAssignments] = useState<UserAssignment[]>([]);
  const [courses, setCourses] = useState<CourseInfo[]>([]);
  const [activeCourseId, setActiveCourseId] = useState<string | null>(courseId ?? null);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userName, setUserName] = useState("Trainee");
  const [business, setBusiness] = useState<BusinessInfo>(
    () => readLocalBusiness() ?? { name: "", phone: "", logo: null }
  );

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
    if (!tenantId) {
      setError(
        "Your sign-in record is missing its tenant. Please sign out and sign in again."
      );
      setLoading(false);
      return;
    }
    if (!uid) {
      setError(
        "Your sign-in record is missing a user id. Please sign out and sign in again."
      );
      setLoading(false);
      return;
    }
    setUserName(displayName(user));

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data: bs } = await supabase
          .from("business_settings")
          .select("business_name, phone, logo")
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (cancelled) return;
        if (bs) {
          const mapped: BusinessInfo = {
            name: bs.business_name ?? "",
            phone: bs.phone ?? "",
            logo: bs.logo ?? null,
          };
          setBusiness(mapped);
          try {
            localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
          } catch {
            /* ignore */
          }
        }

        // Modules for the tenant — narrowed to one course when the URL carries one.
        const cols = "id, title, description, created_at, status, passmark, course_id, content";
        const { data: rows, error: aerr } = courseId
          ? await supabase
              .from("assignments")
              .select(cols)
              .eq("tenant_id", tenantId)
              .eq("course_id", courseId)
              .order("created_at", { ascending: true })
          : await supabase
              .from("assignments")
              .select(cols)
              .eq("tenant_id", tenantId)
              .order("created_at", { ascending: true });
        if (cancelled) return;
        if (aerr) {
          setError(aerr.message);
          setLoading(false);
          return;
        }
        const list = (rows ?? []) as UserAssignment[];
        setAssignments(list);

        // Derive the course list from the modules and fetch friendly titles.
        // The courses table is used if readable; otherwise titles fall back.
        const courseIds = Array.from(
          new Set(list.map((a) => String(a.course_id ?? "")).filter(Boolean))
        );
        const titles: Record<string, string> = {};
        if (courseIds.length > 0) {
          try {
            const { data: crows } = await supabase
              .from("courses")
              .select("*")
              .eq("tenant_id", tenantId);
            if (cancelled) return;
            for (const c of (crows ?? []) as any[]) {
              const cid = String(c?.id ?? "");
              if (!cid) continue;
              titles[cid] = c.title ?? c.name ?? c.course_name ?? c.course_title ?? "Course";
            }
          } catch {
            /* courses table not readable — titles fall back to "Course" */
          }
        }
        if (cancelled) return;
        setCourses(courseIds.map((id) => ({ id, title: titles[id] ?? "Course" })));
        if (courseId) setActiveCourseId(courseId);
        else setActiveCourseId((prev) => prev ?? courseIds[0] ?? null);

        const { data: subs } = await supabase
          .from("assignment_submissions")
          .select("id, assignment_id, submitted_at, graded_at, grade")
          .eq("user_id", uid);
        if (cancelled) return;
        const map: Record<string, SubmissionRow> = {};
        for (const s of (subs ?? []) as any[]) {
          const existing = map[s.assignment_id];
          if (!existing || (s.submitted_at ?? "") > (existing.submitted_at ?? "")) {
            map[s.assignment_id] = s as SubmissionRow;
          }
        }
        setSubmissions(map);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load your modules.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, navigate]);

  // When the page loads every tenant module (no course in the URL), show one
  // course at a time; sequential unlocking then applies within that course.
  const visible = useMemo(
    () =>
      activeCourseId
        ? assignments.filter((a) => (a.course_id ?? "") === activeCourseId)
        : assignments,
    [assignments, activeCourseId]
  );

  const isLocked = (index: number): boolean => {
    if (index === 0) return false;
    const prev = visible[index - 1];
    const prevSub = submissions[prev.id];
    if (!prevSub) return true;
    // The trainer picks the rule per module in the builder:
    // "any" = the next module opens as soon as this one is submitted,
    // even with skipped questions. Otherwise marking is required.
    if (prev.content?.unlockNext === "any") return !prevSub.submitted_at;
    return !prevSub.graded_at;
  };

  const rows = visible.map((a, i) => {
    const sub = submissions[a.id] ?? null;
    let state: ModuleState;
    if (isLocked(i)) state = "locked";
    else if (sub && sub.graded_at) state = "graded";
    else if (sub && sub.submitted_at) state = "pending";
    else state = "open";
    return { a, state, sub, index: i };
  });

  const completed = rows.filter((r) => r.state === "graded").length;
  const inReview = rows.filter((r) => r.state === "pending").length;
  const lockedCount = rows.filter((r) => r.state === "locked").length;
  const total = rows.length;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  const nextUp = rows.find((r) => r.state === "open") ?? null;

  // Course picker only appears when the URL carries no course and there is
  // more than one course to choose from.
  const chipsRow = courseId ? [] : courses.length > 1 ? courses : [];
  const activeCourse = courses.find((c) => c.id === activeCourseId) ?? null;
  const activeCourseTitle =
    activeCourse && activeCourse.title !== "Course" ? activeCourse.title : null;

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text }}>
      <UserAppBar business={business} userName={userName} />

      <div style={{ padding: "28px clamp(20px, 4vw, 40px) 80px" }}>
        {/* ------------------------------- Heading ------------------------------ */}
        <div style={{ ...TS.micro, color: C.sub, marginBottom: 6 }}>My learning path</div>
        <h1
          style={{
            ...TS.largeTitle,
            margin: 0,
            marginBottom: chipsRow.length > 0 || activeCourseTitle ? 12 : 20,
          }}
        >
          Modules
        </h1>

        {chipsRow.length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            {chipsRow.map((c) => {
              const active = c.id === activeCourseId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCourseId(c.id)}
                  style={{
                    background: active ? C.blue : C.card,
                    color: active ? "#FFFFFF" : C.text,
                    border: `1px solid ${active ? C.blue : C.sep}`,
                    borderRadius: 999,
                    padding: "9px 16px",
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: FONT,
                    cursor: "pointer",
                    boxShadow: active ? "0 4px 12px rgba(0,122,255,0.25)" : SHADOW,
                    transition: "background .15s, color .15s",
                  }}
                >
                  {c.title}
                </button>
              );
            })}
          </div>
        )}

        {chipsRow.length === 0 && activeCourseTitle && (
          <div style={{ ...TS.body, color: C.sub, marginBottom: 20 }}>{activeCourseTitle}</div>
        )}

        {error && (
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
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ padding: "64px 0", textAlign: "center", ...TS.body, color: C.sub }}>
            Loading your modules…
          </div>
        ) : error ? (
          /* Error banner is already shown above — show nothing else. */ null
        ) : total === 0 ? (
          /* ------------------------------ Empty state ----------------------------- */
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.sep}`,
              borderRadius: 20,
              boxShadow: SHADOW,
              padding: "64px 32px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 72,
                height: 72,
                borderRadius: 22,
                background: "rgba(0,122,255,0.10)",
                color: C.blue,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <IconBook />
            </div>
            <div style={{ ...TS.headline, fontSize: 18 }}>No modules yet</div>
            <div style={{ ...TS.body, color: C.sub, maxWidth: 400 }}>
              {activeCourseTitle
                ? `Your trainer hasn't published any modules for ${activeCourseTitle} yet. Check back soon.`
                : "Your trainer hasn't published any modules yet. Check back soon."}
            </div>
          </div>
        ) : (
          <>
            {/* --------------------------- Progress card --------------------------- */}
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.sep}`,
                borderRadius: 18,
                boxShadow: SHADOW,
                padding: "20px 22px",
                marginBottom: 24,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ ...TS.headline, fontSize: 17 }}>
                  {completed} of {total} module{total === 1 ? "" : "s"} completed
                </div>
              </div>
              {/* Colour = completion state: green all done, orange part-way,
                  red nothing yet. No percentage shown. */}
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: completed === 0 ? "rgba(255,59,48,0.18)" : C.bg,
                  border: `1px solid ${C.sep}`,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    borderRadius: 4,
                    background: pct >= 100 ? C.green : C.orange,
                    transition: "width .35s ease",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: 18, marginTop: 12, flexWrap: "wrap" }}>
                <span style={{ ...TS.caption, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: C.green }} /> {completed} completed
                </span>
                <span style={{ ...TS.caption, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: C.orange }} /> {inReview} in review
                </span>
                <span style={{ ...TS.caption, color: C.sub, display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: C.sub }} /> {lockedCount} locked
                </span>
              </div>
              {nextUp && (
                <button
                  onClick={() => navigate(`/user/assignment-taker/${nextUp.a.id}`)}
                  style={{
                    marginTop: 16,
                    width: "100%",
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    background: C.blue,
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "13px 18px",
                    fontSize: 15,
                    fontWeight: 700,
                    fontFamily: FONT,
                    cursor: "pointer",
                    boxShadow: "0 4px 14px rgba(0,122,255,0.28)",
                  }}
                >
                  {nextUp.sub && nextUp.state === "pending" ? "Continue" : "Start"}: {nextUp.a.title || `Module ${nextUp.index + 1}`}
                </button>
              )}
            </div>

            {/* ------------------------- Module cards (new) ------------------------ */}
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rows.map(({ a, state, sub, index }) => {
                // Graded modules stay clickable so the trainee can reopen the
                // module and read the trainer's marks in the review view.
                const clickable = state === "open" || state === "pending" || state === "graded";
                const passed =
                  a.passmark > 0 ? (sub?.grade ?? 0) >= a.passmark : true;
                const tile: React.CSSProperties =
                  state === "graded"
                    ? passed
                      ? { background: "rgba(52,199,89,0.14)", color: C.green }
                      : { background: "rgba(255,59,48,0.14)", color: C.red }
                    : state === "pending"
                    ? { background: "rgba(255,159,10,0.16)", color: C.orange }
                    : state === "locked"
                    ? { background: "rgba(142,142,147,0.14)", color: C.sub }
                    : { background: "rgba(0,122,255,0.10)", color: C.blue };

                return (
                  <div
                    key={a.id}
                    onClick={() => clickable && navigate(`/user/assignment-taker/${a.id}`)}
                    onMouseEnter={(e) => {
                      if (clickable) e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.10)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.boxShadow = SHADOW;
                    }}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.sep}`,
                      borderRadius: 16,
                      boxShadow: SHADOW,
                      padding: "16px 18px",
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      cursor: clickable ? "pointer" : "default",
                      opacity: state === "locked" ? 0.75 : 1,
                      transition: "box-shadow .18s",
                      width: "100%",
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      style={{
                        width: 46,
                        height: 46,
                        borderRadius: 13,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        fontWeight: 800,
                        fontSize: 17,
                        ...tile,
                      }}
                    >
                      {state === "graded" ? (
                        <IconCheck />
                      ) : state === "pending" ? (
                        <IconClock />
                      ) : state === "locked" ? (
                        <IconLock />
                      ) : (
                        index + 1
                      )}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ ...TS.headline, fontSize: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {a.title || `Module ${index + 1}`}
                      </div>
                      {a.description && (
                        <div
                          style={{
                            ...TS.body,
                            color: C.sub,
                            marginTop: 2,
                            fontSize: 14,
                            overflow: "hidden",
                            display: "-webkit-box",
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {a.description}
                        </div>
                      )}
                      <div style={{ ...TS.caption, color: C.sub, marginTop: 5 }}>
                        Module {index + 1}
                        {a.passmark > 0 ? ` · Pass mark ${a.passmark}%` : ""}
                        {state === "graded" ? " · Tap to view your marks" : ""}
                        {state === "locked" ? " · Complete the previous module to unlock" : ""}
                      </div>
                    </div>

                    {state === "graded" && (
                      <>
                        {/* The mark itself, right on the card */}
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div
                            style={{
                              fontSize: 20,
                              fontWeight: 800,
                              lineHeight: 1,
                              color: passed ? "#1E8E4A" : C.red,
                            }}
                          >
                            {sub?.grade != null ? `${sub.grade}%` : "—"}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: 0.6,
                              textTransform: "uppercase",
                              marginTop: 3,
                              color: passed ? "#1E8E4A" : C.red,
                            }}
                          >
                            {passed ? "Pass" : "Below pass mark"}
                          </div>
                        </div>
                        <Pill
                          tone={passed ? "green" : "red"}
                          label={passed ? "Completed" : "Below pass"}
                          icon={passed ? <IconCheck /> : <IconCross />}
                        />
                      </>
                    )}
                    {state === "pending" && <Pill tone="orange" label="In Review" icon={<IconClock />} />}
                    {state === "locked" && <Pill tone="gray" label="Locked" icon={<IconLock />} />}
                    {state === "open" && (
                      <Pill tone="blue" filled label={sub ? "Continue" : "Start"} />
                    )}
                  </div>
                );
              })}
            </div>

            <div style={{ ...TS.caption, color: C.sub, textAlign: "center", marginTop: 28 }}>
              Modules unlock in order — your trainer decides whether the next one opens after marking
              or as soon as you submit.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
