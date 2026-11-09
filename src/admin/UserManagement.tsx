// src/admin/UserManagement.tsx — Google Material Design 3 Redesign — Expandable Rows Layout
// DIRECT-TO-SUPABASE REVISION: user create/update/delete go straight to the
// public.users table via the exported Supabase client (../auth/supabase).
// No localhost:3001 / Render backend in the data path. Fetch (loadData) was
// already direct and is unchanged.
import { useEffect, useState, useRef } from "react";
import type { User, Course } from "../types";
import { getUsers, updateUser, deleteUser, addUser, getRecentlyPushedUserIds, noteUserPushed } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { deleteUserApi } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getDeletedIds, purgeDeletedFromDexie } from "../database/deletedIdsTracker";

/* ================= MD3 COLOR TOKENS ================= */
const C = {
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  secondary: "#5F6368",
  secondaryContainer: "#E8EAED",
  tertiary: "#1E8E3E",
  tertiaryContainer: "#E6F4EA",
  error: "#D93025",
  errorContainer: "#F9DEDC",
  warning: "#F9AB00",
  warningContainer: "#FEF7E0",
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  surfaceVariant: "#E8EAED",
  background: "#F8F9FA",
  outline: "#DADCE0",
  outlineVariant: "#BDC1C6",
  skeletonBase: "#E8EAED",
  textPrimary: "#202124",
  textSecondary: "#3C4043",
  textTertiary: "#5F6368",
  textQuaternary: "#80868B",
  bg: "#F8F9FA",
  card: "#FFFFFF",
  inset: "#F1F3F4",
  separator: "#DADCE0",
  separatorLight: "#E8EAED",
  blue: "#1A73E8",
  blueBg: "#D3E3FD",
  green: "#1E8E3E",
  greenBg: "#E6F4EA",
  orange: "#E37400",
  orangeBg: "#FEF7E0",
  red: "#D93025",
  redBg: "#F9DEDC",
  purple: "#8430CE",
  purpleBg: "#F3E8FD",
  medBlue: "#1A73E8",
  medBlueBg: "#D3E3FD",
};

const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const S = {
  level1: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  level2: "0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)",
  level3: "0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)",
  card: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  cardHover: "0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)",
};

const R = { sm: 8, md: 12, lg: 16, xl: 28 };

const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1400;

const cardBase: React.CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  border: "1px solid " + C.outline,
  boxSizing: "border-box",
  minWidth: 0,
};

const motion = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

/**
 * Builds a row matching the public.users schema exactly (snake_case columns,
 * tuition/remuneration jsonb stored as numbers).
 * phone/email are sent as NULL when empty: the partial unique index
 * uniq_user_phone_active (phone) WHERE deleted_at IS NULL treats '' as a real
 * value, so two phone-less users would collide — multiple NULLs are allowed.
 */
function mapUserToSupabase(user: any, mode: "insert" | "update" = "insert") {
  const row: Record<string, any> = {
    username: user.username,
    phone: user.phone?.trim() ? user.phone.trim() : null,
    email: user.email?.trim() ? user.email.trim() : null,
    password: user.password,
    role: user.role,
    assigned_courses: user.assignedCourses ?? [],
    profile_pic: user.profilePic || null,
    tuition: {
      expected: toAmount(user.tuition?.expected),
      paid: toAmount(user.tuition?.paid),
    },
    remuneration: {
      net_salary: toAmount(user.remuneration?.netSalary),
      per_diem: toAmount(user.remuneration?.perDiem),
    },
    synced: true,
  };
  if (mode === "insert") {
    row.id = user.id;
    row.tenant_id = user.tenantId || user.tenant_id || "";
    if (user.createdAt) row.created_at = user.createdAt;
  }
  return row;
}

/**
 * Soft-delete straight in Supabase (matches the deleted_at design of the
 * schema). Idempotent — safe to call even if userDB's own cloud delete
 * already succeeded. loadData() filters deleted_at is null, so the row
 * disappears from every device on the next pull.
 */
async function softDeleteUserInCloud(id: string) {
  const { error } = await supabase
    .from("users")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

function mapUserFromSupabase(u: any): User {
  const remuneration = u.remuneration || {};
  return {
    ...u,
    tenantId: u.tenant_id || u.tenantId || "",
    createdAt: u.created_at || u.createdAt || "",
    assignedCourses: u.assigned_courses || u.assignedCourses || [],
    profilePic: u.profile_pic || u.profilePic || "",
    tuition: u.tuition || { expected: "0", paid: "0" },
    remuneration: {
      netSalary: remuneration.net_salary ?? remuneration.netSalary ?? "0",
      perDiem: remuneration.per_diem ?? remuneration.perDiem ?? "0",
    },
    paymentHistory: u.payment_history || u.paymentHistory || [],
    remunerationHistory: u.remuneration_history || u.remunerationHistory || [],
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
  username: "",
  phone: "",
  email: "",
  password: "",
  role: "trainee" as "trainee" | "trainer",
  selectedCourses: [] as string[],
  profilePic: "" as string,
  expectedTuition: "",
  paidTuition: "",
  netSalary: "",
  perDiem: "",
};

function getAvatarColor(str: string) {
  const colors = ["#1A73E8", "#D93025", "#1E8E3E", "#E37400", "#8430CE", "#5F6368", "#C5221F", "#12AFDA"];
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

function toAmount(value: unknown): number {
  const parsed = parseFloat(String(value ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Writes go straight to the public.users table in Supabase (browser client).
 * The row is marked synced only after the upsert is accepted. The enrolment
 * copy is best-effort: assigned_courses (the authoritative course-access list)
 * is already stored on the user row itself, so a missing/mismatched
 * enrollments table must not leave every user stuck "pending" forever.
 */
async function pushUserToCloud(
  user: any,
  syncEnrollments: (userId: string, courseIds: string[]) => Promise<void>
): Promise<void> {
  const { error } = await supabase
    .from("users")
    .upsert(mapUserToSupabase(user, "insert"), { onConflict: "id" });
  if (error) throw new Error(error.message);

  try {
    await syncEnrollments(user.id, user.assignedCourses || []);
  } catch (e) {
    console.warn("Enrolment copy failed (user row is still synced):", e);
  }

  await db.users.update(user.id, { synced: true });
  noteUserPushed(user.id);
}

async function pushUnsyncedUsersSilently(
  syncEnrollments: (userId: string, courseIds: string[]) => Promise<void>
): Promise<{ pushed: number; failed: number }> {
  let pushed = 0;
  let failed = 0;

  try {
    const unsynced = await db.users
      .filter((u) => !u.synced && u.role !== "admin")
      .toArray();

    for (const user of unsynced) {
      try {
        await pushUserToCloud(user, syncEnrollments);
        pushed++;
      } catch (error) {
        failed++;
        console.warn(`User ${user.id} remains pending cloud sync:`, error);
      }
    }
  } catch (error) {
    console.warn("Could not read pending users from local database:", error);
  }

  return { pushed, failed };
}

function StatCard({ icon, label, value, bg, fg, valueColor, delay }: {
  icon: React.ReactNode; label: string; value: string | number; bg: string; fg: string; valueColor?: string; delay?: number;
}) {
  return (
    <div style={{ ...cardBase, padding: "clamp(12px, 2vw, 16px)", display: "flex", alignItems: "center", gap: 12, animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both", animationDelay: (delay ?? 0) + "ms" }}>
      <div style={{ width: 40, height: 40, borderRadius: R.sm, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em", lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        <div style={{ fontSize: "clamp(16px, 3.4vw, 22px)", fontWeight: 500, color: valueColor || C.onSurface, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      </div>
    </div>
  );
}

function SkeletonStat() {
  return (
    <div style={{ ...cardBase, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: R.sm, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: "55%", height: 10, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "75%", height: 18, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", minHeight: 56, borderBottom: "1px solid " + C.outline }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0, marginRight: 12 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ width: "40%", height: 14, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "60%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "20px 4px 8px" }}>
      <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, letterSpacing: "0.01em" }}>{title}</span>
    </div>
  );
}

function OutlinedField({ label, onChange, style, ...rest }: {
  label: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; style?: React.CSSProperties; [key: string]: any;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em" }}>{label}</label>
      <input
        {...rest}
        onChange={onChange}
        style={{
          width: "100%", padding: "12px 16px", backgroundColor: "transparent",
          border: "1px solid " + C.outline, borderRadius: R.sm, fontSize: 14, color: C.onSurface,
          outline: "none", fontFamily: font, boxSizing: "border-box", minHeight: 48,
          transition: "border-color 0.15s ease", ...style,
        }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.primary; (rest.onFocus as any)?.(e); }}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.outline; (rest.onBlur as any)?.(e); }}
      />
    </div>
  );
}

function RoleSegmentedButton({ value, onChange }: { value: "trainee" | "trainer"; onChange: (v: "trainee" | "trainer") => void; }) {
  const options: { key: "trainee" | "trainer"; label: string }[] = [{ key: "trainee", label: "Trainee" }, { key: "trainer", label: "Trainer" }];
  return (
    <div style={{ display: "inline-flex", border: "1px solid " + C.outline, borderRadius: R.xl, overflow: "hidden" }}>
      {options.map((opt, i) => {
        const active = value === opt.key;
        return (
          <button key={opt.key} onClick={() => onChange(opt.key)} style={{ border: "none", borderLeft: i > 0 ? "1px solid " + C.outline : "none", background: active ? C.primary : "transparent", color: active ? C.onPrimary : C.onSurface, padding: "8px 20px", fontSize: 14, fontWeight: active ? 500 : 400, fontFamily: font, cursor: "pointer", minHeight: 40, transition: motion, letterSpacing: "0.01em" }}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: R.sm, background: bg, color: fg, fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
  );
}

function useSnackbar() {
  const [snack, setSnack] = useState<{ message: string; color: string } | null>(null);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const show = (message: string, color: string = C.primary) => { if (timer) clearTimeout(timer); setSnack({ message, color }); const t = setTimeout(() => setSnack(null), 3000); setTimer(t); };
  const success = (message: string) => show(message, C.green);
  const error = (message: string) => show(message, C.red);
  return { snack, show, success, error };
}

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [form, setForm] = useState(INITIAL_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [inlineForm, setInlineForm] = useState(INITIAL_FORM);
  const [inlineError, setInlineError] = useState("");
  const inlinePicRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const snack = useSnackbar();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Sequence guard: only the most recent loadData() may write to state.
  // Overlapping loads (mount + online/dataSynced listeners + post-save reload)
  // otherwise race, and a slow stale response can paint a list WITHOUT a
  // freshly created user — one cause of "new users seen on and off".
  const loadSeqRef = useRef(0);

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    const onOnline = () => loadData();
    window.addEventListener("online", onOnline);
    window.addEventListener("dataSynced", onOnline as EventListener);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("dataSynced", onOnline as EventListener); };
  }, []);

  async function loadData() {
    const seq = ++loadSeqRef.current;
    const isStale = () => seq !== loadSeqRef.current;
    try {
      const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
      const tenantId = currentUser?.tenantId || currentUser?.tenant_id;
      let usersData: User[] = [];
      let coursesData: Course[] = [];
      try { usersData = await getUsers(); coursesData = await getCourses(); } catch (e) { /* ignore */ }
      if (!isStale()) {
        setUsers(usersData.filter((user) => user.role !== "admin"));
        setCourses(coursesData);
        setIsLoading(false);
      }
      if (tenantId && navigator.onLine) {
        try {
          await pushUnsyncedUsersSilently(syncEnrollmentsToCloud);

          // FIX: Query Supabase with .is("deleted_at", null) to exclude soft-deleted rows
          const [usersRes, coursesRes] = await Promise.all([
            supabase.from("users").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
            supabase.from("courses").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
          ]);

          // Supabase can return { data: null, error } without throwing.
          // Do not treat an authorization/schema error as an empty cloud dataset.
          if (usersRes.error) throw usersRes.error;
          if (coursesRes.error) throw coursesRes.error;

          // FIX: Pre-load tombstoned IDs to skip deleted items
          const deletedUserIds = new Set(await getDeletedIds("user"));
          const deletedCourseIds = new Set(await getDeletedIds("course"));

          let remoteUsers: User[] = [];
          let remoteCourses: Course[] = [];
          if (usersRes.data) { remoteUsers = usersRes.data.map(mapUserFromSupabase); }
          if (coursesRes.data) { remoteCourses = coursesRes.data.map(mapCourseFromSupabase); }

          // FIX: Skip users that are tombstoned (permanently deleted) before putting into Dexie
          for (const user of remoteUsers) {
            if (user.role !== "admin" && !deletedUserIds.has(user.id)) {
              await db.users.put(user);
            }
          }

          // FIX: Skip courses that are tombstoned before putting into Dexie
          for (const course of remoteCourses) {
            if (!deletedCourseIds.has(course.id)) {
              await db.courses.put(course);
            }
          }

          // FIX: Defensively purge any tombstoned items that snuck into Dexie
          await purgeDeletedFromDexie();

          // FIX: Filter tombstoned items from React state — same filter applied to Dexie above
          const visibleRemoteUsers = remoteUsers.filter(u => u.role !== "admin" && !deletedUserIds.has(u.id));
          const visibleRemoteCourses = remoteCourses.filter(c => !deletedCourseIds.has(c.id));

          // FIX: MERGE local + remote instead of replacing local with remote.
          // Previously: `visibleRemoteUsers.length > 0 ? visibleRemoteUsers : local`
          // meant ANY remote result threw away local-only users — so a user whose
          // cloud upsert failed (offline, or API cold-start) vanished from the list
          // the moment the remote query returned other users, then reappeared after
          // a later successful sync: "newly created users seen on and off".
          // Rules:
          //   - remote wins for ids the server knows about
          //   - local users NOT yet synced (created/edited here, cloud confirm
          //     still pending) always stay visible
          //   - synced-but-absent-remotely rows stay hidden (deleted on another device)
          const remoteUserIds = new Set(visibleRemoteUsers.map((u) => u.id));
          // Read-after-write lag shield: a user whose cloud push was confirmed
          // moments ago counts as cloud-known even if THIS pull does not return
          // it yet (Supabase replication lag). Without this, a just-created/
          // edited user vanished for one refresh and popped back on the next.
          const recentPushIds = new Set(await getRecentlyPushedUserIds());
          const pendingLocalUsers = usersData.filter(
            (u) => u.role !== "admin" && !deletedUserIds.has(u.id) && !remoteUserIds.has(u.id) && (!u.synced || recentPushIds.has(u.id))
          );
          const finalUsers = [...visibleRemoteUsers, ...pendingLocalUsers];
          // A successful empty cloud result is authoritative too; do not resurrect
          // stale local courses merely because the remote table currently has none.
          const finalCourses = visibleRemoteCourses;
          if (!isStale()) {
            setUsers(finalUsers);
            setCourses(finalCourses);
          }
        } catch (onlineError) { console.warn("Supabase fetch failed, using local DB", onlineError); }
      }
    } catch (error) { console.error("Failed to load data", error); } finally { setIsLoading(false); }
  }

  function isUsernameTaken(username: string, excludeId?: string): boolean { return users.some(u => u.username.trim().toLowerCase() === username.trim().toLowerCase() && u.id !== excludeId); }
  function isPhoneTaken(phone: string, excludeId?: string): boolean { if (!phone || phone.trim() === "") return false; return users.some(u => u.phone?.trim() === phone.trim() && u.id !== excludeId); }
  function updateForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setForm(prev => ({ ...prev, [key]: value })); }
  function toggleCourse(id: string) { setForm(prev => ({ ...prev, selectedCourses: prev.selectedCourses.includes(id) ? prev.selectedCourses.filter(c => c !== id) : [...prev.selectedCourses, id] })); }
  function handleToggleForm() { if (showForm) closeForm(); else openCreateForm(); }
  function openCreateForm() { setForm(INITIAL_FORM); setShowForm(true); }
  function closeForm() { setShowForm(false); setForm(INITIAL_FORM); }
  function uploadPic(e: React.ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (!file) return; compressImage(file, (base64) => updateForm("profilePic", base64)); e.target.value = ""; }

  async function syncEnrollmentsToCloud(userId: string, courseIds: string[]) {
    // Writes the normalized enrolment rows directly to Supabase. Requires the
    // public.enrollments table (see the setup SQL). Callers treat failures as
    // best-effort: assigned_courses on the user row is the source of truth.
    if (courseIds.length === 0) return;
    const sessionUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = sessionUser?.tenantId || sessionUser?.tenant_id || "";
    const rows = courseIds.map(courseId => ({
      tenant_id: tenantId,
      user_id: userId,
      course_id: courseId,
      status: "active",
    }));
    const { error } = await supabase
      .from("enrollments")
      .upsert(rows, { onConflict: "user_id,course_id" });
    if (error) throw new Error(error.message);
  }

  async function saveUser() {
    if (!form.username || !form.email || !form.password) { snack.error("Name, email, and password are required."); return; }
    if (isUsernameTaken(form.username)) { snack.error("Username already exists."); return; }
    if (isPhoneTaken(form.phone)) { snack.error("This phone number is already registered to another user."); return; }
    // synced:false makes the pending state explicit — if the cloud upsert below
    // fails, loadData() keeps this user visible (local-pending merge) until a
    // later pushUnsyncedUsersSilently() confirms it in the cloud.
    const sessionUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = sessionUser?.tenantId || sessionUser?.tenant_id || "";
    const newUser: any = {
      id: crypto.randomUUID(),
      tenantId,
      tenant_id: tenantId,
      username: form.username.trim(),
      phone: form.phone.trim(),
      email: form.email.trim(),
      password: form.password,
      role: form.role,
      assignedCourses: form.selectedCourses,
      profilePic: form.profilePic,
      createdAt: new Date().toISOString(),
      synced: false,
      tuition: { expected: form.expectedTuition, paid: form.paidTuition },
      remuneration: { netSalary: form.netSalary, perDiem: form.perDiem },
    };
    // addUser() now runs the tenant-scoped duplicate guard at DB level too —
    // surface its error instead of letting it bubble unhandled.
    try {
      await addUser(newUser);
    } catch (err: any) {
      snack.error(err?.message || "Could not create user.");
      return;
    }
    let cloudSaved = false;
    try {
      await pushUserToCloud(newUser, syncEnrollmentsToCloud);
      cloudSaved = true;
    } catch (err: any) {
      console.warn("User saved locally; Supabase sync is pending:", err);
    }
    snack.show(
      cloudSaved
        ? "User created and synchronised with Supabase."
        : "User saved on this device. Cloud synchronisation is pending.",
      cloudSaved ? C.green : C.warning
    );
    closeForm();
    // Search affects CRUD: drop any active filter so the newly created user is immediately visible
    setSearchQuery("");
    loadData();
  }

  function startInlineEdit(user: any) {
    setInlineError(""); setDeleteId(null); setInlineEditId(user.id); setExpandedId(user.id);
    setInlineForm({ username: user.username, phone: user.phone, email: user.email, password: "", role: user.role === "trainer" ? "trainer" : "trainee", selectedCourses: user.assignedCourses ?? [], profilePic: user.profilePic || "", expectedTuition: user.tuition?.expected ?? "", paidTuition: user.tuition?.paid ?? "", netSalary: user.remuneration?.netSalary ?? "", perDiem: user.remuneration?.perDiem ?? "" });
  }

  function updateInlineForm<K extends keyof typeof INITIAL_FORM>(key: K, value: (typeof INITIAL_FORM)[K]) { setInlineForm(prev => ({ ...prev, [key]: value })); }
  function toggleInlineCourse(id: string) { setInlineForm(prev => ({ ...prev, selectedCourses: prev.selectedCourses.includes(id) ? prev.selectedCourses.filter(c => c !== id) : [...prev.selectedCourses, id] })); }
  function handleInlinePicUpload(e: React.ChangeEvent<HTMLInputElement>) { const file = e.target.files?.[0]; if (!file) return; compressImage(file, (base64) => updateInlineForm("profilePic", base64)); e.target.value = ""; }

  async function saveInlineUser(userId: string) {
    if (!inlineForm.username || !inlineForm.email) { setInlineError("Name and email are required."); return; }
    if (isUsernameTaken(inlineForm.username, userId)) { setInlineError("Username already exists."); return; }
    if (isPhoneTaken(inlineForm.phone, userId)) { setInlineError("This phone number is already registered to another user."); return; }
    const currentUser: any = users.find(u => u.id === userId);
    const finalPassword = inlineForm.password.trim() !== "" ? inlineForm.password.trim() : (currentUser?.password || "");
    const updatedUser: any = {
      ...currentUser,
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
      remuneration: { netSalary: inlineForm.netSalary, perDiem: inlineForm.perDiem },
      synced: false,
    };
    // Persist locally first. If the cloud write fails, synced remains false so
    // the automatic retry can push this exact version when the API is reachable.
    await updateUser({ ...updatedUser, synced: false });
    let cloudSaved = false;
    try {
      const { error } = await supabase
        .from("users")
        .update(mapUserToSupabase(updatedUser, "update"))
        .eq("id", userId);
      if (error) throw new Error(error.message);
      try {
        await syncEnrollmentsToCloud(userId, updatedUser.assignedCourses);
      } catch (e) {
        console.warn("Enrolment copy failed (user row is still synced):", e);
      }
      await db.users.update(userId, { synced: true });
      noteUserPushed(userId);
      cloudSaved = true;
    } catch (err: any) {
      console.warn("User updated locally; Supabase sync is pending:", err);
    }
    snack.show(
      cloudSaved
        ? "Changes saved and synchronised with Supabase."
        : "Changes saved on this device. Cloud synchronisation is pending.",
      cloudSaved ? C.green : C.warning
    );
    setInlineEditId(null);
    // Search affects CRUD: if the update no longer matches the active filter, clear it
    // so the edited row stays visible instead of silently dropping out of the list
    if (!matchesUserSearch(updatedUser, searchQuery)) setSearchQuery("");
    loadData();
  }

  async function removeUser(id: string) {
    // Soft-delete straight in Supabase FIRST — independent of userDB's own
    // delete, which may still try a backend endpoint and fail. Idempotent,
    // so the cloud row is tombstoned either way and cannot reappear.
    try { await softDeleteUserInCloud(id); } catch (err: any) { console.warn("Cloud soft-delete skipped:", err.message); }
    try {
      // deleteUser() handles local delete + tombstone (+ its own cloud delete)
      await deleteUser(id);
    } catch (err: any) {
      // Local delete + tombstone inside deleteUser() still applied even if its
      // cloud step failed; the row above is already soft-deleted in Supabase.
      console.warn("Delete warning:", err.message);
      snack.error("User deleted. Cloud cleanup will retry automatically.");
      setDeleteId(null); setExpandedId(null); if (inlineEditId === id) setInlineEditId(null); loadData();
      return;
    }
    // Also remove from Supabase Auth (best effort — may not exist if user was never auth'd)
    try { await deleteUserApi(id); } catch (err: any) { console.warn("Auth cleanup skipped:", err.message); }
    snack.success("User deleted"); setDeleteId(null); setExpandedId(null); if (inlineEditId === id) setInlineEditId(null); loadData();
  }

  const traineeCount = users.filter(u => u.role === "trainee").length;
  const trainerCount = users.filter(u => u.role === "trainer").length;
  // Search predicate — single source of truth so CRUD results stay consistent with the visible (filtered) list
  function matchesUserSearch(u: any, query: string): boolean { if (!query) return true; const q = query.toLowerCase(); return (u.username || "").toLowerCase().includes(q) || (u.email || "").toLowerCase().includes(q) || (u.phone || "").toLowerCase().includes(q) || (u.role || "").toLowerCase().includes(q); }
  const filteredUsers = users.filter((u: any) => matchesUserSearch(u, searchQuery));

  const chevronSvg = <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.onSurfaceVariant} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>;
  const checkSvg = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.onPrimary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
  const userIconSvg = <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.onSurfaceVariant} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{"@keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } } @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } } @keyframes snackbarIn { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } } @keyframes ripple { from { transform: scale(0); opacity: 0.12; } to { transform: scale(4); opacity: 0; } } @keyframes expandSpring { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }"}</style>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPic} />
      <input ref={inlinePicRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleInlinePicUpload} />

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: "16px " + gutter + " clamp(20px, 4vh, 44px)", boxSizing: "border-box" }}>

        {/* PAGE HEADER */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 10, gap: 12, width: "100%", animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.onSurface, fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>User Management</h1>
            <p style={{ margin: "4px 0 0 0", color: C.onSurfaceVariant, fontSize: 14, fontWeight: 400, letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Manage trainers, trainees, and financials</p>
          </div>

          {/* SEARCH — in line with the Add button (Google Workspace style) */}
          {!isLoading && users.length > 0 && (
            <div style={{ position: "relative", flex: "1 1 280px", minWidth: 220, maxWidth: 420, height: 40, boxSizing: "border-box" }}>
              <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.onSurfaceVariant }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="text" placeholder="Search users by name, email, phone, or role…" value={searchQuery} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)} style={{ width: "100%", height: 40, paddingLeft: 40, paddingRight: searchQuery ? 40 : 14, backgroundColor: C.surface, border: "1px solid " + C.outline, borderRadius: R.xl, fontSize: 14, color: C.onSurface, outline: "none", fontFamily: font, boxSizing: "border-box", transition: "border-color 0.2s ease" }} onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.primary; }} onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.outline; }} />
              {searchQuery && <button onClick={() => setSearchQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "transparent", color: C.onSurfaceVariant, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontSize: 14, transition: "background 0.15s ease" }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = C.surfaceVariant; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; }}>×</button>}
            </div>
          )}
          <button onClick={handleToggleForm} style={{ height: 40, borderRadius: R.xl, border: "none", background: showForm ? C.error : C.primary, color: C.onPrimary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "0 20px", fontSize: 14, fontWeight: 500, fontFamily: font, boxShadow: showForm ? S.level1 : S.level2, flexShrink: 0, transition: motion, letterSpacing: "0.01em" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{showForm ? <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></> : <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>}</svg>
            {showForm ? "Close" : "New User"}
          </button>
        </div>

        {/* STAT CARDS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))", gap: 12, paddingTop: 16, width: "100%", boxSizing: "border-box" }}>
          {isLoading ? <><SkeletonStat /><SkeletonStat /><SkeletonStat /></> : (
            <>
              <StatCard icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>} bg={C.medBlueBg} fg={C.medBlue} label="Total Users" value={users.length} delay={0} />
              <StatCard icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>} bg={C.purpleBg} fg={C.purple} label="Trainers" value={trainerCount} delay={50} />
              <StatCard icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>} bg={C.greenBg} fg={C.green} label="Trainees" value={traineeCount} delay={100} />
            </>
          )}
        </div>

        {/* CREATE FORM */}
        <div style={{ maxHeight: showForm ? 4000 : 0, overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease", opacity: showForm ? 1 : 0, width: "100%" }}>
          <SectionHeader title="New Account" />
          <div style={{ ...cardBase, padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <OutlinedField label="Full Name" placeholder="Enter full name" value={form.username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("username", e.target.value)} />
            <OutlinedField label="Phone" placeholder="Enter phone number" type="tel" value={form.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("phone", e.target.value)} />
            <OutlinedField label="Email" placeholder="Enter email address" type="email" value={form.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("email", e.target.value)} />
          </div>
          <SectionHeader title="Security" />
          <div style={{ ...cardBase, padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
            <OutlinedField label="Password" placeholder="Enter password" type="password" value={form.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("password", e.target.value)} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em" }}>Role</label>
              <RoleSegmentedButton value={form.role} onChange={v => updateForm("role", v)} />
            </div>
          </div>
          <SectionHeader title="Profile Picture" />
          <div style={{ ...cardBase, padding: 20, marginBottom: 16 }}>
            <button onClick={() => fileInputRef.current?.click()} style={{ width: "100%", padding: 16, background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", textAlign: "left", boxSizing: "border-box", borderRadius: R.sm, transition: motion }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.surfaceVariant, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                {form.profilePic ? <img src={form.profilePic} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : userIconSvg}
              </div>
              <div style={{ fontSize: 14, color: C.primary, fontWeight: 500, letterSpacing: "0.01em" }}>Upload Photo</div>
            </button>
          </div>
          {form.role === "trainee" ? (
            <>
              <SectionHeader title="Tuition Details" />
              <div style={{ ...cardBase, padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                <OutlinedField label="Expected Tuition" placeholder="Enter expected tuition" value={form.expectedTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("expectedTuition", e.target.value)} />
                <OutlinedField label="Amount Paid" placeholder="Enter amount paid" value={form.paidTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("paidTuition", e.target.value)} />
              </div>
            </>
          ) : (
            <>
              <SectionHeader title="Remuneration Details" />
              <div style={{ ...cardBase, padding: 20, marginBottom: 16, display: "flex", flexDirection: "column", gap: 16 }}>
                <OutlinedField label="Net Salary" placeholder="Enter net salary" value={form.netSalary} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("netSalary", e.target.value)} />
                <OutlinedField label="Per Diem" placeholder="Enter per diem" value={form.perDiem} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateForm("perDiem", e.target.value)} />
              </div>
            </>
          )}
          {courses.length > 0 && (
            <>
              <SectionHeader title="Course Access" />
              <div style={{ ...cardBase, padding: 16, marginBottom: 24, display: "flex", flexDirection: "column" }}>
                {courses.map((course, index) => (
                  <div key={course.id} style={{ padding: "12px 16px", backgroundColor: form.selectedCourses.includes(course.id) ? C.primaryContainer : "transparent", borderBottom: index < courses.length - 1 ? "1px solid " + C.outline : "none", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background 0.15s ease", minHeight: 48 }} onClick={() => toggleCourse(course.id)} onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!form.selectedCourses.includes(course.id)) e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!form.selectedCourses.includes(course.id)) e.currentTarget.style.background = "transparent"; }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, border: form.selectedCourses.includes(course.id) ? "none" : "2px solid " + C.outlineVariant, background: form.selectedCourses.includes(course.id) ? C.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: motion }}>
                      {form.selectedCourses.includes(course.id) && checkSvg}
                    </div>
                    <span style={{ fontSize: 14, color: form.selectedCourses.includes(course.id) ? C.onPrimaryContainer : C.onSurface, fontWeight: form.selectedCourses.includes(course.id) ? 500 : 400, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <button onClick={saveUser} style={{ width: "100%", background: C.primary, color: C.onPrimary, border: "none", padding: "14px 24px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", boxShadow: S.level1, minHeight: 48, letterSpacing: "0.01em", transition: motion }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level2; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level1; }}>Create Account</button>
        </div>

        {/* REGISTERED USERS LIST — Expandable Rows */}
        <div style={{ paddingTop: showForm ? 0 : 8 }}>
          <SectionHeader title={searchQuery ? "Results (" + filteredUsers.length + ")" : "Registered Users"} />
        </div>

        {isLoading ? (
          <div style={{ borderRadius: R.md, overflow: "hidden", boxShadow: S.level1, border: "1px solid " + C.outline, background: C.surface, width: "100%", boxSizing: "border-box" }}>
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
        ) : users.length === 0 ? (
          <div style={{ background: C.surface, borderRadius: R.lg, border: "1px dashed " + C.outlineVariant, padding: "32px 16px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14, boxSizing: "border-box" }}>No Accounts Yet</div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ background: C.surface, borderRadius: R.lg, border: "1px dashed " + C.outlineVariant, padding: "32px 16px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14, boxSizing: "border-box" }}>No users match &quot;{searchQuery}&quot;</div>
        ) : (
          <div style={{ borderRadius: R.md, overflow: "hidden", boxShadow: S.level1, border: "1px solid " + C.outline, background: C.surface, width: "100%", boxSizing: "border-box" }}>
            {filteredUsers.map((user: any, userIndex: number) => {
              const isExpanded = expandedId === user.id;
              const isEditing = inlineEditId === user.id;
              const parseNum = (val: any) => { const str = String(val ?? "0").replace(/,/g, "").trim(); const num = parseFloat(str); return isNaN(num) ? 0 : num; };
              const expected = parseNum(user.tuition?.expected);
              const paid = parseNum(user.tuition?.paid);
              const balance = expected - paid;
              let balanceBg = C.redBg; let balanceText = C.red;
              if (expected <= 0) { balanceBg = C.inset; balanceText = C.onSurfaceVariant; } else if (balance <= 0) { balanceBg = C.greenBg; balanceText = C.green; }
              const expectedStr = String(user.tuition?.expected || "0");
              const paidStr = String(user.tuition?.paid || "0");
              const netSalaryStr = String(user.remuneration?.netSalary || "0");
              const perDiemStr = String(user.remuneration?.perDiem || "0");
              const paymentHistory = user.paymentHistory || [];
              const remunerationHistory = user.remunerationHistory || [];

              return (
                <div key={user.id} style={{ animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both", animationDelay: (userIndex * 30) + "ms" }}>
                  {/* COLLAPSED ROW — MD3 touch feedback */}
                  <div
                    onClick={(e: React.MouseEvent<HTMLDivElement>) => {
                      if (isEditing) return;
                      // MD3 ripple effect — spawn transient overlay at click point
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const y = e.clientY - rect.top;
                      const ripple = document.createElement("div");
                      ripple.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:40px;height:40px;margin-left:-20px;margin-top:-20px;border-radius:50%;background:${C.primary};pointer-events:none;animation:ripple 0.6s cubic-bezier(0.2,0,0,1) forwards;`;
                      e.currentTarget.appendChild(ripple);
                      setTimeout(() => ripple.remove(), 600);
                      if (isExpanded) { setExpandedId(null); } else { setExpandedId(user.id); }
                    }}
                    style={{ display: "flex", alignItems: "center", padding: "12px 16px", minHeight: 56, background: isExpanded ? C.primaryContainer : C.surface, borderBottom: "1px solid " + C.outline, cursor: isEditing ? "default" : "pointer", transition: "background 0.2s cubic-bezier(0.2,0,0,1), box-shadow 0.2s ease", boxSizing: "border-box", width: "100%", position: "relative", overflow: "hidden" }}
                    onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.background = C.surfaceVariant; e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(26,115,232,0.08)"; } }}
                    onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded) { e.currentTarget.style.background = C.surface; e.currentTarget.style.boxShadow = "none"; } else { e.currentTarget.style.boxShadow = "none"; } }}
                    onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(26,115,232,0.12)"; } }}
                    onMouseUp={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(26,115,232,0.08)"; } }}
                  >
                    {/* Avatar */}
                    {user.profilePic ? (
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.surfaceVariant, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, marginRight: 12 }}>
                        <img src={user.profilePic} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: getAvatarColor(user.username), color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500, flexShrink: 0, marginRight: 12 }}>{user.username.charAt(0).toUpperCase()}</div>
                    )}
                    {/* Center content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2, flexWrap: "wrap", minWidth: 0 }}>
                        <Chip label={user.role === "trainer" ? "Trainer" : "Trainee"} bg={user.role === "trainer" ? C.purpleBg : C.greenBg} fg={user.role === "trainer" ? C.purple : C.green} />
                        <span style={{ fontSize: 13, color: C.onSurfaceVariant, fontWeight: 400, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{user.phone || user.email || ""}</span>
                      </div>
                    </div>
                    {/* Chevron — MD3 spring bounce */}
                    <div style={{ flexShrink: 0, marginLeft: 8, transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)" }}>
                      {chevronSvg}
                    </div>
                  </div>

                  {/* EXPANDED SECTION — MD3 spring ease-out */}
                  <div style={{ maxHeight: isExpanded ? 2000 : 0, overflow: "hidden", opacity: isExpanded ? 1 : 0, transition: "max-height 0.45s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s cubic-bezier(0.2,0,0,1)", background: C.surface, borderBottom: isExpanded ? "1px solid " + C.outline : "none", animation: isExpanded ? "expandSpring 0.35s cubic-bezier(0.2,0,0,1) both" : "none" }}>
                    <div style={{ padding: "16px 16px 20px", boxSizing: "border-box" }}>
                      {isEditing ? (
                        <>
                          {inlineError && <div style={{ margin: "0 0 12px 0", padding: "10px 16px", background: C.errorContainer, color: C.error, borderRadius: R.sm, fontSize: 13, fontWeight: 500, textAlign: "center", border: "1px solid " + C.error }}>{inlineError}</div>}
                          <SectionHeader title="Profile Picture" />
                          <div style={{ ...cardBase, padding: 16, marginBottom: 12, boxShadow: "none" }}>
                            <button onClick={() => inlinePicRef.current?.click()} style={{ width: "100%", padding: 12, background: "transparent", border: "none", display: "flex", alignItems: "center", gap: 14, cursor: "pointer", textAlign: "left", boxSizing: "border-box", borderRadius: R.sm, transition: motion }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; }}>
                              <div style={{ width: 48, height: 48, borderRadius: "50%", background: C.surfaceVariant, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
                                {inlineForm.profilePic ? <img src={inlineForm.profilePic} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : userIconSvg}
                              </div>
                              <div>
                                <div style={{ fontSize: 14, color: C.primary, fontWeight: 500, letterSpacing: "0.01em" }}>Change Photo</div>
                                <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>Tap to select a new image</div>
                              </div>
                            </button>
                          </div>
                          <SectionHeader title="Edit Details" />
                          <div style={{ ...cardBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                            <OutlinedField label="Full Name" placeholder="Enter full name" value={inlineForm.username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("username", e.target.value); setInlineError(""); }} />
                            <OutlinedField label="Phone" placeholder="Enter phone number" type="tel" value={inlineForm.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("phone", e.target.value)} />
                            <OutlinedField label="Email" placeholder="Enter email address" type="email" value={inlineForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("email", e.target.value); setInlineError(""); }} />
                          </div>
                          <SectionHeader title="Security" />
                          <div style={{ ...cardBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                            <OutlinedField label="New Password (leave blank to keep current)" placeholder="Enter new password" type="password" value={inlineForm.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("password", e.target.value); setInlineError(""); }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <label style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em" }}>Role</label>
                              <RoleSegmentedButton value={inlineForm.role} onChange={v => updateInlineForm("role", v)} />
                            </div>
                          </div>
                          {inlineForm.role === "trainee" ? (
                            <>
                              <SectionHeader title="Edit Tuition" />
                              <div style={{ ...cardBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                                <OutlinedField label="Expected Tuition" placeholder="Enter expected tuition" value={inlineForm.expectedTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("expectedTuition", e.target.value)} />
                                <OutlinedField label="Amount Paid" placeholder="Enter amount paid" value={inlineForm.paidTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("paidTuition", e.target.value)} />
                              </div>
                            </>
                          ) : (
                            <>
                              <SectionHeader title="Edit Remuneration" />
                              <div style={{ ...cardBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                                <OutlinedField label="Net Salary" placeholder="Enter net salary" value={inlineForm.netSalary} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("netSalary", e.target.value)} />
                                <OutlinedField label="Per Diem" placeholder="Enter per diem" value={inlineForm.perDiem} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("perDiem", e.target.value)} />
                              </div>
                            </>
                          )}
                          {courses.length > 0 && (
                            <>
                              <SectionHeader title="Course Access" />
                              <div style={{ ...cardBase, padding: 16, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column" }}>
                                {courses.map((course, cIndex) => (
                                  <div key={course.id} style={{ padding: "12px 16px", backgroundColor: inlineForm.selectedCourses.includes(course.id) ? C.primaryContainer : "transparent", borderBottom: cIndex < courses.length - 1 ? "1px solid " + C.outline : "none", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background 0.15s ease", minHeight: 48 }} onClick={() => toggleInlineCourse(course.id)} onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!inlineForm.selectedCourses.includes(course.id)) e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!inlineForm.selectedCourses.includes(course.id)) e.currentTarget.style.background = "transparent"; }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 4, border: inlineForm.selectedCourses.includes(course.id) ? "none" : "2px solid " + C.outlineVariant, background: inlineForm.selectedCourses.includes(course.id) ? C.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: motion }}>
                                      {inlineForm.selectedCourses.includes(course.id) && checkSvg}
                                    </div>
                                    <span style={{ fontSize: 14, color: inlineForm.selectedCourses.includes(course.id) ? C.onPrimaryContainer : C.onSurface, fontWeight: inlineForm.selectedCourses.includes(course.id) ? 500 : 400, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, width: "100%", boxSizing: "border-box" }}>
                            <button onClick={() => saveInlineUser(user.id)} style={{ flex: "1 1 min(160px, 100%)", background: C.primary, color: C.onPrimary, border: "none", padding: "12px 24px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", boxShadow: S.level1, minHeight: 48, letterSpacing: "0.01em", transition: motion }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level2; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level1; }}>Save Changes</button>
                            <button onClick={() => { setInlineEditId(null); setInlineError(""); }} style={{ flex: "1 1 min(120px, 100%)", background: "transparent", color: C.primary, border: "1px solid " + C.outline, padding: "12px 24px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", minHeight: 48, letterSpacing: "0.01em", transition: motion }}>Cancel</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                            {/* Date of Enrollment */}
                            <div style={{ padding: 12, borderRadius: R.sm, background: C.inset, border: "1px solid " + C.outline }}>
                              <div style={{ fontSize: 11, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.04em" }}>Date of Enrollment</div>
                              <div style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, marginTop: 4 }}>{user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Unknown"}</div>
                            </div>

                            {/* Trainee financials */}
                            {user.role === "trainee" && (
                              <>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 12 }}>
                                  <div style={{ padding: 12, borderRadius: R.sm, background: C.blueBg, color: C.blue }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.7 }}>EXPECTED</div>
                                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{expectedStr}</div>
                                  </div>
                                  <div style={{ padding: 12, borderRadius: R.sm, background: C.greenBg, color: C.green }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.7 }}>PAID</div>
                                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{paidStr}</div>
                                  </div>
                                  <div style={{ padding: 12, borderRadius: R.sm, background: balanceBg, color: balanceText }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.7 }}>BALANCE</div>
                                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{expected <= 0 ? "N/A" : balance}</div>
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Payment Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                                    {paymentHistory.length > 0 ? paymentHistory.map((p: any, i: number) => (
                                      <div key={i} style={{ padding: 10, borderRadius: R.sm, background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: C.onSurface }}>{new Date(p.date).toLocaleString()}</div>
                                          <div style={{ fontSize: 11, color: C.onSurfaceVariant }}>{p.method}</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: C.green, flexShrink: 0 }}>{p.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: 12, textAlign: "center", color: C.onSurfaceVariant, fontSize: 13, borderRadius: R.sm, background: C.inset }}>No payment records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            {/* Trainer financials */}
                            {user.role === "trainer" && (
                              <>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 12 }}>
                                  <div style={{ padding: 12, borderRadius: R.sm, background: C.purpleBg, color: C.purple }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.7 }}>NET SALARY</div>
                                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{netSalaryStr}</div>
                                  </div>
                                  <div style={{ padding: 12, borderRadius: R.sm, background: C.orangeBg, color: C.orange }}>
                                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", opacity: 0.7 }}>PER DIEM</div>
                                    <div style={{ fontSize: 14, fontWeight: 500, marginTop: 4 }}>{perDiemStr}</div>
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Remuneration Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                                    {remunerationHistory.length > 0 ? remunerationHistory.map((r: any, i: number) => (
                                      <div key={i} style={{ padding: 10, borderRadius: R.sm, background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: C.onSurface }}>{r.date ? new Date(r.date).toLocaleString() : "\u2014"}</div>
                                          <div style={{ fontSize: 11, color: C.onSurfaceVariant }}>{r.method || r.type || "Payment"}</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: C.purple, flexShrink: 0 }}>{r.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: 12, textAlign: "center", color: C.onSurfaceVariant, fontSize: 13, borderRadius: R.sm, background: C.inset }}>No remuneration records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            {/* Assigned Courses */}
                            {user.assignedCourses && user.assignedCourses.length > 0 && (
                              <div>
                                <div style={{ fontSize: 11, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Assigned Courses</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {user.assignedCourses.map((courseId: string) => {
                                    const course = courses.find((c: any) => c.id === courseId);
                                    if (!course) return null;
                                    return <Chip key={courseId} label={course.name} bg={C.blueBg} fg={C.blue} />;
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Edit / Delete buttons */}
                            <div style={{ display: "flex", gap: 12, paddingTop: 8 }}>
                              <button onClick={() => startInlineEdit(user)} style={{ flex: 1, background: C.primary, color: C.onPrimary, border: "none", padding: "12px 24px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", minHeight: 48, letterSpacing: "0.01em", transition: motion, boxShadow: S.level1 }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level2; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.boxShadow = S.level1; }}>Edit</button>
                              <button onClick={() => setDeleteId(user.id)} style={{ flex: 1, background: "transparent", color: C.error, border: "1px solid " + C.error, padding: "12px 24px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", minHeight: 48, letterSpacing: "0.01em", transition: motion }}>Delete</button>
                            </div>

                            {/* Delete Confirmation — inline bar */}
                            {deleteId === user.id && (
                              <div style={{ marginTop: 12, padding: "12px 16px", background: C.errorContainer, borderRadius: R.sm, border: "1px solid " + C.error, display: "flex", flexDirection: "column", gap: 12 }}>
                                <div style={{ fontSize: 14, color: C.error, fontWeight: 500, lineHeight: 1.4 }}>Delete <strong>{user.username}</strong>&apos;s account permanently? This cannot be undone.</div>
                                <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
                                  <button onClick={() => setDeleteId(null)} style={{ background: "transparent", color: C.onSurfaceVariant, border: "1px solid " + C.outline, padding: "8px 20px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", minHeight: 40, letterSpacing: "0.01em", transition: motion }}>Cancel</button>
                                  <button onClick={() => removeUser(user.id)} style={{ background: C.error, color: C.onPrimary, border: "none", padding: "8px 20px", borderRadius: R.xl, fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer", minHeight: 40, letterSpacing: "0.01em", transition: motion, boxShadow: S.level1 }}>Delete Permanently</button>
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* SNACKBAR */}
      {snack.snack && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.onSurface, color: C.surface, padding: "12px 24px", borderRadius: R.sm, fontSize: 14, fontWeight: 500, fontFamily: font, boxShadow: S.level3, zIndex: 10000, animation: "snackbarIn 0.25s cubic-bezier(0.2,0,0,1) both", letterSpacing: "0.01em", maxWidth: "90vw", textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {snack.snack.color === C.green && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            {snack.snack.color === C.red && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>}
            {snack.snack.message}
          </span>
        </div>
      )}
    </div>
  );
}
