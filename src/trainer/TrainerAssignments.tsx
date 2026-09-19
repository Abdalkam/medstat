// src/trainer/TrainerAssignments.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", green: "#34C759", greenBg: "#EAF9EE",
  purple: "#AF52DE", purpleBg: "#F5F0FF", orange: "#FF9F0A", orangeBg: "#FFF6EB",
  shadow: "0 4px 24px rgba(0,0,0,0.06)", shadowHover: "0 8px 32px rgba(0,0,0,0.1)",
};

interface AssignmentSummary { id: string; title: string; description: string; created_at: string; submission_count: number; graded_count: number; }

export default function TrainerAssignments() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [assignments, setAssignments] = useState<AssignmentSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!courseId) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data: aList, error: aErr } = await supabase.from("assignments").select("id, title, description, created_at").eq("course_id", courseId).eq("tenant_id", currentUser.tenantId).order("created_at", { ascending: false });
        if (aErr) throw aErr;
        const { data: subs } = await supabase.from("assignment_submissions").select("assignment_id, grade");
        const subCounts: Record<string, { total: number; graded: number }> = {};
        (subs || []).forEach((s: any) => { if (!subCounts[s.assignment_id]) subCounts[s.assignment_id] = { total: 0, graded: 0 }; subCounts[s.assignment_id].total++; if (s.grade) subCounts[s.assignment_id].graded++; });
        setAssignments((aList || []).map((a: any) => ({ id: a.id, title: a.title, description: a.description || "", created_at: a.created_at, submission_count: subCounts[a.id]?.total || 0, graded_count: subCounts[a.id]?.graded || 0 })));
      } catch (err) { console.error("Failed to load modules:", err); } finally { setLoading(false); }
    };
    load();
  }, [courseId, currentUser.tenantId]);

  if (loading) {
    return (
      <div style={{ padding: "32px 24px", maxWidth: "800px", margin: "0 auto" }}>
        <style>{`@keyframes shimmer { 0%{background-position:-200% 0} 100%{background-position:200% 0} }`}</style>
        {[1, 2, 3].map((i) => (
          <div key={i} style={{ background: C.card, borderRadius: 18, padding: 22, marginBottom: 14, display: "flex", gap: 16, alignItems: "center", boxShadow: C.shadow }}>
            <div style={{ width: 52, height: 52, borderRadius: 16, background: `linear-gradient(90deg,${C.separator} 25%,${C.separatorLight} 50%,${C.separator} 75%)`, backgroundSize: "200% 100%", animation: `shimmer 1.5s infinite ${i * 0.15}s`, flexShrink: 0 }} />
            <div style={{ flex: 1 }}>
              <div style={{ width: "55%", height: 16, borderRadius: 8, background: `linear-gradient(90deg,${C.separator} 25%,${C.separatorLight} 50%,${C.separator} 75%)`, backgroundSize: "200% 100%", animation: `shimmer 1.5s infinite ${i * 0.15 + 0.05}s`, marginBottom: 10 }} />
              <div style={{ width: "35%", height: 12, borderRadius: 6, background: `linear-gradient(90deg,${C.separator} 25%,${C.separatorLight} 50%,${C.separator} 75%)`, backgroundSize: "200% 100%", animation: `shimmer 1.5s infinite ${i * 0.15 + 0.1}s` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: "800px", margin: "0 auto", minHeight: "calc(100vh - 100px)", display: "flex", flexDirection: "column" }}>
      <style>{`@keyframes fadeSlideIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } } .assignment-card { animation: fadeSlideIn 0.3s ease-out; }`}</style>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 28, flexShrink: 0 }}>
        <button onClick={() => navigate(-1)} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 12, color: C.medBlue, cursor: "pointer", width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.15s", flexShrink: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
        </button>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, flex: 1, letterSpacing: "-0.5px" }}>Modules</h1>
        <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)} style={{ padding: "10px 20px", background: `linear-gradient(135deg, ${C.medBlue}, #0055D4)`, color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", gap: 7, boxShadow: "0 4px 16px rgba(0,122,255,0.3)", transition: "all 0.2s", letterSpacing: "0.2px", flexShrink: 0 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.transform = "translateY(-1px)"; (e.currentTarget as HTMLElement).style.boxShadow = "0 6px 20px rgba(0,122,255,0.4)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "0 4px 16px rgba(0,122,255,0.3)"; }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
          New Module
        </button>
      </div>

      {/* Empty State */}
      {assignments.length === 0 && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "40px 24px" }}>
          <div style={{ width: 88, height: 88, borderRadius: 24, background: `linear-gradient(135deg, ${C.purpleBg}, ${C.medBlueBg})`, marginBottom: 24, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
          </div>
          <h3 style={{ margin: "0 0 10px", fontSize: 20, fontWeight: 700, letterSpacing: "-0.3px" }}>No Modules Yet</h3>
          <p style={{ margin: "0 0 32px", color: C.textTertiary, fontSize: 15, lineHeight: 1.5, maxWidth: 320 }}>Create your first module to get started.</p>
          <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}`)} style={{ padding: "14px 36px", background: `linear-gradient(135deg, ${C.medBlue}, #0055D4)`, color: "#fff", border: "none", borderRadius: 14, fontWeight: 700, cursor: "pointer", fontSize: 16, boxShadow: "0 4px 16px rgba(0,122,255,0.35)", transition: "all 0.2s", letterSpacing: "0.3px" }}>Create Module</button>
        </div>
      )}

      {/* Module List */}
      {assignments.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1 }}>
          {assignments.map((a, idx) => {
            const allGraded = a.submission_count > 0 && a.submission_count === a.graded_count;
            const progress = a.submission_count > 0 ? Math.round((a.graded_count / a.submission_count) * 100) : 0;
            return (
              <div key={a.id} className="assignment-card" style={{ animationDelay: `${idx * 0.05}s` }}>
                <div onClick={() => navigate(`/trainer/assignments/${courseId}/${a.id}`)}
                  style={{ background: C.card, borderRadius: 18, padding: "20px 22px", border: allGraded ? `1.5px solid ${C.green}44` : `1px solid ${C.separatorLight}`, cursor: "pointer", transition: "all 0.2s", boxShadow: C.shadow, display: "flex", alignItems: "center", gap: 16 }}
                  onMouseEnter={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "translateY(-2px)"; el.style.boxShadow = C.shadowHover; el.style.borderColor = allGraded ? C.green + "66" : C.medBlue + "33"; }}
                  onMouseLeave={(e) => { const el = e.currentTarget as HTMLElement; el.style.transform = "none"; el.style.boxShadow = C.shadow; el.style.borderColor = allGraded ? `${C.green}44` : C.separatorLight; }}>
                  
                  <div style={{ width: 52, height: 52, borderRadius: 16, flexShrink: 0, background: allGraded ? `linear-gradient(135deg, ${C.greenBg}, #D4F5DC)` : `linear-gradient(135deg, ${C.purpleBg}, #EDE0FF)`, display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.2s" }}>
                    {allGraded ? (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    ) : (
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.purple} strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                    )}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ margin: "0 0 4px", fontSize: 16, fontWeight: 650, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", letterSpacing: "-0.2px" }}>{a.title}</h3>
                    <p style={{ margin: "0 0 12px", fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.description || "No description"}</p>
                    {a.submission_count > 0 ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <div style={{ flex: 1, height: 5, borderRadius: 3, background: C.separatorLight, overflow: "hidden" }}>
                          <div style={{ height: "100%", width: `${progress}%`, borderRadius: 3, background: allGraded ? `linear-gradient(90deg, ${C.green}, #28B84C)` : `linear-gradient(90deg, ${C.medBlue}, #0055D4)`, transition: "width 0.5s ease-out" }} />
                        </div>
                        <span style={{ fontSize: 12, color: C.textTertiary, fontWeight: 600, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{a.graded_count}/{a.submission_count} graded</span>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, color: C.textTertiary, fontWeight: 500 }}>No submissions yet</span>
                    )}
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    {a.submission_count > 0 && (
                      <button onClick={() => navigate(`/trainer/submissions/${a.id}`)} style={{ padding: "8px 16px", background: C.greenBg, color: C.green, border: `1px solid ${C.green}22`, borderRadius: 10, fontWeight: 650, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", transition: "all 0.15s", letterSpacing: "0.2px" }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = C.green; (e.currentTarget as HTMLElement).style.color = "#fff"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = C.greenBg; (e.currentTarget as HTMLElement).style.color = C.green; }}>Grade</button>
                    )}
                    <button onClick={() => navigate(`/trainer/assignment-builder/${courseId}/${a.id}`)} style={{ padding: "8px 16px", background: C.bg, color: C.textTertiary, border: `1px solid ${C.separator}`, borderRadius: 10, fontWeight: 600, cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", transition: "all 0.15s" }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.medBlue + "44"; (e.currentTarget as HTMLElement).style.color = C.medBlue; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.borderColor = C.separator; (e.currentTarget as HTMLElement).style.color = C.textTertiary; }}>Edit</button>
                  </div>

                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.separator} strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 2 }}><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}