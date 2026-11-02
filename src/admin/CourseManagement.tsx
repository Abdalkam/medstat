// src/admin/AssignCourses.tsx — Google Material Design 3 — Course Assignment Manager
//
// One screen, two directions (both save through enrollmentDB, the canonical
// diff-based / tombstone-aware assignment engine):
//   • By Course  — open a course, tick trainers/trainees into its roster.
//   • By User    — open a user, tick the courses they get.
//
// Offline-first like the rest of the app: Dexie paints instantly, Supabase is
// merged in the background (tombstone-aware), saves work offline and retry.
//
// Deep-linkable from other pages:
//   <AssignCourses />                          → free navigation
//   <AssignCourses initialMode="course" initialCourseId={id} />  → CourseManagement "Assign" button
//   <AssignCourses initialMode="user" initialUserId={id} />      → UserManagement "Assign courses" button

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { db } from "../database/db";
import { supabase } from "../auth/supabase";
import { getDeletedIds } from "../database/deletedIdsTracker";
import {
  getEnrollments,
  applyUserAssignments,
  applyCourseAssignments,
  reconcileAllEnrollments,
  syncPendingEnrollments,
  pushUserAssignmentsMirror,
} from "../database/enrollmentDB";

/* ================= MD3 COLOR TOKENS (same system as UserManagement/CourseManagement) ================= */
const C = {
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  secondaryContainer: "#E8EAED",
  error: "#D93025",
  errorContainer: "#F9DEDC",
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  surfaceVariant: "#E8EAED",
  background: "#F8F9FA",
  outline: "#DADCE0",
  outlineVariant: "#BDC1C6",
  skeletonBase: "#E8EAED",
  inset: "#F1F3F4",
  green: "#1E8E3E",
  greenBg: "#E6F4EA",
  orange: "#E37400",
  orangeBg: "#FEF7E0",
  red: "#D93025",
  redBg: "#F9DEDC",
  purple: "#8430CE",
  purpleBg: "#F3E8FD",
  blue: "#1A73E8",
  blueBg: "#D3E3FD",
  freeText: "#1E8E3E",
  freeBg: "#E6F4EA",
  paidText: "#B06000",
  paidBg: "#FEF7E0",
};

const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const S = {
  level1: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  level2: "0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)",
};
const R = { sm: 8, md: 12, lg: 16, xl: 28 };
const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1400;
const motion = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

const cardBase: CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  border: `1px solid ${C.outline}`,
  boxSizing: "border-box",
  minWidth: 0,
};

/* ================= HELPERS ================= */

function getAvatarColor(str: string) {
  const colors = ["#1A73E8", "#D93025", "#1E8E3E", "#E37400", "#8430CE", "#5F6368", "#C5221F", "#12AFDA"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === null || amount === undefined || amount === "") return "0.00";
  const num = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : amount;
  if (isNaN(num)) return "0.00";
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function mapUserFromSupabase(u: any): any {
  return {
    ...u,
    id: u.id,
    username: u.username || "",
    phone: u.phone || "",
    email: u.email || "",
    role: u.role || "trainee",
    profilePic: u.profile_pic || "",
    assignedCourses: u.assigned_courses || [],
    tenantId: u.tenant_id,
    synced: true,
  };
}

function mapCourseFromSupabase(c: any): any {
  return {
    ...c,
    id: c.id,
    name: c.name || "",
    tuitionType: c.tuition_type || "free",
    amount: c.amount || 0,
    startDate: c.start_date || "",
    logo: c.logo || "",
    tenantId: c.tenant_id,
    synced: true,
  };
}

function mapEnrollmentFromSupabase(e: any, tenantId: string): any {
  return {
    id: e.id,
    userId: e.user_id || "",
    courseId: e.course_id || "",
    role: e.role || "trainee",
    status: e.status || "active",
    tenantId: e.tenant_id || tenantId,
    enrolledAt: e.enrolled_at || "",
    createdAt: e.created_at || "",
    synced: true,
  };
}

/* ================= SMALL BUILDING BLOCKS ================= */

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 8px", borderRadius: R.sm, background: bg, color: fg, fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap", flexShrink: 0 }}>{label}</span>
  );
}

function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 4px 8px" }}>
      <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, letterSpacing: "0.01em" }}>{title}</span>
      {right}
    </div>
  );
}

function MiniTextButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none", background: "transparent", color: disabled ? C.outlineVariant : C.primary,
        fontSize: 13, fontWeight: 500, fontFamily: font, cursor: disabled ? "default" : "pointer",
        padding: "6px 10px", borderRadius: R.sm, letterSpacing: "0.01em", transition: motion,
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { if (!disabled) e.currentTarget.style.background = C.blueBg; }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.background = "transparent"; }}
    >{label}</button>
  );
}

function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <div style={{
      width: 20, height: 20, borderRadius: 4, flexShrink: 0,
      border: checked ? "none" : `2px solid ${C.outlineVariant}`,
      background: checked ? C.primary : "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      transition: motion,
    }}>
      {checked && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.onPrimary} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
      )}
    </div>
  );
}

function Avatar({ name, pic, size = 36 }: { name: string; pic?: string; size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: C.surfaceVariant, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
      {pic
        ? <img src={pic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <div style={{ width: "100%", height: "100%", background: getAvatarColor(name || "?"), color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: size * 0.42, fontWeight: 500 }}>{(name || "?").charAt(0).toUpperCase()}</div>}
    </div>
  );
}

/** Tickable person row — used in the course roster panel. */
function PersonRow({ user, checked, pending, onToggle }: {
  user: any; checked: boolean; pending: boolean; onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", minHeight: 52,
        borderBottom: `1px solid ${C.outline}`, cursor: "pointer",
        background: checked ? C.primaryContainer : "transparent", transition: "background 0.15s ease",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!checked) e.currentTarget.style.background = C.inset; }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = checked ? C.primaryContainer : "transparent"; }}
    >
      <CheckSquare checked={checked} />
      <Avatar name={user.username} pic={user.profilePic} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: checked ? C.onPrimaryContainer : C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
        <div style={{ fontSize: 12.5, color: checked ? C.onPrimaryContainer : C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{user.phone || user.email || "—"}</div>
      </div>
      {pending && <Chip label="Pending sync" bg={checked ? "#FFE0B2" : C.orangeBg} fg={C.orange} />}
    </div>
  );
}

/** Tickable course row — used in the per-user panel. */
function CourseRow({ course, checked, pending, onToggle }: {
  course: any; checked: boolean; pending: boolean; onToggle: () => void;
}) {
  const paid = course.tuitionType === "paid";
  return (
    <div
      onClick={onToggle}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", minHeight: 52,
        borderBottom: `1px solid ${C.outline}`, cursor: "pointer",
        background: checked ? C.primaryContainer : "transparent", transition: "background 0.15s ease",
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!checked) e.currentTarget.style.background = C.inset; }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = checked ? C.primaryContainer : "transparent"; }}
    >
      <CheckSquare checked={checked} />
      <div style={{ width: 36, height: 36, borderRadius: R.sm, background: C.blueBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" }}>
        {course.logo
          ? <img src={course.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, color: checked ? C.onPrimaryContainer : C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
        <div style={{ fontSize: 12.5, color: checked ? C.onPrimaryContainer : C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{paid ? `KES ${formatCurrency(course.amount)}` : "Free"}</div>
      </div>
      {pending && <Chip label="Pending sync" bg={checked ? "#FFE0B2" : C.orangeBg} fg={C.orange} />}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", minHeight: 56, borderBottom: `1px solid ${C.outline}` }}>
      <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0, marginRight: 12 }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
        <div style={{ width: "40%", height: 14, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "60%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: "relative", height: 40, boxSizing: "border-box" }}>
      <svg style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", pointerEvents: "none", color: C.onSurfaceVariant }} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        style={{
          width: "100%", height: 40, paddingLeft: 40, paddingRight: value ? 40 : 14,
          backgroundColor: C.surface, border: `1px solid ${C.outline}`, borderRadius: R.xl,
          fontSize: 14, color: C.onSurface, outline: "none", fontFamily: font,
          boxSizing: "border-box", transition: "border-color 0.2s ease",
        }}
        onFocus={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.primary; }}
        onBlur={(e: React.FocusEvent<HTMLInputElement>) => { e.currentTarget.style.borderColor = C.outline; }}
      />
      {value && (
        <button onClick={() => onChange("")} aria-label="Clear search" style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", width: 32, height: 32, borderRadius: "50%", border: "none", background: "transparent", color: C.onSurfaceVariant, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: font, fontSize: 14 }}>×</button>
      )}
    </div>
  );
}

/* ================= MAIN COMPONENT ================= */

export default function AssignCourses({
  initialMode = "course",
  initialCourseId,
  initialUserId,
}: {
  initialMode?: "course" | "user";
  initialCourseId?: string;
  initialUserId?: string;
}) {
  const [mode, setMode] = useState<"course" | "user">(initialMode);
  const [users, setUsers] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [enrollRows, setEnrollRows] = useState<any[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialCourseId ?? null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(initialUserId ?? null);
  // draft = the ticked set in the detail panel (userIds in course mode, courseIds in user mode)
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [courseSearch, setCourseSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [detailSearch, setDetailSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; color: string } | null>(null);
  const loadSeqRef = useRef(0);
  const bootstrappedRef = useRef(false);

  useEffect(() => {
    if (snackbar) {
      const t = setTimeout(() => setSnackbar(null), 3500);
      return () => clearTimeout(t);
    }
  }, [snackbar]);

  const showSnack = (message: string, color: string = C.green) => setSnackbar({ message, color });

  /* ---------- data load (local first, remote merge second — tombstone-aware) ---------- */

  async function loadData() {
    const seq = ++loadSeqRef.current;
    const stale = () => seq !== loadSeqRef.current;

    let cu: any = {};
    try { cu = JSON.parse(localStorage.getItem("currentUser") || "{}"); } catch { /* ignore */ }
    const tenantId = cu?.tenantId || cu?.tenant_id || "";

    // STEP 1 — instant local paint
    let localUsers: any[] = [];
    let localCourses: any[] = [];
    let localRows: any[] = [];
    try { localUsers = (await db.users.toArray() as any[]).filter((u) => u.role !== "admin"); } catch { /* ignore */ }
    try { localCourses = await db.courses.toArray() as any[]; } catch { /* ignore */ }
    try { localRows = (await getEnrollments(tenantId)) as any[]; } catch { /* ignore */ }
    if (!stale()) {
      setUsers(localUsers);
      setCourses(localCourses);
      setEnrollRows(localRows);
      setIsLoading(false);
    }

    // STEP 2 — background: flush pending changes, then merge Supabase
    if (tenantId && navigator.onLine) {
      try {
        await syncPendingEnrollments(tenantId);

        const [uRes, cRes, eRes] = await Promise.all([
          supabase.from("users").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
          supabase.from("courses").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
          supabase.from("enrollments").select("*").eq("tenant_id", tenantId),
        ]);

        const [dU, dC, dE] = await Promise.all([
          getDeletedIds("user"), getDeletedIds("course"), getDeletedIds("enrollment"),
        ]);
        const deadUsers = new Set(dU);
        const deadCourses = new Set(dC);
        const deadEnroll = new Set(dE);

        for (const u of uRes.data || []) {
          if (u.role !== "admin" && !deadUsers.has(u.id)) await db.users.put(mapUserFromSupabase(u));
        }
        for (const c of cRes.data || []) {
          if (!deadCourses.has(c.id)) await db.courses.put(mapCourseFromSupabase(c));
        }
        for (const e of eRes.data || []) {
          if (e.deleted_at || deadEnroll.has(e.id) || deadEnroll.has(`${e.user_id}:${e.course_id}`)) continue;
          await db.enrollments.put(mapEnrollmentFromSupabase(e, tenantId));
        }

        await reconcileAllEnrollments(tenantId);

        if (!stale()) {
          const freshUsers = ((await db.users.toArray() as any[]) || []).filter((u) => u.role !== "admin");
          const freshCourses = (await db.courses.toArray() as any[]) || [];
          const freshRows = (await getEnrollments(tenantId)) as any[];
          setUsers(freshUsers);
          setCourses(freshCourses);
          setEnrollRows(freshRows);
        }
      } catch (e) {
        console.warn("AssignCourses: remote merge failed, using local DB", e);
      }
    }
  }

  useEffect(() => { loadData(); }, []);

  // Deep-link bootstrap: seed the draft from the initially selected entity
  useEffect(() => {
    if (isLoading || bootstrappedRef.current) return;
    bootstrappedRef.current = true;
    if (mode === "course" && selectedCourseId) {
      setDraft(new Set(enrollRows.filter((r) => r.courseId === selectedCourseId).map((r) => r.userId)));
    } else if (mode === "user" && selectedUserId) {
      setDraft(new Set(enrollRows.filter((r) => r.userId === selectedUserId).map((r) => r.courseId)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  /* ---------- derived state ---------- */

  const selectedCourse = useMemo(() => courses.find((c) => c.id === selectedCourseId) || null, [courses, selectedCourseId]);
  const selectedUser = useMemo(() => users.find((u) => u.id === selectedUserId) || null, [users, selectedUserId]);

  // courseId → Set<userId> and userId → Set<courseId> from the canonical rows
  const membersByCourse = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of enrollRows) {
      if (!m.has(r.courseId)) m.set(r.courseId, new Set());
      m.get(r.courseId)!.add(r.userId);
    }
    return m;
  }, [enrollRows]);

  const coursesByUser = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of enrollRows) {
      if (!m.has(r.userId)) m.set(r.userId, new Set());
      m.get(r.userId)!.add(r.courseId);
    }
    return m;
  }, [enrollRows]);

  // synced state per pair, for the "Pending sync" chips
  const pendingPairs = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of enrollRows) {
      const key = `${r.userId}:${r.courseId}`;
      if (!m.has(key)) m.set(key, r.synced === false);
      else m.set(key, m.get(key) || r.synced === false);
    }
    return m;
  }, [enrollRows]);

  const trainers = useMemo(() => users.filter((u) => u.role === "trainer"), [users]);
  const trainees = useMemo(() => users.filter((u) => u.role === "trainee"), [users]);

  const filteredCourseList = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter((c: any) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q) ||
      (c.tuitionType || "").toLowerCase().includes(q));
  }, [courses, courseSearch]);

  const filteredUserList = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u: any) =>
      (u.username || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q));
  }, [users, userSearch]);

  const detailQuery = detailSearch.trim().toLowerCase();

  const filteredTrainers = useMemo(() => {
    if (!detailQuery) return trainers;
    return trainers.filter((u: any) => (u.username || "").toLowerCase().includes(detailQuery) || (u.phone || "").toLowerCase().includes(detailQuery) || (u.email || "").toLowerCase().includes(detailQuery));
  }, [trainers, detailQuery]);

  const filteredTrainees = useMemo(() => {
    if (!detailQuery) return trainees;
    return trainees.filter((u: any) => (u.username || "").toLowerCase().includes(detailQuery) || (u.phone || "").toLowerCase().includes(detailQuery) || (u.email || "").toLowerCase().includes(detailQuery));
  }, [trainees, detailQuery]);

  const filteredCoursesDetail = useMemo(() => {
    if (!detailQuery) return courses;
    return courses.filter((c: any) => (c.name || "").toLowerCase().includes(detailQuery) || (c.tuitionType || "").toLowerCase().includes(detailQuery));
  }, [courses, detailQuery]);

  // diff preview for the save bar
  const currentSet = useMemo(() => {
    if (mode === "course" && selectedCourseId) return membersByCourse.get(selectedCourseId) || new Set<string>();
    if (mode === "user" && selectedUserId) return coursesByUser.get(selectedUserId) || new Set<string>();
    return new Set<string>();
  }, [mode, selectedCourseId, selectedUserId, membersByCourse, coursesByUser]);

  const addedCount = useMemo(() => [...draft].filter((id) => !currentSet.has(id)).length, [draft, currentSet]);
  const removedCount = useMemo(() => [...currentSet].filter((id) => !draft.has(id)).length, [draft, currentSet]);
  const hasChanges = addedCount > 0 || removedCount > 0;

  /* ---------- selection + draft actions ---------- */

  function selectCourse(id: string) {
    setSelectedCourseId(id);
    setDraft(new Set(membersByCourse.get(id) || []));
    setDetailSearch("");
  }

  function selectUser(id: string) {
    setSelectedUserId(id);
    setDraft(new Set(coursesByUser.get(id) || []));
    setDetailSearch("");
  }

  function toggleDraft(id: string) {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function setSectionAll(ids: string[], on: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);
      for (const id of ids) { if (on) next.add(id); else next.delete(id); }
      return next;
    });
  }

  /* ---------- saves ---------- */

  async function saveRoster() {
    if (!selectedCourse || saving) return;
    setSaving(true);
    try {
      const res = await applyCourseAssignments({ courseId: selectedCourse.id, userIds: [...draft] });
      // Cloud mirror of assigned_courses on every touched user (best-effort, non-blocking)
      for (const uid of res.touchedUsers) pushUserAssignmentsMirror(uid).catch(() => undefined);
      showSnack(
        res.cloudSynced
          ? `Roster saved — ${res.added.length} added, ${res.removed.length} removed · synced`
          : `Roster saved locally — ${res.added.length} added, ${res.removed.length} removed · will retry when online`,
        res.cloudSynced ? C.green : C.orange
      );
      await loadData();
      const rows = (await getEnrollments()) as any[];
      setEnrollRows(rows);
      setDraft(new Set(rows.filter((r) => r.courseId === selectedCourse.id).map((r) => r.userId)));
    } catch (e: any) {
      showSnack(e?.message || "Could not save the roster.", C.red);
    } finally {
      setSaving(false);
    }
  }

  async function saveUserCourses() {
    if (!selectedUser || saving) return;
    setSaving(true);
    try {
      const res = await applyUserAssignments({ userId: selectedUser.id, courseIds: [...draft] });
      if (res.cloudSynced) pushUserAssignmentsMirror(selectedUser.id).catch(() => undefined);
      showSnack(
        res.cloudSynced
          ? `Courses saved — ${res.added.length} added, ${res.removed.length} removed · synced`
          : `Courses saved locally — ${res.added.length} added, ${res.removed.length} removed · will retry when online`,
        res.cloudSynced ? C.green : C.orange
      );
      await loadData();
      const rows = (await getEnrollments()) as any[];
      setEnrollRows(rows);
      setDraft(new Set(rows.filter((r) => r.userId === selectedUser.id).map((r) => r.courseId)));
    } catch (e: any) {
      showSnack(e?.message || "Could not save the courses.", C.red);
    } finally {
      setSaving(false);
    }
  }

  /* ---------- render ---------- */

  const tuitionPill = (course: any): CSSProperties => course.tuitionType === "paid"
    ? { display: "inline-flex", padding: "2px 10px", borderRadius: R.sm, background: C.paidBg, color: C.paidText, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 }
    : { display: "inline-flex", padding: "2px 10px", borderRadius: R.sm, background: C.freeBg, color: C.freeText, fontSize: 12, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0 };

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`
        @keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes snackbarIn { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        .acLayout { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 16px; align-items: start; }
        @media (max-width: 880px) { .acLayout { grid-template-columns: 1fr; } }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} clamp(20px, 4vh, 44px)`, boxSizing: "border-box" }}>

        {/* ===== PAGE HEADER ===== */}
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", rowGap: 10, gap: 12, width: "100%", animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.onSurface, fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 400, letterSpacing: "-0.01em", lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Course Assignments</h1>
            <p style={{ margin: "4px 0 0 0", color: C.onSurfaceVariant, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Assign courses to trainers and trainees</p>
          </div>

          {/* Mode switch */}
          <div style={{ display: "inline-flex", border: `1px solid ${C.outline}`, borderRadius: R.xl, overflow: "hidden", flexShrink: 0 }}>
            {([["course", "By Course"], ["user", "By User"]] as const).map(([key, label], i) => {
              const active = mode === key;
              return (
                <button key={key} onClick={() => { if (mode !== key) { setMode(key); setSelectedCourseId(null); setSelectedUserId(null); setDraft(new Set()); setDetailSearch(""); } }}
                  style={{ border: "none", borderLeft: i > 0 ? `1px solid ${C.outline}` : "none", background: active ? C.primary : "transparent", color: active ? C.onPrimary : C.onSurface, padding: "8px 20px", fontSize: 14, fontWeight: active ? 500 : 400, fontFamily: font, cursor: "pointer", minHeight: 40, transition: motion, letterSpacing: "0.01em" }}>
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ===== LAYOUT: master list + detail panel ===== */}
        <div className="acLayout" style={{ paddingTop: 16 }}>

          {/* ---------- MASTER LIST ---------- */}
          <div style={{ ...cardBase, overflow: "hidden", animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both" }}>
            <div style={{ padding: "14px 16px", borderBottom: `1px solid ${C.outline}`, background: C.surface }}>
              {mode === "course"
                ? <SearchBox value={courseSearch} onChange={setCourseSearch} placeholder="Search courses…" />
                : <SearchBox value={userSearch} onChange={setUserSearch} placeholder="Search people…" />}
            </div>

            {isLoading ? (
              <><SkeletonRow /><SkeletonRow /><SkeletonRow /></>
            ) : mode === "course" ? (
              filteredCourseList.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14 }}>
                  {courses.length === 0 ? "No courses yet — create one in Course Management." : `No courses match "${courseSearch}"`}
                </div>
              ) : (
                <div style={{ maxHeight: "min(620px, 70vh)", overflowY: "auto" }}>
                  {filteredCourseList.map((course: any) => {
                    const memberCount = membersByCourse.get(course.id)?.size || 0;
                    const active = course.id === selectedCourseId;
                    return (
                      <div key={course.id} onClick={() => selectCourse(course.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", minHeight: 56, borderBottom: `1px solid ${C.outline}`, cursor: "pointer", background: active ? C.primaryContainer : "transparent", transition: "background 0.15s ease" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!active) e.currentTarget.style.background = C.surfaceVariant; }}
                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = active ? C.primaryContainer : "transparent"; }}>
                        <div style={{ width: 40, height: 40, borderRadius: R.sm, background: course.logo ? "transparent" : C.blueBg, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          {course.logo
                            ? <img src={course.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, color: active ? C.onPrimaryContainer : C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                            <span style={tuitionPill(course)}>{course.tuitionType === "paid" ? `KES ${formatCurrency(course.amount)}` : "Free"}</span>
                            <span style={{ fontSize: 12.5, color: active ? C.onPrimaryContainer : C.onSurfaceVariant, whiteSpace: "nowrap" }}>{memberCount} assigned</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            ) : (
              filteredUserList.length === 0 ? (
                <div style={{ padding: "32px 16px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14 }}>
                  {users.length === 0 ? "No accounts yet — create one in User Management." : `No people match "${userSearch}"`}
                </div>
              ) : (
                <div style={{ maxHeight: "min(620px, 70vh)", overflowY: "auto" }}>
                  {filteredUserList.map((u: any) => {
                    const courseCount = coursesByUser.get(u.id)?.size || 0;
                    const active = u.id === selectedUserId;
                    const isTrainer = u.role === "trainer";
                    return (
                      <div key={u.id} onClick={() => selectUser(u.id)}
                        style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", minHeight: 56, borderBottom: `1px solid ${C.outline}`, cursor: "pointer", background: active ? C.primaryContainer : "transparent", transition: "background 0.15s ease" }}
                        onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => { if (!active) e.currentTarget.style.background = C.surfaceVariant; }}
                        onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => { e.currentTarget.style.background = active ? C.primaryContainer : "transparent"; }}>
                        <Avatar name={u.username} pic={u.profilePic} size={40} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, color: active ? C.onPrimaryContainer : C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.username}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                            <Chip label={isTrainer ? "Trainer" : "Trainee"} bg={isTrainer ? C.purpleBg : C.greenBg} fg={isTrainer ? C.purple : C.green} />
                            <span style={{ fontSize: 12.5, color: active ? C.onPrimaryContainer : C.onSurfaceVariant, whiteSpace: "nowrap" }}>{courseCount} course{courseCount === 1 ? "" : "s"}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            )}
          </div>

          {/* ---------- DETAIL PANEL ---------- */}
          <div style={{ ...cardBase, overflow: "hidden", display: "flex", flexDirection: "column", animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both", animationDelay: "60ms" }}>
            {!selectedCourse && mode === "course" ? (
              <div style={{ padding: "56px 24px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>
                <div>Select a course on the left to manage its roster.</div>
              </div>
            ) : !selectedUser && mode === "user" ? (
              <div style={{ padding: "56px 24px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14 }}>
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 12 }}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                <div>Select a person on the left to manage their courses.</div>
              </div>
            ) : (
              <>
                {/* detail header */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", borderBottom: `1px solid ${C.outline}`, background: C.surface }}>
                  {mode === "course" && selectedCourse ? (
                    <>
                      <div style={{ width: 44, height: 44, borderRadius: R.sm, background: selectedCourse.logo ? "transparent" : C.blueBg, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {selectedCourse.logo
                          ? <img src={selectedCourse.logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.blue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, color: C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedCourse.name}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                          <span style={tuitionPill(selectedCourse)}>{selectedCourse.tuitionType === "paid" ? `KES ${formatCurrency(selectedCourse.amount)}` : "Free"}</span>
                          <span style={{ fontSize: 12.5, color: C.onSurfaceVariant }}>{currentSet.size} currently assigned</span>
                        </div>
                      </div>
                    </>
                  ) : selectedUser ? (
                    <>
                      <Avatar name={selectedUser.username} pic={selectedUser.profilePic} size={44} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 16, color: C.onSurface, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{selectedUser.username}</div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                          <Chip label={selectedUser.role === "trainer" ? "Trainer" : "Trainee"} bg={selectedUser.role === "trainer" ? C.purpleBg : C.greenBg} fg={selectedUser.role === "trainer" ? C.purple : C.green} />
                          <span style={{ fontSize: 12.5, color: C.onSurfaceVariant }}>{currentSet.size} currently assigned</span>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {/* detail search */}
                <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.outline}`, background: C.surface }}>
                  <SearchBox value={detailSearch} onChange={setDetailSearch} placeholder={mode === "course" ? "Filter people…" : "Filter courses…"} />
                </div>

                {/* tickable lists */}
                <div style={{ maxHeight: "min(560px, 62vh)", overflowY: "auto", flex: 1 }}>
                  {mode === "course" && selectedCourse ? (
                    <>
                      <SectionHeader
                        title={`Trainers (${filteredTrainers.filter((u: any) => draft.has(u.id)).length}/${filteredTrainers.length} ticked)`}
                        right={
                          <div style={{ display: "flex", gap: 4 }}>
                            <MiniTextButton label="Tick all" onClick={() => setSectionAll(filteredTrainers.map((u: any) => u.id), true)} />
                            <MiniTextButton label="Clear" onClick={() => setSectionAll(filteredTrainers.map((u: any) => u.id), false)} />
                          </div>
                        }
                      />
                      {filteredTrainers.length === 0 ? (
                        <div style={{ padding: "16px", color: C.onSurfaceVariant, fontSize: 13, textAlign: "center" }}>No trainers match "{detailSearch}"</div>
                      ) : filteredTrainers.map((u: any) => (
                        <PersonRow key={u.id} user={u} checked={draft.has(u.id)} pending={pendingPairs.get(`${u.id}:${selectedCourse.id}`) === true} onToggle={() => toggleDraft(u.id)} />
                      ))}

                      <SectionHeader
                        title={`Trainees (${filteredTrainees.filter((u: any) => draft.has(u.id)).length}/${filteredTrainees.length} ticked)`}
                        right={
                          <div style={{ display: "flex", gap: 4 }}>
                            <MiniTextButton label="Tick all" onClick={() => setSectionAll(filteredTrainees.map((u: any) => u.id), true)} />
                            <MiniTextButton label="Clear" onClick={() => setSectionAll(filteredTrainees.map((u: any) => u.id), false)} />
                          </div>
                        }
                      />
                      {filteredTrainees.length === 0 ? (
                        <div style={{ padding: "16px", color: C.onSurfaceVariant, fontSize: 13, textAlign: "center" }}>No trainees match "{detailSearch}"</div>
                      ) : filteredTrainees.map((u: any) => (
                        <PersonRow key={u.id} user={u} checked={draft.has(u.id)} pending={pendingPairs.get(`${u.id}:${selectedCourse.id}`) === true} onToggle={() => toggleDraft(u.id)} />
                      ))}
                    </>
                  ) : selectedUser ? (
                    <>
                      <SectionHeader
                        title={`Courses (${filteredCoursesDetail.filter((c: any) => draft.has(c.id)).length}/${filteredCoursesDetail.length} ticked)`}
                        right={
                          <div style={{ display: "flex", gap: 4 }}>
                            <MiniTextButton label="Tick all" onClick={() => setSectionAll(filteredCoursesDetail.map((c: any) => c.id), true)} />
                            <MiniTextButton label="Clear" onClick={() => setSectionAll(filteredCoursesDetail.map((c: any) => c.id), false)} />
                          </div>
                        }
                      />
                      {filteredCoursesDetail.length === 0 ? (
                        <div style={{ padding: "24px 16px", color: C.onSurfaceVariant, fontSize: 13, textAlign: "center" }}>
                          {courses.length === 0 ? "No courses yet — create one in Course Management." : `No courses match "${detailSearch}"`}
                        </div>
                      ) : filteredCoursesDetail.map((c: any) => (
                        <CourseRow key={c.id} course={c} checked={draft.has(c.id)} pending={pendingPairs.get(`${selectedUser.id}:${c.id}`) === true} onToggle={() => toggleDraft(c.id)} />
                      ))}
                    </>
                  ) : null}
                </div>

                {/* sticky save bar with diff preview */}
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${C.outline}`, background: C.surface }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {hasChanges ? (
                      <span style={{ fontSize: 13.5, color: C.onSurface, fontWeight: 500 }}>
                        <span style={{ color: C.green }}>+{addedCount} add{addedCount === 1 ? "" : "s"}</span>
                        {" · "}
                        <span style={{ color: C.red }}>−{removedCount} removal{removedCount === 1 ? "" : "s"}</span>
                      </span>
                    ) : (
                      <span style={{ fontSize: 13.5, color: C.onSurfaceVariant }}>No changes — tick or untick to edit assignments</span>
                    )}
                  </div>
                  <button
                    onClick={mode === "course" ? saveRoster : saveUserCourses}
                    disabled={!hasChanges || saving}
                    style={{
                      height: 40, borderRadius: R.xl, border: "none", padding: "0 22px",
                      background: !hasChanges || saving ? C.secondaryContainer : C.primary,
                      color: !hasChanges || saving ? C.onSurfaceVariant : C.onPrimary,
                      fontSize: 14, fontWeight: 500, fontFamily: font, cursor: !hasChanges || saving ? "default" : "pointer",
                      boxShadow: !hasChanges || saving ? "none" : S.level2, transition: motion, flexShrink: 0, letterSpacing: "0.01em",
                    }}>
                    {saving ? "Saving…" : "Save assignments"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Snackbar */}
      {snackbar && (
        <div style={{
          position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)",
          background: snackbar.color, color: C.onPrimary, padding: "12px 22px",
          borderRadius: R.sm, fontSize: 14, fontWeight: 500, fontFamily: font,
          boxShadow: S.level2, zIndex: 1000, animation: "snackbarIn 0.25s cubic-bezier(0.2,0,0,1) both",
          maxWidth: "min(92vw, 640px)", boxSizing: "border-box",
        }}>
          {snackbar.message}
        </div>
      )}
    </div>
  );
}
