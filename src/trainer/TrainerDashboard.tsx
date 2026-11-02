import { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { Course, BusinessSettings, User } from "../types";
import { supabase } from "../auth/supabase";
import { getCourses } from "../database/courseDB";

function initialsOf(name: string | null | undefined, fallback: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

const PRIMARY = "#0B57D0";
const PRIMARY_HOVER = "#0842A0";
const PRIMARY_CONTAINER = "#D3E3FD";
const GREEN_FG = "#146C2E";
const GREEN_CONTAINER = "#D2EEDA";
const PURPLE_FG = "#8430CE";
const PURPLE_CONTAINER = "#E9DDFB";
const ORANGE_FG = "#965E00";
const ORANGE_CONTAINER = "#FDEBC8";

const TD_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');

.td-root { min-height:100vh; min-height:100dvh; width:100%; background:#F0F4F9; color:#1F1F1F;
  font-family:Roboto,'Google Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  display:flex; flex-direction:column; }
.td-root *, .td-root *::before, .td-root *::after { box-sizing:border-box; }

.td-bar { position:sticky; top:0; z-index:20; background:#fff; border-bottom:1px solid #DADCE0;
  box-shadow:0 1px 3px rgba(60,64,67,.06); }
.td-bar-inner { display:flex; align-items:center; gap:12px; flex-wrap:wrap;
  padding:10px clamp(12px,3vw,24px); width:100%; }
.td-brand { display:flex; align-items:center; gap:12px; flex:1 1 220px; min-width:0; }
.td-logo { width:38px; height:38px; border-radius:10px; object-fit:contain; object-position:center; background:#FFFFFF; padding:3px; box-sizing:border-box; border:1px solid #DADCE0; flex-shrink:0; }
.td-logo-fallback { display:flex; align-items:center; justify-content:center;
  background:${PRIMARY_CONTAINER}; color:${PRIMARY}; font-weight:500; font-size:17px; }
.td-name { margin:0; font-size:16px; font-weight:500; color:#1F1F1F;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.td-phone { font-size:12.5px; color:#444746; text-decoration:none; display:inline-flex;
  align-items:center; gap:5px; margin-top:1px; white-space:nowrap; }
.td-phone:hover { color:${PRIMARY}; }
.td-bar-actions { display:flex; align-items:center; gap:6px; }
.td-chip { display:flex; align-items:center; gap:8px; background:#F0F4F9; border:1px solid #DADCE0;
  border-radius:999px; padding:3px 14px 3px 4px; max-width:210px; min-width:0; }
.td-avatar { width:30px; height:30px; border-radius:50%; background:${PRIMARY}; color:#fff;
  font-size:13px; font-weight:500; display:flex; align-items:center; justify-content:center;
  overflow:hidden; flex-shrink:0; }
.td-avatar img { width:100%; height:100%; object-fit:cover; }
.td-username { font-size:13px; font-weight:500; color:#1F1F1F; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.td-iconbtn { position:relative; width:40px; height:40px; border-radius:50%; border:none;
  background:transparent; color:#444746; display:flex; align-items:center; justify-content:center;
  cursor:pointer; flex-shrink:0; transition:background .15s ease, color .15s ease; }
@media (hover:hover){ .td-iconbtn:hover { background:rgba(60,64,67,0.08); color:#1F1F1F; } }
.td-badge { position:absolute; top:1px; right:1px; min-width:17px; height:17px; border-radius:9px;
  background:#B3261E; color:#fff; font-size:10px; font-weight:700; display:flex; align-items:center;
  justify-content:center; padding:0 4px; border:2px solid #fff; box-sizing:content-box; }

.td-body { flex:1; width:100%;
  padding:clamp(16px,3.5vw,32px) clamp(14px,3.5vw,28px) 72px; }
.td-heading { display:flex; align-items:center; gap:10px; margin:4px 2px 22px; }
.td-heading h2 { margin:0; font-size:clamp(20px,2.4vw,24px); font-weight:400; color:#1F1F1F; }
.td-count { background:#fff; border:1px solid #DADCE0; border-radius:999px; padding:2px 11px;
  font-size:12px; font-weight:500; color:#444746; white-space:nowrap; }

.td-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(min(310px,100%),1fr));
  gap:clamp(14px,2vw,22px); }
.td-card { background:#fff; border-radius:22px; overflow:hidden; display:flex; flex-direction:column;
  box-shadow:0 1px 2px 0 rgba(60,64,67,.24), 0 1px 3px 1px rgba(60,64,67,.08);
  transition:box-shadow .2s ease, transform .2s ease; min-width:0; }
@media (hover:hover){
  .td-card:hover { box-shadow:0 1px 3px 0 rgba(60,64,67,.30), 0 4px 8px 3px rgba(60,64,67,.15); transform:translateY(-2px); }
}
.td-media { position:relative; width:100%; height:clamp(150px,22vw,200px); background:${PRIMARY_CONTAINER}; }
.td-media img { width:100%; height:100%; object-fit:cover; display:block; }
.td-media-fallback { width:100%; height:100%; display:flex; align-items:center; justify-content:center;
  font-size:46px; font-weight:400; color:${PRIMARY};
  background:linear-gradient(135deg, #E8F0FE, ${PRIMARY_CONTAINER}); }
.td-media-scrim { position:absolute; left:0; right:0; bottom:0; height:55%;
  background:linear-gradient(to top, rgba(0,0,0,.40), transparent); pointer-events:none; }
.td-countpill { position:absolute; top:12px; right:12px; display:flex; align-items:center; gap:6px;
  background:rgba(255,255,255,.95); color:#1F1F1F; border-radius:999px; padding:5px 12px;
  font-size:12.5px; font-weight:500; box-shadow:0 1px 2px rgba(60,64,67,.18); }
.td-cardbody { padding:18px 20px 14px; flex:1; display:flex; flex-direction:column; min-width:0; }
.td-cardtitle { margin:0 0 7px; font-size:19px; font-weight:500; color:#1F1F1F; }
.td-carddesc { margin:0; color:#444746; font-size:14px; line-height:1.6; max-width:72ch; display:-webkit-box;
  -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.td-schedbtn { align-self:flex-start; margin-top:16px; display:inline-flex; align-items:center; gap:7px;
  padding:7px 15px; border-radius:999px; border:1px solid #DADCE0; background:#fff; color:#444746;
  font-size:13px; font-weight:500; cursor:pointer; font-family:inherit;
  transition:background .15s, border-color .15s; }
@media (hover:hover){ .td-schedbtn:hover { background:#F0F4F9; border-color:#C4C7C5; } }
.td-actions { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; padding:14px 16px 16px;
  border-top:1px solid #E8EAED; }
.td-tile { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px;
  padding:12px 6px; border-radius:16px; border:none; cursor:pointer; font-family:inherit;
  transition:filter .15s ease, transform .1s ease; min-width:0; }
@media (hover:hover){ .td-tile:hover { filter:brightness(0.95); } }
.td-tile:active { transform:scale(.97); }
.td-tile span { font-size:11px; font-weight:500; letter-spacing:.3px; }
.td-iconbtn:focus-visible, .td-tile:focus-visible, .td-schedbtn:focus-visible,
.td-close:focus-visible, .td-delbtn:focus-visible, .td-primary:focus-visible {
  outline:2px solid ${PRIMARY}; outline-offset:2px; }

.td-overlay { position:fixed; inset:0; background:rgba(32,33,36,.5); display:flex;
  align-items:center; justify-content:center; z-index:1000; padding:20px; }
.td-dialog { background:#fff; border-radius:28px; width:100%; max-width:560px;
  max-height:88vh; max-height:88dvh; display:flex; flex-direction:column; overflow:hidden;
  box-shadow:0 4px 8px 3px rgba(60,64,67,.15), 0 1px 3px rgba(60,64,67,.3); }
.td-sheet-handle { display:none; }
.td-dialog-head { padding:18px 14px 14px 24px; display:flex; align-items:flex-start;
  justify-content:space-between; gap:12px; border-bottom:1px solid #E8EAED; }
.td-dialog-title { margin:0; font-size:21px; font-weight:400; color:#1F1F1F; }
.td-dialog-sub { margin:3px 0 0; font-size:13.5px; color:#747775; }
.td-dialog-body { padding:20px 24px 26px; overflow-y:auto; }
.td-close { width:36px; height:36px; border-radius:50%; border:none; background:#F0F4F9;
  color:#444746; display:flex; align-items:center; justify-content:center; cursor:pointer;
  flex-shrink:0; transition:background .15s; }
.td-close:hover { background:#E8EAED; }

.td-field { width:100%; padding:12px 14px; border:1px solid #C4C7C5; border-radius:12px;
  font-size:15px; font-family:inherit; color:#1F1F1F; outline:none; background:#fff;
  margin-bottom:10px; transition:border-color .15s, box-shadow .15s; }
.td-field:focus { border-color:${PRIMARY}; box-shadow:inset 0 0 0 1px ${PRIMARY}; }
.td-field::placeholder { color:#747775; }
.td-label { font-size:12.5px; font-weight:500; color:#444746; margin:2px 0 6px; display:block; }
.td-primary { width:100%; padding:13px 20px; border:none; border-radius:999px; background:${PRIMARY};
  color:#fff; font-size:14.5px; font-weight:500; font-family:inherit; cursor:pointer;
  margin-top:4px; transition:background .15s, box-shadow .15s; }
.td-primary:hover { background:${PRIMARY_HOVER}; box-shadow:0 1px 3px 0 rgba(60,64,67,.3); }
.td-primary:disabled { background:#C4C7C5; color:#fff; cursor:default; box-shadow:none; }
.td-upcoming { margin:0 0 12px; font-size:12.5px; font-weight:600; letter-spacing:.6px;
  text-transform:uppercase; color:#747775; }

.td-listitem { display:flex; align-items:center; gap:12px; padding:9px 12px; border-radius:16px;
  transition:background .12s; }
@media (hover:hover){ .td-listitem:hover { background:#F0F4F9; } }
.td-lavatar { width:40px; height:40px; border-radius:50%; background:${PRIMARY_CONTAINER};
  color:${PRIMARY}; font-weight:500; font-size:15px; display:flex; align-items:center;
  justify-content:center; overflow:hidden; flex-shrink:0; }
.td-lavatar img { width:100%; height:100%; object-fit:cover; }
.td-listmeta { flex:1; min-width:0; }
.td-listname { font-size:15px; font-weight:500; color:#1F1F1F; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }
.td-listsub { font-size:13px; color:#747775; margin-top:1px; white-space:nowrap;
  overflow:hidden; text-overflow:ellipsis; }

.td-schedrow { display:flex; align-items:center; gap:12px; background:#F0F4F9;
  border-radius:16px; padding:12px 14px; }
.td-datesq { width:46px; border-radius:12px; background:#fff; border:1px solid #DADCE0;
  text-align:center; padding:6px 0 5px; flex-shrink:0; }
.td-datesq b { display:block; font-size:17px; font-weight:500; color:#1F1F1F; line-height:1.1; }
.td-datesq span { font-size:10.5px; font-weight:500; color:#747775; text-transform:uppercase;
  letter-spacing:.4px; }
.td-delbtn { border:none; background:transparent; color:#B3261E; font-size:13px; font-weight:500;
  padding:7px 12px; border-radius:999px; cursor:pointer; font-family:inherit; flex-shrink:0;
  transition:background .15s; }
.td-delbtn:hover { background:#FCE8E6; }

.td-empty { background:#fff; border-radius:24px; padding:56px 28px; text-align:center;
  box-shadow:0 1px 2px rgba(60,64,67,.3), 0 1px 3px 1px rgba(60,64,67,.1); }
.td-emptyicon { width:76px; height:76px; border-radius:50%; background:${PRIMARY_CONTAINER};
  color:${PRIMARY}; display:flex; align-items:center; justify-content:center; margin:0 auto 18px; }
.td-emptytitle { margin:0 0 8px; font-size:20px; font-weight:500; color:#1F1F1F; }
.td-emptysub { margin:0 auto; font-size:14.5px; color:#747775; line-height:1.6; max-width:430px; }
.td-emptysmall { text-align:center; color:#747775; padding:26px 0; font-size:14px; margin:0; }
.td-skel { border-radius:20px;
  background:linear-gradient(100deg,#E7EDF5 40%,#F5F8FC 50%,#E7EDF5 60%);
  background-size:200% 100%; animation:td-shimmer 1.3s infinite linear; }
@keyframes td-shimmer { to { background-position:-200% 0; } }

@media (max-width:720px){
  .td-username, .td-phone { display:none; }
  .td-chip { padding-right:10px; }
}
@media (max-width:640px){
  .td-overlay { align-items:flex-end; padding:0; }
  .td-dialog { max-width:100%; border-radius:24px 24px 0 0; max-height:92dvh; }
  .td-sheet-handle { display:block; width:36px; height:4px; border-radius:2px;
    background:#DADCE0; margin:10px auto 0; }
  .td-dialog-head { border-bottom:none; padding-bottom:8px; }
}
@media (max-width:360px){
  .td-actions { grid-template-columns:repeat(2,1fr); }
}
@media (max-width:480px){
  .td-cardbody { padding:16px 16px 12px; }
  .td-cardtitle { font-size:18px; }
  .td-actions { padding:10px 12px 12px; gap:6px; }
}
@media (min-width:1200px){
  .td-grid { grid-template-columns:1fr; gap:18px; }
  .td-card { flex-direction:row; align-items:stretch; border-radius:24px; }
  .td-card:hover { transform:none;
    box-shadow:0 1px 2px 0 rgba(60,64,67,.24), 0 6px 16px 4px rgba(60,64,67,.12); }
  .td-media { width:clamp(250px,24vw,360px); height:auto; min-height:210px; flex-shrink:0; }
  .td-cardbody { flex:1; min-width:0; justify-content:center; padding:26px 32px; }
  .td-cardtitle { font-size:21px; }
  .td-actions { width:clamp(240px,21vw,330px); flex-shrink:0; grid-template-columns:repeat(2,1fr); gap:10px;
    align-content:center; padding:18px 20px; border-top:none; border-left:1px solid #E8EAED; }
  .td-skel { height:240px !important; }
}
`;

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
  const [profilePic, setProfilePic] = useState<string | null>(null);
  const [profilePicError, setProfilePicError] = useState(false);
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

  const [pendingForms, setPendingForms] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      const savedUserString = localStorage.getItem("currentUser");
      if (!savedUserString) { navigate("/"); return; }
      const savedUser = JSON.parse(savedUserString);
      if (!savedUser.id || !savedUser.tenantId) { navigate("/"); return; }
      setCurrentUser(savedUser);

      const localSettings = localStorage.getItem("localBusinessSettings");
      if (localSettings) setSettings(JSON.parse(localSettings));

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

  useEffect(() => {
    const fetchTrainerAvatar = async () => {
      if (!currentUser?.id) return;
      setProfilePicError(false);

      const cached = localStorage.getItem(`cachedAvatar_${currentUser.id}`);
      let cachedProfile: any = null;
      try { cachedProfile = JSON.parse(localStorage.getItem(`cachedProfile_${currentUser.id}`) || "null"); } catch {}
      if (cached || cachedProfile?.avatar_url || currentUser.profilePic) {
        setProfilePic(cached || cachedProfile?.avatar_url || currentUser.profilePic);
      }

      try {
        const { data } = await supabase.from("profile_settings").select("avatar_url").eq("user_id", currentUser.id).maybeSingle();
        if (data?.avatar_url) {
          setProfilePic(data.avatar_url);
          localStorage.setItem(`cachedProfile_${currentUser.id}`, JSON.stringify({ id: currentUser.id, username: currentUser.username, role: currentUser.role, avatar_url: data.avatar_url }));
          cacheAvatarImage(currentUser.id, data.avatar_url);
          return;
        }

        const { data: u } = await supabase.from("users").select("profile_pic").eq("id", currentUser.id).maybeSingle();
        if (u?.profile_pic) {
          setProfilePic(u.profile_pic);
          cacheAvatarImage(currentUser.id, u.profile_pic);
        } else {
          setProfilePic(currentUser.profilePic || null);
        }
      } catch {}
    };
    fetchTrainerAvatar();
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

  const fetchCourses = useCallback(async () => {
    if (!currentUser?.id || !currentUser?.tenantId) return;
    setLoading(true);

    try {
      const allLocalCourses = await getCourses();
      const assignedIds = currentUser.assignedCourses || [];
      const localCourses = allLocalCourses.filter(c => assignedIds.includes(c.id));
      setCourses(localCourses);
    } catch (e) { console.error("Local courses fetch failed", e); }

    try {
      const assigned = currentUser.assignedCourses;
      if (assigned && assigned.length > 0) {
        const { data: coursesRes } = await supabase.from("courses").select("*").in("id", assigned).order("created_at", { ascending: false });
        if (coursesRes) {
          const remoteCourses = coursesRes.map(mapCourseFromSupabase);
          setCourses(remoteCourses);

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

  return (
    <div className="td-root">
      <style>{TD_CSS}</style>

      <header className="td-bar">
        <div className="td-bar-inner">
          <div className="td-brand">
            {businessLogo ? (
              <img className="td-logo" src={businessLogo} alt="Logo" />
            ) : (
              <span className="td-logo td-logo-fallback">{(businessName || "M").charAt(0).toUpperCase()}</span>
            )}
            <div style={{ minWidth: 0 }}>
              {businessName && <h1 className="td-name">{businessName}</h1>}
              {phone && (
                <a className="td-phone" href={`tel:${phone.replace(/\s+/g, "")}`}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                  {phone}
                </a>
              )}
            </div>
          </div>

          <div className="td-bar-actions">
            <div className="td-chip" title={currentUser?.username || ""}>
              <span className="td-avatar">
                {profilePic && !profilePicError ? (
                  <img src={profilePic} alt="" onError={() => setProfilePicError(true)} />
                ) : (
                  initialsOf(currentUser?.username, "?")
                )}
              </span>
              <span className="td-username">{currentUser?.username}</span>
            </div>

            <button className="td-iconbtn" onClick={() => navigate("/forms")} title="Forms">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
              {pendingForms > 0 && <span className="td-badge">{pendingForms}</span>}
            </button>
            <button className="td-iconbtn" onClick={() => navigate("/trainer/settings")} title="Settings">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
            </button>
            <button className="td-iconbtn" onClick={handleLogout} title="Log out">
              <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
            </button>
          </div>
        </div>
      </header>

      <main className="td-body">
        <div className="td-heading">
          <h2>My courses</h2>
          {!loading && <span className="td-count">{courses.length} assigned</span>}
        </div>

        {loading && (
          <div className="td-grid">
            <div className="td-skel" style={{ height: 340 }} />
            <div className="td-skel" style={{ height: 340 }} />
          </div>
        )}

        {!loading && courses.length === 0 && (
          <div className="td-empty">
            <div className="td-emptyicon">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>
            </div>
            <h3 className="td-emptytitle">No courses assigned</h3>
            <p className="td-emptysub">Your administrator hasn&apos;t assigned any courses to you yet. Once they do, your classes will appear here.</p>
          </div>
        )}

        {!loading && courses.length > 0 && (
          <div className="td-grid">
            {courses.map((course) => {
              const learnerCount = courseStats[course.id] || 0;
              return (
                <div className="td-card" key={course.id}>
                  <div className="td-media">
                    {course.logo ? (
                      <img src={course.logo} alt={course.name} loading="lazy" />
                    ) : (
                      <div className="td-media-fallback">{(course.name || "C").charAt(0).toUpperCase()}</div>
                    )}
                    <div className="td-media-scrim" />
                    <div className="td-countpill">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      {learnerCount} learner{learnerCount === 1 ? "" : "s"}
                    </div>
                  </div>

                  <div className="td-cardbody">
                    <h3 className="td-cardtitle">{course.name}</h3>
                    <p className="td-carddesc">{course.description || "No description provided."}</p>
                    <button className="td-schedbtn" onClick={() => setScheduleCourse(course)}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                      Schedule session
                    </button>
                  </div>

                  <div className="td-actions">
                    <button className="td-tile" style={{ background: PRIMARY_CONTAINER, color: PRIMARY }} onClick={() => navigate(`/trainer/live/${course.id}`)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
                      <span>Live</span>
                    </button>
                    <button className="td-tile" style={{ background: GREEN_CONTAINER, color: GREEN_FG }} onClick={() => navigate(`/trainer/upload/${course.id}`)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></svg>
                      <span>Upload</span>
                    </button>
                    <button className="td-tile" style={{ background: PURPLE_CONTAINER, color: PURPLE_FG }} onClick={() => navigate(`/trainer/assignments/${course.id}`)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /></svg>
                      <span>Assignments</span>
                    </button>
                    <button className="td-tile" style={{ background: ORANGE_CONTAINER, color: ORANGE_FG }} onClick={() => openAttendance(course)}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      <span>Attendance</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {attendanceCourse && (
        <div className="td-overlay" onClick={() => setAttendanceCourse(null)}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="td-sheet-handle" />
            <div className="td-dialog-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="td-dialog-title">{attendanceCourse.name}</h2>
                <p className="td-dialog-sub">
                  {loadingLearners ? "Loading learners…" : `${assignedLearners.length} learner${assignedLearners.length === 1 ? "" : "s"} enrolled`}
                </p>
              </div>
              <button className="td-close" onClick={() => setAttendanceCourse(null)} title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="td-dialog-body">
              {loadingLearners ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className="td-skel" style={{ height: 56, borderRadius: 16 }} />
                  <div className="td-skel" style={{ height: 56, borderRadius: 16 }} />
                  <div className="td-skel" style={{ height: 56, borderRadius: 16 }} />
                </div>
              ) : assignedLearners.length === 0 ? (
                <p className="td-emptysmall">No learners enrolled yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 2, margin: "0 -12px" }}>
                  {assignedLearners.map((learner) => (
                    <div className="td-listitem" key={learner.id}>
                      <span className="td-lavatar">
                        {learner.profilePic ? <img src={learner.profilePic} alt="" /> : learner.username?.charAt(0).toUpperCase()}
                      </span>
                      <div className="td-listmeta">
                        <div className="td-listname">{learner.username}</div>
                        <div className="td-listsub">{learner.phone || "No phone"}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {scheduleCourse && (
        <div className="td-overlay" onClick={() => setScheduleCourse(null)}>
          <div className="td-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="td-sheet-handle" />
            <div className="td-dialog-head">
              <div style={{ minWidth: 0 }}>
                <h2 className="td-dialog-title">Schedule sessions</h2>
                <p className="td-dialog-sub">{scheduleCourse.name}</p>
              </div>
              <button className="td-close" onClick={() => setScheduleCourse(null)} title="Close">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
              </button>
            </div>
            <div className="td-dialog-body">
              <div style={{ background: "#F0F4F9", borderRadius: 18, padding: 16, marginBottom: 22 }}>
                <input
                  className="td-field" type="text" placeholder="Session title"
                  value={newScheduleTitle} onChange={(e) => setNewScheduleTitle(e.target.value)}
                />
                <textarea
                  className="td-field" placeholder="Description (optional)" rows={2} style={{ resize: "none" }}
                  value={newScheduleDesc} onChange={(e) => setNewScheduleDesc(e.target.value)}
                />
                <label className="td-label">Date &amp; time</label>
                <input
                  className="td-field" type="datetime-local"
                  value={newScheduleDate} onChange={(e) => setNewScheduleDate(e.target.value)}
                />
                <button
                  className="td-primary" onClick={handleCreateSchedule}
                  disabled={!newScheduleTitle || !newScheduleDate}
                >
                  Add session
                </button>
              </div>

              <h3 className="td-upcoming">Upcoming</h3>
              {schedules.length === 0 ? (
                <p className="td-emptysmall">No sessions scheduled yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {schedules.map((sch) => {
                    const d = new Date(sch.scheduled_at);
                    const valid = !isNaN(d.getTime());
                    return (
                      <div className="td-schedrow" key={sch.id}>
                        <div className="td-datesq">
                          <b>{valid ? d.getDate() : "—"}</b>
                          <span>{valid ? d.toLocaleString(undefined, { month: "short" }) : ""}</span>
                        </div>
                        <div className="td-listmeta">
                          <div className="td-listname">{sch.title}</div>
                          {sch.description && <div className="td-listsub">{sch.description}</div>}
                          <div className="td-listsub">{valid ? d.toLocaleString() : ""}</div>
                        </div>
                        <button className="td-delbtn" onClick={() => handleDeleteSchedule(sch.id)}>Delete</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
