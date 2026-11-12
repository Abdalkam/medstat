// src/admin/UserManagement.tsx — Material Design 3 (Android) redesign — expandable rows layout
// Professional Android look: Material You color roles, MD3 elevation, outlined text
// fields with floating labels, filled/tonal/outlined/text buttons, MD3 search bar,
// segmented buttons, dialog, snackbar and extended FAB. All CRUD/sync logic unchanged.
import { useEffect, useState, useRef } from "react";
import type { User, Course } from "../types";
import { getUsers, updateUser, deleteUser, addUser, getRecentlyPushedUserIds, noteUserPushed } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { deleteUserApi } from "../api/authApi";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getDeletedIds, purgeDeletedFromDexie } from "../database/deletedIdsTracker";

/* ============ MD3 COLOR TOKENS (Material You, light scheme) ============ */
const C = {
  primary: "#0B57D0",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  secondary: "#444746",
  secondaryContainer: "#DAE2F2",
  tertiary: "#146C2E",
  tertiaryContainer: "#E6F4EA",
  error: "#B3261E",
  errorContainer: "#F9DEDC",
  warning: "#B06000",
  warningContainer: "#FEF7E0",
  surface: "#FFFFFF",
  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",
  surfaceVariant: "#E9EEF6",
  background: "#F8FAFD",
  outline: "#747775",
  outlineVariant: "#C4C7C5",
  skeletonBase: "#E1E6ED",
  textPrimary: "#1F1F1F",
  textSecondary: "#444746",
  textTertiary: "#747775",
  textQuaternary: "#80868B",
  bg: "#F8FAFD",
  card: "#FFFFFF",
  inset: "#F0F4F9",
  separator: "#C4C7C5",
  separatorLight: "#E1E6ED",
  blue: "#0B57D0",
  blueBg: "#D3E3FD",
  green: "#146C2E",
  greenBg: "#E6F4EA",
  orange: "#B06000",
  orangeBg: "#FEF7E0",
  red: "#B3261E",
  redBg: "#F9DEDC",
  purple: "#8430CE",
  purpleBg: "#F3E8FD",
  medBlue: "#0B57D0",
  medBlueBg: "#D3E3FD",
  inverseSurface: "#2D2F31",
  inverseOnSurface: "#F0F4F9",
  inversePrimary: "#A8C7FA",
  scrim: "rgba(0,0,0,0.40)",
};

const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* MD3 elevation — soft, layered, low-contrast shadows. */
const S = {
  level1: "0 1px 2px 0 rgba(0,0,0,0.10), 0 1px 3px 1px rgba(0,0,0,0.07)",
  level2: "0 1px 2px 0 rgba(0,0,0,0.12), 0 2px 6px 2px rgba(0,0,0,0.08)",
  level3: "0 2px 3px 0 rgba(0,0,0,0.15), 0 6px 10px 4px rgba(0,0,0,0.09)",
  card: "0 1px 2px 0 rgba(0,0,0,0.10), 0 1px 3px 1px rgba(0,0,0,0.07)",
  cardHover: "0 1px 2px 0 rgba(0,0,0,0.12), 0 2px 6px 2px rgba(0,0,0,0.08)",
};

const R = { sm: 8, md: 12, lg: 16, xl: 28 };

const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1400;

/* MD3 elevated card: clean white surface, soft shadow, no border. */
const cardBase: React.CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  boxSizing: "border-box",
  minWidth: 0,
};

/* MD3 group card used inside expanded rows (outlined, flat). */
const groupBase: React.CSSProperties = {
  background: C.surface,
  border: "1px solid " + C.outlineVariant,
  borderRadius: R.md,
  boxSizing: "border-box",
  minWidth: 0,
};

const motion = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

/* MD3 button base: 40dp pill, label-large typography, state layers on hover. */
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean };
const btnBase: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
  border: "none", borderRadius: R.xl, minHeight: 40, padding: "0 24px",
  fontFamily: font, fontSize: 14, fontWeight: 500, letterSpacing: "0.01em",
  cursor: "pointer", transition: motion, whiteSpace: "nowrap",
};

function FilledButton({ danger, style, children, onMouseEnter, onMouseLeave, ...rest }: BtnProps) {
  const bg = danger ? C.error : C.primary;
  const hover = danger ? "#B93730" : "#1F64D4";
  return (
    <button
      {...rest}
      onMouseEnter={(e) => { e.currentTarget.style.background = hover; onMouseEnter?.(e); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = bg; onMouseLeave?.(e); }}
      style={{ ...btnBase, background: bg, color: C.onPrimary, ...style }}
    >
      {children}
    </button>
  );
}

function TonalButton({ style, children, onMouseEnter, onMouseLeave, ...rest }: BtnProps) {
  const bg = C.primaryContainer;
  return (
    <button
      {...rest}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#C2D3EF"; onMouseEnter?.(e); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = bg; onMouseLeave?.(e); }}
      style={{ ...btnBase, background: bg, color: C.onPrimaryContainer, ...style }}
    >
      {children}
    </button>
  );
}

function OutlinedButton({ danger, style, children, onMouseEnter, onMouseLeave, ...rest }: BtnProps) {
  const border = danger ? C.error : C.outline;
  const color = danger ? C.error : C.primary;
  const hoverBg = danger ? "rgba(179,38,30,0.08)" : "rgba(11,87,208,0.08)";
  return (
    <button
      {...rest}
      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; onMouseEnter?.(e); }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; onMouseLeave?.(e); }}
      style={{ ...btnBase, background: "transparent", color, border: "1px solid " + border, ...style }}
    >
      {children}
    </button>
  );
}

function TextButton({ danger, style, children, ...rest }: BtnProps) {
  const color = danger ? C.error : C.primary;
  return (
    <button
      {...rest}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? "rgba(179,38,30,0.08)" : "rgba(11,87,208,0.08)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      style={{ ...btnBase, background: "transparent", color, padding: "0 16px", ...style }}
    >
      {children}
    </button>
  );
}

const API_BASE_URL = import.meta.env.PROD ? "https://medstat-3rxl.onrender.com" : "";

function getAuthHeaders(): Record<string, string> {
  const token = localStorage.getItem("authToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: "Bearer " + token } : {}),
  };
}

async function apiFetch(path: string, body: any, method: string = "POST") {
  const res = await fetch(API_BASE_URL + path, {
    method,
    headers: getAuthHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "HTTP " + res.status }));
    throw new Error(err.error || "Sync failed: " + res.status);
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
  const colors = ["#0B57D0", "#B3261E", "#146C2E", "#B06000", "#8430CE", "#444746", "#C5221F", "#018786"];
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

async function pushUnsyncedUsersSilently() {
  try {
    const unsynced = await db.users.filter((u) => !u.synced && u.role !== "admin").toArray();
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
        // Register the confirmation so the merge below treats this id as
        // cloud-known for the next few seconds (read-after-write lag shield).
        noteUserPushed(user.id);
        if (user.assignedCourses && user.assignedCourses.length > 0) {
          const enrollments = user.assignedCourses.map((courseId: string) => ({ userId: user.id, courseId: courseId, status: "active" }));
          await apiFetch("/api/enrollments/sync", { enrollments }, "PUT");
        }
      } catch { /* keep unsynced */ }
    }
  } catch { /* local db unavailable */ }
}

/* ============================ MD3 components ============================= */

function StatCard({ icon, label, value, bg, fg, valueColor, delay }: {
  icon: React.ReactNode; label: string; value: string | number; bg: string; fg: string; valueColor?: string; delay?: number;
}) {
  return (
    <div style={{ ...cardBase, padding: "clamp(12px, 2vw, 16px)", display: "flex", alignItems: "center", gap: 12, animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both", animationDelay: (delay ?? 0) + "ms" }}>
      <div style={{ width: 40, height: 40, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
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
      <div style={{ width: 40, height: 40, borderRadius: 12, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: "55%", height: 10, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "75%", height: 18, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 20px", minHeight: 72, borderBottom: "1px solid " + C.separatorLight }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0, marginRight: 16 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ width: "40%", height: 14, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "60%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "24px 4px 8px" }}>
      <span style={{ fontSize: 14, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.01em" }}>{title}</span>
    </div>
  );
}

/* MD3 outlined text field — floating label notched into the border,
   2dp primary border + state layer on focus (Android Settings style). */
function OutlinedField({ label, onChange, style, ...rest }: {
  label: string; onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void; style?: React.CSSProperties; [key: string]: any;
}) {
  const [focused, setFocused] = useState(false);
  const val = rest.value == null ? "" : String(rest.value);
  const floated = focused || val.length > 0;
  return (
    <div style={{ position: "relative", width: "100%", minWidth: 0, ...style }}>
      <input
        {...rest}
        onChange={onChange}
        placeholder={floated ? rest.placeholder : ""}
        style={{
          width: "100%", height: 52,
          padding: floated ? "18px 15px 6px" : "0 15px",
          backgroundColor: "transparent",
          border: "1px solid " + (focused ? C.primary : C.outlineVariant),
          borderRadius: R.sm, fontSize: 15, color: C.onSurface,
          outline: "none", fontFamily: font, boxSizing: "border-box", caretColor: C.primary,
          boxShadow: focused ? "0 0 0 1px " + C.primary : "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease, padding 0.18s cubic-bezier(0.2,0,0,1)",
        }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => { setFocused(true); (rest.onFocus as any)?.(e); }}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => { setFocused(false); (rest.onBlur as any)?.(e); }}
      />
      <label
        style={{
          position: "absolute", left: 12, top: floated ? 0 : 26, transform: "translateY(-50%)",
          padding: "0 5px", background: C.surface,
          fontSize: floated ? 12 : 15, fontWeight: floated ? 500 : 400,
          color: focused ? C.primary : C.onSurfaceVariant,
          letterSpacing: floated ? "0.02em" : "0",
          pointerEvents: "none", whiteSpace: "nowrap",
          maxWidth: "calc(100% - 24px)", overflow: "hidden", textOverflow: "ellipsis",
          transition: "top 0.18s cubic-bezier(0.2,0,0,1), font-size 0.18s cubic-bezier(0.2,0,0,1), color 0.15s ease",
        }}
      >
        {label}
      </label>
    </div>
  );
}

/* MD3 segmented button — active segment gets secondary container + check icon. */
function RoleSegmentedButton({ value, onChange }: { value: "trainee" | "trainer"; onChange: (v: "trainee" | "trainer") => void; }) {
  const options: { key: "trainee" | "trainer"; label: string }[] = [{ key: "trainee", label: "Trainee" }, { key: "trainer", label: "Trainer" }];
  return (
    <div style={{ display: "inline-flex", width: "100%", maxWidth: 360, border: "1px solid " + C.outline, borderRadius: R.xl, overflow: "hidden" }}>
      {options.map((opt, i) => {
        const active = value === opt.key;
        return (
          <button key={opt.key} onClick={() => onChange(opt.key)} style={{ flex: 1, border: "none", borderLeft: i > 0 ? "1px solid " + C.outline : "none", background: active ? C.primaryContainer : "transparent", color: active ? C.onPrimaryContainer : C.onSurface, padding: "0 16px", fontSize: 14, fontWeight: active ? 500 : 400, fontFamily: font, cursor: "pointer", minHeight: 40, transition: motion, letterSpacing: "0.01em", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
            {active && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* MD3 assist chip — 8dp shape, tonal container. */
function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", borderRadius: R.sm, background: bg, color: fg, fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
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
  const formAnchorRef = useRef<HTMLDivElement>(null);
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
      const tenantId = currentUser?.tenantId;
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
          await pushUnsyncedUsersSilently();

          // FIX: Query Supabase with .is("deleted_at", null) to exclude soft-deleted rows
          const [usersRes, coursesRes] = await Promise.all([
            supabase.from("users").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
            supabase.from("courses").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
          ]);

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
          const finalCourses = visibleRemoteCourses.length > 0 ? visibleRemoteCourses : coursesData;
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
    if (courseIds.length === 0) return;
    try { const enrollments = courseIds.map(courseId => ({ userId, courseId, status: "active" })); await apiFetch("/api/enrollments/sync", { enrollments }, "PUT"); } catch (e: any) { console.warn("Enrollment sync failed:", e.message); }
  }

  async function saveUser() {
    if (!form.username || !form.email || !form.password) { snack.error("Name, email, and password are required."); return; }
    if (isUsernameTaken(form.username)) { snack.error("Username already exists."); return; }
    if (isPhoneTaken(form.phone)) { snack.error("This phone number is already registered to another user."); return; }
    // synced:false makes the pending state explicit — if the cloud upsert below
    // fails, loadData() keeps this user visible (local-pending merge) until a
    // later pushUnsyncedUsersSilently() confirms it in the cloud.
    const newUser: any = { id: crypto.randomUUID(), username: form.username.trim(), phone: form.phone.trim(), email: form.email.trim(), password: form.password, role: form.role, assignedCourses: form.selectedCourses, profilePic: form.profilePic, createdAt: new Date().toISOString(), synced: false, tuition: { expected: form.expectedTuition, paid: form.paidTuition }, remuneration: { netSalary: form.netSalary as any, perDiem: form.perDiem as any } };
    // addUser() now runs the tenant-scoped duplicate guard at DB level too —
    // surface its error instead of letting it bubble unhandled.
    try {
      await addUser(newUser);
    } catch (err: any) {
      snack.error(err?.message || "Could not create user.");
      return;
    }
    try {
      await apiFetch("/api/users/upsert", { id: newUser.id, username: newUser.username, phone: newUser.phone, email: newUser.email, password: newUser.password, role: newUser.role, assigned_courses: newUser.assignedCourses, profile_pic: newUser.profilePic || null, tuition: { expected: parseFloat(String(form.expectedTuition ?? "").replace(/,/g, "")) || 0, paid: parseFloat(String(form.paidTuition ?? "").replace(/,/g, "")) || 0 }, remuneration: { net_salary: parseFloat(form.netSalary.replace(/,/g, "")) || 0, per_diem: parseFloat(form.perDiem.replace(/,/g, "")) || 0 } });
      await db.users.update(newUser.id, { synced: true });
      noteUserPushed(newUser.id);
    } catch (err: any) { console.warn("Cloud sync failed:", err.message); }
    await syncEnrollmentsToCloud(newUser.id, newUser.assignedCourses);
    snack.success("User created successfully");
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
    const updatedUser: any = { id: userId, username: inlineForm.username.trim(), phone: inlineForm.phone.trim(), email: inlineForm.email.trim(), password: finalPassword, role: inlineForm.role, assignedCourses: inlineForm.selectedCourses, profilePic: inlineForm.profilePic, createdAt: currentUser?.createdAt || new Date().toISOString(), tuition: { expected: inlineForm.expectedTuition, paid: inlineForm.paidTuition }, remuneration: { netSalary: inlineForm.netSalary as any, perDiem: inlineForm.perDiem as any } };
    await updateUser(updatedUser);
    try {
      await apiFetch("/api/users/update", { id: userId, username: updatedUser.username, phone: updatedUser.phone, email: updatedUser.email, password: finalPassword, role: updatedUser.role, assigned_courses: updatedUser.assignedCourses, profile_pic: updatedUser.profilePic || null, tuition: { expected: parseFloat(String(inlineForm.expectedTuition ?? "").replace(/,/g, "")) || 0, paid: parseFloat(String(inlineForm.paidTuition ?? "").replace(/,/g, "")) || 0 }, remuneration: { net_salary: parseFloat(String(inlineForm.netSalary ?? "").replace(/,/g, "")) || 0, per_diem: parseFloat(String(inlineForm.perDiem ?? "").replace(/,/g, "")) || 0 } }, "PUT");
      await db.users.update(userId, { synced: true });
      noteUserPushed(userId);
    } catch (err: any) { console.warn("Cloud sync failed:", err.message); }
    await syncEnrollmentsToCloud(userId, updatedUser.assignedCourses);
    snack.success("User updated successfully");
    setInlineEditId(null);
    // Search affects CRUD: if the update no longer matches the active filter, clear it
    // so the edited row stays visible instead of silently dropping out of the list
    if (!matchesUserSearch(updatedUser, searchQuery)) setSearchQuery("");
    loadData();
  }

  async function removeUser(id: string) {
    try {
      // deleteUser() now handles local delete + tombstone + Supabase delete
      await deleteUser(id);
    } catch (err: any) {
      // Cloud delete may fail (FK constraints, network) — tombstone still blocks reappearing
      console.warn("Delete warning:", err.message);
      snack.error("User deleted locally. Cloud delete will retry automatically.");
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
  const plusSvg = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
  const closeSvg = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{"@keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } } @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } } @keyframes snackbarIn { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } } @keyframes ripple { from { transform: scale(0); opacity: 0.12; } to { transform: scale(4); opacity: 0; } } @keyframes expandSpring { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } } @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes dialogIn { from { opacity: 0; transform: scale(0.94) translateY(10px); } to { opacity: 1; transform: none; } }"}</style>
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={uploadPic} />
      <input ref={inlinePicRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleInlinePicUpload} />

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: "20px " + gutter + " clamp(96px, 12vh, 128px)", boxSizing: "border-box" }}>

        {/* TOP APP BAR — MD3 headlineMedium */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 12, gap: 12, width: "100%", animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.onSurface, fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>User Management</h1>
            <p style={{ margin: "4px 0 0 0", color: C.onSurfaceVariant, fontSize: 14, fontWeight: 400, letterSpacing: "0.01em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Manage trainers, trainees, and financials</p>
          </div>

          {/* MD3 SEARCH BAR — borderless tonal pill, leading icon, trailing clear */}
          {!isLoading && users.length > 0 && (
            <div style={{ position: "relative", flex: "1 1 280px", minWidth: 220, maxWidth: 440, height: 48, boxSizing: "border-box" }}>
              <svg style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.onSurfaceVariant }} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input type="text" placeholder="Search users by name, email, phone, or role…" value={searchQuery} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)} style={{ width: "100%", height: 48, paddingLeft: 46, paddingRight: searchQuery ? 44 : 16, backgroundColor: C.surfaceVariant, border: "1px solid transparent", borderRadius: 24, fontSize: 14, color: C.onSurface, outline: "none", fontFamily: font, boxSizing: "border-box", transition: "background 0.2s ease" }} onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.background = C.separatorLight; }} onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.background = C.surfaceVariant; }} />
              {searchQuery && <button onClick={() => setSearchQuery("")} aria-label="Clear search" style={{ position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "transparent", color: C.onSurfaceVariant, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontSize: 16, transition: "background 0.15s ease" }} onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = C.separatorLight; }} onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; }}>×</button>}
            </div>
          )}
          {showForm ? (
            <TonalButton onClick={handleToggleForm} style={{ height: 40, flexShrink: 0 }}>
              {closeSvg}
              Close
            </TonalButton>
          ) : (
            <FilledButton onClick={handleToggleForm} style={{ height: 40, flexShrink: 0 }}>
              {plusSvg}
              New User
            </FilledButton>
          )}
        </div>

        {/* STAT CARDS — MD3 elevated cards */}
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
        <div ref={formAnchorRef} style={{ maxHeight: showForm ? 4000 : 0, overflow: "hidden", transition: "max-height 0.4s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.3s ease", opacity: showForm ? 1 : 0, width: "100%" }}>
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
              <div>
                <div style={{ fontSize: 14, color: C.primary, fontWeight: 500, letterSpacing: "0.01em" }}>Upload Photo</div>
                <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>JPG or PNG, compressed automatically</div>
              </div>
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
                  <div key={course.id} style={{ padding: "12px 16px", backgroundColor: form.selectedCourses.includes(course.id) ? C.primaryContainer : "transparent", borderBottom: index < courses.length - 1 ? "1px solid " + C.separatorLight : "none", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background 0.15s ease", minHeight: 48 }} onClick={() => toggleCourse(course.id)} onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!form.selectedCourses.includes(course.id)) e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!form.selectedCourses.includes(course.id)) e.currentTarget.style.background = "transparent"; }}>
                    <div style={{ width: 20, height: 20, borderRadius: 4, border: form.selectedCourses.includes(course.id) ? "none" : "2px solid " + C.outlineVariant, background: form.selectedCourses.includes(course.id) ? C.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: motion }}>
                      {form.selectedCourses.includes(course.id) && checkSvg}
                    </div>
                    <span style={{ fontSize: 14, color: form.selectedCourses.includes(course.id) ? C.onPrimaryContainer : C.onSurface, fontWeight: form.selectedCourses.includes(course.id) ? 500 : 400, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          <FilledButton onClick={saveUser} style={{ width: "100%", minHeight: 48 }}>Create Account</FilledButton>
        </div>

        {/* REGISTERED USERS LIST — MD3 expandable list */}
        <div style={{ paddingTop: showForm ? 0 : 8 }}>
          <SectionHeader title={searchQuery ? "Results (" + filteredUsers.length + ")" : "Registered Users"} />
        </div>

        {isLoading ? (
          <div style={{ ...cardBase, borderRadius: R.md, overflow: "hidden", width: "100%" }}>
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
        ) : users.length === 0 ? (
          <div style={{ background: C.inset, borderRadius: R.lg, padding: "40px 24px", textAlign: "center", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.separatorLight, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              {userIconSvg}
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: C.onSurface }}>No accounts yet</div>
            <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4 }}>New users you create will appear here.</div>
          </div>
        ) : filteredUsers.length === 0 ? (
          <div style={{ background: C.inset, borderRadius: R.lg, padding: "40px 24px", textAlign: "center", boxSizing: "border-box" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.separatorLight, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke={C.onSurfaceVariant} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /><line x1="4" y1="4" x2="20" y2="20" /></svg>
            </div>
            <div style={{ fontSize: 15, fontWeight: 500, color: C.onSurface }}>No users match &quot;{searchQuery}&quot;</div>
            <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4 }}>Try a different name, email, phone, or role.</div>
          </div>
        ) : (
          <div style={{ ...cardBase, borderRadius: R.md, overflow: "hidden", width: "100%" }}>
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
                  {/* COLLAPSED ROW — MD3 list item with ripple + state layers */}
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
                    style={{ display: "flex", alignItems: "center", padding: "14px 20px 14px 16px", minHeight: 72, background: isExpanded ? C.primaryContainer : C.surface, borderBottom: "1px solid " + C.separatorLight, cursor: isEditing ? "default" : "pointer", transition: "background 0.2s cubic-bezier(0.2,0,0,1)", boxSizing: "border-box", width: "100%", position: "relative", overflow: "hidden" }}
                    onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.background = C.surfaceVariant; e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(11,87,208,0.08)"; } }}
                    onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded) { e.currentTarget.style.background = C.surface; e.currentTarget.style.boxShadow = "none"; } else { e.currentTarget.style.boxShadow = "none"; } }}
                    onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(11,87,208,0.12)"; } }}
                    onMouseUp={(e: React.MouseEvent<HTMLDivElement>) => { if (!isExpanded && !isEditing) { e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(11,87,208,0.08)"; } }}
                  >
                    {/* Avatar */}
                    {user.profilePic ? (
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.surfaceVariant, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0, marginRight: 16 }}>
                        <img src={user.profilePic} alt="Avatar" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    ) : (
                      <div style={{ width: 40, height: 40, borderRadius: "50%", background: getAvatarColor(user.username), color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500, flexShrink: 0, marginRight: 16 }}>{user.username.charAt(0).toUpperCase()}</div>
                    )}
                    {/* Center content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 15, color: C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
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
                  <div style={{ maxHeight: isExpanded ? 2000 : 0, overflow: "hidden", opacity: isExpanded ? 1 : 0, transition: "max-height 0.45s cubic-bezier(0.2, 0, 0, 1), opacity 0.3s cubic-bezier(0.2,0,0,1)", background: C.surface, borderBottom: isExpanded ? "1px solid " + C.separatorLight : "none", animation: isExpanded ? "expandSpring 0.35s cubic-bezier(0.2,0,0,1) both" : "none" }}>
                    <div style={{ padding: "16px 20px 20px", boxSizing: "border-box" }}>
                      {isEditing ? (
                        <>
                          {inlineError && <div style={{ margin: "0 0 12px 0", padding: "10px 16px", background: C.errorContainer, color: C.error, borderRadius: R.sm, fontSize: 13, fontWeight: 500, textAlign: "center" }}>{inlineError}</div>}
                          <SectionHeader title="Profile Picture" />
                          <div style={{ ...groupBase, padding: 16, marginBottom: 12, boxShadow: "none" }}>
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
                          <div style={{ ...groupBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                            <OutlinedField label="Full Name" placeholder="Enter full name" value={inlineForm.username} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("username", e.target.value); setInlineError(""); }} />
                            <OutlinedField label="Phone" placeholder="Enter phone number" type="tel" value={inlineForm.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("phone", e.target.value)} />
                            <OutlinedField label="Email" placeholder="Enter email address" type="email" value={inlineForm.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("email", e.target.value); setInlineError(""); }} />
                          </div>
                          <SectionHeader title="Security" />
                          <div style={{ ...groupBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                            <OutlinedField label="New Password (leave blank to keep current)" placeholder="Enter new password" type="password" value={inlineForm.password} onChange={(e: React.ChangeEvent<HTMLInputElement>) => { updateInlineForm("password", e.target.value); setInlineError(""); }} />
                            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                              <label style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em" }}>Role</label>
                              <RoleSegmentedButton value={inlineForm.role} onChange={v => updateInlineForm("role", v)} />
                            </div>
                          </div>
                          {inlineForm.role === "trainee" ? (
                            <>
                              <SectionHeader title="Edit Tuition" />
                              <div style={{ ...groupBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                                <OutlinedField label="Expected Tuition" placeholder="Enter expected tuition" value={inlineForm.expectedTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("expectedTuition", e.target.value)} />
                                <OutlinedField label="Amount Paid" placeholder="Enter amount paid" value={inlineForm.paidTuition} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("paidTuition", e.target.value)} />
                              </div>
                            </>
                          ) : (
                            <>
                              <SectionHeader title="Edit Remuneration" />
                              <div style={{ ...groupBase, padding: 20, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column", gap: 16 }}>
                                <OutlinedField label="Net Salary" placeholder="Enter net salary" value={inlineForm.netSalary} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("netSalary", e.target.value)} />
                                <OutlinedField label="Per Diem" placeholder="Enter per diem" value={inlineForm.perDiem} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateInlineForm("perDiem", e.target.value)} />
                              </div>
                            </>
                          )}
                          {courses.length > 0 && (
                            <>
                              <SectionHeader title="Course Access" />
                              <div style={{ ...groupBase, padding: 16, marginBottom: 12, boxShadow: "none", display: "flex", flexDirection: "column" }}>
                                {courses.map((course, cIndex) => (
                                  <div key={course.id} style={{ padding: "12px 16px", backgroundColor: inlineForm.selectedCourses.includes(course.id) ? C.primaryContainer : "transparent", borderBottom: cIndex < courses.length - 1 ? "1px solid " + C.separatorLight : "none", display: "flex", alignItems: "center", gap: 12, cursor: "pointer", transition: "background 0.15s ease", minHeight: 48 }} onClick={() => toggleInlineCourse(course.id)} onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!inlineForm.selectedCourses.includes(course.id)) e.currentTarget.style.background = C.inset; }} onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { if (!inlineForm.selectedCourses.includes(course.id)) e.currentTarget.style.background = "transparent"; }}>
                                    <div style={{ width: 20, height: 20, borderRadius: 4, border: inlineForm.selectedCourses.includes(course.id) ? "none" : "2px solid " + C.outlineVariant, background: inlineForm.selectedCourses.includes(course.id) ? C.primary : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: motion }}>
                                      {inlineForm.selectedCourses.includes(course.id) && checkSvg}
                                    </div>
                                    <span style={{ fontSize: 14, color: inlineForm.selectedCourses.includes(course.id) ? C.onPrimaryContainer : C.onSurface, fontWeight: inlineForm.selectedCourses.includes(course.id) ? 500 : 400, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course.name}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, width: "100%", boxSizing: "border-box", paddingTop: 4 }}>
                            <FilledButton onClick={() => saveInlineUser(user.id)} style={{ flex: "1 1 min(160px, 100%)", minHeight: 48 }}>Save Changes</FilledButton>
                            <OutlinedButton onClick={() => { setInlineEditId(null); setInlineError(""); }} style={{ flex: "1 1 min(120px, 100%)", minHeight: 48 }}>Cancel</OutlinedButton>
                          </div>
                        </>
                      ) : (
                        <>
                          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
                            {/* Date of Enrollment */}
                            <div style={{ padding: "12px 16px", borderRadius: R.md, background: C.inset }}>
                              <div style={{ fontSize: 11, color: C.onSurfaceVariant, fontWeight: 600, letterSpacing: "0.06em" }}>DATE OF ENROLLMENT</div>
                              <div style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, marginTop: 4 }}>{user.createdAt ? new Date(user.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "Unknown"}</div>
                            </div>

                            {/* Trainee financials */}
                            {user.role === "trainee" && (
                              <>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 12 }}>
                                  <div style={{ padding: "12px 14px", borderRadius: R.md, background: C.blueBg, color: C.blue }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", opacity: 0.75 }}>EXPECTED</div>
                                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{expectedStr}</div>
                                  </div>
                                  <div style={{ padding: "12px 14px", borderRadius: R.md, background: C.greenBg, color: C.green }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", opacity: 0.75 }}>PAID</div>
                                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{paidStr}</div>
                                  </div>
                                  <div style={{ padding: "12px 14px", borderRadius: R.md, background: balanceBg, color: balanceText }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", opacity: 0.75 }}>BALANCE</div>
                                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{expected <= 0 ? "N/A" : balance}</div>
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Payment Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                                    {paymentHistory.length > 0 ? paymentHistory.map((p: any, i: number) => (
                                      <div key={i} style={{ padding: "12px 14px", borderRadius: R.md, background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: C.onSurface }}>{new Date(p.date).toLocaleString()}</div>
                                          <div style={{ fontSize: 11, color: C.onSurfaceVariant }}>{p.method}</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: C.green, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{p.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: 14, textAlign: "center", color: C.onSurfaceVariant, fontSize: 13, borderRadius: R.md, background: C.inset }}>No payment records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            {/* Trainer financials */}
                            {user.role === "trainer" && (
                              <>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 12 }}>
                                  <div style={{ padding: "12px 14px", borderRadius: R.md, background: C.purpleBg, color: C.purple }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", opacity: 0.75 }}>NET SALARY</div>
                                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{netSalaryStr}</div>
                                  </div>
                                  <div style={{ padding: "12px 14px", borderRadius: R.md, background: C.orangeBg, color: C.orange }}>
                                    <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.06em", opacity: 0.75 }}>PER DIEM</div>
                                    <div style={{ fontSize: 15, fontWeight: 500, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>{perDiemStr}</div>
                                  </div>
                                </div>
                                <div>
                                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Remuneration Records</div>
                                  <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 200, overflowY: "auto" }}>
                                    {remunerationHistory.length > 0 ? remunerationHistory.map((r: any, i: number) => (
                                      <div key={i} style={{ padding: "12px 14px", borderRadius: R.md, background: C.inset, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                        <div style={{ minWidth: 0 }}>
                                          <div style={{ fontSize: 13, fontWeight: 500, color: C.onSurface }}>{r.date ? new Date(r.date).toLocaleString() : "\u2014"}</div>
                                          <div style={{ fontSize: 11, color: C.onSurfaceVariant }}>{r.method || r.type || "Payment"}</div>
                                        </div>
                                        <div style={{ fontSize: 14, fontWeight: 600, color: C.purple, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>{r.amount}</div>
                                      </div>
                                    )) : <div style={{ padding: 14, textAlign: "center", color: C.onSurfaceVariant, fontSize: 13, borderRadius: R.md, background: C.inset }}>No remuneration records found</div>}
                                  </div>
                                </div>
                              </>
                            )}

                            {/* Assigned Courses */}
                            {user.assignedCourses && user.assignedCourses.length > 0 && (
                              <div>
                                <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginBottom: 8, fontWeight: 500, letterSpacing: "0.04em" }}>Assigned Courses</div>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                                  {user.assignedCourses.map((courseId: string) => {
                                    const course = courses.find((c: any) => c.id === courseId);
                                    if (!course) return null;
                                    return <Chip key={courseId} label={course.name} bg={C.blueBg} fg={C.blue} />;
                                  })}
                                </div>
                              </div>
                            )}

                            {/* Edit / Delete actions */}
                            <div style={{ display: "flex", gap: 12, paddingTop: 8 }}>
                              <FilledButton onClick={() => startInlineEdit(user)} style={{ flex: 1, minHeight: 48 }}>Edit</FilledButton>
                              <OutlinedButton danger onClick={() => setDeleteId(user.id)} style={{ flex: 1, minHeight: 48 }}>Delete</OutlinedButton>
                            </div>
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

      {/* DELETE CONFIRMATION — MD3 basic dialog */}
      {deleteId && (() => {
        const target: any = users.find((u: any) => u.id === deleteId);
        if (!target) return null;
        return (
          <div onClick={() => setDeleteId(null)} style={{ position: "fixed", top: 0, right: 0, bottom: 0, left: 0, background: C.scrim, zIndex: 9998, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "fadeIn 0.2s ease both" }}>
            <div onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()} role="dialog" aria-modal="true" style={{ background: C.surface, borderRadius: 28, padding: "24px 24px 16px", maxWidth: 400, width: "100%", boxShadow: S.level3, boxSizing: "border-box", animation: "dialogIn 0.28s cubic-bezier(0.2,0,0,1) both" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.redBg, color: C.error, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                </div>
                <div style={{ fontSize: 22, color: C.onSurface, fontWeight: 400, letterSpacing: "-0.01em" }}>Delete account?</div>
              </div>
              <p style={{ margin: "16px 0 0 0", fontSize: 14, lineHeight: 1.5, color: C.onSurfaceVariant }}>Delete <strong style={{ color: C.onSurface }}>{target.username}</strong>&apos;s account permanently? This cannot be undone.</p>
              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24 }}>
                <TextButton onClick={() => setDeleteId(null)}>Cancel</TextButton>
                <FilledButton danger onClick={() => removeUser(target.id)}>Delete permanently</FilledButton>
              </div>
            </div>
          </div>
        );
      })()}

      {/* EXTENDED FAB — MD3, bottom-right (the Android signature) */}
      <button
        onClick={() => { if (showForm) { closeForm(); } else { openCreateForm(); window.setTimeout(() => { formAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 80); } }}
        aria-label={showForm ? "Close form" : "New user"}
        style={{ position: "fixed", right: "clamp(16px, 4vw, 32px)", bottom: "clamp(20px, 4vh, 32px)", height: 56, borderRadius: 16, border: "none", background: C.primaryContainer, color: C.onPrimaryContainer, display: "flex", alignItems: "center", gap: 12, padding: "0 24px 0 20px", cursor: "pointer", boxShadow: S.level2, fontFamily: font, fontSize: 14, fontWeight: 500, letterSpacing: "0.01em", zIndex: 900, transition: motion }}
        onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "#C2D3EF"; }}
        onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = C.primaryContainer; }}
      >
        {showForm ? closeSvg : plusSvg}
        {showForm ? "Close" : "New User"}
      </button>

      {/* SNACKBAR — MD3 inverse surface */}
      {snack.snack && (
        <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", background: C.inverseSurface, color: C.inverseOnSurface, padding: "14px 20px", borderRadius: R.sm, fontSize: 14, fontWeight: 500, fontFamily: font, boxShadow: S.level3, zIndex: 10000, animation: "snackbarIn 0.25s cubic-bezier(0.2,0,0,1) both", letterSpacing: "0.01em", maxWidth: "90vw", textAlign: "center" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
            {snack.snack.color === C.green && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.inversePrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
            {snack.snack.color === C.red && <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F2B8B5" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>}
            {snack.snack.message}
          </span>
        </div>
      )}
    </div>
  );
}
