import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";

interface CourseData {
  id: string;
  name: string;
  description: string;
  logo: string;
  category: string;
}

interface ScheduleItem {
  id: string;
  tenant_id: string;
  course_id: string;
  scheduled_at: string;
  title: string | null;
  description: string | null;
  trainer_name: string | null;
}

interface BusinessData {
  business_name: string | null;
  phone: string | null;
  logo: string | null;
}

const C = {
  textPrimary: "#242424",
  textTertiary: "#616161",
  bg: "#F5F5F5",
  card: "#FFFFFF",
  separator: "#E1DFDD",
  medBlue: "#0878B9",
  medBlueBg: "#E8F4FB",
  green: "#34C759",
  greenBg: "#EAF9EE",
  purple: "#075985",
  purpleBg: "#EAF4FA",
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtParts(ts: string) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return null;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { day: d.getDate(), mon: MONTHS[d.getMonth()], time: `${hh}:${mm}` };
}

function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) {
    const m = raw.match(/^(data:image\/[a-z.+-]+;base64,)([\s\S]*)$/i);
    return m ? m[1] + m[2].replace(/\s+/g, "") : raw;
  }
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("<svg") || raw.startsWith("<?xml")) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`;
  }
  const compact = raw.replace(/\s+/g, "");
  if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    let mime = "image/png";
    if (compact.startsWith("/9j/")) mime = "image/jpeg";
    else if (compact.startsWith("R0lGOD")) mime = "image/gif";
    else if (compact.startsWith("UklGR")) mime = "image/webp";
    else if (compact.startsWith("PHN2Zy") || compact.startsWith("PD94bW")) mime = "image/svg+xml";
    return `data:${mime};base64,${compact}`;
  }
  // Bare filenames ("loadlogo.png") are not renderable — the browser resolves
  // them against the app origin (http://127.0.0.1:1420/loadlogo.png → 404).
  // Only absolute/protocol-relative/blob URLs and app-absolute paths survive;
  // anything else falls back to the letter avatar.
  if (/^(https?:\/\/|\/\/|blob:)/i.test(raw) || raw.startsWith("/")) return raw;
  return "";
}

function initialsOf(name: string | null | undefined, fallback: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

async function cacheAvatarImage(userId: string, url: string) {
  try {
    if (url.startsWith("data:")) {
      localStorage.setItem(`cachedAvatar_${userId}`, url);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
      return;
    }
    if (localStorage.getItem(`cachedAvatarUrl_${userId}`) === url) return;

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 1_000_000) return;

    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    if (dataUrl) {
      localStorage.setItem(`cachedAvatar_${userId}`, dataUrl);
      localStorage.setItem(`cachedAvatarUrl_${userId}`, url);
    }
  } catch {}
}

async function cacheBusinessLogo(tenantId: string, url: string) {
  try {
    if (!url) return;
    if (url.startsWith("data:")) {
      localStorage.setItem(`cachedBusinessLogo_${tenantId}`, url);
      localStorage.setItem(`cachedBusinessLogoUrl_${tenantId}`, url);
      return;
    }
    if (localStorage.getItem(`cachedBusinessLogoUrl_${tenantId}`) === url) return;

    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (blob.size > 1_000_000) return;

    const dataUrl = await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });

    if (dataUrl) {
      localStorage.setItem(`cachedBusinessLogo_${tenantId}`, dataUrl);
      localStorage.setItem(`cachedBusinessLogoUrl_${tenantId}`, url);
    }
  } catch {}
}

function SkeletonCourseCard() {
  const shimmerStyle: React.CSSProperties = {
    background: "linear-gradient(90deg, #E5E5EA 25%, #F2F2F7 50%, #E5E5EA 75%)",
    backgroundSize: "200% 100%",
    animation: "shimmer 1.5s infinite",
    borderRadius: "8px",
  };

  return (
    <div className="ud-card" style={{ background: C.card, borderRadius: 12, overflow: "hidden", border: `1px solid ${C.separator}` }}>
      <div className="ud-card-media" style={shimmerStyle} />
      <div className="ud-card-body">
        <div style={{ width: "70%", height: "18px", marginBottom: "10px", ...shimmerStyle }} />
        <div style={{ width: "100%", height: "14px", ...shimmerStyle }} />
        <div style={{ width: "85%", height: "14px", marginTop: "6px", ...shimmerStyle }} />
      </div>
      <div className="ud-card-actions">
        <div style={{ height: "72px", ...shimmerStyle }} />
        <div style={{ height: "72px", ...shimmerStyle }} />
      </div>
    </div>
  );
}

export default function UserDashboard() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePicError, setProfilePicError] = useState(false);
  const [courses, setCourses] = useState<CourseData[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveCourseIds, setLiveCourseIds] = useState<string[]>([]);
  const [activeAttendanceCourseId, setActiveAttendanceCourseId] = useState<string | null>(null);
  const [business, setBusiness] = useState<BusinessData | null>(null);
  const [pendingForms, setPendingForms] = useState(0);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);

  const isTrainer = currentUser?.role === "trainer" || currentUser?.role === "admin";

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

    try {
      const local = localStorage.getItem("localBusinessSettings");
      if (local) {
        const s = JSON.parse(local);
        if (!cancelled) setBusiness({ business_name: s.businessName || null, phone: s.phone || null, logo: s.logo ? normalizeImageSrc(s.logo) : null });
      }
    } catch {}
    const cachedLogo = localStorage.getItem(`cachedBusinessLogo_${currentUser.tenantId}`);
    if (cachedLogo && !cancelled) {
      setBusiness((b) => ({ business_name: b?.business_name || null, phone: b?.phone || null, logo: cachedLogo }));
    }

    const fetchBusiness = async () => {
      try {
        const { data } = await supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) {
          const logo = normalizeImageSrc(data.logo);
          setBusiness({ business_name: data.business_name, phone: data.phone, logo: logo || null });
          try {
            const existing = (() => {
              try {
                return JSON.parse(localStorage.getItem("localBusinessSettings") || "null");
              } catch {
                return null;
              }
            })();
            localStorage.setItem("localBusinessSettings", JSON.stringify({
              ...(existing || {}),
              businessName: data.business_name || existing?.businessName || "",
              phone: data.phone || existing?.phone || "",
              logo: logo || existing?.logo || "",
            }));
          } catch {}
          if (logo) cacheBusinessLogo(currentUser.tenantId, logo);
        }
      } catch {}
    };
    fetchBusiness();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    const fetchProfilePic = async () => {
      if (!currentUser?.id) return;
      setProfilePicError(false);

      const cached = localStorage.getItem(`cachedAvatar_${currentUser.id}`);
      let cachedProfile: any = null;
      try {
        cachedProfile = JSON.parse(localStorage.getItem(`cachedProfile_${currentUser.id}`) || "null");
      } catch {}
      if (cached || cachedProfile?.avatar_url || currentUser.profilePic) {
        setProfilePic(cached || cachedProfile?.avatar_url || currentUser.profilePic);
      }

      try {
        const { data } = await supabase.from("profile_settings").select("avatar_url").eq("user_id", currentUser.id).maybeSingle();
        if (data?.avatar_url) {
          setProfilePic(data.avatar_url);
          localStorage.setItem(`cachedProfile_${currentUser.id}`, JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, avatar_url: data.avatar_url }));
          cacheAvatarImage(currentUser.id, data.avatar_url);
        } else {
          const { data: u } = await supabase.from("users").select("profile_pic").eq("id", currentUser.id).maybeSingle();
          if (u?.profile_pic) {
            setProfilePic(u.profile_pic);
            cacheAvatarImage(currentUser.id, u.profile_pic);
          } else if (currentUser.profilePic) {
            setProfilePic(currentUser.profilePic);
            cacheAvatarImage(currentUser.id, currentUser.profilePic);
          } else {
            setProfilePic(null);
          }
        }
      } catch {}
    };
    fetchProfilePic();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!currentUser?.tenantId || !currentUser?.id) return;
    (async () => {
      try {
        const { data: forms } = await supabase.from("forms").select("id").eq("tenant_id", currentUser.tenantId).eq("status", "published");
        const { data: subs } = await supabase.from("form_submissions").select("form_id").eq("user_id", currentUser.id);
        const filled = new Set((subs || []).map((s: any) => s.form_id));
        setPendingForms((forms || []).filter((f: any) => !filled.has(f.id)).length);
      } catch {}
    })();
  }, [currentUser?.tenantId, currentUser?.id]);

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

      try {
        const { data, error } = await supabase
          .from("enrollments")
          .select("course_id, courses ( id, name, description, logo, category )")
          .eq("user_id", savedUser.id)
          .eq("status", "active");

        if (!error && data) {
          fetchedCourses = data.map((e: any) => e.courses as unknown as CourseData).filter(Boolean);
        }
      } catch {}

      if (fetchedCourses.length === 0) {
        try {
          const { getUser } = await import("../database/userDB");
          const localUser = await getUser(savedUser.id);
          const assignedIds = localUser?.assignedCourses || savedUser.assignedCourses || [];

          if (assignedIds.length > 0) {
            const { getCourses } = await import("../database/courseDB");
            const allLocalCourses = await getCourses();
            if (allLocalCourses && allLocalCourses.length > 0) {
              fetchedCourses = allLocalCourses
                .filter((c: any) => assignedIds.includes(c.id))
                .map((c: any) => ({ id: c.id, name: c.name, description: c.description || "", logo: normalizeImageSrc(c.logo) || "", category: c.mediaName || "" }));
            }
          }
        } catch {}
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
    } catch {}
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

  const fetchSchedules = useCallback(async () => {
    if (!currentUser?.tenantId) return;
    if (courses.length === 0) {
      setSchedules([]);
      return;
    }
    try {
      const { data } = await supabase
        .from("schedules")
        .select("id, tenant_id, course_id, scheduled_at, title, description, trainer_name")
        .eq("tenant_id", currentUser.tenantId)
        .in("course_id", courses.map((c) => c.id))
        .gte("scheduled_at", new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order("scheduled_at", { ascending: true })
        .limit(20);
      if (data) setSchedules(data as ScheduleItem[]);
    } catch {}
  }, [currentUser?.tenantId, courses]);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  useEffect(() => {
    if (!currentUser?.tenantId) return;

    const token = localStorage.getItem("authToken");
    if (token === "offline-mode-pending-sync") return;

    let cancelled = false;
    const channel = supabase
      .channel(`schedules-${currentUser.tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "schedules",
          filter: `tenant_id=eq.${currentUser.tenantId}`,
        },
        (payload: any) => {
          if (cancelled) return;
          if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
            const row = payload.new as ScheduleItem | null;
            if (!row || !row.id) return;
            setSchedules((prev) => {
              const others = prev.filter((s) => s.id !== row.id);
              return [...others, row].sort(
                (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime()
              );
            });
          } else if (payload.eventType === "DELETE") {
            const oldId = payload.old?.id;
            if (!oldId) return;
            setSchedules((prev) => prev.filter((s) => s.id !== oldId));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [currentUser?.tenantId]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchSchedules();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [fetchSchedules]);

  async function handleClassAction(courseId: string, isLive: boolean) {
    if (isTrainer) {
      if (isLive) {
        await supabase.from("live_session").update({ active: false, updated_at: new Date().toISOString() }).eq("course_id", courseId);
        await supabase.from("live_presentations").delete().eq("course_id", courseId);
        fetchLiveClasses();
      } else {
        await supabase.from("live_session").insert({
          id: crypto.randomUUID(),
          tenant_id: currentUser.tenantId,
          course_id: courseId,
          trainer_id: currentUser.id,
          active: true,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          created_at: new Date().toISOString()
        });
        navigate(`/trainer/live/${courseId}`);
      }
    } else {
      if (activeAttendanceCourseId === courseId) {
        const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
        localStorage.removeItem("activeAttendanceCourseId");
        setActiveAttendanceCourseId(null);
        try {
          const { db } = await import("../database/db");
          await db.activeAttendances.delete(savedUser.id);
        } catch {}
        supabase.from("active_attendances").delete().eq("user_id", savedUser.id).eq("course_id", courseId).then(() => {}, () => {});
        supabase.from("raised_hands").delete().eq("user_id", savedUser.id).eq("course_id", courseId).then(() => {}, () => {});
      } else if (isLive) {
        try {
          const { data } = await supabase
            .from("live_session")
            .select("id")
            .eq("course_id", courseId)
            .eq("active", true)
            .maybeSingle();
          if (!data) {
            setLiveCourseIds((prev) => prev.filter((id) => id !== courseId));
            alert("This class is no longer live. The trainer may have ended the session.");
            return;
          }
        } catch {}

        if (activeAttendanceCourseId && activeAttendanceCourseId !== courseId) {
          const savedUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
          supabase.from("active_attendances").delete().eq("user_id", savedUser.id).eq("course_id", activeAttendanceCourseId).then(() => {}, () => {});
          supabase.from("raised_hands").delete().eq("user_id", savedUser.id).eq("course_id", activeAttendanceCourseId).then(() => {}, () => {});
          try {
            const { db } = await import("../database/db");
            await db.activeAttendances.delete(savedUser.id);
          } catch {}
        }

        localStorage.setItem("activeAttendanceCourseId", courseId);
        setActiveAttendanceCourseId(courseId);

        supabase.from("active_attendances").insert({
          id: crypto.randomUUID(),
          user_id: currentUser.id,
          course_id: courseId,
          joined_at: new Date().toISOString(),
        }).then(() => {}, () => {});

        navigate(`/user/classroom/${courseId}`);
      } else {
        alert("This class is not live yet. Please wait for the trainer to start the session.");
      }
    }
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
    border: `1px solid ${C.separator}`,
    minWidth: 0,
  };

  const enrolledIds = courses.map((c) => c.id);
  const upcoming = schedules
    .filter(
      (s) =>
        enrolledIds.includes(s.course_id) &&
        new Date(s.scheduled_at).getTime() > Date.now() - 30 * 60 * 1000
    )
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  return (
    <div className="ud-teams-shell">
      <aside className="ud-teams-rail" aria-label="Main navigation">
        <button
          className="ud-rail-item"
          onClick={() => navigate("/forms")}
          title="Forms"
          aria-label="Forms"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span>Forms</span>
          {pendingForms > 0 && <i className="ud-rail-badge">{pendingForms}</i>}
        </button>
        <button
          className="ud-rail-item"
          onClick={() => navigate(isTrainer ? "/trainer/settings" : "/user/settings")}
          title="Settings"
          aria-label="Settings"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 2.94-.08-.02a1.7 1.7 0 0 0-1.72.7l-.04.07h-3.4l-.04-.07a1.7 1.7 0 0 0-1.72-.7l-.08.02-1.7-2.94.06-.06A1.7 1.7 0 0 0 9.7 15l-.08-.04v-3.4l.08-.04a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-2.94.08.02a1.7 1.7 0 0 0 1.72-.7l.04-.07h3.4l.04.07a1.7 1.7 0 0 0 1.72.7l.08-.02 1.7 2.94-.06.06A1.7 1.7 0 0 0 19.4 11.5l.08.04v3.4z" />
          </svg>
          <span>Settings</span>
        </button>
        <div className="ud-rail-spacer" />
        <button
          className="ud-rail-item ud-rail-logout"
          onClick={handleLogout}
          title="Sign out"
          aria-label="Sign out"
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </aside>
    <div
      className="ud-root"
      style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale", display: "flex", flexDirection: "column" }}
    >
      <div className="ud-bar">
        <div className="ud-bar-inner">
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            {business?.logo ? (
              <img
                src={business.logo}
                alt="Logo"
                style={{ width: 34, height: 34, borderRadius: 6, objectFit: "contain", background: "#FFFFFF", flexShrink: 0 }}
              />
            ) : (
              <div style={{ width: 34, height: 34, borderRadius: 6, background: C.medBlue, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, flexShrink: 0 }}>
                {(business?.business_name || "M").charAt(0).toUpperCase()}
              </div>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
              {business?.phone && (
                <a
                  href={`tel:${business.phone}`}
                  className="ud-phone"
                  style={{ ...TS.label, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2, maxWidth: "100%", overflow: "hidden" }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{business.phone}</span>
                </a>
              )}
            </div>
          </div>

          <div title="User profile" style={{ display: "flex", alignItems: "center", gap: 8, background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: 20, flexShrink: 0 }}>
            {profilePic && !profilePicError ? (
              <img
                src={profilePic}
                alt="Profile"
                style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }}
                onError={() => {
                  const cached = currentUser?.id ? localStorage.getItem(`cachedAvatar_${currentUser.id}`) : null;
                  if (cached && profilePic !== cached) {
                    setProfilePic(cached);
                    setProfilePicError(false);
                  } else {
                    setProfilePicError(true);
                  }
                }}
              />
            ) : (
              <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 700 }}>
                {initialsOf(currentUser?.username, "U")}
              </div>
            )}
            <span className="ud-username" style={{ fontSize: 13, fontWeight: 600, color: C.purple, whiteSpace: "nowrap" }}>{currentUser?.username || "User"}</span>
          </div>

        </div>
      </div>

      <div className="ud-body">
        {!loading && upcoming.length > 0 && (
          <section style={{ marginBottom: 26 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 12px" }}>
              <h2 style={{ ...TS.caption, margin: 0 }}>Upcoming Sessions</h2>
              <span style={{ ...TS.caption, fontSize: 10, background: C.medBlueBg, color: C.medBlue, borderRadius: 999, padding: "3px 8px" }}>{upcoming.length}</span>
            </div>
            <div className="ud-sched-list">
              {upcoming.map((s) => {
                const p = fmtParts(s.scheduled_at);
                const course = courses.find((c) => c.id === s.course_id);
                return (
                  <div key={s.id} className="ud-sched-row">
                    <div className="ud-datesq">
                      <span style={{ fontSize: 17, fontWeight: 800, color: C.medBlue, lineHeight: 1.1 }}>{p?.day ?? "--"}</span>
                      <span style={{ fontSize: 9, fontWeight: 700, color: C.medBlue, opacity: 0.75, textTransform: "uppercase", letterSpacing: "0.08em" }}>{p?.mon ?? ""}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.title || "Scheduled session"}
                      </div>
                      <div style={{ ...TS.bodySm, fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {course?.name || "Course"} · {p?.time ?? ""}
                        {s.trainer_name ? ` · By ${s.trainer_name}` : ""}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "0 0 16px" }}>
          <h2 style={{ ...TS.caption, margin: 0 }}>My Courses</h2>
          {!loading && courses.length > 0 && (
            <span style={{ ...TS.caption, fontSize: 10, background: C.purpleBg, color: C.purple, borderRadius: 999, padding: "3px 8px" }}>{courses.length}</span>
          )}
        </div>

        {loading && (
          <div className="ud-grid">
            <SkeletonCourseCard />
            <SkeletonCourseCard />
            <SkeletonCourseCard />
          </div>
        )}

        {!loading && courses.length === 0 && (
          <div style={{ padding: "clamp(48px, 8vw, 80px) clamp(20px, 5vw, 40px)", textAlign: "center", width: "100%", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.5"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
            </div>
            <h3 style={{ ...TS.h3, fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>No Courses Assigned</h3>
            <p style={{ ...TS.bodySm, margin: "0 0 32px" }}>Your administrator has not assigned any courses to you yet.</p>
            <button onClick={() => window.location.reload()} style={{ ...TS.input, padding: "14px 36px", background: C.medBlue, color: "#fff", border: "none", borderRadius: 12, fontWeight: 700, fontSize: 16, cursor: "pointer" }}>Check Again</button>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <div className="ud-grid">
            {courses.map((course) => {
              const isLive = (liveCourseIds || []).includes(course.id);
              const isAttendingThis = activeAttendanceCourseId === course.id;
              const nextSession = upcoming.find((s) => s.course_id === course.id);
              const nextParts = nextSession ? fmtParts(nextSession.scheduled_at) : null;

              let btnBackground = C.bg;
              let btnColor = C.textTertiary;
              let btnIcon = null;
              let btnText = "Join Class";

              if (isTrainer) {
                if (isLive) {
                  btnBackground = C.redBg;
                  btnColor = C.red;
                  btnIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>);
                  btnText = "End Class";
                } else {
                  btnBackground = C.green;
                  btnColor = "#FFFFFF";
                  btnIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>);
                  btnText = "Start Class";
                }
              } else {
                if (isAttendingThis) {
                  btnBackground = C.redBg;
                  btnColor = C.red;
                  btnIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>);
                  btnText = "Leave Class";
                } else if (isLive) {
                  btnBackground = C.green;
                  btnColor = "#FFFFFF";
                  btnIcon = (
                    <span style={{ position: "relative", width: "12px", height: "12px" }}>
                      <span style={{ position: "absolute", inset: 0, background: "#FFFFFF", borderRadius: "50%", opacity: 0.4, animation: "pulse 1.5s infinite" }} />
                      <span style={{ position: "absolute", inset: "3px", background: "#FFFFFF", borderRadius: "50%" }} />
                    </span>
                  );
                  btnText = "Join Live";
                } else {
                  btnIcon = (<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>);
                }
              }

              return (
                <div key={course.id} className="ud-card" style={courseCardStyle}>
                  {course.logo ? (
                    <div className="ud-card-media">
                      <img src={course.logo} alt={course.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      <div style={{ position: "absolute", bottom: 0, left: 0, width: "100%", height: "50%", background: "linear-gradient(to top, rgba(0,0,0,0.5), transparent)" }} />
                    </div>
                  ) : (
                    <div className="ud-card-media" style={{ display: "flex", alignItems: "center", justifyContent: "center", background: C.medBlueBg }}>
                      <span style={{ fontSize: 42, fontWeight: 800, color: C.medBlue }}>{(course.name || "C").charAt(0).toUpperCase()}</span>
                    </div>
                  )}

                  <div className="ud-card-body">
                    <h3 style={{ ...TS.h3, margin: "0 0 6px 0" }}>{course.name}</h3>
                    <p style={{ ...TS.bodySm, margin: 0, flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                      {course.description || "No description provided."}
                    </p>
                    {nextSession && (
                      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 6, background: C.medBlueBg, color: C.medBlue, borderRadius: 8, padding: "6px 10px", fontSize: 12, fontWeight: 600, overflow: "hidden" }}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <rect x="3" y="4" width="18" height="18" rx="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {`Next: ${nextSession.title || "Session"}${nextParts ? ` · ${nextParts.day} ${nextParts.mon}, ${nextParts.time}` : ""}`}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="ud-card-actions">
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
                      onClick={() => handleClassAction(course.id, isLive)}
                      style={{
                        ...iosBtnStyle,
                        background: btnBackground,
                        color: btnColor,
                        boxShadow: (isTrainer ? isLive : (!isAttendingThis && isLive))
                          ? "0 4px 12px rgba(52, 199, 89, 0.3)"
                          : (!isTrainer && isAttendingThis) ? "0 4px 12px rgba(255, 59, 48, 0.25)" : "none",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.8"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
                    >
                      {btnIcon}
                      <span style={{ ...TS.label, fontSize: 11, fontWeight: 600 }}>{btnText}</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <style>{`
        .ud-teams-shell { min-height: 100vh; display: flex; background: #F3F8FC; }
        .ud-teams-rail { position: fixed; inset: 0 auto 0 0; z-index: 30; width: 76px; display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 18px 7px; background: #F5F5F5; color: #242424; border-right: 1px solid #E1DFDD; }
        .ud-rail-brand { width: 44px; height: 44px; margin: 0 0 18px; display: grid; place-items: center; border-radius: 13px; background: #0878B9; color: #fff; font-size: 21px; font-weight: 800; box-shadow: 0 4px 12px rgba(0,0,0,.12); }
        .ud-rail-item { position: relative; width: 62px; min-height: 56px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 0; border-radius: 9px; background: transparent; color: #616161; cursor: pointer; font: 600 10px/1.2 'Segoe UI', sans-serif; transition: background .18s ease, color .18s ease; }
        .ud-rail-item:hover, .ud-rail-item.active { background: #E8F4FB; color: #0878B9; }
        .ud-rail-item.active::before { content: ''; position: absolute; left: -7px; top: 11px; bottom: 11px; width: 3px; border-radius: 0 3px 3px 0; background: #0878B9; }
        .ud-rail-icon { font-size: 21px; line-height: 1; }
        .ud-rail-badge { position: absolute; top: 3px; right: 7px; min-width: 16px; height: 16px; padding: 0 4px; display: grid; place-items: center; border-radius: 10px; background: #D92D45; color: #fff; font-size: 9px; font-style: normal; }
        .ud-rail-spacer { flex: 1; }
        .ud-rail-item:not(.ud-rail-logout) { min-height: 62px; width: 62px; }
        .ud-rail-item:not(.ud-rail-logout) svg { display: block; }
        .ud-rail-logout { min-height: 46px; height: 46px; width: 46px; margin-bottom: 8px; border: 1px solid #E1DFDD; border-radius: 12px; color: #616161; background: #FFFFFF; }
        .ud-rail-logout:hover { background: #E8F4FB; color: #0878B9; }
        .ud-root { margin-left: 76px; width: calc(100% - 76px); min-width: 0; }
        .ud-bar { background: #fff !important; box-shadow: 0 1px 4px rgba(15, 55, 80, .04); }
        .ud-card, .ud-sched-row { border-radius: 12px !important; box-shadow: 0 2px 8px rgba(15, 55, 80, .06); }
        .ud-root, .ud-root *, .ud-root *::before, .ud-root *::after { box-sizing: border-box; }
        .ud-bar { position: sticky; top: 0; z-index: 10; width: 100%; background: ${C.card}; border-bottom: 1px solid #DCEAF2; padding: 14px clamp(18px, 3vw, 36px); }
        .ud-bar-inner { display: flex; align-items: center; gap: 14px; width: 100%; max-width: 1600px; margin: 0 auto; }
        .ud-body { flex: 1; width: 100%; max-width: 1600px; margin: 0 auto; padding: clamp(24px, 3vw, 38px) clamp(18px, 3vw, 40px) 52px; }
        .ud-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr)); gap: 20px; width: 100%; align-items: stretch; }
        .ud-card-media { position: relative; width: 100%; height: clamp(160px, 18vw, 210px); overflow: hidden; }
        .ud-card-actions { padding: 14px 16px 16px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
        .ud-card { display: flex; flex-direction: column; min-width: 0; height: 100%; background: #fff; transition: box-shadow .18s ease, transform .18s ease; }
        .ud-card:hover { transform: translateY(-2px); box-shadow: 0 8px 20px rgba(15, 55, 80, .12); }
        .ud-card-body { padding: 20px 22px; border-bottom: 1px solid ${C.separator}; flex: 1; display: flex; flex-direction: column; min-width: 0; }
        .ud-sched-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr)); gap: 12px; }
        .ud-sched-row { display: flex; align-items: center; gap: 14px; min-width: 0; background: ${C.card}; border: 1px solid #DCEAF2; border-radius: 12px; padding: 14px 16px; }
        .ud-datesq { width: 48px; height: 48px; flex-shrink: 0; border-radius: 12px; background: ${C.medBlueBg}; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
        @media (max-width: 980px) {
          .ud-grid { gap: 16px; }
          .ud-card-body { padding: 18px; }
        }
        @media (max-width: 720px) {
          .ud-username { display: none; }
          .ud-teams-rail { width: 60px; padding-left: 4px; padding-right: 4px; }
          .ud-rail-item { width: 52px; }
          .ud-root { margin-left: 60px; width: calc(100% - 60px); }
          .ud-body { padding: 20px 14px 36px; }
        }
        @media (max-width: 520px) {
          .ud-phone { display: none; }
          .ud-datesq { width: 40px; height: 40px; border-radius: 10px; }
          .ud-sched-row { padding: 10px 12px; gap: 10px; }
          .ud-card-media { height: 150px; }
        }
        /* Wide screens — horizontal cards (same pattern as TrainerDashboard):
           media band left, centered body, fixed action rail right. The 660px
           track guarantees media(190-250) + body(≥240) + actions(176) never
           starve each other; rows get 1-2 cards depending on width. */
        @media (min-width: 1150px) {
          .ud-grid { grid-template-columns: repeat(auto-fill, minmax(min(660px, 100%), 1fr)); gap: 22px; }
          .ud-card { flex-direction: row; align-items: stretch; }
          .ud-card-media { width: clamp(190px, 16vw, 250px); height: auto; min-height: 210px; flex-shrink: 0; }
          .ud-card-body { flex: 1 1 0; min-width: 240px; justify-content: center; border-bottom: none; border-right: 1px solid ${C.separator}; }
          .ud-card-body h3 { font-size: 19px !important; }
          .ud-card-body p { -webkit-line-clamp: 3 !important; }
          .ud-card-actions { display: flex; flex-direction: column; justify-content: center; gap: 9px; width: 176px; flex-shrink: 0; padding: 14px 16px; }
          .ud-card-actions button { flex-direction: row !important; justify-content: flex-start !important; gap: 9px; padding: 11px 13px !important; }
          .ud-card-actions button > * { flex-shrink: 0; }
          .ud-card-actions button span { font-size: 12.5px !important; white-space: nowrap; }
          .ud-sched-list { gap: 14px; }
        }
        @keyframes pulse {
          0% { transform: scale(1); opacity: 0.4; }
          70% { transform: scale(2.5); opacity: 0; }
          100% { transform: scale(1); opacity: 0; }
        }
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
    </div>
  );
}
