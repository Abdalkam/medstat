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

interface FormField {
  id: string; type: string; label: string; required: boolean; 
  options: string[]; page_id: string; file_url: string;
}

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

  useEffect(() => {
    if (!assignmentId) return;
    const load = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        setAssignment(a);
        
        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        setFields((f || []).map((field: any) => ({ 
          id: field.id, type: field.type, label: field.label || "", 
          required: field.required || false, options: field.options || [], 
          page_id: field.page_id || "page-1", file_url: field.file_url || ""
        })));
        
        const { data: s } = await supabase.from("assignment_submissions").select("*").eq("assignment_id", assignmentId).eq("user_id", currentUser.id).maybeSingle();
        if (s) { setSubmission(s); setAnswers(s.answers || {}); }
      } catch (err) { console.error("Failed to load:", err); }
      finally { setLoading(false); }
    };
    load();
  }, [assignmentId, currentUser.id]);

  const slides = useMemo(() => {
    const grouped: Record<string, FormField[]> = {};
    fields.forEach(f => {
      if (!grouped[f.page_id]) grouped[f.page_id] = [];
      grouped[f.page_id].push(f);
    });
    return Object.values(grouped);
  }, [fields]);

  const isSubmitted = !!submission;
  const isGraded = !!submission?.graded_at;

  function setAnswer(fieldId: string, value: any) { 
    setAnswers((p) => ({ ...p, [fieldId]: value })); 
  }

  async function handleSubmit() {
    const allQuestions = fields.filter(f => f.type !== "note" && f.type !== "header" && f.type !== "file");
    for (const f of allQuestions) {
      if (f.required && !answers[f.id]) { 
        alert("Please answer all required questions before finishing."); 
        return; 
      }
    }
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
      alert("Module completed! Your progress has been saved.");
      navigate("/user"); 
    } catch (err: any) { alert("Failed: " + err.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.textTertiary }}>Loading Module...</div>;

  const currentSlideFields = slides[activeSlide] || [];
  const hasQuestions = fields.some(f => f.type !== "note" && f.type !== "header" && f.type !== "file");

  return (
    <div style={{ paddingBottom: 100, background: C.bg, minHeight: "calc(100vh - 60px)" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "24px 16px" }}>
        
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          <button onClick={() => navigate("/user")} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: hasQuestions ? C.purple : C.medBlue, textTransform: "uppercase" }}>{hasQuestions ? "Assessment" : "Lesson"}</span>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{assignment?.title}</h1>
          </div>
        </div>

        {isGraded && (
          <div style={{ background: C.greenBg, borderRadius: 14, padding: 20, marginBottom: 24, border: `1px solid ${C.green}33`, display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.textPrimary }}>{submission?.grade || "Reviewed"}</div>
              <div style={{ fontSize: 13, color: C.textTertiary }}>You have completed this module.</div>
            </div>
          </div>
        )}

        {/* Slide Content */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {currentSlideFields.map((field) => {
            if (field.type === "header") {
              return <h2 key={field.id} style={{ fontSize: 22, fontWeight: 700, color: C.textPrimary, margin: "16px 0 8px" }}>{field.label}</h2>;
            }
            if (field.type === "note") {
              return (
                <div key={field.id} style={{ background: C.orangeBg, borderLeft: `4px solid ${C.orange}`, borderRadius: "0 12px 12px 0", padding: "16px 20px", color: C.textPrimary, fontSize: 15, lineHeight: 1.6, marginBottom: 8 }}>
                  {field.label}
                </div>
              );
            }
            if (field.type === "file" && field.file_url) {
              const isImage = field.file_url.match(/\.(jpeg|jpg|gif|png|webp)$/i);
              const isVideo = field.file_url.match(/\.(mp4|webm|mov)$/i);
              return (
                <div key={field.id} style={{ background: C.card, borderRadius: 16, overflow: "hidden", boxShadow: C.shadow, marginBottom: 8 }}>
                  {isImage ? (
                    <img src={field.file_url} alt={field.label} style={{ width: "100%", maxHeight: "400px", objectFit: "cover" }} />
                  ) : isVideo ? (
                    <video controls style={{ width: "100%", maxHeight: "400px" }} src={field.file_url} />
                  ) : (
                    <a href={field.file_url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px", background: C.bg, color: C.medBlue, textDecoration: "none" }}>
                      <span style={{ fontSize: 24 }}>📄</span>
                      <div>
                        <div style={{ fontWeight: 600, color: C.textPrimary }}>{field.label || "View File"}</div>
                        <div style={{ fontSize: 12 }}>Click to download/view</div>
                      </div>
                    </a>
                  )}
                </div>
              );
            }
            
            // Questions
            return (
              <div key={field.id} style={{ background: C.card, borderRadius: 16, padding: 24, boxShadow: C.shadow, marginBottom: 8 }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.medBlue, background: C.medBlueBg, height: 28, minWidth: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>Q</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{field.label}</h3>
                </div>
                {field.type === "text" && <input type="text" value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }} />}
                {field.type === "paragraph" && <textarea rows={4} value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }} />}
                {field.type === "dropdown" && (
                  <select value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }}>
                    <option value="" disabled>Select...</option>
                    {field.options?.map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
                {field.type === "checkbox" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {field.options?.map((opt: string) => (
                      <label key={opt} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, cursor: "pointer" }}>
                        <input type="checkbox" checked={answers[field.id]?.includes(opt) || false} onChange={(e) => {
                          const current = answers[field.id] || [];
                          if (e.target.checked) setAnswer(field.id, [...current, opt]);
                          else setAnswer(field.id, current.filter((o: string) => o !== opt));
                        }} disabled={isSubmitted} />
                        {opt}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Slide Navigation */}
        {slides.length > 1 && (
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 32 }}>
            <button 
              onClick={() => setActiveSlide(prev => Math.max(0, prev - 1))} 
              disabled={activeSlide === 0}
              style={{ padding: "12px 24px", background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, fontWeight: 600, cursor: activeSlide === 0 ? "not-allowed" : "pointer", opacity: activeSlide === 0 ? 0.5 : 1, color: C.textPrimary }}
            >
              Previous
            </button>
            {activeSlide < slides.length - 1 ? (
              <button 
                onClick={() => setActiveSlide(prev => Math.min(slides.length - 1, prev + 1))} 
                style={{ padding: "12px 24px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer" }}
              >
                Next Slide
              </button>
            ) : (
              !isSubmitted && (
                <button 
                  onClick={handleSubmit} 
                  disabled={submitting}
                  style={{ padding: "12px 24px", background: C.green, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, cursor: "pointer", opacity: submitting ? 0.5 : 1 }}
                >
                  {submitting ? "Saving..." : "Finish & Submit"}
                </button>
              )
            )}
          </div>
        )}

        {/* If only 1 slide, show submit button at bottom */}
        {slides.length <= 1 && !isSubmitted && (
          <div style={{ marginTop: 32, display: "flex", justifyContent: "center" }}>
            <button onClick={handleSubmit} disabled={submitting} style={{ width: "100%", padding: 16, background: C.green, color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 16, cursor: "pointer", boxShadow: "0 4px 12px rgba(52,199,89,0.3)" }}>
              {submitting ? "Saving..." : hasQuestions ? "Submit Assessment" : "Complete & Unlock Next Module"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}