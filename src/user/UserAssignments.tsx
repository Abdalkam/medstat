// src/user/UserAssignments.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", green: "#34C759",
  greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB", red: "#FF3B30", redBg: "#FFEFEE", purple: "#AF52DE",
};

interface AssignmentData { id: string; title: string; description: string; video_url?: string; }
interface SubmissionData { id: string; assignment_id: string; graded_at: string | null; }
interface TenantData { name: string; phone: string | null; logo_url: string | null; }

export default function UserAssignments() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [assignments, setAssignments] = useState<AssignmentData[]>([]);
  const [submissions, setSubmissions] = useState<Record<string, SubmissionData>>({});
  const [loading, setLoading] = useState(true);
  const [tenant, setTenant] = useState<TenantData | null>(null);

  // ✅ Bulletproof logout
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
    const fetchTenant = async () => {
      try {
        const { data } = await supabase.from("tenants").select("name, phone, logo_url").eq("id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) setTenant(data as TenantData);
      } catch (err: unknown) { console.error("Tenant fetch failed:", err); }
    };
    fetchTenant();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    if (!courseId || !currentUser?.id) { setLoading(false); return; }
    const load = async () => {
      try {
        const { data: aData, error: aErr } = await supabase.from("assignments").select("id, title, description, video_url").eq("course_id", courseId).order("created_at", { ascending: true });
        if (aErr) throw aErr;
        setAssignments((aData as AssignmentData[]) || []);
        const { data: sData, error: sErr } = await supabase.from("assignment_submissions").select("*").eq("user_id", currentUser.id);
        if (sErr) throw sErr;
        const map: Record<string, SubmissionData> = {};
        (sData || []).forEach((s: any) => { map[s.assignment_id] = s; });
        setSubmissions(map);
      } catch (err) { console.error("Failed to load:", err); }
      finally { setLoading(false); }
    };
    load();
  }, [courseId, currentUser?.id]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: C.textTertiary }}>Loading Course Path...</div>;

  const isLocked = (index: number) => {
    if (index === 0) return false;
    const prevAssignment = assignments[index - 1];
    const prevSub = submissions[prevAssignment.id];
    return !prevSub || !prevSub.graded_at;
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column" }}>
      {/* APP BAR with gradient */}
      <div style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #F9FAFE 100%)",
        borderBottom: `1px solid ${C.separator}`,
        padding: "16px 20px 20px",
        boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
        position: "sticky", top: 0, zIndex: 10,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            <button onClick={() => navigate("/user")} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Course Path</h1>
              <p style={{ margin: 0, color: C.textTertiary, fontSize: 13 }}>Complete modules in order.</p>
            </div>
          </div>

          <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
          </button>
        </div>

        {/* BUSINESS DETAILS inside AppBar */}
        {tenant && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "rgba(255,255,255,0.7)", borderRadius: 12, border: `1px solid ${C.separator}` }}>
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt={tenant.name || "Business"} style={{ width: 40, height: 40, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 40, height: 40, borderRadius: 8, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, flexShrink: 0 }}>
                {(tenant.name || "B").charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tenant.name || "Business"}</div>
              {tenant.phone && (
                <a href={`tel:${tenant.phone}`} style={{ fontSize: 13, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {tenant.phone}
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {/* BODY */}
      <div style={{ flex: 1, padding: "24px 16px", maxWidth: "800px", margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
        {assignments.length === 0 && (
          <div style={{ background: C.card, borderRadius: 20, padding: "60px 40px", textAlign: "center", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            </div>
            <h3 style={{ margin: "0 0 8px", fontSize: 20, fontWeight: 700 }}>No Modules Yet</h3>
            <p style={{ margin: 0, color: C.textTertiary }}>Your trainer hasn't added any content yet.</p>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 16, position: "relative" }}>
          {assignments.length > 1 && <div style={{ position: "absolute", left: "27px", top: "20px", bottom: "20px", width: "2px", background: C.separator, zIndex: 0 }} />}
          {assignments.map((a, index) => {
            const sub = submissions[a.id];
            const isComplete = !!sub?.graded_at;
            const isPending = !!sub && !sub.graded_at;
            const locked = isLocked(index);
            const hasVideo = !!a.video_url;
            return (
              <div key={a.id} style={{ display: "flex", gap: 16, alignItems: "center", position: "relative", zIndex: 1 }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, fontWeight: 700, background: isComplete ? C.green : locked ? C.bg : C.medBlue, color: isComplete ? "#fff" : locked ? C.textTertiary : "#fff", border: `4px solid ${isComplete ? C.greenBg : locked ? C.bg : C.medBlueBg}`, boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
                  {isComplete ? <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg> : locked ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg> : index + 1}
                </div>
                <div onClick={() => !locked && navigate(`/user/assignment-taker/${a.id}`)} style={{ flex: 1, background: C.card, borderRadius: 16, padding: "18px 20px", boxShadow: "0 2px 12px rgba(0,0,0,0.04)", cursor: locked ? "not-allowed" : "pointer", opacity: locked ? 0.6 : 1, transition: "all 0.2s", border: `1px solid ${isPending ? C.orange + "33" : isComplete ? C.green + "33" : C.separator}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isComplete ? C.green : locked ? C.textTertiary : C.medBlue, textTransform: "uppercase", letterSpacing: "0.5px" }}>{isComplete ? "Completed" : isPending ? "Pending Review" : locked ? "Locked" : hasVideo ? "Video Lesson" : "Exam Module"}</span>
                    {!locked && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textTertiary} strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>}
                  </div>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: C.textPrimary }}>{a.title}</h3>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.description || "Click to start this module."}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}