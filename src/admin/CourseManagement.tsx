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

async function pushUnsyncedCourses() {
  const unsynced = await db.courses.filter(c => !c.synced).toArray();
  if (unsynced.length === 0) return alert("All courses are already synced.");
  let pushed = 0;
  let failed = 0;
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
      pushed++;
    } catch (e: any) {
      failed++;
      console.error("Push failed for", course.name, e.message);
    }
  }
  alert(`Pushed ${pushed} courses.${failed > 0 ? ` ${failed} failed.` : ""}`);
  window.location.reload();
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

const INITIAL_FORM = { name: "", description: "", tuitionType: "free" as "free" | "paid", paidValue: "", startDate: "", endDate: "", logo: "" };

function SkeletonCardGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "0 16px", marginBottom: "20px", width: "100%", boxSizing: "border-box" }}>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} style={{ backgroundColor: C.card, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: `0.5px solid ${C.separator}` }}>
            <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }}></div>
            <div style={{ flex: 1, marginLeft: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              <div style={{ width: "60%", height: "16px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
              <div style={{ width: "30%", height: "12px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
            </div>
          </div>
          <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <div style={{ width: "80%", height: "40px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
            <div style={{ display: "flex", gap: "12px" }}>
              <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
              <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }}></div>
              <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.15s" }}></div>
            </div>
            <div style={{ width: "100%", height: "80px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.25s" }}></div>
            <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
              <div style={{ flex: 1, height: "44px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
              <div style={{ flex: 1, height: "44px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }}></div>
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

  useEffect(() => {
    loadCourses();
  }, []);

  useEffect(() => {
    const handleBackgroundSync = () => loadCourses();
    window.addEventListener("coursesChanged", handleBackgroundSync);
    window.addEventListener("dataSynced", handleBackgroundSync);
    return () => {
      window.removeEventListener("coursesChanged", handleBackgroundSync);
      window.removeEventListener("dataSynced", handleBackgroundSync);
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

      // STEP 2: Try Supabase to update in background
      if (tenantId) {
        try {
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

          // Save remote data to local DB for offline support
          for (const course of remoteCourses) {
            await db.courses.put(course);
          }

          // Use remote data if available, otherwise keep local
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
      console.warn("Course cloud sync failed:", e.message);
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

  const iosInput: React.CSSProperties = { width: "100%", padding: "12px 16px", backgroundColor: "transparent", border: "none", fontSize: "17px", color: C.textPrimary, outline: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", boxSizing: "border-box" as const };
  const iosGroupHeader: React.CSSProperties = { fontSize: "13px", color: C.textTertiary, paddingLeft: "16px", paddingRight: "16px", paddingTop: "24px", paddingBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "-0.08px", fontWeight: "400" };
  const toggleWrap: React.CSSProperties = { display: "flex", padding: "3px", borderRadius: "10px", background: C.separator, margin: "0 16px 16px 16px", width: "calc(100% - 32px)", boxSizing: "border-box" };
  const toggleBtn = (active: boolean, color: string): React.CSSProperties => ({ flex: 1, padding: "10px 0", border: "none", borderRadius: "8px", background: active ? color : "transparent", color: active ? "#FFFFFF" : C.textTertiary, fontSize: "15px", fontWeight: "600", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", cursor: "pointer", transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)", boxShadow: active ? `0 1px 6px ${color}44` : "none" });
  const paidInputVisible: React.CSSProperties = { maxHeight: "80px", opacity: 1, overflow: "hidden", transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease, margin 0.3s ease", margin: "0 16px 16px 16px", width: "calc(100% - 32px)", boxSizing: "border-box" };
  const paidInputHidden: React.CSSProperties = { maxHeight: "0", opacity: 0, overflow: "hidden", margin: "0 16px 0 16px", transition: "max-height 0.35s cubic-bezier(0.4,0,0.2,1), opacity 0.25s ease, margin 0.3s ease", width: "calc(100% - 32px)", boxSizing: "border-box" };
  const dateRowStyle = (borderRight?: boolean): React.CSSProperties => ({ display: "flex", flexDirection: "column", flex: "1 1 45%", borderRight: borderRight ? `0.5px solid ${C.separator}` : "none", minWidth: "150px" });
  const dateLabelStyle: React.CSSProperties = { fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", paddingLeft: "16px", paddingTop: "12px", paddingBottom: "2px" };
  const dateInputStyle: React.CSSProperties = { width: "100%", padding: "6px 16px 12px 16px", backgroundColor: "transparent", border: "none", fontSize: "15px", color: C.textPrimary, outline: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", boxSizing: "border-box" as const };

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
    ? { display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "6px", background: C.paidBg, color: C.paidText, fontSize: "12px", fontWeight: "700", letterSpacing: "0.2px" }
    : { display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "6px", background: C.freeBg, color: C.freeText, fontSize: "12px", fontWeight: "700", letterSpacing: "0.2px" };
  const metaChip: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px", color: C.metaText, fontWeight: "500" };
  const freeCount = courses.filter(c => c.tuitionType === "free").length;
  const paidCount = courses.filter(c => c.tuitionType === "paid").length;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: "40px" }}>
      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadLogo} />
      <input ref={inlinePicRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleInlinePicUpload} />
      <div style={{ width: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>

        <div style={{ padding: "24px 16px 16px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, width: "100%", boxSizing: "border-box" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "28px", fontWeight: "700", letterSpacing: "0.37px", lineHeight: 1.1 }}>Course Management</h1>
            <p style={{ margin: "4px 0 0 0", color: C.textTertiary, fontSize: "15px", fontWeight: "400" }}>Manage modules, schedules, and trainees</p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button onClick={pushUnsyncedCourses} title="Push unsynced courses to cloud" style={{ height: "40px", borderRadius: "10px", border: `1px solid ${C.greenBg}`, background: C.greenBg, color: C.green, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0 12px", fontSize: "14px", fontWeight: "600", transition: "all 0.25s ease" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
              Sync
            </button>
            <button onClick={handleToggleForm} style={{ height: "40px", borderRadius: "10px", border: "none", background: showForm ? C.red : C.blue, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0 16px", fontSize: "15px", fontWeight: "600", transition: "all 0.25s ease", boxShadow: `0 2px 8px ${showForm ? C.red + "33" : C.blue + "33"}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {showForm ? "Close" : "New Course"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", padding: "0 16px 24px 16px", width: "100%", boxSizing: "border-box", flexWrap: "wrap" }}>
          {isLoading ? (
            <>
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }}></div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
                    <div style={{ width: "60%", height: "12px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
                    <div style={{ width: "40%", height: "22px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
                  </div>
                </div>
              ))}
            </>
          ) : (
            <>
              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg></div>
                <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Total Modules</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{courses.length}</div></div>
              </div>
              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.freeBg, color: C.freeText, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg></div>
                <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Free Courses</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{freeCount}</div></div>
              </div>
              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.paidBg, color: C.paidText, display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg></div>
                <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Paid Courses</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{paidCount}</div></div>
              </div>
            </>
          )}
        </div>

        <div style={{ width: "100%", boxSizing: "border-box" }}>
          <div style={{ maxHeight: showForm ? "2000px" : "0", overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1)", opacity: showForm ? 1 : 0, width: "100%" }}>
            <div style={iosGroupHeader}>NEW MODULE</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Course Name" value={form.name} onChange={e => updateForm("name", e.target.value)} /></div>
              <div><textarea style={{ ...iosInput, resize: "none", minHeight: "80px" }} placeholder="Description (Optional)" value={form.description} onChange={e => updateForm("description", e.target.value)} /></div>
            </div>
            <div style={iosGroupHeader}>PRICING</div>
            <div style={toggleWrap}>
              <button type="button" style={toggleBtn(form.tuitionType === "free", C.green)} onClick={() => updateForm("tuitionType", "free")}>&#10003; Free</button>
              <button type="button" style={toggleBtn(form.tuitionType === "paid", C.orange)} onClick={() => updateForm("tuitionType", "paid")}>Paid</button>
            </div>
            <div style={form.tuitionType === "paid" ? paidInputVisible : paidInputHidden}>
              <div style={{ backgroundColor: C.card, borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <input style={{ ...iosInput, color: C.paidText, fontWeight: "500" }} type="text" inputMode="decimal" placeholder="Enter price (e.g. 2,000,000)" value={form.paidValue} onChange={e => { updateForm("paidValue", e.target.value.replace(/[^0-9,\.]/g, '')); }} />
              </div>
            </div>
            <div style={iosGroupHeader}>SCHEDULE</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexWrap: "wrap", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <div style={dateRowStyle(true)}><div style={dateLabelStyle}>Start date</div><input style={dateInputStyle} type="date" value={form.startDate} onChange={e => updateForm("startDate", e.target.value)} /></div>
              <div style={dateRowStyle()}><div style={dateLabelStyle}>End date</div><input style={dateInputStyle} type="date" value={form.endDate} onChange={e => updateForm("endDate", e.target.value)} /></div>
            </div>
            <div style={{ ...iosGroupHeader, paddingTop: "8px" }}>THUMBNAIL</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "24px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", padding: "16px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
                <div style={{ width: "50px", height: "50px", borderRadius: "12px", background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                  {form.logo ? <img src={form.logo} alt="Logo" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
                </div>
                <div style={{ fontSize: "17px", color: C.blue }}>Upload Thumbnail</div>
              </button>
            </div>
            <div style={{ padding: "0 16px", width: "100%", boxSizing: "border-box" }}>
              <button onClick={saveCourse} style={{ width: "100%", background: C.blue, color: "#fff", border: "none", padding: "16px", borderRadius: "12px", fontSize: "17px", fontWeight: "600", cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Create Module</button>
            </div>
          </div>

          <div style={{ ...iosGroupHeader, paddingTop: showForm ? "0px" : "24px" }}>ALL COURSES</div>

          {isLoading ? (
            <SkeletonCardGrid />
          ) : courses.length === 0 ? (
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", padding: "40px 16px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}><div style={{ color: C.textTertiary, fontSize: "15px" }}>No Courses Yet</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "0 16px", marginBottom: "20px", width: "100%", boxSizing: "border-box" }}>
              {courses.map((course: any) => {
                const details = courseDetails[course.id] || { trainer: null, trainees: [], schedules: [] };
                return (
                  <div key={course.id} style={{ backgroundColor: C.card, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: `0.5px solid ${C.separator}` }}>
                      <div style={{ width: "52px", height: "52px", borderRadius: "14px", background: course.logo || course.mediaUrl ? "transparent" : C.medBlueBg, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: course.logo || course.mediaUrl ? "0 2px 8px rgba(0,0,0,0.06)" : "none" }}>
                        {course.logo || course.mediaUrl ? <img src={course.logo ?? course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 2v6a6 6 0 0 0 12 0V2" /><path d="M6 5a2 2 0 0 1 2-2" /><path d="M18 5a2 2 0 0 0-2-2" /><circle cx="12" cy="14" r="2" /><path d="M10 16v2a4 4 0 0 0 8 0v-2" /></svg>}
                      </div>
                      <div style={{ flex: 1, marginLeft: "14px", minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontSize: "17px", fontWeight: "600", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.3 }}>{course.name}</div>
                          {course.synced === false && <span title="Not synced" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.orange, flexShrink: 0 }}></span>}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "6px", marginTop: "5px" }}>
                          <span style={tuitionPill(course)}>{course.tuitionType === "paid" ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg> : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>} {displayTuition(course)}</span>
                          {course.startDate && <span style={metaChip}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg> {course.startDate}</span>}
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: "16px", flex: 1 }}>
                      {inlineEditId === course.id ? (
                        <>
                          {inlineError && <div style={{ margin: "0 0 12px 0", padding: "10px 16px", background: C.red, color: "#fff", borderRadius: "10px", fontSize: "14px", fontWeight: "500", textAlign: "center" }}>{inlineError}</div>}
                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>THUMBNAIL</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                            <button onClick={() => inlinePicRef.current?.click()} style={{ width: "100%", padding: "16px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
                              <div style={{ width: "50px", height: "50px", borderRadius: "12px", background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                                {inlineForm.logo ? <img src={inlineForm.logo} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>}
                              </div>
                              <div><div style={{ fontSize: "17px", color: C.blue }}>Change Thumbnail</div><div style={{ fontSize: "13px", color: C.textTertiary, marginTop: "2px" }}>Tap to select</div></div>
                            </button>
                          </div>
                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>COURSE DETAILS</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                            <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Course Name" value={inlineForm.name} onChange={e => { updateInlineForm("name", e.target.value); setInlineError(""); }} /></div>
                            <div><textarea style={{ ...iosInput, resize: "none", minHeight: "80px" }} placeholder="Description" value={inlineForm.description} onChange={e => updateInlineForm("description", e.target.value)} /></div>
                          </div>
                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>PRICING</div>
                          <div style={{ ...toggleWrap, margin: "0 0 16px 0" }}>
                            <button type="button" style={toggleBtn(inlineForm.tuitionType === "free", C.green)} onClick={() => updateInlineForm("tuitionType", "free")}>&#10003; Free</button>
                            <button type="button" style={toggleBtn(inlineForm.tuitionType === "paid", C.orange)} onClick={() => updateInlineForm("tuitionType", "paid")}>Paid</button>
                          </div>
                          <div style={inlineForm.tuitionType === "paid" ? { ...paidInputVisible, margin: "0 0 16px 0" } : paidInputHidden}>
                            <div style={{ borderRadius: "12px", overflow: "hidden", border: `1px solid ${C.separator}` }}>
                              <input style={{ ...iosInput, color: C.paidText, fontWeight: "500" }} type="text" inputMode="decimal" placeholder="Enter price (e.g. 2,000,000)" value={inlineForm.paidValue} onChange={e => { updateInlineForm("paidValue", e.target.value.replace(/[^0-9,\.]/g, '')); }} />
                            </div>
                          </div>
                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>SCHEDULE</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "24px", border: `1px solid ${C.separator}`, display: "flex", flexWrap: "wrap" }}>
                            <div style={dateRowStyle(true)}><div style={dateLabelStyle}>Start date</div><input style={dateInputStyle} type="date" value={inlineForm.startDate} onChange={e => updateInlineForm("startDate", e.target.value)} /></div>
                            <div style={dateRowStyle()}><div style={dateLabelStyle}>End date</div><input style={dateInputStyle} type="date" value={inlineForm.endDate} onChange={e => updateInlineForm("endDate", e.target.value)} /></div>
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", width: "100%", boxSizing: "border-box" }}>
                            <button onClick={() => saveInlineCourse(course.id)} style={{ flex: "1 1 45%", background: C.blue, color: "#fff", border: "none", padding: "14px", borderRadius: "12px", fontSize: "17px", fontWeight: "600", cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Save Changes</button>
                            <button onClick={() => setInlineEditId(null)} style={{ flex: "1 1 45%", background: "transparent", color: C.blue, border: "none", padding: "14px 20px", borderRadius: "12px", fontSize: "17px", fontWeight: "400", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: "16px", height: "100%" }}>
                            {details.trainer && (
                              <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px", borderRadius: "12px", background: C.purpleBg, color: C.purple }}>
                                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "600", fontSize: "14px", flexShrink: 0 }}>{details.trainer.username?.charAt(0).toUpperCase()}</div>
                                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600", opacity: 0.8 }}>Trainer</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{details.trainer.username}</div><div style={{ fontSize: "12px", opacity: 0.9, marginTop: "2px" }}>{details.trainer.phone || "No phone"}</div></div>
                              </div>
                            )}
                            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                              <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: course.tuitionType === "paid" ? C.paidBg : C.freeBg, color: course.tuitionType === "paid" ? C.paidText : C.freeText }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Tuition</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{displayTuition(course)}</div></div>
                              <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.medBlueBg, color: C.medBlue }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Start Date</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{course.startDate || "TBD"}</div></div>
                              <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.medBlueBg, color: C.medBlue }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Duration</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{calculateDuration(course.startDate, course.period)}</div></div>
                            </div>
                            {course.description && <div style={{ padding: "12px", borderRadius: "12px", background: C.inset, border: `1px solid ${C.separator}` }}><div style={{ fontSize: "12px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600" }}>Details</div><div style={{ fontSize: "14px", color: C.textSecondary, fontWeight: "500", lineHeight: "1.4", marginTop: "4px" }}>{course.description}</div></div>}
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", flex: 1 }}>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: "13px", color: C.textTertiary, marginBottom: "8px", textTransform: "uppercase", fontWeight: "600" }}>Schedules ({details.schedules.length})</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                                  {details.schedules.length > 0 ? details.schedules.map((sch) => (<div key={sch.id} style={{ padding: "10px", borderRadius: "8px", background: C.inset, display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "28px", height: "28px", borderRadius: "6px", background: C.orangeBg, color: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div><div style={{ minWidth: 0 }}><div style={{ fontSize: "13px", fontWeight: "500", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sch.title}</div><div style={{ fontSize: "11px", color: C.textTertiary }}>{new Date(sch.scheduledAt).toLocaleString()}</div></div></div>)) : <div style={{ padding: "12px", textAlign: "center", color: C.textTertiary, fontSize: "13px", borderRadius: "8px", background: C.inset }}>No schedules</div>}
                                </div>
                              </div>
                              <div style={{ display: "flex", flexDirection: "column" }}>
                                <div style={{ fontSize: "13px", color: C.textTertiary, marginBottom: "8px", textTransform: "uppercase", fontWeight: "600" }}>Trainees ({details.trainees.length})</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
                                  {details.trainees.length > 0 ? details.trainees.map((trainee) => (<div key={trainee.id} style={{ padding: "8px", borderRadius: "8px", background: C.inset, display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: "600", fontSize: "12px", flexShrink: 0 }}>{trainee.username?.charAt(0).toUpperCase()}</div><div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: "13px", fontWeight: "500", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trainee.username}</div><div style={{ fontSize: "11px", color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{trainee.phone || "No phone"}</div></div></div>)) : <div style={{ padding: "12px", textAlign: "center", color: C.textTertiary, fontSize: "13px", borderRadius: "8px", background: C.inset }}>No trainees</div>}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: "flex", gap: "12px", marginTop: "auto", paddingTop: "16px" }}>
                              <button onClick={() => startInlineEdit(course)} style={{ flex: 1, background: C.blue, color: "#fff", border: "none", padding: "12px", borderRadius: "10px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }}>Edit</button>
                              <button onClick={() => setDeleteId(course.id)} style={{ flex: 1, background: "transparent", color: C.red, border: `1px solid ${C.redBg}`, padding: "12px", borderRadius: "10px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }}>Delete</button>
                            </div>
                            {deleteId === course.id && (
                              <div style={{ padding: "16px", borderRadius: "12px", background: C.redBg, border: `1px solid ${C.red}` }}>
                                <div style={{ fontSize: "15px", color: C.textPrimary, marginBottom: "12px", textAlign: "center" }}>Delete this course permanently?</div>
                                <div style={{ display: "flex", gap: "12px" }}>
                                  <button style={{ flex: 1, background: C.red, color: "#fff", border: "none", padding: "10px", borderRadius: "8px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }} onClick={() => removeCourse(course.id)}>Delete</button>
                                  <button style={{ flex: 1, background: "transparent", color: C.red, border: "none", padding: "10px", borderRadius: "8px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }} onClick={() => setDeleteId(null)}>Cancel</button>
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
    </div>
  );
}