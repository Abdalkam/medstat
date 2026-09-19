import { useEffect, useState, useRef } from "react";
import type { User, Course } from "../types";
import { getUsers, updateUser, deleteUser } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { deleteUserApi } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";

/* ── Color System (iOS inspired) ── */
const C = {
  textPrimary:   "#1C1C1E",
  textSecondary: "#3C3C43",
  textTertiary:  "#8E8E93",
  textQuaternary:"#AEAEB2",
  bg:           "#F2F2F7",
  card:         "#FFFFFF",
  inset:        "#F9F9FB",
  separator:    "#E5E5EA",
  headerGrad:   "#FAFAFA",
  blue:         "#007AFF",
  blueBg:       "#EBF2FF",
  green:        "#30D158",
  greenBg:      "#EAF9EE",
  orange:       "#FF9F0A",
  orangeBg:     "#FFF6EB",
  red:          "#FF3B30",
  redBg:        "#FFEFEE",
  purple:       "#AF52DE",
  purpleBg:     "#F5F0FF",
  medBlue:      "#0A84FF",
  medBlueBg:    "#E8F2FF",
  skeletonBase: "#E5E5EA",
};

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

function mapUserFromSupabase(u: any): User {
  return {
    ...u,
    assignedCourses: u.assigned_courses || [],
    profilePic: u.profile_pic || "",
    tuition: u.tuition || { expected: "0", paid: "0" },
    remuneration: u.remuneration || { netSalary: "0", perDiem: "0" },
    paymentHistory: u.payment_history || [],
    remunerationHistory: u.remuneration_history || [],
    synced: true,
  } as User;
}

function mapCourseFromSupabase(c: any): Course {
  return {
    ...c,
    tuitionType: c.tuition_type || "free",
    startDate: c.start_date || "",
    mediaUrl: c.logo || "",
  } as Course;
}

const INITIAL_FORM = {
  username: "", phone: "", email: "", password: "",
  role: "trainee" as "trainee" | "trainer", selectedCourses: [] as string[],
  profilePic: "" as string,
  expectedTuition: "",
  paidTuition: "",
  netSalary: "",
  perDiem: "",
};

function getAvatarColor(str: string) {
  const colors = ["#FF2D55", "#5856D6", "#007AFF", "#34C759", "#FF9500", "#AF52DE", "#0056CC", "#FF3B30"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function compressImage(file: File, setter: (val: string) => void) {
  const reader = new FileReader();
  reader.onloadend = () => {
    const img = new Image();
    img.src = reader.result as string;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const maxSize = 150;
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

async function pushUnsyncedUsers() {
  const unsynced = await db.users.filter(u => !u.synced && u.role !== "admin").toArray();
  if (unsynced.length === 0) return alert("All users are already synced.");

  let pushed = 0;
  let failed = 0;

  for (const user of unsynced) {
    try {
      await apiFetch("/api/users/upsert", {
        id: user.id,
        username: user.username,
        phone: user.phone || "",
        email: user.email || "",
        password: user.password,
        role: user.role,
        assigned_courses: user.assignedCourses || [],
        profile_pic: user.profilePic || null,
        tuition: { expected: parseFloat(String(user.tuition?.expected || "0").replace(/,/g, "")) || 0, paid: parseFloat(String(user.tuition?.paid || "0").replace(/,/g, "")) || 0 },
        remuneration: { net_salary: parseFloat(String(user.remuneration?.netSalary || "0").replace(/,/g, "")) || 0, per_diem: parseFloat(String(user.remuneration?.perDiem || "0").replace(/,/g, "")) || 0 },
      });
      await db.users.update(user.id, { synced: true });

      if (user.assignedCourses && user.assignedCourses.length > 0) {
        const enrollments = user.assignedCourses.map((courseId: string) => ({
          userId: user.id,
          courseId: courseId,
          status: "active",
        }));
        await apiFetch("/api/enrollments/sync", { enrollments }, "PUT");
      }

      pushed++;
    } catch (e: any) {
      failed++;
      console.error("Push failed for", user.username, e.message);
    }
  }

  alert(`Pushed ${pushed} users to cloud.${failed > 0 ? ` ${failed} failed — check console.` : ""}`);
}

function SkeletonStatCard() {
  return (
    <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
      <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }}></div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1 }}>
        <div style={{ width: "60%", height: "12px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
        <div style={{ width: "40%", height: "22px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
      </div>
    </div>
  );
}

function SkeletonUserCard() {
  return (
    <div style={{ backgroundColor: C.card, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: `0.5px solid ${C.separator}` }}>
        <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0, marginRight: "14px" }}></div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "8px" }}>
          <div style={{ width: "50%", height: "16px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
          <div style={{ width: "30%", height: "12px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
        </div>
      </div>
      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ width: "100%", height: "48px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
        <div style={{ display: "flex", gap: "12px" }}>
          <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.15s" }}></div>
          <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.25s" }}></div>
          <div style={{ flex: 1, height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
        </div>
        <div style={{ width: "100%", height: "60px", borderRadius: "12px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }}></div>
        <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
          <div style={{ flex: 1, height: "44px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
          <div style={{ flex: 1, height: "44px", borderRadius: "10px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.3s" }}></div>
        </div>
      </div>
    </div>
  );
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(INITIAL_FORM);
  const [isLoading, setIsLoading] = useState(true);

  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState(INITIAL_FORM);
  const [inlineError, setInlineError] = useState("");
  const inlinePicRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const tenantId = currentUser?.tenantId;

      let usersData: User[] = [];
      let coursesData: Course[] = [];

      // STEP 1: Try Supabase first
      if (tenantId) {
        try {
          const [usersRes, coursesRes] = await Promise.all([
            supabase.from("users").select("*").eq("tenant_id", tenantId),
            supabase.from("courses").select("*").eq("tenant_id", tenantId),
          ]);

          if (usersRes.data) {
            usersData = usersRes.data.map(mapUserFromSupabase);
          }
          if (coursesRes.data) {
            coursesData = coursesRes.data.map(mapCourseFromSupabase);
          }
        } catch (onlineError) {
          console.warn("Supabase fetch failed, using local DB", onlineError);
        }
      }

      // STEP 2: Fallback to local DB
      if (usersData.length === 0) {
        usersData = await getUsers();
      }
      if (coursesData.length === 0) {
        coursesData = await getCourses();
      }

      // Cache Supabase users to local DB for offline support
      if (tenantId && usersData.length > 0 && usersData[0].synced) {
        for (const user of usersData) {
          if (user.role !== "admin") {
            await db.users.put(user);
          }
        }
      }

      setUsers(usersData.filter((user) => user.role !== "admin"));
      setCourses(coursesData);
    } catch (error) {
      console.error("Failed to load data", error);
    } finally {
      setIsLoading(false);
    }
  }

  function isUsernameTaken(username: string, excludeId?: string): boolean {
    return users.some(u => u.username.trim().toLowerCase() === username.trim().toLowerCase() && u.id !== excludeId);
  }

  function isPhoneTaken(phone: string, excludeId?: string): boolean {
    if (!phone || phone.trim() === "") return false;
    return users.some(u => u.phone?.trim() === phone.trim() && u.id !== excludeId);
  }

  function updateForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setForm(prev => ({ ...prev, [key]: value })); }
  function toggleCourse(id: string) { setForm(prev => ({ ...prev, selectedCourses: prev.selectedCourses.includes(id) ? prev.selectedCourses.filter(c => c !== id) : [...prev.selectedCourses, id] })); }

  function handleToggleForm() {
    if (showForm) closeForm();
    else openCreateForm();
  }
  function openCreateForm() { setForm(INITIAL_FORM); setShowForm(true); }
  function closeForm() { setShowForm(false); setForm(INITIAL_FORM); }

  function uploadPic(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, (base64) => updateForm("profilePic", base64));
    e.target.value = "";
  }

  async function syncEnrollmentsToCloud(userId: string, courseIds: string[]) {
    if (courseIds.length === 0) return;
    try {
      const enrollments = courseIds.map(courseId => ({
        userId: userId,
        courseId: courseId,
        status: "active",
      }));
      await apiFetch("/api/enrollments/sync", { enrollments }, "PUT");
    } catch (e: any) {
      console.warn("Enrollment sync failed:", e.message);
    }
  }

  async function saveUser() {
    if (!form.username || !form.email || !form.password) { alert("Name, email, and password are required."); return; }
    if (isUsernameTaken(form.username)) { alert("Username already exists."); return; }
    if (isPhoneTaken(form.phone)) { alert("This phone number is already registered to another user in this business."); return; }

    const newUser: any = {
      id: crypto.randomUUID(),
      username: form.username.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      assignedCourses: form.selectedCourses,
      profilePic: form.profilePic,
      createdAt: new Date().toISOString(),
      tuition: { expected: form.expectedTuition, paid: form.paidTuition },
      remuneration: { netSalary: form.netSalary as any, perDiem: form.perDiem as any }
    };

    await (await import("../database/userDB")).addUser(newUser);

    try {
      await apiFetch("/api/users/upsert", {
        id: newUser.id, username: newUser.username, phone: newUser.phone, email: newUser.email,
        password: newUser.password, role: newUser.role, assigned_courses: newUser.assignedCourses,
        profile_pic: newUser.profilePic || null,
        tuition: { expected: parseFloat(form.expectedTuition.replace(/,/g, "")) || 0, paid: parseFloat(form.paidTuition.replace(/,/g, "")) || 0 },
        remuneration: { net_salary: parseFloat(form.netSalary.replace(/,/g, "")) || 0, per_diem: parseFloat(form.perDiem.replace(/,/g, "")) || 0 }
      });
      await db.users.update(newUser.id, { synced: true });
    } catch (err: any) {
      console.warn("Cloud sync failed:", err.message);
    }

    await syncEnrollmentsToCloud(newUser.id, newUser.assignedCourses);

    closeForm();
    loadData();
  }

  function startInlineEdit(user: any) {
    setInlineError("");
    setDeleteId(null);
    setInlineEditId(user.id);
    setInlineForm({
      username: user.username, phone: user.phone, email: user.email, password: "",
      role: user.role === "trainer" ? "trainer" : "trainee",
      selectedCourses: user.assignedCourses ?? [], profilePic: user.profilePic || "",
      expectedTuition: user.tuition?.expected ?? "", paidTuition: user.tuition?.paid ?? "",
      netSalary: user.remuneration?.netSalary ?? "", perDiem: user.remuneration?.perDiem ?? ""
    });
  }

  function updateInlineForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setInlineForm(prev => ({ ...prev, [key]: value })); }
  function toggleInlineCourse(id: string) { setInlineForm(prev => ({ ...prev, selectedCourses: prev.selectedCourses.includes(id) ? prev.selectedCourses.filter(c => c !== id) : [...prev.selectedCourses, id] })); }

  function handleInlinePicUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    compressImage(file, (base64) => updateInlineForm("profilePic", base64));
    e.target.value = "";
  }

  async function saveInlineUser(userId: string) {
    if (!inlineForm.username || !inlineForm.email) { setInlineError("Name and email are required."); return; }
    if (isUsernameTaken(inlineForm.username, userId)) { setInlineError("Username already exists."); return; }
    if (isPhoneTaken(inlineForm.phone, userId)) { setInlineError("This phone number is already registered to another user."); return; }

    const currentUser: any = users.find(u => u.id === userId);

    const finalPassword = inlineForm.password.trim() !== ""
      ? inlineForm.password.trim()
      : (currentUser?.password || "");

    const updatedUser: any = {
      id: userId,
      username: inlineForm.username.trim(),
      phone: inlineForm.phone.trim(),
      email: inlineForm.email.trim(),
      password: finalPassword,
      role: inlineForm.role,
      assignedCourses: inlineForm.selectedCourses,
      profilePic: inlineForm.profilePic,
      createdAt: currentUser?.createdAt || new Date().toISOString(),
      tuition: { expected: inlineForm.expectedTuition, paid: inlineForm.paidTuition },
      remuneration: { netSalary: inlineForm.netSalary as any, perDiem: inlineForm.perDiem as any }
    };

    await updateUser(updatedUser);

    try {
      await apiFetch("/api/users/update", {
        id: userId, username: updatedUser.username, phone: updatedUser.phone, email: updatedUser.email,
        password: finalPassword, role: updatedUser.role, assigned_courses: updatedUser.assignedCourses,
        profile_pic: updatedUser.profilePic || null,
        tuition: { expected: parseFloat(inlineForm.expectedTuition.replace(/,/g, "")) || 0, paid: parseFloat(inlineForm.paidTuition.replace(/,/g, "")) || 0 },
        remuneration: { net_salary: parseFloat(inlineForm.netSalary.replace(/,/g, "")) || 0, per_diem: parseFloat(inlineForm.perDiem.replace(/,/g, "")) || 0 }
      }, "PUT");
      await db.users.update(userId, { synced: true });
    } catch (err: any) {
      console.warn("Cloud sync failed:", err.message);
    }

    await syncEnrollmentsToCloud(userId, updatedUser.assignedCourses);

    setInlineEditId(null);
    loadData();
  }

  async function removeUser(id: string) {
    await deleteUser(id);
    try { await deleteUserApi(id); } catch (err: any) { console.warn("Cloud sync failed:", err.message); }
    setDeleteId(null);
    if (inlineEditId === id) setInlineEditId(null);
    loadData();
  }

  const iosInput: React.CSSProperties = { width: "100%", padding: "12px 16px", backgroundColor: "transparent", border: "none", fontSize: "17px", color: C.textPrimary, outline: "none", fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", boxSizing: "border-box" as const };
  const iosSelect: React.CSSProperties = { ...iosInput, appearance: "none" as const, color: form.role === "trainee" ? C.textPrimary : C.blue, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%23C7C7CC' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='9 18 15 12 9 6'%3E%3C/polyline%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 16px center", cursor: "pointer" };
  const iosGroupHeader: React.CSSProperties = { fontSize: "13px", color: C.textTertiary, paddingLeft: "16px", paddingRight: "16px", paddingTop: "24px", paddingBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "-0.08px", fontWeight: "400" };

  const traineeCount = users.filter(u => u.role === "trainee").length;
  const trainerCount = users.filter(u => u.role === "trainer").length;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif", display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: "40px" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPic} />
      <input ref={inlinePicRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleInlinePicUpload} />

      <div style={{ width: "100%", display: "flex", flexDirection: "column", boxSizing: "border-box" }}>
        <div style={{ padding: "24px 16px 16px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0, width: "100%", boxSizing: "border-box" }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "28px", fontWeight: "700", letterSpacing: "0.37px", lineHeight: 1.1 }}>User Management</h1>
            <p style={{ margin: "4px 0 0 0", color: C.textTertiary, fontSize: "15px", fontWeight: "400" }}>Manage trainers, trainees, and financials</p>
          </div>
          <div style={{ display: "flex", gap: "8px", flexShrink: 0 }}>
            <button onClick={pushUnsyncedUsers} title="Push all unsynced users to cloud" style={{ height: "40px", borderRadius: "10px", border: `1px solid ${C.greenBg}`, background: C.greenBg, color: C.green, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "6px", padding: "0 12px", fontSize: "14px", fontWeight: "600", transition: "all 0.25s ease" }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
              Sync
            </button>
            <button onClick={handleToggleForm} style={{ height: "40px", borderRadius: "10px", border: "none", background: showForm ? C.red : C.blue, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", padding: "0 16px", fontSize: "15px", fontWeight: "600", transition: "all 0.25s ease", boxShadow: `0 2px 8px ${showForm ? C.red + "33" : C.blue + "33"}` }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              {showForm ? "Close" : "New User"}
            </button>
          </div>
        </div>

        <div style={{ display: "flex", gap: "16px", padding: "0 16px 24px 16px", width: "100%", boxSizing: "border-box", flexWrap: "wrap" }}>
          {isLoading ? (
            <><SkeletonStatCard /><SkeletonStatCard /><SkeletonStatCard /></>
          ) : (
            <>
              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Total Users</div>
                  <div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{users.length}</div>
                </div>
              </div>

              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.purpleBg, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Trainers</div>
                  <div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{trainerCount}</div>
                </div>
              </div>

              <div style={{ flex: "1 1 180px", background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
                </div>
                <div>
                  <div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Trainees</div>
                  <div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{traineeCount}</div>
                </div>
              </div>
            </>
          )}
        </div>

        <div style={{ width: "100%", boxSizing: "border-box" }}>
          <div style={{ maxHeight: showForm ? "2000px" : "0", overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1)", opacity: showForm ? 1 : 0, width: "100%" }}>
            <div style={iosGroupHeader}>NEW ACCOUNT</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Full Name" value={form.username} onChange={e => updateForm("username", e.target.value)} /></div>
              <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Phone" type="tel" value={form.phone} onChange={e => updateForm("phone", e.target.value)} /></div>
              <div><input style={iosInput} placeholder="Email" type="email" value={form.email} onChange={e => updateForm("email", e.target.value)} /></div>
            </div>

            <div style={iosGroupHeader}>SECURITY</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Password" type="password" value={form.password} onChange={e => updateForm("password", e.target.value)} /></div>
              <div>
                <select style={{ ...iosSelect, color: form.role === "trainee" ? C.textPrimary : C.blue }} value={form.role} onChange={e => updateForm("role", e.target.value as "trainee" | "trainer")}><option value="trainee">Trainee</option><option value="trainer">Trainer</option></select>
              </div>
            </div>

            <div style={{ ...iosGroupHeader, paddingTop: "8px" }}>PROFILE PICTURE</div>
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
              <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", padding: "16px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
                <div style={{ width: "50px", height: "50px", borderRadius: "50%", background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                  {form.profilePic ? <img src={form.profilePic} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                </div>
                <div style={{ fontSize: "17px", color: C.blue }}>Upload Photo</div>
              </button>
            </div>

            {form.role === "trainee" ? (
              <div style={{ width: "100%", boxSizing: "border-box" }}>
                <div style={iosGroupHeader}>TUITION DETAILS</div>
                <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
                  <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Expected Tuition" value={form.expectedTuition} onChange={e => updateForm("expectedTuition", e.target.value)} /></div>
                  <div><input style={iosInput} placeholder="Amount Paid" value={form.paidTuition} onChange={e => updateForm("paidTuition", e.target.value)} /></div>
                </div>
              </div>
            ) : (
              <div style={{ width: "100%", boxSizing: "border-box" }}>
                <div style={iosGroupHeader}>REMUNERATION DETAILS</div>
                <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
                  <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Net Salary" value={form.netSalary} onChange={e => updateForm("netSalary", e.target.value)} /></div>
                  <div><input style={iosInput} placeholder="Per Diem" value={form.perDiem} onChange={e => updateForm("perDiem", e.target.value)} /></div>
                </div>
              </div>
            )}

            {courses.length > 0 && (<>
              <div style={iosGroupHeader}>COURSE ACCESS</div>
              <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", marginBottom: "24px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}>
                {courses.map((course, index) => (
                  <div key={course.id} style={{ padding: "12px 16px", backgroundColor: form.selectedCourses.includes(course.id) ? C.blueBg : C.card, borderBottom: index < courses.length - 1 ? `0.5px solid ${C.separator}` : "none", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onClick={() => toggleCourse(course.id)}>
                    <input type="checkbox" checked={form.selectedCourses.includes(course.id)} onChange={() => toggleCourse(course.id)} onClick={e => e.stopPropagation()} style={{ width: "22px", height: "22px", accentColor: C.blue, flexShrink: 0 }} />
                    <span style={{ fontSize: "17px", color: C.textPrimary, flex: 1 }}>{course.name}</span>
                  </div>
                ))}
              </div>
            </>)}

            <div style={{ padding: "0 16px", width: "100%", boxSizing: "border-box" }}>
              <button onClick={saveUser} style={{ width: "100%", background: C.blue, color: "#fff", border: "none", padding: "16px", borderRadius: "12px", fontSize: "17px", fontWeight: "600", cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Create Account</button>
            </div>
          </div>

          <div style={{ ...iosGroupHeader, paddingTop: showForm ? "0px" : "24px" }}>REGISTERED USERS</div>

          {isLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "0 16px", marginBottom: "20px", width: "100%", boxSizing: "border-box" }}>
              <SkeletonUserCard /><SkeletonUserCard /><SkeletonUserCard />
            </div>
          ) : users.length === 0 ? (
            <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", padding: "40px 16px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box" }}><div style={{ color: C.textTertiary, fontSize: "15px" }}>No Accounts Yet</div></div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "0 16px", marginBottom: "20px", width: "100%", boxSizing: "border-box" }}>
              {users.map((user: any) => {
                const parseNum = (val: any) => {
                  const str = String(val ?? "0").replace(/,/g, "").trim();
                  const num = parseFloat(str);
                  return isNaN(num) ? 0 : num;
                };

                const expected = parseNum(user.tuition?.expected);
                const paid = parseNum(user.tuition?.paid);
                const balance = expected - paid;

                let balanceBg = C.redBg;
                let balanceText = C.red;

                if (expected <= 0) {
                  balanceBg = C.inset;
                  balanceText = C.textTertiary;
                } else if (balance <= 0) {
                  balanceBg = C.greenBg;
                  balanceText = C.green;
                }

                const expectedStr = String(user.tuition?.expected || "0");
                const paidStr = String(user.tuition?.paid || "0");
                const netSalaryStr = String(user.remuneration?.netSalary || "0");
                const perDiemStr = String(user.remuneration?.perDiem || "0");
                const paymentHistory = user.paymentHistory || [];
                const remunerationHistory = user.remunerationHistory || [];

                return (
                  <div key={user.id} style={{ backgroundColor: C.card, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column" }}>

                    <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: `0.5px solid ${C.separator}` }}>
                      {user.profilePic ? (
                        <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: C.separator, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, marginRight: "14px", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
                          <img src={user.profilePic} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>
                      ) : (
                        <div style={{ width: "52px", height: "52px", borderRadius: "50%", background: getAvatarColor(user.username), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", fontWeight: "600", flexShrink: 0, marginRight: "14px" }}>{user.username.charAt(0).toUpperCase()}</div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ fontSize: "17px", color: C.textPrimary, fontWeight: "600", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
                          {user.synced === false && (
                            <span title="Not synced to cloud" style={{ width: "8px", height: "8px", borderRadius: "50%", background: C.orange, flexShrink: 0 }}></span>
                          )}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "5px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "6px", background: user.role === "trainer" ? C.purpleBg : C.greenBg, color: user.role === "trainer" ? C.purple : C.green, fontSize: "12px", fontWeight: "700", letterSpacing: "0.2px" }}>
                            {user.role === "trainer" ? "Trainer" : "Trainee"}
                          </span>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>{user.phone || "No phone"}</span>
                        </div>
                      </div>
                    </div>

                    <div style={{ padding: "16px", flex: 1 }}>
                      {inlineEditId === user.id ? (
                        <>
                          {inlineError && (<div style={{ margin: "0 0 12px 0", padding: "10px 16px", background: C.red, color: "#fff", borderRadius: "10px", fontSize: "14px", fontWeight: "500", textAlign: "center" }}>{inlineError}</div>)}

                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>PROFILE PICTURE</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                            <button onClick={() => inlinePicRef.current?.click()} style={{ width: "100%", padding: "16px", background: "transparent", border: "none", display: "flex", alignItems: "center", gap: "14px", cursor: "pointer", textAlign: "left", boxSizing: "border-box" }}>
                              <div style={{ width: "50px", height: "50px", borderRadius: "50%", background: C.inset, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                                {inlineForm.profilePic ? <img src={inlineForm.profilePic} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="1.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>}
                              </div>
                              <div>
                                <div style={{ fontSize: "17px", color: C.blue }}>Change Photo</div>
                                <div style={{ fontSize: "13px", color: C.textTertiary, marginTop: "2px" }}>Tap to select a new image</div>
                              </div>
                            </button>
                          </div>

                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>EDIT DETAILS</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                            <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Full Name" value={inlineForm.username} onChange={e => { updateInlineForm("username", e.target.value); setInlineError(""); }} /></div>
                            <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Phone" type="tel" value={inlineForm.phone} onChange={e => updateInlineForm("phone", e.target.value)} /></div>
                            <div><input style={iosInput} placeholder="Email" type="email" value={inlineForm.email} onChange={e => { updateInlineForm("email", e.target.value); setInlineError(""); }} /></div>
                          </div>

                          <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>SECURITY</div>
                          <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                            <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="New Password (leave blank to keep current)" type="password" value={inlineForm.password} onChange={e => { updateInlineForm("password", e.target.value); setInlineError(""); }} /></div>
                            <div>
                              <select style={{ ...iosSelect, color: inlineForm.role === "trainee" ? C.textPrimary : C.blue }} value={inlineForm.role} onChange={e => updateInlineForm("role", e.target.value as "trainee" | "trainer")}><option value="trainee">Trainee</option><option value="trainer">Trainer</option></select>
                            </div>
                          </div>

                          {inlineForm.role === "trainee" ? (
                            <div style={{ width: "100%", boxSizing: "border-box" }}>
                              <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>EDIT TUITION</div>
                              <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                                <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Expected Tuition" value={inlineForm.expectedTuition} onChange={e => updateInlineForm("expectedTuition", e.target.value)} /></div>
                                <div><input style={iosInput} placeholder="Amount Paid" value={inlineForm.paidTuition} onChange={e => updateInlineForm("paidTuition", e.target.value)} /></div>
                              </div>
                            </div>
                          ) : (
                            <div style={{ width: "100%", boxSizing: "border-box" }}>
                              <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>EDIT REMUNERATION</div>
                              <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                                <div style={{ borderBottom: `0.5px solid ${C.separator}` }}><input style={iosInput} placeholder="Net Salary" value={inlineForm.netSalary} onChange={e => updateInlineForm("netSalary", e.target.value)} /></div>
                                <div><input style={iosInput} placeholder="Per Diem" value={inlineForm.perDiem} onChange={e => updateInlineForm("perDiem", e.target.value)} /></div>
                              </div>
                            </div>
                          )}

                          {courses.length > 0 && (<>
                            <div style={{ ...iosGroupHeader, paddingLeft: "0" }}>COURSE ACCESS</div>
                            <div style={{ borderRadius: "12px", overflow: "hidden", marginBottom: "16px", border: `1px solid ${C.separator}` }}>
                              {courses.map((course, cIndex) => (
                                <div key={course.id} style={{ padding: "12px 16px", backgroundColor: inlineForm.selectedCourses.includes(course.id) ? C.blueBg : C.card, borderBottom: cIndex < courses.length - 1 ? `0.5px solid ${C.separator}` : "none", display: "flex", alignItems: "center", gap: "12px", cursor: "pointer" }} onClick={() => toggleInlineCourse(course.id)}>
                                  <input type="checkbox" checked={inlineForm.selectedCourses.includes(course.id)} onChange={() => toggleInlineCourse(course.id)} onClick={e => e.stopPropagation()} style={{ width: "22px", height: "22px", accentColor: C.blue, flexShrink: 0 }} />
                                  <span style={{ fontSize: "17px", color: C.textPrimary, flex: 1 }}>{course.name}</span>
                                </div>
                              ))}
                            </div>
                          </>)}

                          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", width: "100%", boxSizing: "border-box" }}>
                            <button onClick={() => saveInlineUser(user.id)} style={{ flex: "1 1 45%", background: C.blue, color: "#fff", border: "none", padding: "14px", borderRadius: "12px", fontSize: "17px", fontWeight: "600", cursor: "pointer", boxShadow: `0 1px 4px ${C.blue}33` }}>Save Changes</button>
                            <button onClick={() => setInlineEditId(null)} style={{ flex: "1 1 45%", background: "transparent", color: C.blue, border: "none", padding: "14px 20px", borderRadius: "12px", fontSize: "17px", fontWeight: "400", cursor: "pointer" }}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: "16px", height: "100%" }}>
                            <div style={{ padding: "12px", borderRadius: "12px", background: C.inset, border: `1px solid ${C.separator}` }}>
                              <div style={{ fontSize: "12px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600" }}>Date of Enrollment</div>
                              <div style={{ fontSize: "15px", color: C.textPrimary, fontWeight: "500", marginTop: "4px" }}>
                                {user.createdAt ? new Date(user.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : "Unknown"}
                              </div>
                            </div>

                            {user.role === "trainee" && (
                              <>
                                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                                  <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.blueBg, color: C.blue }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Expected</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{expectedStr}</div></div>
                                  <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.greenBg, color: C.green }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Paid</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{paidStr}</div></div>
                                  <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: balanceBg, color: balanceText }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Balance</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{expected <= 0 ? "N/A" : balance}</div></div>
                                </div>
                                <div>
                                  <div style={{ fontSize: "13px", color: C.textTertiary, marginBottom: "8px", textTransform: "uppercase", fontWeight: "600" }}>Payment Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {paymentHistory.length > 0 ? paymentHistory.map((p: any, i: number) => (
                                      <div key={i} style={{ padding: "10px", borderRadius: "8px", background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div><div style={{ fontSize: "13px", fontWeight: "500", color: C.textPrimary }}>{new Date(p.date).toLocaleString()}</div><div style={{ fontSize: "11px", color: C.textTertiary }}>{p.method}</div></div>
                                        <div style={{ fontSize: "14px", fontWeight: "600", color: C.green }}>{p.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: "12px", textAlign: "center", color: C.textTertiary, fontSize: "13px", borderRadius: "8px", background: C.inset }}>No payment records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            {user.role === "trainer" && (
                              <>
                                <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
                                  <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.purpleBg, color: C.purple }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Net Salary</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{netSalaryStr}</div></div>
                                  <div style={{ flex: "1 1 100px", padding: "12px", borderRadius: "12px", background: C.orangeBg, color: C.orange }}><div style={{ fontSize: "12px", textTransform: "uppercase", fontWeight: "600" }}>Per Diem</div><div style={{ fontSize: "15px", fontWeight: "500", marginTop: "4px" }}>{perDiemStr}</div></div>
                                </div>
                                <div>
                                  <div style={{ fontSize: "13px", color: C.textTertiary, marginBottom: "8px", textTransform: "uppercase", fontWeight: "600" }}>Remuneration Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                                    {remunerationHistory.length > 0 ? remunerationHistory.map((r: any, i: number) => (
                                      <div key={i} style={{ padding: "10px", borderRadius: "8px", background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                                        <div><div style={{ fontSize: "13px", fontWeight: "500", color: C.textPrimary }}>{new Date(r.date).toLocaleString()}</div><div style={{ fontSize: "11px", color: C.textTertiary }}>{r.type}</div></div>
                                        <div style={{ fontSize: "14px", fontWeight: "600", color: C.purple }}>{r.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: "12px", textAlign: "center", color: C.textTertiary, fontSize: "13px", borderRadius: "8px", background: C.inset }}>No remuneration records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            <div style={{ padding: "12px", borderRadius: "12px", background: C.inset, border: `1px solid ${C.separator}` }}>
                              <div style={{ fontSize: "12px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", marginBottom: "4px" }}>Contact</div>
                              <div style={{ fontSize: "14px", color: C.textSecondary, fontWeight: "500" }}>{user.email}</div>
                            </div>

                            <div style={{ display: "flex", gap: "12px", marginTop: "auto", paddingTop: "16px" }}>
                              <button onClick={() => startInlineEdit(user)} style={{ flex: 1, background: C.blue, color: "#fff", border: "none", padding: "12px", borderRadius: "10px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }}>Edit</button>
                              <button onClick={() => setDeleteId(user.id)} style={{ flex: 1, background: "transparent", color: C.red, border: `1px solid ${C.redBg}`, padding: "12px", borderRadius: "10px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }}>Delete</button>
                            </div>

                            {deleteId === user.id && (
                              <div style={{ padding: "16px", borderRadius: "12px", background: C.redBg, border: `1px solid ${C.red}` }}>
                                <div style={{ fontSize: "15px", color: C.textPrimary, marginBottom: "12px", textAlign: "center" }}>Delete this account permanently?</div>
                                <div style={{ display: "flex", gap: "12px" }}>
                                  <button style={{ flex: 1, background: C.red, color: "#fff", border: "none", padding: "10px", borderRadius: "8px", fontSize: "15px", fontWeight: "600", cursor: "pointer" }} onClick={() => removeUser(user.id)}>Delete</button>
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