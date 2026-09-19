// src/user/UserAssignmentTaker.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", red: "#FF3B30", 
  green: "#34C759", greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE",
};

interface AssignmentField { id: string; type: string; label: string; required: boolean; options?: string[][]; }

export default function UserAssignmentTaker() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [assignment, setAssignment] = useState<any>(null);
  const [fields, setFields] = useState<AssignmentField[]>([]);
  const [submission, setSubmission] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!assignmentId) return;
    const load = async () => {
      try {
        const { data: a } = await supabase.from("assignments").select("*").eq("id", assignmentId).maybeSingle();
        setAssignment(a);
        const { data: f } = await supabase.from("assignment_fields").select("*").eq("assignment_id", assignmentId).order("sort_order", { ascending: true });
        setFields((f || []).map((field: any) => ({ id: field.id, type: field.type, label: field.label || "", required: field.required || false, options: field.options || [] })));
        const { data: s } = await supabase.from("assignment_submissions").select("*").eq("assignment_id", assignmentId).eq("user_id", currentUser.id).maybeSingle();
        if (s) { setSubmission(s); setAnswers(s.answers || {}); }
      } catch (err) { console.error("Failed to load:", err); }
      finally { setLoading(false); }
    };
    load();
  }, [assignmentId, currentUser.id]);

  function setAnswer(fieldId: string, value: any) { setAnswers((p) => ({ ...p, [fieldId]: value })); }

  async function handleSubmit() {
    for (const f of fields) {
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
      navigate(-1); 
    } catch (err: any) { alert("Failed: " + err.message); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.textTertiary }}>Loading Module...</div>;

  const isSubmitted = !!submission;
  const isGraded = !!submission?.graded_at;
  const hasQuestions = fields.length > 0;

  return (
    <div style={{ paddingBottom: 100 }}>
      {(assignment?.video_url || assignment?.audio_url) && (
        <div style={{ background: "#000", minHeight: 200, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "0 0 24px 24px", overflow: "hidden", marginBottom: 24 }}>
          {assignment?.video_url ? <video controls style={{ width: "100%", maxHeight: "60vh" }} src={assignment.video_url} /> : (
            <div style={{ padding: 40, textAlign: "center", width: "100%" }}>
              <div style={{ width: 64, height: 64, background: "#333", borderRadius: "50%", margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="#fff"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
              </div>
              <audio controls style={{ width: "100%", maxWidth: 400 }} src={assignment.audio_url} />
            </div>
          )}
        </div>
      )}

      <div style={{ maxWidth: "800px", margin: "0 auto", padding: "0 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
          <button onClick={() => navigate(-1)} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: hasQuestions ? C.purple : C.medBlue, textTransform: "uppercase" }}>{hasQuestions ? "Assessment" : "Lesson"}</span>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{assignment?.title}</h1>
          </div>
        </div>

        {assignment?.description && <div style={{ background: C.card, borderRadius: 14, padding: 20, marginBottom: 24, color: C.textTertiary, fontSize: 15, lineHeight: 1.6, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>{assignment.description}</div>}

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

        {hasQuestions && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, margin: "8px 0 0" }}>Assessment Questions</h2>
            {fields.map((field, idx) => (
              <div key={field.id} style={{ background: C.card, borderRadius: 16, padding: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
                <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
                  <span style={{ fontSize: 14, fontWeight: 700, color: C.medBlue, background: C.medBlueBg, height: 28, minWidth: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>{idx + 1}</span>
                  <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, lineHeight: 1.4 }}>{field.label}</h3>
                </div>
                {field.type === "text" && <input type="text" value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }} />}
                {field.type === "paragraph" && <textarea rows={4} value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }} />}
                {field.type === "dropdown" && (
                  <select value={answers[field.id] || ""} onChange={(e) => setAnswer(field.id, e.target.value)} disabled={isSubmitted} style={{ width: "100%", padding: "12px", border: `1px solid ${C.separator}`, borderRadius: 10, fontSize: 15 }}>
                    <option value="" disabled>Select...</option>
                    {field.options?.map((opt: any) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {!isSubmitted && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "rgba(255,255,255,0.9)", backdropFilter: "blur(20px)", padding: 20, borderTop: `1px solid ${C.separator}`, display: "flex", justifyContent: "center" }}>
          <button onClick={handleSubmit} disabled={submitting} style={{ width: "100%", maxWidth: 600, padding: 16, background: C.green, color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, fontSize: 16, cursor: "pointer", boxShadow: "0 4px 12px rgba(52,199,89,0.3)" }}>
            {submitting ? "Saving..." : hasQuestions ? "Submit Assessment" : "Complete & Unlock Next Module"}
          </button>
        </div>
      )}
    </div>
  );
}