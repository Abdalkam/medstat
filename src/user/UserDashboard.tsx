import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

interface CourseData {
  id: string;
  name: string;
  description: string;
  logo: string;
  category: string;
}

const C = {
  textPrimary: "#1C1C1E",
  textTertiary: "#8E8E93",
  bg: "#F2F2F7",
  card: "#FFFFFF",
  separator: "#E5E5EA",
  medBlue: "#007AFF",
  medBlueBg: "#E8F2FF",
  green: "#34C759",
  purple: "#AF52DE",
  purpleBg: "#F5F0FF",
  red: "#FF3B30",
  redBg: "#FFEFEE",
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

interface BusinessData { business_name: string | null; phone: string | null; logo: string | null; }

function SkeletonCourseCard() {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #E5E5EA 25%, #F2F2F7 50%, #E5E5EA 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "8px",
  };

  return (
    <div style={{ background: C.card, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${C.separator}` }}>
      <div style={{ width: "100%", height: "220px", ...shimmerStyle }} />
      <div style={{ padding: "20px", borderBottom: `1px solid ${C.separator}`, flex: 1 }}>
        <div style={{ width: "70%", height: "18px", marginBottom: "10px", ...shimmerStyle }} />
        <div style={{ width: "100%", height: "14px", ...shimmerStyle }} />
        <div style={{ width: "85%", height: "14px", marginTop: "6px", ...shimmerStyle }} />
      </div>
      <div style={{ padding: "16px 12px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
        <div style={{ height: "72px", ...shimmerStyle }} />
        <div style={{ height: "72px", ...shimmerStyle }} />
      </div>
      <style>{`@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }`}</style>
    </div>
  );
}

export default function UserDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [courses, setCourses] = useState<CourseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveCourseIds, setLiveCourseIds] = useState<string[]>([]);
  const [activeAttendanceCourseId, setActiveAttendanceCourseId] = useState<string | null>(null);
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
    let cancelled = false;

    const initialize = async () => {
      const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
      if (!savedUser.id) {
        navigate("/");
        return;
      }

      setCurrentUser(savedUser);

      let fetchedCourses: CourseData[] = [];

      // ✅ 1. Try fetching from Supabase first
      try {
        const { data, error } = await supabase
          .from("enrollments")
          .select("course_id, courses ( id, name, description, logo, category )")
          .eq("user_id", savedUser.id)
          .eq("status", "active");

        if (!error && data) {
          fetchedCourses = data.map((e: any) => e.courses as unknown as CourseData).filter(Boolean);
        }
      } catch (err) {
        console.error("Network fetch failed, trying local DB...", err);
      }

      // ✅ 2. If Supabase failed or returned nothing, try local DB
      if (fetchedCourses.length === 0) {
        try {
          const { getCourses } = await import("../database/courseDB");
          const allLocalCourses = await getCourses();
          if (allLocalCourses && allLocalCourses.length > 0 && savedUser.assignedCourses) {
            fetchedCourses = allLocalCourses
              .filter((c: any) => savedUser.assignedCourses.includes(c.id))
              .map((c: any) => ({ id: c.id, name: c.name, description: c.description || "", logo: c.logo || "", category: c.mediaName || "" }));
          }
        } catch (e) {
          console.warn("No local courses found in DB.");
        }
      }

      if (!cancelled) setCourses(fetchedCourses);

      const activeSession = localStorage.getItem("activeAttendanceCourseId");
      if (!cancelled) setActiveAttendanceCourseId(activeSession);
      if (!cancelled) setLoading(false);
    };

    initialize();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const fetchLiveClasses = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    try {
      const { data } = await supabase
        .from("live_session")
        .select("course_id")
        .eq("tenant_id", currentUser.tenantId)
        .eq("active", true);
      setLiveCourseIds((data || []).map((s: any) => s.course_id));
    } catch (e) {
      /* ignore */
    }
  }, [currentUser?.tenantId]);

  useEffect(() => {
    fetchLiveClasses();
  }, [fetchLiveClasses]);

  useEffect(() => {
    if (!activeAttendanceCourseId || !liveCourseIds) return;
    if (liveCourseIds.length > 0 && !liveCourseIds.includes(activeAttendanceCourseId)) {
      localStorage.removeItem("activeAttendanceCourseId");
      setActiveAttendanceCourseId(null);
    }
  }, [activeAttendanceCourseId, liveCourseIds]);

  useEffect(() => {
    if (!currentUser?.tenantId) return;

    const token = localStorage.getItem("authToken");
    if (token === "offline-mode-pending-sync") return;

    let cancelled = false;
    const channel = supabase
      .channel(`live-status-${currentUser.tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_session",
          filter: `tenant_id=eq.${currentUser.tenantId}`,
        },
        (payload: any) => {
          if (cancelled) return;
          if (
            payload.eventType === "INSERT" ||
            (payload.eventType === "UPDATE" && payload.new?.active)
          ) {
            setLiveCourseIds((prev) =>
              prev.includes(payload.new.course_id)
                ? prev
                : [...prev, payload.new.course_id]
            );
          } else if (
            payload.eventType === "DELETE" ||
            (payload.eventType === "UPDATE" && !payload.new?.active)
          ) {
            setLiveCourseIds((prev) =>
              prev.filter(
                (id) =>
                  id !== payload.new?.course_id && id !== payload.old?.course_id
              )
            );
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [currentUser?.tenantId]);

  function handleJoinClass(courseId: string) {
    localStorage.setItem("activeAttendanceCourseId", courseId);
    setActiveAttendanceCourseId(courseId);
    navigate(`/user/classroom/${courseId}`);
  }

  const iosBtnStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px 4px",
    borderRadius: "12px",
    border: "none",
    cursor: "pointer",
    transition: "opacity 0.2s ease",
    WebkitTapHighlightColor: "transparent",
    gap: "6px",
    minWidth: "0",
    boxSizing: "border-box",
  };

  const courseCardStyle: React.CSSProperties = {
    background: C.card,
    borderRadius: 12,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${C.separator}`,
  };

  return (
    <div style={{ minHeight: "100vh", background: C.card, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box", background: C.card }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
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

      <div style={{ flex: 1, padding: "40px 48px 40px", width: "100%", boxSizing: "border-box" }}>
        <h2 style={{ ...TS.caption, margin: "0 0 20px 0" }}>My Courses</h2>

        {loading && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px" }}>
            <SkeletonCourseCard />
            <SkeletonCourseCard />
            <SkeletonCourseCard />
          </div>
        )}

        {!loading && courses.length === 0 && (
          <div style={{ padding: "80px 40px", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Courses Assigned</h3>
            <p style={{ ...TS.bodySm, margin: "0 0 32px" }}>Your administrator has not assigned any courses to you yet.</p>
            <button onClick={() => window.location.reload()} style={{ ...TS.input, padding: "14px 36px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>Check Again</button>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "20px", width: "100%" }}>
            {courses.map((course) => {
              const isLive = (liveCourseIds || []).includes(course.id);
              const isAttendingThis = activeAttendanceCourseId === course.id;

              return (
                <div key={course.id} style={courseCardStyle}>
                  {course.logo && (
                    <div style={{ position: "relative", width: "100%", height: "220px" }}>
                      <img src={course.logo} alt={course.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "50%", background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent)" }} />
                    </div>
                  )}

                  <div style={{ padding: "20px", borderBottom: `1px solid ${C.separator}`, flex: 1, display: "flex", flexDirection: "column" }}>
                    <h3 style={{ ...TS.h3, margin: "0 0 6px 0" }}>{course.name}</h3>
                    <p style={{ ...TS.bodySm, margin: 0, flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {course.description || "No description provided."}
                    </p>
                  </div>

                  <div style={{ padding: "16px 12px", display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "12px" }}>
                    <button
                      onClick={() => navigate(`/user/assignments/${course.id}`)}
                      style={{ ...iosBtnStyle, background: C.purpleBg, color: C.purple }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <polyline points="14 2 14 8 20 8" />
                        <line x1="16" y1="13" x2="8" y2="13" />
                        <line x1="16" y1="17" x2="8" y2="17" />
                        <polyline points="10 9 9 9 8 9" />
                      </svg>
                      <span style={{ ...TS.label, fontSize: 11, fontWeight: 600 }}>Assignments</span>
                    </button>

                    <button
                      onClick={() => handleJoinClass(course.id)}
                      style={{
                        ...iosBtnStyle,
                        background: isAttendingThis ? C.medBlue : isLive ? C.green : C.bg,
                        color: isAttendingThis ? "#FFFFFF" : isLive ? "#FFFFFF" : C.textTertiary,
                        boxShadow: isLive && !isAttendingThis ? "0 4px 12px rgba(52, 199, 89, 0.3)" : "none",
                      }}
                    >
                      {isAttendingThis ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      ) : isLive ? (
                        <span style={{ position: "relative", width: "12px", height: "12px" }}>
                          <span style={{ position: "absolute", inset: 0, background: "#FFFFFF", borderRadius: "50%", opacity: 0.4, animation: "pulse 1.5s infinite" }} />
                          <span style={{ position: "absolute", inset: "3px", background: "#FFFFFF", borderRadius: "50%" }} />
                        </span>
                      ) : (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M23 7l-7 5 7 5V7z" />
                          <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                        </svg>
                      )}
                      <span style={{ ...TS.label, fontSize: 11, fontWeight: 600 }}>{isAttendingThis ? "Attending" : isLive ? "Join Live" : "Join Class"}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.4; }
          70% { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
      `}</style>
    </div>
  );
}