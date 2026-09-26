// src/trainer/TrainerAssignments.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  purple: "#AF52DE", purpleBg: "#F5F0FF", orange: "#FF9F0A", orangeBg: "#FFF6EB",
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

interface AssignmentSummary {
  id: string; title: string; description: string; created_at: string;
  submission_count: number; graded_count: number; pending_count: number; draft_count: number;
}
interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

export default function TrainerAssignments() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);
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
        // 1. Load from Local Storage INSTANTLY
        const localSettings = localStorage.getItem("localBusinessSettings");
        if (localSettings) setBusiness(JSON.parse(localSettings));

        // 2. Try Supabase
        const { data } = await supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) setBusiness(data as BusinessData);
      } catch (err: unknown) { console.error("Business fetch failed:", err); }
    };
    fetchBusiness();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (!courseId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data: aList, error: aErr } = await supabase
          .from("assignments").select("id, title, description, created_at")
          .eq("course_id", courseId).eq("tenant_id", currentUser.tenantId)
          .order("created_at", { ascending: false });
        if (aErr) throw aErr;

        const { data: subs } = await supabase.from("assignment_submissions").select("assignment_id, grade, submitted_at, graded_at");
        const subCounts: Record<string, { total: number; graded: number; pending: number; draft: number }> = {};
        (subs || []).forEach((s: any) => {
          if (!subCounts[s.assignment_id]) subCounts[s.assignment_id] = { total: 0, graded: 0, pending: 0, draft: 0 };
          subCounts[s.assignment_id].total++;
          if (s.submitted_at) {
            if (s.graded_at || s.grade) subCounts[s.assignment_id].graded++;
            else subCounts[s.assignment_id].pending++;
          } else {
            subCounts[s.assignment_id].draft++;
          }
        });

        setAssignments((aList || []).map((a: any) => ({
          id: a.id, title: a.title, description: a.description || "", created_at: a.created_at,
          submission_count: subCounts[a.id]?.total || 0,
          graded_count: subCounts[a.id]?.graded || 0,
          pending_count: subCounts[a.id]?.pending || 0,
          draft_count: subCounts[a.id]?.draft || 0,
        })));
      } catch (err) { console.error("Failed to load modules:", err); }
      finally { setLoading(false); }
    };
    load();
  }, [courseId, currentUser.tenantId]);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <span style={{ ...TS.body, fontWeight: 500 }}>Loading...</span>
    </div>
  );

  const totalPending = assignments.reduce((sum, a) => sum + a.pending_count, 0);

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* SINGLE APP BAR */}
      <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box", background: C.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <button onClick={() => navigate("/trainer")} style={{ background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            {business?.logo ? (
              <img src={business.logo} alt={business.business_name || "Business"} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ ...TS.h3, width: 36, height: 36, borderRadius: 8, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>
                {(business?.business_name || "B").charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
              {business?.phone && (
                <a href={`tel:${business.phone}`} style={{ ...TS.label, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {business.phone}
                </a>
              )}
            </div>
          </div>

          <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)} style={{ ...TS.input, padding: "8px 16px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            New
          </button>

          <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "40px 48px 40px", width: "100%", boxSizing: "border-box" }}>
        {/* PENDING REVIEW BANNER */}
        {totalPending > 0 && (
          <div style={{ background: C.orangeBg, borderRadius: 12, padding: "16px 20px", marginBottom: 24, border: `1px solid ${C.orange}33`, display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box", cursor: "pointer" }}
            onClick={() => {
              const firstPending = assignments.find(a => a.pending_count > 0);
              if (firstPending) navigate(`/trainer/submissions/${firstPending.id}`);
            }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M12 6v6l4 2" /><circle cx="12" cy="12" r="10" /></svg>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, color: C.textPrimary }}>{totalPending} submission{totalPending > 1 ? "s" : ""} need grading</div>
              <div style={{ ...TS.bodySm, marginTop: 2 }}>Tap to review and mark now</div>
            </div>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.orange} strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
          </div>
        )}

        {/* EMPTY STATE */}
        {assignments.length === 0 && (
          <div style={{ padding: "80px 40px", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Modules Yet</h3>
            <p style={{ ...TS.bodySm, margin: "0 0 32px" }}>Create your first module to get started.</p>
            <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)} style={{ ...TS.input, padding: "14px 36px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>Create Module</button>
          </div>
        )}

        {/* ASSIGNMENT LIST */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
          {assignments.map((a) => {
            const allGraded = a.submission_count > 0 && a.pending_count === 0;
            const hasPending = a.pending_count > 0;
            const progress = a.submission_count > 0 ? Math.round((a.graded_count / a.submission_count) * 100) : 0;

            return (
              <div key={a.id} style={{ display: "flex", alignItems: "stretch", gap: 16, width: "100%" }}>
                {/* Status icon */}
                <div style={{ ...TS.h2, width: 52, height: 52, borderRadius: 14, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: allGraded ? C.greenBg : hasPending ? C.orangeBg : C.purpleBg, color: allGraded ? C.green : hasPending ? C.orange : C.purple, border: `1px solid ${C.separator}` }}>
                  {allGraded ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                  ) : hasPending ? (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></svg>
                  ) : (
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  )}
                </div>

                {/* Card */}
                <div onClick={() => navigate(`/trainer/assignments/${courseId}/${a.id}`)}
                  style={{ flex: 1, background: C.bg, borderRadius: 12, padding: "18px 24px", cursor: "pointer", border: `1px solid ${hasPending ? C.orange + "33" : allGraded ? C.green + "33" : C.separator}`, minWidth: 0, transition: "border-color 0.2s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = hasPending ? C.orange + "66" : allGraded ? C.green + "66" : C.medBlue + "33"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = hasPending ? C.orange + "33" : allGraded ? C.green + "33" : C.separator; }}>

                  {/* Status badges */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                    {hasPending && (
                      <span style={{ ...TS.caption, color: C.orange, background: C.orangeBg, padding: "3px 8px", borderRadius: 6 }}>
                        {a.pending_count} to grade
                      </span>
                    )}
                    {a.graded_count > 0 && (
                      <span style={{ ...TS.caption, color: C.green, background: C.greenBg, padding: "3px 8px", borderRadius: 6 }}>
                        {a.graded_count} graded
                      </span>
                    )}
                    {a.draft_count > 0 && (
                      <span style={{ ...TS.caption, color: C.textTertiary, background: C.bg, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.separator}` }}>
                        {a.draft_count} draft{a.draft_count > 1 ? "s" : ""}
                      </span>
                    )}
                    {a.submission_count === 0 && (
                      <span style={{ ...TS.caption, color: C.textTertiary, background: C.bg, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.separator}` }}>
                        No submissions
                      </span>
                    )}
                  </div>

                  <h3 style={{ ...TS.h3, margin: "0 0 4px" }}>{a.title}</h3>
                  <p style={{ ...TS.bodySm, margin: "0 0 12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.description || "No description"}</p>

                  {/* Progress bar */}
                  {a.submission_count > 0 && (
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ flex: 1, height: 4, borderRadius: 2, background: C.separator, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${progress}%`, borderRadius: 2, background: allGraded ? C.green : C.medBlue, transition: "width 0.5s ease-out" }} />
                      </div>
                      <span style={{ ...TS.label, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.graded_count}/{a.submission_count} marked</span>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0, justifyContent: "center" }}>
                  {hasPending && (
                    <button onClick={() => navigate(`/trainer/submissions/${a.id}`)} style={{ ...TS.input, padding: "8px 16px", background: C.orange, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>
                      Mark ({a.pending_count})
                    </button>
                  )}
                  {a.submission_count > 0 && !hasPending && (
                    <button onClick={() => navigate(`/trainer/submissions/${a.id}`)} style={{ ...TS.input, padding: "8px 16px", background: C.greenBg, color: C.green, border: `1px solid ${C.green}22`, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>View</button>
                  )}
                  <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}/${a.id}`)} style={{ ...TS.input, padding: "8px 16px", background: C.bg, color: C.textTertiary, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}>Edit</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}