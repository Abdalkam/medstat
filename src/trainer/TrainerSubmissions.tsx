// src/trainer/TrainerSubmissions.tsx
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

interface QuestionField { id: string; type: string; label: string; options: string[]; correctAnswer: string; }
interface Submission {
  id: string; user_id: string; username: string;
  answers: Record<string, any>; grade: string | null;
  submitted_at: string | null; graded_at: string | null;
}
interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

export default function TrainerSubmissions() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [assignment, setAssignment] = useState<any>(null);
  const [questions, setQuestions] = useState<QuestionField[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [grading, setGrading] = useState<Record<string, "correct" | "incorrect">>({});
  const [saving, setSaving] = useState(false);

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
        if (localSettings) {
          const parsed = JSON.parse(localSettings);
          setBusiness({ business_name: parsed.businessName || null, phone: parsed.phone || null, logo: parsed.logo || null });
        }

        // 2. Try Supabase
        const { data } = await supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) setBusiness(data as BusinessData);
      } catch (err: unknown) { console.error("Business fetch failed:", err); }
    };
    fetchBusiness();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (!assignmentId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        if (!cancelled) setAssignment(a);

        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        if (!cancelled) {
          const qFields = (f || [])
            .filter((field: any) => field.type !== "note" && field.type !== "header" && field.type !== "file")
            .map((field: any) => ({ id: field.id, type: field.type, label: field.label || "", options: field.options || [], correctAnswer: field.correct_answer || "" }));
          setQuestions(qFields);
        }

        // Fetch ALL submissions for this assignment (including drafts)
        const { data: subs, error: subsErr } = await supabase
          .from("assignment_submissions")
          .select("*")
          .eq("assignment_id", assignmentId)
          .order("submitted_at", { ascending: false, nullsFirst: false });

        if (subsErr) {
          console.error("Submissions fetch error:", subsErr);
          if (!cancelled) setSubmissions([]);
        } else if (!cancelled) {
          setSubmissions((subs || []).map((s: any) => ({
            id: s.id, user_id: s.user_id, username: s.username || "Unknown",
            answers: s.answers || {}, grade: s.grade, submitted_at: s.submitted_at, graded_at: s.graded_at,
          })));
        }
      } catch (err) { console.error("Failed to load:", err); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    return () => { cancelled = true; };
  }, [assignmentId]);

  // Real-time: listen for new submissions while trainer is on this page
  useEffect(() => {
    if (!assignmentId) return;
    const channel = supabase
      .channel(`submissions-${assignmentId}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "assignment_submissions", filter: `assignment_id=eq.${assignmentId}` },
        () => { setLoading(true); setTimeout(() => window.location.reload(), 500); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [assignmentId]);

  function selectSubmission(sub: Submission) {
    setSelectedSubId(sub.id);
    let g: Record<string, "correct" | "incorrect"> = {};
    if (sub.grade) {
      try { g = JSON.parse(sub.grade); } catch { g = {}; }
    }
    // Auto-mark questions that have a correctAnswer set
    questions.forEach(q => {
      if (!g[q.id] && q.correctAnswer) {
        const userAnswer = sub.answers[q.id];
        if (Array.isArray(userAnswer)) {
          g[q.id] = userAnswer.includes(q.correctAnswer) ? "correct" : "incorrect";
        } else {
          g[q.id] = userAnswer === q.correctAnswer ? "correct" : "incorrect";
        }
      }
    });
    setGrading(g);
  }

  function setMark(fieldId: string, mark: "correct" | "incorrect") {
    setGrading(prev => ({ ...prev, [fieldId]: mark }));
  }

  async function handleSaveGrading() {
    const sub = submissions.find(s => s.id === selectedSubId);
    if (!sub) return;
    setSaving(true);
    try {
      const gradeJson = JSON.stringify(grading);
      const { error } = await supabase
        .from("assignment_submissions")
        .update({
          grade: gradeJson,
          graded_at: new Date().toISOString(),
        })
        .eq("id", sub.id);

      if (error) {
        console.error("Grading save error:", error);
        throw error;
      }

      // Update local state immediately
      setSubmissions(prev => prev.map(s => s.id === sub.id
        ? { ...s, grade: gradeJson, graded_at: new Date().toISOString() }
        : s
      ));

      alert("Grading saved! The trainee will see results next time they open this module.");
      setSelectedSubId(null);
    } catch (err: any) {
      console.error("Failed to save grading:", err);
      alert("Failed to save grading: " + (err.message || "Unknown error") + "\n\nCheck Supabase RLS policies for assignment_submissions table.");
    }
    finally { setSaving(false); }
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <span style={{ ...TS.body, fontWeight: 500 }}>Loading submissions...</span>
    </div>
  );

  const selectedSub = submissions.find(s => s.id === selectedSubId);
  const submittedSubs = submissions.filter(s => s.submitted_at);
  const draftSubs = submissions.filter(s => !s.submitted_at);
  const correctCount = Object.values(grading).filter(v => v === "correct").length;
  const totalCount = questions.length;

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* SINGLE APP BAR */}
      <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box", background: C.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <button onClick={() => navigate(-1)} style={{ background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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

          <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "40px 48px 40px", width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ ...TS.h1, margin: "0 0 32px" }}>{assignment?.title || "Submissions"}</h1>

        {submissions.length === 0 ? (
          <div style={{ padding: "80px 40px", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Submissions Yet</h3>
            <p style={{ ...TS.bodySm, margin: 0 }}>Trainees haven't submitted any answers yet.</p>
          </div>
        ) : selectedSub ? (
          /* ===== GRADING VIEW ===== */
          <div style={{ width: "100%" }}>
            <button onClick={() => setSelectedSubId(null)} style={{ ...TS.input, background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, padding: "10px 20px", fontWeight: 600, cursor: "pointer", fontSize: 14, marginBottom: 24, display: "flex", alignItems: "center", gap: 8 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              Back to list
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
              <div style={{ ...TS.h3, width: 48, height: 48, borderRadius: "50%", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
                {selectedSub.username?.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{ ...TS.h3, fontSize: 18 }}>{selectedSub.username}</div>
                <div style={{ ...TS.bodySm, marginTop: 2 }}>{correctCount} of {totalCount} correct {correctCount === totalCount ? "🏆" : ""}</div>
              </div>
            </div>

            <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.separator, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${totalCount > 0 ? (correctCount / totalCount) * 100 : 0}%`, borderRadius: 3, background: C.green, transition: "width 0.3s ease" }} />
              </div>
              <span style={{ ...TS.label, fontSize: 12, fontWeight: 600, color: C.textTertiary }}>{correctCount}/{totalCount}</span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
              {questions.map((q, i) => {
                const answer = selectedSub.answers[q.id];
                const mark = grading[q.id];
                const answerText = Array.isArray(answer) ? answer.join(", ") : (answer || "(no answer)");

                return (
                  <div key={q.id} style={{ background: C.bg, borderRadius: 12, padding: "24px 28px", border: `1px solid ${mark === "correct" ? C.green + "44" : mark === "incorrect" ? C.red + "44" : C.separator}`, transition: "border-color 0.2s" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                      <span style={{ ...TS.caption, fontSize: 13, color: "#fff", background: mark === "correct" ? C.green : mark === "incorrect" ? C.red : C.medBlue, padding: "4px 10px", borderRadius: 8 }}>Q{i + 1}</span>
                      {q.correctAnswer && (
                        <span style={{ ...TS.caption, fontSize: 10, color: C.textTertiary, background: C.card, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.separator}` }}>Answer key: {q.correctAnswer}</span>
                      )}
                    </div>

                    <h3 style={{ ...TS.h3, margin: "0 0 12px", lineHeight: 1.5 }}>{q.label}</h3>

                    <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", marginBottom: 16, border: `1px solid ${C.separator}` }}>
                      <div style={{ ...TS.caption, fontSize: 10, marginBottom: 4 }}>Trainee's answer:</div>
                      <div style={{ ...TS.body, fontSize: 15 }}>{answerText}</div>
                    </div>

                    {/* ✓ / ✗ buttons — spread FIRST, overrides AFTER */}
                    <div style={{ display: "flex", gap: 12 }}>
                      <button
                        onClick={() => setMark(q.id, "correct")}
                        style={{
                          ...TS.input,
                          flex: 1, padding: "14px", borderRadius: 10,
                          border: `2px solid ${mark === "correct" ? C.green : C.separator}`,
                          background: mark === "correct" ? C.green : C.card,
                          color: mark === "correct" ? "#fff" : C.textTertiary,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          fontSize: 15, fontWeight: 700, transition: "all 0.2s",
                        }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        Correct
                      </button>
                      <button
                        onClick={() => setMark(q.id, "incorrect")}
                        style={{
                          ...TS.input,
                          flex: 1, padding: "14px", borderRadius: 10,
                          border: `2px solid ${mark === "incorrect" ? C.red : C.separator}`,
                          background: mark === "incorrect" ? C.red : C.card,
                          color: mark === "incorrect" ? "#fff" : C.textTertiary,
                          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                          fontSize: 15, fontWeight: 700, transition: "all 0.2s",
                        }}>
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        Incorrect
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 32, width: "100%" }}>
              <button onClick={handleSaveGrading} disabled={saving}
                style={{ ...TS.input, width: "100%", padding: "16px 24px", background: saving ? C.textTertiary : C.green, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 17, cursor: saving ? "wait" : "pointer" }}>
                {saving ? "Saving..." : `Save Grading (${correctCount}/${totalCount} correct)`}
              </button>
            </div>
          </div>
        ) : (
          /* ===== SUBMISSION LIST ===== */
          <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
            {/* Submitted */}
            {submittedSubs.map((sub) => {
              const isGraded = !!sub.graded_at;
              let gradeData: Record<string, string> = {};
              if (sub.grade) { try { gradeData = JSON.parse(sub.grade); } catch { } }
              const subCorrectCount = Object.values(gradeData).filter(v => v === "correct").length;

              return (
                <div key={sub.id} onClick={() => selectSubmission(sub)}
                  style={{ display: "flex", alignItems: "center", gap: 16, background: C.bg, borderRadius: 12, padding: "18px 24px", cursor: "pointer", border: `1px solid ${isGraded ? C.green + "33" : C.orange + "33"}`, minWidth: 0, transition: "border-color 0.2s" }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = isGraded ? C.green + "66" : C.orange + "66"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = isGraded ? C.green + "33" : C.orange + "33"; }}>

                  <div style={{ ...TS.h3, width: 48, height: 48, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: isGraded ? C.greenBg : C.orangeBg, color: isGraded ? C.green : C.orange, border: `1px solid ${C.separator}`, fontSize: 18 }}>
                    {isGraded ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg> : sub.username?.charAt(0).toUpperCase()}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ ...TS.caption, color: isGraded ? C.green : C.orange, background: isGraded ? C.greenBg : C.orangeBg, padding: "3px 8px", borderRadius: 6 }}>
                        {isGraded ? "Graded" : "Pending"}
                      </span>
                      {isGraded && <span style={{ ...TS.caption, color: C.textTertiary, background: C.card, padding: "3px 8px", borderRadius: 6, border: `1px solid ${C.separator}` }}>{subCorrectCount}/{questions.length} correct</span>}
                    </div>
                    <h3 style={{ ...TS.h3, margin: 0 }}>{sub.username}</h3>
                    <p style={{ ...TS.bodySm, margin: "4px 0 0" }}>{isGraded ? `Marked ${subCorrectCount} of ${questions.length} correct` : "Awaiting review"}</p>
                  </div>

                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.textTertiary} strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              );
            })}

            {/* Drafts (not yet submitted) */}
            {draftSubs.length > 0 && (
              <>
                <div style={{ ...TS.caption, margin: "16px 0 4px" }}>Drafts (not yet submitted)</div>
                {draftSubs.map((sub) => (
                  <div key={sub.id} style={{ display: "flex", alignItems: "center", gap: 16, background: C.bg, borderRadius: 12, padding: "14px 24px", border: `1px solid ${C.separator}`, opacity: 0.6 }}>
                    <div style={{ ...TS.h3, width: 40, height: 40, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: C.bg, color: C.textTertiary, border: `1px solid ${C.separator}`, fontSize: 14 }}>
                      {sub.username?.charAt(0).toUpperCase()}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ ...TS.h3, margin: 0, fontSize: 15 }}>{sub.username}</h3>
                      <p style={{ ...TS.bodySm, margin: "2px 0 0" }}>Saved draft — not yet submitted</p>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}