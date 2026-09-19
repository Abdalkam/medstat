// src/user/UserDashboard.tsx
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
  medBlue: "#0A84FF",
  medBlueBg: "#E8F2FF",
  green: "#34C759",
  purple: "#AF52DE",
  purpleBg: "#F5F0FF",
  red: "#FF3B30",
  redBg: "#FFEFEE",
};

function SkeletonCourseCard() {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #E5E5EA 25%, #F2F2F7 50%, #E5E5EA 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "8px",
  };

  return (
    <div style={{ background: C.card, borderRadius: "24px", boxShadow: "0 8px 24px rgba(0,0,0,0.04)", overflow: "hidden", display: "flex", flexDirection: "column", border: `1px solid ${C.separator}` }}>
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

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
      if (!savedUser.id) {
        navigate("/");
        return;
      }

      setCurrentUser(savedUser);

      try {
        const { data, error } = await supabase
          .from("enrollments")
          .select("course_id, courses ( id, name, description, logo, category )")
          .eq("user_id", savedUser.id)
          .eq("status", "active");

        if (!cancelled && !error && data) {
          setCourses(
            data
              .map((e: any) => e.courses as unknown as CourseData)
              .filter(Boolean)
          );
        }
      } catch (err) {
        console.error("Courses fetch exception:", err);
      }

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

  // ✅ FIX: Borrowed EXACTLY from TrainerDashboard.tsx
  function handleLogout() {
    // Clear absolutely ALL local storage and session data to prevent infinite loops
    localStorage.removeItem("currentUser");
    localStorage.removeItem("authToken");
    localStorage.removeItem("adminDeviceId");

    // Notify the rest of the app
    window.dispatchEvent(new Event("authStateChanged"));
    
    // Send them to the root "/" (Startup) on logout
    navigate("/");
  }

  const iosBtnStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "16px 4px",
    borderRadius: "16px",
    border: "none",
    cursor: "pointer",
    transition: "transform 0.1s ease, opacity 0.2s ease",
    WebkitTapHighlightColor: "transparent",
    gap: "6px",
    minWidth: "0",
    boxSizing: "border-box",
  };

  const courseCardStyle: React.CSSProperties = {
    background: C.card,
    borderRadius: "24px",
    boxShadow: "0 8px 24px rgba(0,0,0,0.04)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    border: `1px solid ${C.separator}`,
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        width: "100%",
        overflowX: "hidden",
        background: C.bg,
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* CUSTOM HEADER (Borrowed from TrainerDashboard) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 16px",
          background: "rgba(255,255,255,0.8)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          borderBottom: `1px solid ${C.separator}`,
          position: "sticky",
          top: 0,
          zIndex: 10,
          flexShrink: 0,
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "200px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: C.medBlueBg,
              padding: "4px 12px 4px 4px",
              borderRadius: "20px",
            }}
          >
            {currentUser?.profilePic ? (
              <img src={currentUser.profilePic} alt="Student" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div
                style={{
                  width: "28px",
                  height: "28px",
                  borderRadius: "50%",
                  background: C.card,
                  color: C.medBlue,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "12px",
                  fontWeight: "700",
                }}
              >
                {currentUser?.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <span style={{ fontSize: "13px", fontWeight: "600", color: C.medBlue }}>
              {currentUser?.username}
            </span>
          </div>
        </div>
        
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            onClick={() => navigate("/user/settings")}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "9px",
              background: "rgba(118, 118, 128, 0.12)",
              border: "none",
              cursor: "pointer",
              color: C.textPrimary,
            }}
            title="Settings"
          >
            ⚙️
          </button>
          <button
            onClick={handleLogout}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "9px",
              background: C.redBg,
              border: "none",
              cursor: "pointer",
              color: C.red,
            }}
            title="Logout"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div
        style={{
          flex: 1,
          padding: "24px 16px",
          maxWidth: "1200px",
          margin: "0 auto",
          width: "100%",
          boxSizing: "border-box",
        }}
      >
        <h2
          style={{
            fontSize: "13px",
            color: C.textTertiary,
            textTransform: "uppercase",
            fontWeight: "600",
            letterSpacing: "-0.08px",
            margin: "0 0 16px 0",
          }}
        >
          My Courses
        </h2>

        {loading && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
            }}
          >
            <SkeletonCourseCard />
            <SkeletonCourseCard />
            <SkeletonCourseCard />
          </div>
        )}

        {!loading && courses.length === 0 && (
          <div
            style={{
              background: C.card,
              borderRadius: "16px",
              padding: "40px",
              textAlign: "center",
              color: C.textTertiary,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
            }}
          >
            <h3 style={{ margin: "0 0 8px 0", color: C.textPrimary }}>
              No Courses Assigned
            </h3>
            <p style={{ margin: "0 0 20px 0", fontSize: "14px" }}>
              Your administrator has not assigned any courses to you yet.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: C.medBlue,
                color: "#fff",
                padding: "10px 20px",
                borderRadius: "8px",
                border: "none",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              Check Again
            </button>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
              gap: "20px",
              width: "100%",
            }}
          >
            {courses.map((course) => {
              const isLive = (liveCourseIds || []).includes(course.id);
              const isAttendingThis = activeAttendanceCourseId === course.id;

              return (
                <div key={course.id} style={courseCardStyle}>
                  {course.logo && (
                    <div style={{ position: "relative", width: "100%", height: "220px" }}>
                      <img
                        src={course.logo}
                        alt={course.name}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                      <div
                        style={{
                          position: "absolute",
                          bottom: 0,
                          left: 0,
                          width: "100%",
                          height: "50%",
                          background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent)",
                        }}
                      />
                    </div>
                  )}

                  <div
                    style={{
                      padding: "20px",
                      borderBottom: `1px solid ${C.separator}`,
                      flex: 1,
                      display: "flex",
                      flexDirection: "column",
                    }}
                  >
                    <h3
                      style={{
                        margin: "0 0 6px 0",
                        color: C.textPrimary,
                        fontSize: "18px",
                        fontWeight: "600",
                      }}
                    >
                      {course.name}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        color: C.textTertiary,
                        fontSize: "14px",
                        lineHeight: "1.4",
                        flex: 1,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {course.description || "No description provided."}
                    </p>
                  </div>

                  <div
                    style={{
                      padding: "16px 12px",
                      display: "grid",
                      gridTemplateColumns: "repeat(2, 1fr)",
                      gap: "12px",
                    }}
                  >
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
                      <span style={{ fontSize: "11px", fontWeight: "600" }}>Assignments</span>
                    </button>

                    <button
                      onClick={() => handleJoinClass(course.id)}
                      style={{
                        ...iosBtnStyle,
                        background: isAttendingThis ? C.medBlue : isLive ? C.green : C.bg,
                        color: isAttendingThis ? "#FFFFFF" : isLive ? "#FFFFFF" : C.textTertiary,
                        opacity: 1,
                        cursor: "pointer",
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