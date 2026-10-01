// src/admin/CourseManagement.tsx
import { useEffect, useState, useRef } from "react";
import type { Course, User } from "../types";
import { addCourse, getCourses, updateCourse, deleteCourse } from "../database/courseDB";
import { db } from "../database/db";
import { getUsers } from "../database/userDB";
import { supabase } from "../auth/supabase";

function compressImage(file: File, setter: (val: string) => void) {
  const reader = new FileReader();
  reader.onloadend = () => {
    const img = new Image();
    img.src = reader.result as string;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const maxSize = 200;
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxSize) { height *= maxSize / width; width = maxSize; }
      } else {
        if (height > maxSize) { width *= maxSize / height; height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      ctx?.drawImage(img, 0, 0, width, height);
      setter(canvas.toDataURL("image/jpeg", 0.6));
    };
  };
  reader.readAsDataURL(file);
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    const id = crypto.randomUUID();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return id;
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === null || amount === undefined || amount === "") return "0.00";
  const num = typeof amount === 'string' ? parseFloat(amount.replace(/,/g, '')) : amount;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mapCourseFromSupabase(c: any): Course {
  return {
    id: c.id,
    name: c.name,
    description: c.description || "",
    tuitionType: c.tuition_type || "free",
    amount: c.amount || 0,
    startDate: c.start_date || "",
    period: c.period || "",
    logo: c.logo || "",
    mediaUrl: c.logo || "",
    mediaType: "image",
    mediaName: "course-logo",
    createdAt: c.created_at || new Date().toISOString(),
    synced: true,
  };
}

function mapUserFromSupabase(u: any): User {
  return {
    ...u,
    assignedCourses: u.assigned_courses || [],
    profilePic: u.profile_pic,
    tuitionType: u.tuition_type,
  } as User;
}

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { "Authorization": `Bearer ${token}` } : {}),
  };
}

async function apiFetch(path: string, body: any, method: string = "POST") {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `Sync failed: ${res.status}`);
  }
  return res.json();
}

// SILENT sync — pushes offline-created courses to the cloud with no UI, no alerts.
// Failed items stay unsynced and are retried on the next load / reconnect.
async function pushUnsyncedCoursesSilently() {
  try {
    const unsynced = await db.courses.filter((c) => !c.synced).toArray();
    for (const course of unsynced) {
      try {
        await apiFetch("/api/courses/create", {
          id: course.id,
          name: course.name,
          description: course.description || "",
          logo: course.logo || null,
          tuition_type: course.tuitionType || "free",
          amount: parseFloat(String(course.amount || 0).replace(/,/g, "")) || 0,
          start_date: course.startDate || null,
          period: course.period || null,
        });
        await db.courses.update(course.id, { synced: true });
      } catch { /* keep unsynced — retried next time */ }
    }
  } catch { /* local db unavailable — ignore */ }
}

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93", textQuaternary: "#AEAEB2",
  bg: "#F2F2F7", card: "#FFFFFF", inset: "#F9F9FB", separator: "#E5E5EA",
  blue: "#007AFF", blueBg: "#EBF2FF", green: "#30D158", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", red: "#FF3B30", redBg: "#FFEFEE",
  purple: "#AF52DE", purpleBg: "#F5F0FF", freeText: "#1B8A3A", freeBg: "#EAF9EE",
  paidText: "#C47F17", paidBg: "#FFF6EB", metaText: "#8E8E93",
  medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  skeletonBase: "#E5E5EA",
};

const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

const INITIAL_FORM = { name: "", description: "", tuitionType: "free" as "free" | "paid", paidValue: "", startDate: "", endDate: "", logo: "" };

const panelBase: React.CSSProperties = {
  backgroundColor: C.card, borderRadius: 14, overflow: "hidden",
  boxShadow: "0 1px 4px rgba(0,0,0,0.04)", border: "1px solid rgba(17,24,39,0.05)",
  boxSizing: "border-box", minWidth: 0,
};

function Stat({ icon, bg, fg, label, value }: { icon: React.ReactNode; bg: string; fg: string; label: string; value: string | number }) {
  return (
    <div style={{ flex: "1 1 min(180px, 100%)", ...panelBase, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.textTertiary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        <div style={{ fontSize: 22, color: C.textPrimary, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}

function SkeletonStat() {
  return (
    <div style={{ flex: "1 1 min(180px, 100%)", ...panelBase, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
        <div style={{ width: "60%", height: 12, borderRadius: 4, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }} />
        <div style={{ width: "40%", height: 22, borderRadius: 6, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SkeletonCardGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(360px, 100%), 1fr))", gap: 16, width: "100%", boxSizing: "border-box" }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{ ...panelBase, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", padding: 16, borderBottom: `0.5px solid ${C.separator}` }}>
            <div style={{ width: 52, height: 52, borderRadius: 14, background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
            <div style={{ flex: 1, marginLeft: 14, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
              <div style={{ width: "60%", height: 16, borderRadius: 6, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }} />
              <div style={{ width: "30%", height: 12, borderRadius: 4, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
            </div>
          </div>
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ width: "80%", height: 40, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }} />
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, height: 60, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
              <div style={{ flex: 1, height: 60, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }} />
              <div style={{ flex: 1, height: 60, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.15s" }} />
            </div>
            <div style={{ width: "100%", height: 80, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.25s" }} />
            <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
              <div style={{ flex: 1, height: 44, borderRadius: 10, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
              <div style={{ flex: 1, height: 44, borderRadius: 10, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function CourseManagement() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [courseDetails, setCourseDetails] = useState<Record<string, { trainer: User | null; trainees: any[]; schedules: any[] }>>({});
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState(INITIAL_FORM);
  const [inlineError, setInlineError] = useState("");
  const inlinePicRef = useRef<HTMLInputElement>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => { loadCourses(); }, []);

  // SILENT SYNC — retry whenever the device comes back online
  useEffect(() => {
    const onOnline = () => loadCourses();
    window.addEventListener("online", onOnline);
    window.addEventListener("dataSynced", onOnline as EventListener);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("dataSynced", onOnline as EventListener);
    };
  }, []);

  async function loadCourses() {
    try {
      const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const tenantId = currentUser?.tenantId;

      let coursesData: Course[] = [];
      let usersData: User[] = [];
      let schedulesData: any[] = [];

      // STEP 1: Load from Local DB INSTANTLY (Offline support)
      try {
        coursesData = await getCourses();
        const rawUsers = await getUsers();
        usersData = Array.isArray(rawUsers) ? rawUsers : [];
        schedulesData = await db.schedules.toArray();
      } catch (e) { /* ignore */ }

      setCourses(coursesData);
      buildCourseDetails(coursesData, usersData, schedulesData);
      setIsLoading(false);

      // STEP 2: Background push of offline-created records, then pull fresh from Supabase
      if (tenantId && navigator.onLine) {
        try {
          await pushUnsyncedCoursesSilently();

          const [coursesRes, usersRes] = await Promise.all([
            supabase.from("courses").select("*").eq("tenant_id", tenantId),
            supabase.from("users").select("*").eq("tenant_id", tenantId),
          ]);

          let remoteCourses: Course[] = [];
          let remoteUsers: User[] = [];

          if (coursesRes.data && coursesRes.data.length > 0) {
            remoteCourses = coursesRes.data.map(mapCourseFromSupabase);
          }
          if (usersRes.data) {
            remoteUsers = usersRes.data.map(mapUserFromSupabase);
          }

          let remoteSchedules: any[] = [];
          try {
            const { data: schedData } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId);
            if (schedData) {
              remoteSchedules = schedData.map((s: any) => ({
                ...s,
                courseId: s.course_id,
                trainerId: s.trainer_id,
                scheduledAt: s.scheduled_at || s.created_at,
              }));
            }
          } catch (e) { /* schedules table may not exist */ }

          for (const course of remoteCourses) {
            await db.courses.put(course);
          }

          const finalCourses = remoteCourses.length > 0 ? remoteCourses : coursesData;
          const finalUsers = remoteUsers.length > 0 ? remoteUsers : usersData;
          const finalSchedules = remoteSchedules.length > 0 ? remoteSchedules : schedulesData;

          setCourses(finalCourses);
          buildCourseDetails(finalCourses, finalUsers, finalSchedules);
        } catch (onlineError) {
          console.warn("Supabase fetch failed, using local DB", onlineError);
        }
      }
    } catch (error) {
      console.error("Failed to load courses", error);
    } finally {
      setIsLoading(false);
    }
  }

  function buildCourseDetails(coursesData: Course[], usersData: User[], schedulesData: any[]) {
    const detailsMap: Record<string, { trainer: User | null; trainees: any[]; schedules: any[] }> = {};
    for (const course of coursesData) {
      const courseSchedules = schedulesData.filter((s: any) => s.courseId === course.id);
      const trainer = usersData.find((u: any) => u.role === "trainer" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id)) || null;
      const trainees = usersData
        .filter((u: any) => u.role === "trainee" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id))
        .map((u: any) => ({ id: u.id, username: u.username || "Unknown", phone: u.phone || "" }));
      detailsMap[course.id] = { trainer, trainees, schedules: courseSchedules };
    }
    setCourseDetails(detailsMap);
  }

  function updateForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setForm(prev => ({ ...prev, [key]: value })); }
  function handleToggleForm() { if (showForm) closeForm(); else openCreateForm(); }
  function openCreateForm() { setForm(INITIAL_FORM); setShowForm(true); }
  function closeForm() { setShowForm(false); setForm(INITIAL_FORM); }

  function uploadLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, (base64) => updateForm("logo", base64));
    e.target.value = "";
  }

  async function saveCourse() {
    if (!form.name.trim()) return;
    const courseId = generateUUID();
    const course: Course = {
      id: courseId, name: form.name, description: form.description,
      tuitionType: form.tuitionType, amount: form.tuitionType === "paid" ? (parseFloat(form.paidValue.replace(/,/g, "")) || 0) : 0,
      startDate: form.startDate, period: form.endDate, logo: form.logo,
      mediaUrl: form.logo, mediaType: "image", mediaName: "course-logo", createdAt: new Date().toISOString()
    };

    await addCourse(course);

    try {
      await apiFetch("/api/courses/create", {
        id: courseId, name: form.name, description: form.description || "",
        logo: form.logo || null, tuition_type: form.tuitionType || "free",
        amount: form.tuitionType === "paid" ? (parseFloat(form.paidValue.replace(/,/g, "")) || 0) : 0,
        start_date: form.startDate || null, period: form.endDate || null,
      });
      await db.courses.update(courseId, { synced: true });
    } catch (e: any) {
      console.warn("Course cloud sync failed:", e.message); // stays unsynced — retried silently in background
    }

    closeForm();
    loadCourses();
  }

  function startInlineEdit(course: any) {
    setInlineError(""); setDeleteId(null); setInlineEditId(course.id);
    setInlineForm({
      name: course.name, description: course.description,
      tuitionType: course.tuitionType || (course.amount > 0 ? "paid" : "free"),
      paidValue: course.tuitionType === "paid" ? formatCurrency(course.amount) : "",
      startDate: course.startDate, endDate: course.period || "", logo: course.logo ?? course.mediaUrl ?? ""
    });
  }

  function updateInlineForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setInlineForm(prev => ({ ...prev, [key]: value })); }

  function handleInlinePicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, (base64) => updateInlineForm("logo", base64));
    e.target.value = "";
  }

  async function saveInlineCourse(courseId: string) {
    if (!inlineForm.name.trim()) { setInlineError("Course name is required."); return; }
    const course: Course = {
      id: courseId, name: inlineForm.name, description: inlineForm.description,
      tuitionType: inlineForm.tuitionType, amount: inlineForm.tuitionType === "paid" ? (parseFloat(inlineForm.paidValue.replace(/,/g, "")) || 0) : 0,
      startDate: inlineForm.startDate, period: inlineForm.endDate, logo: inlineForm.logo,
      mediaUrl: inlineForm.logo, mediaType: "image", mediaName: "course-logo", createdAt: ""
    };

    await updateCourse(course);

    try {
      await apiFetch("/api/courses/update", {
        id: courseId, name: inlineForm.name, description: inlineForm.description || "",
        logo: inlineForm.logo || null, tuition_type: inlineForm.tuitionType || "free",
        amount: inlineForm.tuitionType === "paid" ? (parseFloat(inlineForm.paidValue.replace(/,/g, "")) || 0) : 0,
        start_date: inlineForm.startDate || null, period: inlineForm.endDate || null,
      }, "PUT");
      await db.courses.update(courseId, { synced: true });
    } catch (e: any) {
      console.warn("Course update sync failed:", e.message);
    }

    setInlineEditId(null);
    loadCourses();
  }

  async function removeCourse(id: string) {
    await deleteCourse(id); setDeleteId(null); if (inlineEditId === id) setInlineEditId(null);

    try { await apiFetch("/api/courses/delete", { id }); } catch (e: any) { console.warn("Course delete sync failed:", e.message); }

    loadCourses();
  }

  // ---- shared styles ----
  const iosInput: React.CSSProperties = { width: "100%", padding: "12px 16px", backgroundColor: "transparent", border: "none", fontSize: 17, color: C.textPrimary, outline: "none", fontFamily: iosFont, boxSizing: "border-box" as const };
  const groupHeader: React.CSSProperties = { fontSize: 13, color: C.textTertiary, padding: "22px 4px 8px", textTransform: "uppercase" as const, letterSpacing: "0.04em", fontWeight: 600 };
  const borderedPanel: React.CSSProperties = { ...panelBase, border: `1px solid ${C.separator}`, boxShadow: "none" };
  const toggleWrap: React.CSSProperties = { display: "flex", padding: 3, borderRadius: 10, background: C.separator, marginBottom: 16 };
  const toggleBtn = (active: boolean, color: string): React.CSSProperties => ({ flex: 1, padding: "10px 0", border: "none", borderRadius: 8, background: active ? color : "transparent", color: active ? "#FFFFFF" : C.textTertiary, fontSize: 15, fontWeight: 600, fontFamily: iosFont, cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: active ? `0 1px 6px ${color}44` : "none" });
  const paidInputVisible: React.CSSProperties = { maxHeight: 90, opacity: 1, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease, margin 0.3s ease", marginBottom: 16 };
  const paidInputHidden: React.CSSProperties = { maxHeight: 0, opacity: 0, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease, margin 0.3s ease", marginBottom: 0 };
  const dateRowStyle = (borderRight?: boolean): React.CSSProperties => ({ display: "flex", flexDirection: "column", flex: "1 1 min(150px, 100%)", borderRight: borderRight ? `0.5px solid ${C.separator}` : "none", minWidth: 0 });
  const dateLabelStyle: React.CSSProperties = { fontSize: 13, color: C.textTertiary, textTransform: "uppercase", fontWeight: 600, paddingLeft: 16, paddingTop: 12, paddingBottom: 2 };
  const dateInputStyle: React.CSSProperties = { width: "100%", padding: "6px 16px 12px 16px", backgroundColor: "transparent", border: "none", fontSize: 15, color: C.textPrimary, outline: "none", fontFamily: iosFont, boxSizing: "border-box" as const };

  function displayTuition(course: Course) { return course.tuitionType === "paid" ? formatCurrency(course.amount) : "Free"; }

  function calculateDuration(startDate: string, endDate: string) {
    if (!startDate || !endDate) return "TBD";
    const start = new Date(startDate); const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return "TBD";
    const diffDays = Math.ceil(Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "0 days";
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""}`;
    if (diffDays < 30) { const w = Math.floor(diffDays / 7); return `${w} week${w > 1 ? "s" : ""}`; }
    if (diffDays < 365) { const m = Math.floor(diffDays / 30); return `${m} month${m > 1 ? "s" : ""}`; }
    const y = Math.floor(diffDays / 365); return `${y} year${y > 1 ? "s" : ""}`;
  }

  const tuitionPill = (course: Course): React.CSSProperties => course.tuitionType === "paid"
    ? { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: C.paidBg, color: C.paidText, fontSize: 12, fontWeight: 700, letterSpacing: "0.2px" }
    : { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: C.freeBg, color: C.freeText, fontSize: 12, fontWeight: 700, letterSpacing: "0.2px" };
  const metaChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: C.metaText, fontWeight: 500 };
  const freeCount = courses.filter(c => c.tuitionType === "free").length;
  const paidCount = courses.filter(c => c.tuitionType === "paid").length;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: iosFont, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadLogo} />
      <input ref={inlinePicRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleInlinePicUpload} />

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 48px`, boxSizing: "border-box" }}>

        {/* PAGE HEADER — single action button, no Sync */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 700, letterSpacing: "0.37px", lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Course Management</h1>
            <p style={{ margin: "4px 0 0 0", color: C.textTertiary, fontSize: 15, fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Manage modules, schedules, and trainees</p>
          </div>
          <button onClick={handleToggleForm} style={{ height: 40, borderRadius: 10, border: "none", background: showForm ? C.red : C.blue, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 16px", fontSize: 15, fontWeight: 600, transition: "all 0.25s ease", boxShadow: `0 2px 8px ${showForm ? C.red + "33" : C.blue + "33"}`, flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
            {showForm ? "Close" : "New Course"}
          </button>
        </div>

        {/* STATS */}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", paddingTop: 20, paddingBottom: 24 }}>
          {isLoading ? (
            <><SkeletonStat /><SkeletonStat /><SkeletonStat /></>
          ) : (
            <>
              <Stat icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>} bg={C.medBlueBg} fg={C.medBlue} label="Total Modules" value={courses.length} />
              <Stat icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>} bg={C.freeBg} fg={C.freeText} label="Free Courses" value={freeCount} />
              <Stat icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>} bg={C.paidBg} fg={C.paidText} label="Paid Courses" value={paidCount} />
            </>
          )}
        </div>

        {/* CREATE FORM (animated) */}
        <div style={{ maxHeight: showForm ? 2600 : 0, overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1)", opacity: showForm ? 1 : 0, width: "100%" }}>
          <div style={groupHeader}>New Module</div>
          <div style={{ ...panelBase, marginBottom: 16 }}>
            <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Course Name" value={form.name} onChange={e => updateForm("name", e.target.value)} /></div>
            <div><textarea style={{ ...iosInput, resize: "none", minHeight: 80 }} placeholder="Description (Optional)" value={form.description} onChange={e => updateForm("description", e.target.value)} /></div>
          </div>

          <div style={groupHeader}>Pricing</div>
          <div style={toggleWrap}>
            <button type="button" style={toggleBtn(form.tuitionType === "free", C.green)} onClick={() => updateForm("tuitionType", "free")}>&#10003; Free</button>
            <button type="button" style={toggleBtn(form.tuitionType === "paid", C.orange)} onClick={() => updateForm("tuitionType", "paid")}>Paid</button>
          </div>
          <div style={form.tuitionType === "paid" ? paidInputVisible : paidInputHidden}>
            <div style={panelBase}>
              <input style={{ ...iosInput, color: C.paidText, fontWeight: 500 }} type="text" inputMode="decimal" placeholder="Enter price (e.g. 2,000,000)" value={form.paidValue} onChange={e => { updateForm("paidValue", e.target.value.replace(/[^0-9,\.]/g, '')); }} />
            </div>
          </div>

          <div style={groupHeader}>Schedule</div>
          <div style={{ ...panelBase, marginBottom: 16, display: "flex", flexWrap: "wrap" }}>
            <div style={dateRowStyle(true)}><div style={dateLabelStyle}>Start date</div><input style={dateInputStyle} type="date" value={form.startDate} onChange={e => updateForm("startDate", e.target.value)} /></div>
            <div style={dateRowStyle()}><div style={dateLabelStyle}>End date</div><input style={dateInputStyle} type="date" value={form.endDate} onChange={e => updateForm("endDate", e.target.value)} /></div>
          </div>

          <div style={{ ...groupHeader, paddingTop: 8 }}>Thumbnail</div>
          <div style={{ ...panelBase, marginBottom: 24 }}>
            <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", padding: 16, background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
              <div style={{ width: 50, height: 50, borderRadius: 12, background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {form.logo ? <img src={form.logo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
              </div>
              <div style={{ fontSize: 17, color: C.blue }}>Upload Thumbnail</div>
            </button>
          </div>

          <button onClick={saveCourse} style={{ width: "100%", background: C.blue, color: "#fff", border: "none", padding: 16, borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Create Module</button>
        </div>

        {/* LIST */}
        <div style={{ ...groupHeader, paddingTop: showForm ? 0 : 24 }}>All Courses</div>

        {isLoading ? (
          <SkeletonCardGrid />
        ) : courses.length === 0 ? (
          <div style={{ ...panelBase, padding: "40px 16px", textAlign: "center" }}><div style={{ color: C.textTertiary, fontSize: 15 }}>No Courses Yet</div></div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(360px, 100%), 1fr))", gap: 16, width: "100%", boxSizing: "border-box" }}>
            {courses.map((course: any) => {
              const details = courseDetails[course.id] || { trainer: null, trainees: [], schedules: [] };
              return (
                <div key={course.id} style={{ ...panelBase, display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", alignItems: "center", padding: 16, borderBottom: `0.5px solid ${C.separator}` }}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: course.logo || course.mediaUrl ? "transparent" : C.medBlueBg, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: course.logo || course.mediaUrl ? "0 2px 8px rgba(0,0,0,0.06)" : "none" }}>
                      {course.logo || course.mediaUrl ? <img src={course.logo ?? course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v6a6 6 0 0 0 12 0V2" /><path d="M6 5a2 2 0 0 1 2-2" /><path d="M18 5a2 2 0 0 0-2-2" /><circle cx="12" cy="14" r="2" /><path d="M10 16v2a4 4 0 0 0 8 0v-2" /></svg>}
                    </div>
                    <div style={{ flex: 1, marginLeft: 14, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <div style={{ fontSize: 17, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3, minWidth: 0 }}>{course.name}</div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                        <span style={tuitionPill(course)}>{course.tuitionType === "paid" ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>} {displayTuition(course)}</span>
                        {course.startDate && <span style={metaChip}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> {course.startDate}</span>}
                      </div>
                    </div>
                  </div>

                  <div style={{ padding: 16, flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
                    {inlineEditId === course.id ? (
                      <>
                        {inlineError && <div style={{ margin: "0 0 12px 0", padding: "10px 16px", background: C.red, color: "#fff", borderRadius: 10, fontSize: 14, fontWeight: 500, textAlign: "center" }}>{inlineError}</div>}
                        <div style={{ ...groupHeader, paddingTop: 0, paddingLeft: 0 }}>Thumbnail</div>
                        <div style={{ ...borderedPanel, marginBottom: 16 }}>
                          <button onClick={() => inlinePicRef.current?.click()} style={{ width: "100%", padding: 16, background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
                            <div style={{ width: 50, height: 50, borderRadius: 12, background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                              {inlineForm.logo ? <img src={inlineForm.logo} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
                            </div>
                            <div><div style={{ fontSize: 17, color: C.blue }}>Change Thumbnail</div><div style={{ fontSize: 13, color: C.textTertiary, marginTop: 2 }}>Tap to select</div></div>
                          </button>
                        </div>
                        <div style={{ ...groupHeader, paddingLeft: 0 }}>Course Details</div>
                        <div style={{ ...borderedPanel, marginBottom: 16 }}>
                          <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Course Name" value={inlineForm.name} onChange={e => { updateInlineForm("name", e.target.value); setInlineError(""); }} /></div>
                          <div><textarea style={{ ...iosInput, resize: "none", minHeight: 80 }} placeholder="Description" value={inlineForm.description} onChange={e => updateInlineForm("description", e.target.value)} /></div>
                        </div>
                        <div style={{ ...groupHeader, paddingLeft: 0 }}>Pricing</div>
                        <div style={{ ...toggleWrap, marginBottom: 16 }}>
                          <button type="button" style={toggleBtn(inlineForm.tuitionType === "free", C.green)} onClick={() => updateInlineForm("tuitionType", "free")}>&#10003; Free</button>
                          <button type="button" style={toggleBtn(inlineForm.tuitionType === "paid", C.orange)} onClick={() => updateInlineForm("tuitionType", "paid")}>Paid</button>
                        </div>
                        <div style={inlineForm.tuitionType === "paid" ? paidInputVisible : paidInputHidden}>
                          <div style={borderedPanel}>
                            <input style={{ ...iosInput, color: C.paidText, fontWeight: 500 }} type="text" inputMode="decimal" placeholder="Enter price (e.g. 2,000,000)" value={inlineForm.paidValue} onChange={e => { updateInlineForm("paidValue", e.target.value.replace(/[^0-9,\.]/g, '')); }} />
                          </div>
                        </div>
                        <div style={{ ...groupHeader, paddingLeft: 0 }}>Schedule</div>
                        <div style={{ ...borderedPanel, marginBottom: 24, display: "flex", flexWrap: "wrap" }}>
                          <div style={dateRowStyle(true)}><div style={dateLabelStyle}>Start date</div><input style={dateInputStyle} type="date" value={inlineForm.startDate} onChange={e => updateInlineForm("startDate", e.target.value)} /></div>
                          <div style={dateRowStyle()}><div style={dateLabelStyle}>End date</div><input style={dateInputStyle} type="date" value={inlineForm.endDate} onChange={e => updateInlineForm("endDate", e.target.value)} /></div>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, width: "100%", boxSizing: "border-box" }}>
                          <button onClick={() => saveInlineCourse(course.id)} style={{ flex: "1 1 min(160px, 100%)", background: C.blue, color: "#fff", border: "none", padding: 14, borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Save Changes</button>
                          <button onClick={() => setInlineEditId(null)} style={{ flex: "1 1 min(120px, 100%)", background: "transparent", color: C.blue, border: "none", padding: 14, borderRadius: 12, fontSize: 17, fontWeight: 400, cursor: "pointer" }}>Cancel</button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ display: "flex", flexDirection: "column", gap: 16, height: "100%", minWidth: 0 }}>
                          {details.trainer && (
                            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: C.purpleBg, color: C.purple, minWidth: 0 }}>
                              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 14, flexShrink: 0 }}>{details.trainer.username?.charAt(0).toUpperCase()}</div>
                              <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 600, opacity: 0.8 }}>Trainer</div><div style={{ fontSize: 15, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{details.trainer.username}</div><div style={{ fontSize: 12, opacity: 0.9, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{details.trainer.phone || "No phone"}</div></div>
                            </div>
                          )}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 12 }}>
                            <div style={{ padding: 12, borderRadius: 12, background: course.tuitionType === "paid" ? C.paidBg : C.freeBg, color: course.tuitionType === "paid" ? C.paidText : C.freeText }}><div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 600 }}>Tuition</div><div style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{displayTuition(course)}</div></div>
                            <div style={{ padding: 12, borderRadius: 12, background: C.medBlueBg, color: C.medBlue }}><div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 600 }}>Start Date</div><div style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{course.startDate || "TBD"}</div></div>
                            <div style={{ padding: 12, borderRadius: 12, background: C.medBlueBg, color: C.medBlue }}><div style={{ fontSize: 12, textTransform: "uppercase", fontWeight: 600 }}>Duration</div><div style={{ fontSize: 15, fontWeight: 500, marginTop: 4 }}>{calculateDuration(course.startDate, course.period)}</div></div>
                          </div>
                          {course.description && <div style={{ padding: 12, borderRadius: 12, background: C.inset, border: `1px solid ${C.separator}` }}><div style={{ fontSize: 12, color: C.textTertiary, textTransform: "uppercase", fontWeight: 600 }}>Details</div><div style={{ fontSize: 14, color: C.textSecondary, fontWeight: 500, lineHeight: 1.4, marginTop: 4 }}>{course.description}</div></div>}
                          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", gap: 16, flex: 1 }}>
                            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: C.textTertiary, marginBottom: 8, textTransform: "uppercase", fontWeight: 600 }}>Schedules ({details.schedules.length})</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                                {details.schedules.length > 0 ? details.schedules.map((sch) => (<div key={sch.id} style={{ padding: 10, borderRadius: 8, background: C.inset, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><div style={{ width: 28, height: 28, borderRadius: 6, background: C.orangeBg, color: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div><div style={{ minWidth: 0 }}><div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sch.title}</div><div style={{ fontSize: 11, color: C.textTertiary }}>{new Date(sch.scheduledAt).toLocaleString()}</div></div></div>)) : <div style={{ padding: 12, textAlign: "center", color: C.textTertiary, fontSize: 13, borderRadius: 8, background: C.inset }}>No schedules</div>}
                              </div>
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                              <div style={{ fontSize: 13, color: C.textTertiary, marginBottom: 8, textTransform: "uppercase", fontWeight: 600 }}>Trainees ({details.trainees.length})</div>
                              <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1 }}>
                                {details.trainees.length > 0 ? details.trainees.map((trainee) => (<div key={trainee.id} style={{ padding: 8, borderRadius: 8, background: C.inset, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}><div style={{ width: 28, height: 28, borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 12, flexShrink: 0 }}>{trainee.username?.charAt(0).toUpperCase()}</div><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trainee.username}</div><div style={{ fontSize: 11, color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trainee.phone || "No phone"}</div></div></div>)) : <div style={{ padding: 12, textAlign: "center", color: C.textTertiary, fontSize: 13, borderRadius: 8, background: C.inset }}>No trainees</div>}
                              </div>
                            </div>
                          </div>
                          <div style={{ display: "flex", gap: 12, marginTop: "auto", paddingTop: 16 }}>
                            <button onClick={() => startInlineEdit(course)} style={{ flex: 1, background: C.blue, color: "#fff", border: "none", padding: 12, borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Edit</button>
                            <button onClick={() => setDeleteId(course.id)} style={{ flex: 1, background: "transparent", color: C.red, border: `1px solid ${C.redBg}`, padding: 12, borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                          </div>
                          {deleteId === course.id && (
                            <div style={{ padding: 16, borderRadius: 12, background: C.redBg, border: `1px solid ${C.red}`, marginTop: 12 }}>
                              <div style={{ fontSize: 15, color: C.textPrimary, marginBottom: 12, textAlign: "center" }}>Delete this course permanently?</div>
                              <div style={{ display: "flex", gap: 12 }}>
                                <button style={{ flex: 1, background: C.red, color: "#fff", border: "none", padding: 10, borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" }} onClick={() => removeCourse(course.id)}>Delete</button>
                                <button style={{ flex: 1, background: "transparent", color: C.red, border: "none", padding: 10, borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer" }} onClick={() => setDeleteId(null)}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}