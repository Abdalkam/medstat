import React, { useEffect, useState } from "react";
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

interface AssignmentSummary {
  id: string;
  title: string;
  description: string;
  created_at: string;
  status: string;
  passmark: number;
}

interface SubCounts {
  total: number;
  graded: number;
  pending: number;
}

interface BusinessInfo {
  name: string;
  phone: string;
  logo: string | null;
}

/* ================================= icons ================================== */

const IconChevronLeft = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const IconLogout = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
);

const IconPlus = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);

const IconDoc = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
    <path d="M14 2v5h5" />
    <path d="M9 13h6" />
    <path d="M9 17h4" />
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

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

/* ================================ components =============================== */

function StatusBadge({ status }: { status: string }) {
  const s = (status ?? "").trim().toLowerCase();
  if (!s) return null;
  const isDraft = s === "draft" || s === "unpublished";
  const label = s.charAt(0).toUpperCase() + s.slice(1);
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "3px 9px",
        borderRadius: 999,
        background: isDraft ? "rgba(142,142,147,0.14)" : "rgba(52,199,89,0.14)",
        color: isDraft ? "#636366" : "#1E8E4A",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function MetaDot({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, ...TS.caption, color: C.sub }}>
      <span style={{ width: 7, height: 7, borderRadius: 4, background: color, display: "inline-block" }} />
      {children}
    </span>
  );
}

/* ================================== page =================================== */

const appBar: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 50,
  background: "rgba(255,255,255,0.86)",
  backdropFilter: "saturate(180%) blur(20px)",
  WebkitBackdropFilter: "saturate(180%) blur(20px)",
  borderBottom: `1px solid ${C.sep}`,
};

const iconBtn: React.CSSProperties = {
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
};

const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  background: C.blue,
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "10px 16px",
  fontSize: 14,
  fontWeight: 600,
  fontFamily: FONT,
  cursor: "pointer",
  boxShadow: "0 4px 14px rgba(0,122,255,0.28)",
};

const outlineBtn: React.CSSProperties = {
  background: C.card,
  color: C.blue,
  border: `1.5px solid ${C.blue}`,
  borderRadius: 10,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: FONT,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const ghostBtn: React.CSSProperties = {
  background: C.bg,
  color: C.text,
  border: "none",
  borderRadius: 10,
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  fontFamily: FONT,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function TrainerAssignments() {
  const navigate = useNavigate();
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;

  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [subCounts, setSubCounts] = useState<Record<string, SubCounts>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
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
    if (!user?.tenantId || !courseId) {
      setError("No course selected.");
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Business settings — local cache first, then refresh from the DB.
        const { data: bs } = await supabase
          .from("business_settings")
          .select("business_name, phone, logo")
          .eq("tenant_id", user.tenantId)
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
            /* ignore quota errors */
          }
        }

        const { data: rows, error: aerr } = await supabase
          .from("assignments")
          .select("id, title, description, created_at, status, passmark")
          .eq("course_id", courseId)
          .eq("tenant_id", user.tenantId)
          .order("created_at", { ascending: false });
        if (cancelled) return;
        if (aerr) {
          setError(aerr.message);
          setLoading(false);
          return;
        }
        const list = (rows ?? []) as AssignmentSummary[];
        setAssignments(list);

        if (list.length > 0) {
          const ids = list.map((a) => a.id);
          // Count only this business's responses: match our tenant_id, and
          // keep older rows that were saved before the column existed
          // (tenant_id is null). If the column is missing entirely, fall
          // back to the unfiltered count so numbers never vanish.
          const tenantScoped = await supabase
            .from("assignment_submissions")
            .select("assignment_id, graded_at, grade")
            .in("assignment_id", ids)
            .or(`tenant_id.eq.${user.tenantId},tenant_id.is.null`);
          if (cancelled) return;
          let subsRows: any[] = [];
          if (!tenantScoped.error) {
            subsRows = (tenantScoped.data ?? []) as any[];
          } else {
            const plain = await supabase
              .from("assignment_submissions")
              .select("assignment_id, graded_at, grade")
              .in("assignment_id", ids);
            if (cancelled) return;
            subsRows = (plain.data ?? []) as any[];
          }
          const counts: Record<string, SubCounts> = {};
          for (const a of list) counts[a.id] = { total: 0, graded: 0, pending: 0 };
          for (const s of subsRows) {
            const c = counts[s.assignment_id];
            if (!c) continue;
            c.total += 1;
            if (s.graded_at || s.grade != null) c.graded += 1;
            else c.pending += 1;
          }
          setSubCounts(counts);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Failed to load modules.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [courseId, navigate]);

  const handleLogout = () => {
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("adminDeviceId");
    localStorage.removeItem("activeAttendanceCourseId");
    window.dispatchEvent(new Event("authStateChanged"));
    navigate("/");
  };

  const clearResponses = async (assignmentId: string, title: string) => {
    const ok = window.confirm(
      `Delete every response for "${title || "this module"}"?\n\nUse this to remove test submissions. This cannot be undone.`
    );
    if (!ok) return;
    setClearingId(assignmentId);
    setError(null);
    try {
      const { error } = await supabase
        .from("assignment_submissions")
        .delete()
        .eq("assignment_id", assignmentId);
      if (error) throw error;
      setSubCounts((prev) => ({
        ...prev,
        [assignmentId]: { total: 0, graded: 0, pending: 0 },
      }));
    } catch (e: any) {
      setError(e?.message ?? "Could not clear responses.");
    } finally {
      setClearingId(null);
    }
  };

  const totals = assignments.reduce(
    (acc, a) => {
      const c = subCounts[a.id] ?? { total: 0, graded: 0, pending: 0 };
      acc.subs += c.total;
      acc.graded += c.graded;
      acc.pending += c.pending;
      return acc;
    },
    { subs: 0, graded: 0, pending: 0 }
  );

  const firstPendingId =
    assignments.find((a) => (subCounts[a.id]?.pending ?? 0) > 0)?.id ?? null;

  const logoInitial = (business.name || "B").trim().charAt(0).toUpperCase();

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: FONT, color: C.text }}>
      {/* ------------------------------- App bar ------------------------------ */}
      <div style={appBar}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", width: "100%", boxSizing: "border-box" }}>
          <button style={iconBtn} onClick={() => navigate("/trainer")} title="Back">
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
            <div style={{ ...TS.caption, color: C.sub }}>Trainer console</div>
          </div>
          <div style={{ flex: 1 }} />
          <button
            style={primaryBtn}
            onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)}
          >
            <IconPlus /> New Module
          </button>
          <button style={iconBtn} onClick={handleLogout} title="Log out">
            <IconLogout />
          </button>
        </div>
      </div>

      {/* -------------------------------- Body -------------------------------- */}
      <div style={{ padding: "28px clamp(18px, 4vw, 40px) 80px" }}>
        <div style={{ ...TS.micro, color: C.sub, marginBottom: 6 }}>Assignments</div>
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 24 }}>
          <h1 style={{ ...TS.largeTitle, margin: 0 }}>Modules</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {[
              { label: "Modules", value: assignments.length, color: C.blue },
              { label: "Submissions", value: totals.subs, color: C.purple },
              { label: "To mark", value: totals.pending, color: C.orange },
            ].map((s) => (
              <div
                key={s.label}
                style={{
                  background: C.card,
                  border: `1px solid ${C.sep}`,
                  borderRadius: 14,
                  padding: "10px 18px",
                  boxShadow: SHADOW,
                  minWidth: 96,
                }}
              >
                <div style={{ fontSize: 22, fontWeight: 700, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ ...TS.caption, color: C.sub }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div
            style={{
              background: "rgba(255,59,48,0.10)",
              border: `1px solid rgba(255,59,48,0.35)`,
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

        {!error && totals.pending > 0 && firstPendingId && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              background: "rgba(255,159,10,0.12)",
              border: "1px solid rgba(255,159,10,0.35)",
              borderRadius: 12,
              padding: "12px 16px",
              marginBottom: 20,
              flexWrap: "wrap",
            }}
          >
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.orange, flexShrink: 0 }} />
            <span style={{ ...TS.body, color: "#8a5300", fontWeight: 600, flex: 1, minWidth: 200 }}>
              {totals.pending} submission{totals.pending === 1 ? "" : "s"} waiting for grading
            </span>
            <button
              style={{ ...primaryBtn, boxShadow: "none", padding: "8px 14px", fontSize: 13 }}
              onClick={() => navigate(`/trainer/submissions/${firstPendingId}`)}
            >
              Open marking
            </button>
          </div>
        )}

        {loading ? (
          <div style={{ padding: "64px 0", textAlign: "center", ...TS.body, color: C.sub }}>
            Loading modules…
          </div>
        ) : assignments.length === 0 ? (
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
              <IconDoc />
            </div>
            <div style={{ ...TS.headline, fontSize: 18 }}>No Modules Yet</div>
            <div style={{ ...TS.body, color: C.sub, maxWidth: 420 }}>
              Create your first module for this course. Add slides, media and questions in the
              assignment builder — trainees unlock each module in order.
            </div>
            <button style={{ ...primaryBtn, marginTop: 6 }} onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)}>
              <IconPlus /> New Module
            </button>
          </div>
        ) : (
          /* ------------------------------ Module cards ---------------------------- */
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {assignments.map((a) => {
              const c = subCounts[a.id] ?? { total: 0, graded: 0, pending: 0 };
              return (
                <div
                  key={a.id}
                  onClick={() => navigate(`/trainer/assignments/${courseId}/${a.id}`)}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(0,122,255,0.45)";
                    e.currentTarget.style.boxShadow = "0 2px 4px rgba(0,0,0,0.05), 0 16px 40px rgba(0,0,0,0.10)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = C.sep;
                    e.currentTarget.style.boxShadow = SHADOW;
                  }}
                  style={{
                    background: C.card,
                    border: `1px solid ${C.sep}`,
                    borderRadius: 16,
                    boxShadow: SHADOW,
                    padding: "18px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 18,
                    cursor: "pointer",
                    transition: "box-shadow .18s, border-color .18s",
                    width: "100%",
                    boxSizing: "border-box",
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 14,
                      background: "rgba(175,82,222,0.12)",
                      color: C.purple,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <IconDoc />
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ ...TS.headline, fontSize: 17 }}>{a.title || "Untitled module"}</span>
                      <StatusBadge status={a.status} />
                    </div>
                    {a.description && (
                      <div
                        style={{
                          ...TS.body,
                          color: C.sub,
                          marginTop: 3,
                          overflow: "hidden",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                        }}
                      >
                        {a.description}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 16, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
                      <span style={{ ...TS.caption, color: C.sub }}>{formatDate(a.created_at)}</span>
                      {c.total > 0 ? (
                        <>
                          <MetaDot color={C.purple}>
                            {c.total} submission{c.total === 1 ? "" : "s"}
                          </MetaDot>
                          {c.graded > 0 && <MetaDot color={C.green}>{c.graded} graded</MetaDot>}
                          {c.pending > 0 && <MetaDot color={C.orange}>{c.pending} to mark</MetaDot>}
                        </>
                      ) : (
                        <MetaDot color="#C7C7CC">No responses yet</MetaDot>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
                    {c.total > 0 && (
                      <>
                        <button
                          style={{ ...ghostBtn, color: C.red, background: "rgba(255,59,48,0.08)" }}
                          disabled={clearingId === a.id}
                          onClick={(e) => {
                            e.stopPropagation();
                            clearResponses(a.id, a.title);
                          }}
                        >
                          {clearingId === a.id ? "Clearing…" : "Clear"}
                        </button>
                        <button
                          style={outlineBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/trainer/submissions/${a.id}`);
                          }}
                        >
                          Mark{c.pending > 0 ? ` (${c.pending})` : ""}
                        </button>
                      </>
                    )}
                    <button
                      style={ghostBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/trainer/assignment-builder/${courseId}/${a.id}`);
                      }}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
