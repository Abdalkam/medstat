// src/user/UserAssignmentTaker.tsx
import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", red: "#FF3B30",
  green: "#34C759", greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE",
  purpleBg: "#F5F0FF", redBg: "#FFEFEE", shadow: "0 4px 24px rgba(0,0,0,0.06)"
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
  const [activeSlide, setActiveSlide] = useState(0);
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

  const isSubmitted = !!submission;
  const isGraded = !!submission?.graded_at;

  function setAnswer(fieldId: string, value: any) { setAnswers((p) => ({ ...p, [fieldId]: value })); }

  async function handleSubmit() {
    const allQuestions = fields.filter(f => f.type !== "note" && f.type !== "header" && f.type !== "file");
    for (const f of allQuestions) {
      if (f.required && !answers[f.id]) { alert("Please answer all required questions before finishing."); return; }
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("assignment_submissions").upsert({
        id: submission?.id || crypto.randomUUID(), tenant_id: currentUser.tenantId, assignment_id: assignment.id,
        user_id: currentUser.id, username: currentUser.username, answers, submitted_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (error) throw error;
      alert("Module completed! Your progress has been saved.");
      navigate("/user");
    } catch (err: any) { alert("Failed: " + err.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <span style={{ ...TS.body, fontWeight: 500 }}>Loading Module...</span>
    </div>
  );

  const currentSlideFields = slides[activeSlide] || [];
  const hasQuestions = fields.some(f => f.type !== "note" && f.type !== "header" && f.type !== "file");

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* APP BAR */}
      <div style={{ background: "linear-gradient(180deg, #FFFFFF 0%, #F9FAFE 100%)", borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", boxShadow: "0 1px 6px rgba(0,0,0,0.04)", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <button onClick={() => navigate("/user")} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
      <div style={{ flex: 1, padding: "32px 24px 100px", width: "100%", boxSizing: "border-box" }}>
        <h1 style={{ ...TS.h1, margin: "0 0 28px" }}>{assignment?.title}</h1>

        {isGraded && (
          <div style={{ background: C.greenBg, borderRadius: 14, padding: "20px 24px", marginBottom: 28, border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", gap: 16, width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ ...TS.h3, fontSize: 18, fontWeight: 700 }}>{submission?.grade || "Reviewed"}</div>
              <div style={{ ...TS.bodySm, marginTop: 2 }}>You have completed this module.</div>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
          {currentSlideFields.map((field) => {
            if (field.type === "header") {
              return <h2 key={field.id} style={{ ...TS.h2, margin: "12px 0 8px" }}>{field.label}</h2>;
            }
            if (field.type === "note") {
              return (
                <div key={field.id} style={{
                  ...TS.body,
                  width: "100%",
                  boxSizing: "border-box",
                  background: C.orangeBg,
                  borderLeft: `6px solid ${C.orange}`,
                  padding: "24px 28px",
                  marginBottom: 8,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}>
                  {field.label}
                </div>
              );
            }
            if (field.type === "file" && field.file_url) {
              const isImage = field.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
              const isVideo = field.file_url.match(/\.(mp4|webm|mov)$/i);
              return (
                <div key={field.id} style={{ background: C.card, borderRadius: 16, overflow: "hidden", boxShadow: C.shadow, marginBottom: 8, width: "100%" }}>
                  {isImage ? <img src={field.file_url} alt={field.label} style={{ width: "100%", maxHeight: "400px", objectFit: "cover" }} /> : isVideo ? <video controls style={{ width: "100%", maxHeight: "400px" }} src={field.file_url} /> : (
                    <a href={field.file_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", background: C.bg, color: C.medBlue, textDecoration: "none" }}>
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
            return (
              <div key={field.id} style={{ background: C.card, borderRadius: 16, padding: "24px 28px", boxShadow: C.shadow, marginBottom: 8, width: "100%", boxSizing: "border-box" }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <span style={{ ...TS.caption, fontSize: 13, color: C.medBlue, background: C.medBlueBg, height: 28, minWidth: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, letterSpacing: "-0.01em", textTransform: "none" }}>Q</span>
                  <h3 style={{ ...TS.h3, margin: 0, lineHeight: 1.4 }}>{field.label}</h3>
                </div>
                {field.type === "text" && <input type="text" value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box" }} />}
                {field.type === "paragraph" && <textarea rows={4} value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box", resize: "vertical" }} />}
                {field.type === "dropdown" && (
                  <select value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ ...TS.input, width: "100%", padding: "12px 16px", border: `1px solid ${C.separator}`, borderRadius: 10, outline: "none", background: C.bg, boxSizing: "border-box", cursor: "pointer" }}>
                    <option value="" disabled>Select...</option>
                    {field.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
                {field.type === "checkbox" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {field.options?.map((opt: string) => (
                      <label key={opt} style={{ ...TS.input, display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                        <input type="checkbox" checked={answers[field.id]?.includes(opt) || false} onChange={(e) => {
                          const current = answers[field.id] || [];
                          if (e.target.checked) setAnswer(field.id, [...current, opt]);
                          else setAnswer(field.id, current.filter((o: string) => o !== opt));
                        }} disabled={isSubmitted} style={{ width: 20, height: 20, accentColor: C.medBlue, cursor: "pointer" }} />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {slides.length > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 36, width: "100%" }}>
            <button onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))} disabled={activeSlide === 0}
              style={{ ...TS.input, padding: "12px 24px", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: activeSlide === 0 ? "not-allowed" : "pointer", opacity: activeSlide === 0 ? 0.5 : 1, color: C.textPrimary, fontSize: 15 }}>
              Previous
            </button>
            {activeSlide < slides.length - 1 ? (
              <button onClick={() => setActiveSlide(prev => Math.min(slides.length - 1, prev + 1))}
                style={{ ...TS.input, padding: "12px 24px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 15 }}>
                Next Slide
              </button>
            ) : (
              !isSubmitted && (
                <button onClick={handleSubmit} disabled={submitting}
                  style={{ ...TS.input, padding: "12px 24px", background: C.green, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.5 : 1, fontSize: 15 }}>
                  {submitting ? "Saving..." : "Finish & Submit"}
                </button>
              )
            )}
          </div>
        )}
        {slides.length <= 1 && !isSubmitted && (
          <div style={{ marginTop: 36, width: "100%" }}>
            <button onClick={handleSubmit} disabled={submitting} style={{ ...TS.input, width: "100%", padding: "16px 24px", background: C.green, color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 17, cursor: "pointer", boxShadow: "0 4px 12px rgba(52,199,89,0.3)" }}>
              {submitting ? "Saving..." : hasQuestions ? "Submit Assessment" : "Complete & Unlock Next Module"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}