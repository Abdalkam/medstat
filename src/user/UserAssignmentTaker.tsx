// src/user/UserAssignmentTaker.tsx
import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", red: "#FF3B30",
  green: "#34C759", greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE",
  purpleBg: "#F5F0FF", redBg: "#FFEFEE",
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

interface FormField { id: string; type: string; label: string; required: boolean; options: string[]; page_id: string; file_url: string; }
interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

export default function UserAssignmentTaker() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [assignment, setAssignment] = useState<any>(null);
  const [fields, setFields] = useState<FormField[]>([]);
  const [submission, setSubmission] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [activeSlide, setActiveSlide] = useState(0);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);

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
    if (!assignmentId) return;
    const load = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        setAssignment(a);
        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        setFields((f || []).map((field: any) => ({ id: field.id, type: field.type, label: field.label || "", required: field.required || false, options: field.options || [], page_id: field.page_id || "page-1", file_url: field.file_url || "" })));
        const { data: s } = await supabase.from("assignment_submissions").select("*").eq("assignment_id", assignmentId).eq("user_id", currentUser.id).maybeSingle();
        if (s) { setSubmission(s); setAnswers(s.answers || {}); }
      } catch (err) { console.error("Failed to load:", err); }
      finally { setLoading(false); }
    };
    load();
  }, [assignmentId, currentUser.id]);

  const slides = useMemo(() => {
    const grouped: Record<string, FormField[]> = {};
    fields.forEach(f => { if (!grouped[f.page_id]) grouped[f.page_id] = []; grouped[f.page_id].push(f); });
    return Object.values(grouped);
  }, [fields]);

  const isSubmitted = !!submission?.submitted_at;
  const isGraded = !!submission?.graded_at;

  const gradeData: Record<string, "correct" | "incorrect"> = useMemo(() => {
    if (!submission?.grade) return {};
    try { return JSON.parse(submission.grade); } catch { return {}; }
  }, [submission]);

  const questionFields = fields.filter(f => f.type !== "note" && f.type !== "header" && f.type !== "file");
  const answeredCount = questionFields.filter(f => {
    const ans = answers[f.id];
    if (Array.isArray(ans)) return ans.length > 0;
    return ans !== undefined && ans !== null && ans !== "";
  }).length;
  const requiredUnanswered = questionFields.filter(f => {
    if (!f.required) return false;
    const ans = answers[f.id];
    if (Array.isArray(ans)) return ans.length === 0;
    return !ans || ans === "";
  });
  const correctCount = Object.values(gradeData).filter(v => v === "correct").length;

  function setAnswer(fieldId: string, value: any) { setAnswers((p) => ({ ...p, [fieldId]: value })); }

  async function handleSaveDraft() {
    setSavingDraft(true);
    try {
      const { error } = await supabase.from("assignment_submissions").upsert({
        id: submission?.id || crypto.randomUUID(),
        tenant_id: currentUser.tenantId,
        assignment_id: assignment.id,
        user_id: currentUser.id,
        username: currentUser.username,
        answers,
        submitted_at: null,
      }, { onConflict: "id" });
      if (error) throw error;
      const { data: s } = await supabase.from("assignment_submissions").select("*").eq("assignment_id", assignmentId).eq("user_id", currentUser.id).maybeSingle();
      if (s) setSubmission(s);
      alert("Progress saved. You can return later to finish.");
    } catch (err: any) { alert("Failed to save: " + err.message); }
    finally { setSavingDraft(false); }
  }

  async function handleSubmit() {
    setShowSubmitConfirm(false);
    setSubmitting(true);
    try {
      const { error } = await supabase.from("assignment_submissions").upsert({
        id: submission?.id || crypto.randomUUID(),
        tenant_id: currentUser.tenantId,
        assignment_id: assignment.id,
        user_id: currentUser.id,
        username: currentUser.username,
        answers,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      navigate("/user/assignments/" + assignment.course_id);
    } catch (err: any) { alert("Failed: " + err.message); }
    finally { setSubmitting(false); }
  }

  function attemptSubmit() {
    if (requiredUnanswered.length > 0) {
      alert(`Please answer all required questions (${requiredUnanswered.length} remaining).`);
      return;
    }
    setShowSubmitConfirm(true);
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <span style={{ ...TS.body, fontWeight: 500 }}>Loading Module...</span>
    </div>
  );

  const currentSlideFields = slides[activeSlide] || [];
  const hasQuestions = questionFields.length > 0;
  const progressPct = questionFields.length > 0 ? Math.round((answeredCount / questionFields.length) * 100) : 100;
  let questionCounter = 0;

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* APP BAR */}
      <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box", background: C.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <button onClick={() => navigate(`/user/assignments/${assignment?.course_id || ""}`)} style={{ background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
      <div style={{ padding: "40px 48px 100px", width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ ...TS.h1, margin: "0 0 12px" }}>{assignment?.title}</h1>

        {/* PROGRESS BAR */}
        {hasQuestions && !isSubmitted && (
          <div style={{ marginBottom: 32, display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.separator, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progressPct}%`, borderRadius: 3, background: C.medBlue, transition: "width 0.3s ease" }} />
            </div>
            <span style={{ ...TS.label, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", color: C.textTertiary }}>{answeredCount}/{questionFields.length} answered</span>
          </div>
        )}

        {/* GRADED RESULTS BANNER */}
        {isGraded && (
          <div style={{ background: C.greenBg, borderRadius: 14, padding: "20px 24px", marginBottom: 32, border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", gap: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div>
              <div style={{ ...TS.h3, fontSize: 18, fontWeight: 700 }}>{correctCount} / {questionFields.length} Correct {correctCount === questionFields.length ? "🏆" : ""}</div>
              <div style={{ ...TS.bodySm, marginTop: 2 }}>Your trainer has reviewed your answers.</div>
            </div>
          </div>
        )}

        {/* PENDING REVIEW BANNER */}
        {isSubmitted && !isGraded && (
          <div style={{ background: C.medBlueBg, borderRadius: 12, padding: "20px 24px", marginBottom: 32, border: `1px solid ${C.medBlue}33`, display: "flex", alignItems: "center", gap: 12, width: "100%", boxSizing: "border-box" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            <div>
              <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, color: C.medBlue }}>Submitted — Pending Review</div>
              <div style={{ ...TS.bodySm, marginTop: 2 }}>Your trainer will review and grade your submission.</div>
            </div>
          </div>
        )}

        {/* SLIDE CONTENT */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
          {currentSlideFields.map((field) => {
            if (field.type === "header") {
              return <h2 key={field.id} style={{ ...TS.h2, margin: "16px 0 8px" }}>{field.label}</h2>;
            }
            if (field.type === "note") {
              return (
                <div key={field.id} style={{
                  ...TS.body,
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.orangeBg,
                  borderLeft: `4px solid ${C.orange}`,
                  padding: "20px 24px",
                  marginBottom: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  borderRadius: 8,
                }}>
                  {field.label}
                </div>
              );
            }
            if (field.type === "file" && field.file_url) {
              const isImage = field.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
              const isVideo = field.file_url.match(/\.(mp4|webm|mov)$/i);
              return (
                <div key={field.id} style={{ background: C.bg, borderRadius: 12, overflow: "hidden", marginBottom: 8, width: "100%", border: `1px solid ${C.separator}` }}>
                  {isImage ? <img src={field.file_url} alt={field.label} style={{ width: "100%", maxHeight: "400px", objectFit: "cover" }} /> : isVideo ? <video controls style={{ width: "100%", maxHeight: "400px" }} src={field.file_url} /> : (
                    <a href={field.file_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", color: C.medBlue, textDecoration: "none" }}>
                      <span style={{ fontSize: 28 }}>📄</span>
                      <div>
                        <div style={{ ...TS.h3, fontSize: 15, fontWeight: 600 }}>{field.label || "View File"}</div>
                        <div style={{ ...TS.bodySm, fontSize: 13, marginTop: 2 }}>Click to download/view</div>
                      </div>
                    </a>
                  )}
                </div>
              );
            }

            // QUESTION CARDS — just "Question 1", "Question 2", etc.
            questionCounter++;
            const isAnswered = (() => {
              const ans = answers[field.id];
              if (Array.isArray(ans)) return ans.length > 0;
              return ans !== undefined && ans !== null && ans !== "";
            })();
            const mark = gradeData[field.id];

            return (
              <div key={field.id} style={{
                background: C.bg, borderRadius: 12, padding: "24px 28px", marginBottom: 8, width: "100%", boxSizing: "border-box",
                border: `1px solid ${isGraded ? (mark === "correct" ? C.green + "44" : mark === "incorrect" ? C.red + "44" : C.separator) : (isAnswered ? C.green + "44" : C.separator)}`,
                transition: "border-color 0.2s",
              }}>
                {/* Question header — just "Question 1" + Required + ✓/✗ */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ ...TS.input, fontSize: 15, fontWeight: 700, color: isGraded ? (mark === "correct" ? C.green : mark === "incorrect" ? C.red : C.textPrimary) : C.textPrimary }}>Question {questionCounter}</span>
                    {field.required && <span style={{ ...TS.caption, fontSize: 10, color: "#fff", background: C.red, padding: "2px 6px", borderRadius: 4 }}>Required</span>}
                  </div>
                  {/* Show ✓/✗ when graded, or ✓ when answered */}
                  {isGraded ? (
                    mark === "correct" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        </div>
                        <span style={{ ...TS.input, fontSize: 14, fontWeight: 700, color: C.green }}>Correct</span>
                      </div>
                    ) : mark === "incorrect" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.red, display: "flex", alignItems: "center", justifyContent: "center" }}>
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                        </div>
                        <span style={{ ...TS.input, fontSize: 14, fontWeight: 700, color: C.red }}>Incorrect</span>
                      </div>
                    ) : null
                  ) : isAnswered && !isSubmitted ? (
                    <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                    </div>
                  ) : null}
                </div>

                {/* Question text */}
                <h3 style={{ ...TS.h3, margin: "0 0 16px", lineHeight: 1.5 }}>{field.label}</h3>

                {/* Answer input */}
                {field.type === "text" && (
                  <input type="text" value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} placeholder="Type your answer..." style={{ ...TS.input, width: "100%", padding: "14px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.card, boxSizing: "border-box" }} />
                )}
                {field.type === "paragraph" && (
                  <textarea rows={5} value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} placeholder="Type your detailed answer..." style={{ ...TS.input, width: "100%", padding: "14px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.card, boxSizing: "border-box", resize: "vertical", lineHeight: 1.6 }} />
                )}
                {field.type === "dropdown" && (
                  <select value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ ...TS.input, width: "100%", padding: "14px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.card, boxSizing: "border-box", cursor: "pointer" }}>
                    <option value="" disabled>Select an answer...</option>
                    {field.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
                {field.type === "checkbox" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {field.options?.map((opt: string) => {
                      const checked = answers[field.id]?.includes(opt) || false;
                      return (
                        <label key={opt} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.card, borderRadius: 10, border: `1px solid ${checked ? C.medBlue + "44" : C.separator}`, cursor: isSubmitted ? "default" : "pointer", transition: "border-color 0.2s" }}
                          onClick={(e) => { if (isSubmitted) return; e.preventDefault(); const current = answers[field.id] || []; if (checked) setAnswer(field.id, current.filter((o: string) => o !== opt)); else setAnswer(field.id, [...current, opt]); }}>
                          <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${checked ? C.medBlue : C.separator}`, background: checked ? C.medBlue : C.card, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all 0.2s" }}>
                            {checked && <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
                          </div>
                          <span style={{ ...TS.input, userSelect: "none" }}>{opt}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* SLIDE NAVIGATION */}
        {slides.length > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 40, width: "100%" }}>
            <button onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))} disabled={activeSlide === 0}
              style={{ ...TS.input, padding: "12px 24px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: activeSlide === 0 ? "not-allowed" : "pointer", opacity: activeSlide === 0 ? 0.5 : 1, color: C.textPrimary, fontSize: 15 }}>
              Previous
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              {!isSubmitted && (
                <button onClick={handleSaveDraft} disabled={savingDraft}
                  style={{ ...TS.input, padding: "12px 20px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: savingDraft ? "wait" : "pointer", fontSize: 14, color: C.textTertiary }}>
                  {savingDraft ? "Saving..." : "Save Draft"}
                </button>
              )}
              {activeSlide < slides.length - 1 ? (
                <button onClick={() => setActiveSlide(prev => Math.min(slides.length - 1, prev + 1))}
                  style={{ ...TS.input, padding: "12px 24px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 15 }}>
                  Next Slide
                </button>
              ) : (
                !isSubmitted && (
                  <button onClick={attemptSubmit} disabled={submitting}
                    style={{ ...TS.input, padding: "12px 24px", background: C.green, color: "#fff", border: "none", borderRadius: 10, fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.5 : 1, fontSize: 15 }}>
                    {submitting ? "Submitting..." : "Finish & Submit"}
                  </button>
                )
              )}
            </div>
          </div>
        )}

        {/* SINGLE SLIDE — submit + save draft */}
        {slides.length <= 1 && !isSubmitted && (
          <div style={{ marginTop: 40, display: "flex", gap: 12, width: "100%" }}>
            <button onClick={handleSaveDraft} disabled={savingDraft}
              style={{ ...TS.input, flex: 1, padding: "16px 24px", background: C.bg, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: savingDraft ? "wait" : "pointer", fontSize: 16, color: C.textTertiary }}>
              {savingDraft ? "Saving..." : "Save Draft"}
            </button>
            <button onClick={attemptSubmit} disabled={submitting}
              style={{ ...TS.input, flex: 2, padding: "16px 24px", background: C.green, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>
              {submitting ? "Submitting..." : hasQuestions ? "Submit Assessment" : "Complete & Unlock Next Module"}
            </button>
          </div>
        )}
      </div>

      {/* SUBMIT CONFIRMATION MODAL */}
      {showSubmitConfirm && (
        <div onClick={() => setShowSubmitConfirm(false)} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 16, padding: 28, maxWidth: 420, width: "100%", textAlign: "center" }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: C.greenBg, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 18, margin: "0 0 8px" }}>Submit Answers?</h3>
            <p style={{ ...TS.bodySm, margin: "0 0 8px" }}>You've answered <strong>{answeredCount} of {questionFields.length}</strong> questions.</p>
            {answeredCount < questionFields.length && (
              <p style={{ ...TS.bodySm, margin: "0 0 20px", color: C.orange }}>⚠️ {questionFields.length - answeredCount} questions are unanswered and will be submitted blank.</p>
            )}
            {answeredCount === questionFields.length && <p style={{ ...TS.bodySm, margin: "0 0 20px" }}>All questions answered. Your trainer will review and grade your submission.</p>}
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={() => setShowSubmitConfirm(false)} style={{ ...TS.input, flex: 1, padding: "12px", background: C.bg, color: C.textPrimary, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 14 }}>Cancel</button>
              <button onClick={handleSubmit} style={{ ...TS.input, flex: 1, padding: "12px", background: C.green, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", fontSize: 14 }}>Submit</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}