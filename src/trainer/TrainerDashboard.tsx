import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Course, BusinessSettings, User } from "../types";
import { supabase } from "../auth/supabase";
import { getCourses } from "../database/courseDB";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  medBlue: "#0A84FF", medBlueBg: "#E8F2FF", red: "#FF3B30", redBg: "#FFEFEE",
  green: "#34C759", greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB",
  purple: "#AF52DE", purpleBg: "#F5F0FF", shadow: "0 4px 24px rgba(0,0,0,0.06)", shadowHover: "0 8px 32px rgba(0,0,0,0.1)",
};

function mapCourseFromSupabase(c: Record<string, unknown>): Course {
  return {
    id: c.id as string, name: (c.name as string) || "", description: (c.description as string) || "",
    logo: (c.logo as string) || "", tenantId: c.tenant_id as string, trainerId: c.trainer_id as string,
    createdAt: c.created_at as string, tuitionType: ((c.tuition_type as string) || "free") as "free" | "paid",
    amount: (c.amount as number) || 0, startDate: (c.start_date as string) || "", period: (c.period as string) || "",
    mediaUrl: (c.media_url as string) || (c.logo as string) || "", mediaType: (c.media_type as string) || "image", mediaName: (c.media_name as string) || "course-logo",
  };
}

export default function TrainerDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseStats, setCourseStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [attendanceCourse, setAttendanceCourse] = useState<Course | null>(null);
  const [assignedLearners, setAssignedLearners] = useState<Array<{ id: string; username: string; phone: string; profilePic: string }>>([]);
  const [loadingLearners, setLoadingLearners] = useState(false);
  const [scheduleCourse, setScheduleCourse] = useState<Course | null>(null);
  const [schedules, setSchedules] = useState<Array<{ id: string; title: string; scheduled_at: string; description?: string }>>([]);
  const [newScheduleTitle, setNewScheduleTitle] = useState("");
  const [newScheduleDesc, setNewScheduleDesc] = useState("");
  const [newScheduleDate, setNewScheduleDate] = useState("");

  useEffect(() => {
    const loadData = async () => {
      const savedUserString = localStorage.getItem("currentUser");
      if (!savedUserString) { navigate("/"); return; }
      const savedUser = JSON.parse(savedUserString);
      if (!savedUser.id || !savedUser.tenantId) { navigate("/"); return; }
      setCurrentUser(savedUser);

      // 1. Load Settings from Local Storage INSTANTLY
      const localSettings = localStorage.getItem("localBusinessSettings");
      if (localSettings) setSettings(JSON.parse(localSettings));

      // 2. Try Supabase for Settings
      try {
        const { data: s } = await supabase.from("business_settings").select("*").eq("tenant_id", savedUser.tenantId).maybeSingle();
        if (s) {
          const mapped = { id: s.id, businessName: s.business_name || "", address: s.address || "", phone: s.phone || "", email: s.email || "", website: s.website || "", logo: s.logo || "", header: s.header || "", adminProfile: s.admin_profile || "", loginBackground: s.login_background || "", themeColor: s.theme_color || "", appBarItems: s.app_bar_items || [], tenantId: s.tenant_id, createdAt: s.created_at };
          setSettings(mapped);
          localStorage.setItem("localBusinessSettings", JSON.stringify(mapped));
        }
      } catch (e) { console.warn("Offline: Settings"); }
    };
    loadData();
  }, [navigate]);

  const fetchCourses = useCallback(async () => {
    if (!currentUser?.id || !currentUser?.tenantId) return;
    setLoading(true);

    // 1. Load Local Courses INSTANTLY
    try {
      const allLocalCourses = await getCourses();
      const assignedIds = currentUser.assignedCourses || [];
      const localCourses = allLocalCourses.filter(c => assignedIds.includes(c.id));
      setCourses(localCourses);
    } catch (e) { console.error("Local courses fetch failed", e); }

    // 2. Try Supabase for Courses
    try {
      const assigned = currentUser.assignedCourses;
      if (assigned && assigned.length > 0) {
        const { data: coursesRes } = await supabase.from("courses").select("*").in("id", assigned).order("created_at", { ascending: false });
        if (coursesRes) {
          const remoteCourses = coursesRes.map(mapCourseFromSupabase);
          setCourses(remoteCourses);
          
          // Fetch Learner Counts
          const courseIds = remoteCourses.map((c) => c.id);
          const { data: stats } = await supabase.from("enrollments").select("course_id").in("course_id", courseIds).eq("role", "trainee");
          if (stats) {
            const counts: Record<string, number> = {};
            stats.forEach((s) => { counts[s.course_id] = (counts[s.course_id] || 0) + 1; });
            setCourseStats(counts);
          }
        }
      }
    } catch (err) { console.warn("Offline: Using local courses", err); }
    finally { setLoading(false); }
  }, [currentUser?.id, currentUser?.tenantId, currentUser?.assignedCourses]);

  useEffect(() => { fetchCourses(); }, [fetchCourses]);

  async function openAttendance(course: Course) {
    setAttendanceCourse(course);
    setLoadingLearners(true);
    try {
      const { data: enrollments } = await supabase.from("enrollments").select("user_id").eq("course_id", course.id).eq("role", "trainee").eq("tenant_id", currentUser?.tenantId);
      if (enrollments && enrollments.length > 0) {
        const userIds = enrollments.map((e) => e.user_id);
        const { data: users } = await supabase.from("users").select("id, username, phone, profile_pic").in("id", userIds);
        setAssignedLearners((users || []).map((u) => ({ id: u.id, username: u.username || "Unknown", phone: u.phone || "", profilePic: u.profile_pic || "" })));
      } else { setAssignedLearners([]); }
    } catch (e) { console.error("Failed to load learners", e); setAssignedLearners([]); }
    finally { setLoadingLearners(false); }
  }

  const loadSchedules = useCallback(async () => {
    if (!scheduleCourse) return;
    try {
      const { data } = await supabase.from("schedules").select("*").eq("course_id", scheduleCourse.id).order("scheduled_at", { ascending: true });
      setSchedules((data || []).map((s) => ({ id: s.id, title: s.title, scheduled_at: s.scheduled_at, description: s.description })));
    } catch (e) { console.error("Could not load schedules:", e); setSchedules([]); }
  }, [scheduleCourse]);

  useEffect(() => { loadSchedules(); }, [loadSchedules]);

  async function handleCreateSchedule() {
    if (!scheduleCourse || !currentUser || !newScheduleTitle || !newScheduleDate) return;
    try {
      const { error } = await supabase.from("schedules").insert({
        id: crypto.randomUUID(), tenant_id: currentUser.tenantId, course_id: scheduleCourse.id, trainer_id: currentUser.id, trainer_name: currentUser.username,
        title: newScheduleTitle, description: newScheduleDesc, scheduled_at: new Date(newScheduleDate).toISOString(),
      });
      if (error) throw error;
      setNewScheduleTitle(""); setNewScheduleDesc(""); setNewScheduleDate("");
      loadSchedules();
    } catch (e) { console.error("Failed to save schedule:", e); alert("Failed to save schedule."); }
  }

  async function handleDeleteSchedule(id: string) {
    try { await supabase.from("schedules").delete().eq("id", id); setSchedules((prev) => prev.filter((s) => s.id !== id)); } catch (e) { console.error("Failed to delete schedule:", e); }
  }

  function handleLogout() {
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId");
    window.dispatchEvent(new Event("authStateChanged")); navigate("/");
  }

  const businessName = settings?.businessName || "";
  const businessLogo = settings?.logo;
  const phone = settings?.phone || "";

  const iconBtnStyle: React.CSSProperties = { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "12px 4px", borderRadius: 16, border: "none", cursor: "pointer", transition: "transform 0.15s ease, box-shadow 0.15s ease", WebkitTapHighlightColor: "transparent", gap: 6, minWidth: 0, boxSizing: "border-box" };
  const modalCloseBtnStyle: React.CSSProperties = { background: C.bg, border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: C.textTertiary, fontSize: 16 };

  return (
    <div style={{ minHeight: "100vh", width: "100%", overflowX: "hidden", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 24px", background: "rgba(255,255,255,0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: `1px solid ${C.separator}`, position: "sticky", top: 0, zIndex: 10, flexShrink: 0, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 200 }}>
          {businessLogo && <img src={businessLogo} alt="Logo" style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover" }} />}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            {businessName && <h1 style={{ margin: 0, color: C.textPrimary, fontSize: 17, fontWeight: 700, letterSpacing: "-0.4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{businessName}</h1>}
            {phone && <a href={`tel:${phone}`} style={{ fontSize: 13, color: C.textTertiary, textDecoration: "none", display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>{phone}</a>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.purpleBg, padding: "4px 14px 4px 4px", borderRadius: 20 }}>
            {currentUser?.profilePic ? <img src={currentUser.profilePic} alt="Trainer" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} /> : <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700 }}>{currentUser?.username?.charAt(0).toUpperCase()}</div>}
            <span style={{ fontSize: 13, fontWeight: 600, color: C.purple }}>{currentUser?.username}</span>
          </div>
          <button onClick={() => navigate("/trainer/settings")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, background: "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", color: C.textPrimary, transition: "background 0.2s" }} title="Settings"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
          <button onClick={handleLogout} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, transition: "background 0.2s" }} title="Logout"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></button>
        </div>
      </div>

      <div style={{ flex: 1, padding: "32px 24px", width: "100%", maxWidth: "1200px", margin: "0 auto", boxSizing: "border-box" }}>
        <h2 style={{ fontSize: 13, color: C.textTertiary, textTransform: "uppercase", fontWeight: 600, letterSpacing: "-0.08px", margin: "0 0 20px 0" }}>My Courses</h2>
        {loading && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}><div style={{ background: C.card, borderRadius: 24, height: 300 }} /><div style={{ background: C.card, borderRadius: 24, height: 300 }} /></div>}
        {!loading && courses.length === 0 && (
          <div style={{ background: C.card, borderRadius: 24, padding: 48, textAlign: "center", color: C.textTertiary, boxShadow: C.shadow, border: `1px solid ${C.separatorLight}` }}><h3 style={{ margin: "0 0 8px 0", color: C.textPrimary, fontSize: 20, fontWeight: 700 }}>No Courses Assigned</h3><p style={{ margin: 0, fontSize: 15 }}>Your administrator has not assigned any courses to you yet.</p></div>
        )}
        {!loading && courses.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 24 }}>
            {courses.map((course) => {
              const learnerCount = courseStats[course.id] || 0;
              return (
                <div key={course.id} style={{ background: C.card, borderRadius: 24, boxShadow: C.shadow, overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${C.separatorLight}`, transition: "box-shadow 0.3s ease, transform 0.3s ease" }} onMouseEnter={(e) => { e.currentTarget.style.boxShadow = C.shadowHover; e.currentTarget.style.transform = "translateY(-4px)"; }} onMouseLeave={(e) => { e.currentTarget.style.boxShadow = C.shadow; e.currentTarget.style.transform = "none"; }}>
                  {course.logo && (<div style={{ position: "relative", width: "100%", height: 200 }}><img src={course.logo} alt={course.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} /><div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "60%", background: "linear-gradient(to top, rgba(0,0,0,0.6), transparent)" }} /><div style={{ position: "absolute", top: 16, right: 16, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "6px 14px", borderRadius: 20, fontSize: 13, fontWeight: 600, backdropFilter: "blur(8px)" }}>👥 {learnerCount}</div></div>)}
                  <div style={{ padding: 24, borderBottom: `1px solid ${C.separatorLight}`, flex: 1, display: "flex", flexDirection: "column" }}>
                    <h3 style={{ margin: "0 0 8px 0", color: C.textPrimary, fontSize: 20, fontWeight: 700 }}>{course.name}</h3>
                    <p style={{ margin: 0, color: C.textTertiary, fontSize: 14, lineHeight: 1.5, flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{course.description || "No description provided."}</p>
                    <button onClick={() => setScheduleCourse(course)} style={{ alignSelf: "flex-start", marginTop: 16, background: "none", border: "none", color: C.orange, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 600 }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>Schedule Session</button>
                  </div>
                  <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    <button onClick={() => navigate(`/trainer/live/${course.id}`)} style={{ ...iconBtnStyle, background: C.medBlueBg, color: C.medBlue }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg><span style={{ fontSize: 11, fontWeight: 600 }}>Live</span></button>
                    <button onClick={() => navigate(`/trainer/upload/${course.id}`)} style={{ ...iconBtnStyle, background: C.greenBg, color: C.green }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg><span style={{ fontSize: 11, fontWeight: 600 }}>Upload</span></button>
                    <button onClick={() => navigate(`/trainer/assignments/${course.id}`)} style={{ ...iconBtnStyle, background: C.purpleBg, color: C.purple }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line></svg><span style={{ fontSize: 11, fontWeight: 600 }}>Assignments</span></button>
                    <button onClick={() => openAttendance(course)} style={{ ...iconBtnStyle, background: C.orangeBg, color: C.orange }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg><span style={{ fontSize: 11, fontWeight: 600 }}>Attendance</span></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {attendanceCourse && (
        <div onClick={() => setAttendanceCourse(null)} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 24, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
            <div style={{ padding: 24, borderBottom: `1px solid ${C.separatorLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><h2 style={{ margin: "0 0 4px 0", fontSize: 20, fontWeight: 700 }}>{attendanceCourse.name}</h2><p style={{ margin: 0, fontSize: 14, color: C.textTertiary }}>Learners ({assignedLearners.length})</p></div>
              <button onClick={() => setAttendanceCourse(null)} style={modalCloseBtnStyle}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div style={{ padding: 24, overflowY: "auto" }}>
              {loadingLearners ? <p style={{ textAlign: "center", color: C.textTertiary }}>Loading...</p> : assignedLearners.length === 0 ? <p style={{ textAlign: "center", color: C.textTertiary }}>No learners enrolled yet.</p> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{assignedLearners.map((learner) => (<div key={learner.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: C.bg, borderRadius: 12 }}>{learner.profilePic ? <img src={learner.profilePic} alt="" style={{ width: 36, height: 36, borderRadius: "50%", objectFit: "cover" }} /> : <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>{learner.username?.charAt(0).toUpperCase()}</div>}<div style={{ flex: 1 }}><span style={{ fontWeight: 600, color: C.textPrimary, fontSize: 15, display: "block" }}>{learner.username}</span><span style={{ fontSize: 13, color: C.textTertiary }}>{learner.phone || "No phone"}</span></div></div>))}</div>}
            </div>
          </div>
        </div>
      )}

      {scheduleCourse && (
        <div onClick={() => setScheduleCourse(null)} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16, boxSizing: "border-box" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 24, width: "100%", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.2)" }}>
            <div style={{ padding: 24, borderBottom: `1px solid ${C.separatorLight}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div><h2 style={{ margin: "0 0 4px 0", fontSize: 20, fontWeight: 700 }}>📅 {scheduleCourse.name}</h2><p style={{ margin: 0, fontSize: 14, color: C.textTertiary }}>Create sessions</p></div>
              <button onClick={() => setScheduleCourse(null)} style={modalCloseBtnStyle}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
            </div>
            <div style={{ padding: 24, overflowY: "auto" }}>
              <div style={{ background: C.bg, borderRadius: 16, padding: 16, marginBottom: 24 }}>
                <input type="text" placeholder="Session Title" value={newScheduleTitle} onChange={(e) => setNewScheduleTitle(e.target.value)} style={{ width: "100%", padding: 12, border: `1px solid ${C.separator}`, borderRadius: 10, marginBottom: 8, boxSizing: "border-box", fontFamily: "inherit", fontSize: 15, outline: "none" }} />
                <textarea placeholder="Description (Optional)" value={newScheduleDesc} onChange={(e) => setNewScheduleDesc(e.target.value)} rows={2} style={{ width: "100%", padding: 12, border: `1px solid ${C.separator}`, borderRadius: 10, marginBottom: 8, resize: "none", boxSizing: "border-box", fontFamily: "inherit", fontSize: 15, outline: "none" }} />
                <label style={{ fontSize: 13, color: C.textTertiary, fontWeight: 600, display: "block", marginBottom: 4 }}>Date & Time</label>
                <input type="datetime-local" value={newScheduleDate} onChange={(e) => setNewScheduleDate(e.target.value)} style={{ width: "100%", padding: 12, border: `1px solid ${C.separator}`, borderRadius: 10, marginBottom: 12, boxSizing: "border-box", fontFamily: "inherit", fontSize: 15, outline: "none" }} />
                <button onClick={handleCreateSchedule} disabled={!newScheduleTitle || !newScheduleDate} style={{ width: "100%", padding: 14, background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 600, cursor: "pointer", fontSize: 15, opacity: !newScheduleTitle || !newScheduleDate ? 0.5 : 1, transition: "opacity 0.15s ease" }}>Add Session</button>
              </div>
              <h3 style={{ fontSize: 14, fontWeight: 600, color: C.textTertiary, textTransform: "uppercase", margin: "0 0 12px 0" }}>Upcoming</h3>
              {schedules.length === 0 ? <p style={{ textAlign: "center", color: C.textTertiary, padding: 20 }}>No sessions scheduled yet.</p> : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{schedules.map((sch) => (<div key={sch.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 16px", background: C.bg, borderRadius: 12 }}><div style={{ flex: 1, minWidth: 0 }}><div style={{ fontWeight: 600, color: C.textPrimary, fontSize: 15, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sch.title}</div>{sch.description && <div style={{ fontSize: 13, color: C.textTertiary, marginBottom: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sch.description}</div>}<div style={{ fontSize: 13, color: C.textTertiary }}>{new Date(sch.scheduled_at).toLocaleString()}</div></div><button onClick={() => handleDeleteSchedule(sch.id)} style={{ background: C.redBg, border: "none", color: C.red, cursor: "pointer", fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 8, marginLeft: 12, flexShrink: 0 }}>Delete</button></div>))}</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}