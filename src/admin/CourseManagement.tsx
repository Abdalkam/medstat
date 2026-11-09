
// src/admin/AssignCourses.tsx
// Medstat / Smartpages — Professional Medical Design
// Course Assignment Manager
//
// Features:
// - Assign trainers and trainees by course.
// - Assign courses by user.
// - Offline-first Dexie storage.
// - Background Supabase synchronization.
// - Tombstone-aware reconciliation.
// - Deep-link support from CourseManagement and UserManagement.
// - Currency displayed in UGX.
//
// Assignment writes continue through enrollmentDB, the canonical
// diff-based / tombstone-aware assignment engine.

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

/* ============================================================================
   PROFESSIONAL MEDICAL DESIGN SYSTEM
============================================================================ */

const C = {
  primary: "#1769AA",
  primaryDark: "#12558A",
  onPrimary: "#FFFFFF",

  primaryContainer: "#E8F2FA",
  onPrimaryContainer: "#123B5D",

  surface: "#FFFFFF",
  background: "#F5F7FA",

  onSurface: "#202B36",
  onSurfaceVariant: "#667482",

  secondaryContainer: "#E9EEF3",
  surfaceVariant: "#EDF2F6",

  outline: "#E1E7ED",
  outlineVariant: "#B8C5D1",

  inset: "#F7F9FB",
  skeletonBase: "#E9EEF3",

  green: "#21845B",
  greenBg: "#E8F5EE",

  orange: "#B7791F",
  orangeBg: "#FFF5DF",

  red: "#C74646",
  redBg: "#FCECEC",

  purple: "#1769AA",
  purpleBg: "#E8F2FA",

  blue: "#1769AA",
  blueBg: "#E8F2FA",

  freeText: "#1769AA",
  freeBg: "#E8F2FA",

  paidText: "#1769AA",
  paidBg: "#EDF2F6",
};

const font =
  "'Inter', 'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const S = {
  level1: "0 1px 3px rgba(25,45,65,0.06)",
  level2: "0 4px 12px rgba(25,45,65,0.10)",
};

const R = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
};

const gutter = "clamp(14px, 3vw, 28px)";
const PAGE_MAX = 1440;
const motion = "all 0.2s ease";

const cardBase: CSSProperties = {
  background: C.surface,
  borderRadius: R.lg,
  boxShadow: S.level1,
  border: `1px solid ${C.outline}`,
  boxSizing: "border-box",
  minWidth: 0,
};

/* ============================================================================
   HELPERS
============================================================================ */

function getAvatarColor(str: string) {
  const colors = [
    "#1769AA",
    "#21845B",
    "#527A9B",
    "#64748B",
    "#347D91",
    "#496B87",
  ];

  let hash = 0;

  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  return colors[Math.abs(hash) % colors.length];
}

/** Uganda Shillings formatter. */

function formatCurrency(
  amount: number | string | undefined | null
): string {
  if (amount === null || amount === undefined || amount === "") {
    return "0";
  }

  const num =
    typeof amount === "string"
      ? parseFloat(amount.replace(/,/g, ""))
      : amount;

  if (!Number.isFinite(num)) return "0";

  return num.toLocaleString("en-UG", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
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

function mapEnrollmentFromSupabase(
  e: any,
  tenantId: string
): any {
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

/* ============================================================================
   SMALL UI COMPONENTS
============================================================================ */

function Chip({
  label,
  bg,
  fg,
}: {
  label: string;
  bg: string;
  fg: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 9px",
        borderRadius: 7,
        background: bg,
        color: fg,
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: "0.01em",
        whiteSpace: "nowrap",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

function SectionHeader({
  title,
  right,
}: {
  title: string;
  right?: ReactNode;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "17px 16px 9px",
      }}
    >
      <span
        style={{
          fontSize: 13,
          color: C.onSurface,
          fontWeight: 650,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </span>

      {right}
    </div>
  );
}

function MiniTextButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none",
        background: "transparent",
        color: disabled ? C.outlineVariant : C.primary,
        fontSize: 12.5,
        fontWeight: 600,
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        padding: "7px 10px",
        borderRadius: 7,
        transition: motion,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.background = C.primaryContainer;
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

/** Professional checkbox. */

function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 19,
        height: 19,
        borderRadius: 5,
        flexShrink: 0,
        border: checked ? `1px solid ${C.primary}` : `1.7px solid ${C.outlineVariant}`,
        background: checked ? C.primary : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: motion,
      }}
    >
      {checked && (
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.onPrimary}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

function Avatar({
  name,
  pic,
  size = 36,
}: {
  name: string;
  pic?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: C.surfaceVariant,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {pic ? (
        <img
          src={pic}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: getAvatarColor(name || "?"),
            color: C.onPrimary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: size * 0.42,
            fontWeight: 600,
          }}
        >
          {(name || "?").charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/* ============================================================================
   COURSE ICON
============================================================================ */

function CourseIcon({
  logo,
  size = 40,
}: {
  logo?: string;
  size?: number;
}) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 10,
        background: logo ? "transparent" : C.primaryContainer,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {logo ? (
        <img
          src={logo}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
          }}
        />
      ) : (
        <svg
          width={size * 0.48}
          height={size * 0.48}
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.primary}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      )}
    </div>
  );
}

/* ============================================================================
   TICKABLE PERSON ROW
============================================================================ */

function PersonRow({
  user,
  checked,
  pending,
  onToggle,
}: {
  user: any;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        minHeight: 60,
        borderBottom: `1px solid ${C.outline}`,
        cursor: "pointer",
        background: checked ? C.primaryContainer : C.surface,
        transition: motion,
      }}
      onMouseEnter={(e) => {
        if (!checked) e.currentTarget.style.background = C.inset;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = checked
          ? C.primaryContainer
          : C.surface;
      }}
    >
      <CheckSquare checked={checked} />

      <Avatar
        name={user.username}
        pic={user.profilePic}
      />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            color: checked ? C.onPrimaryContainer : C.onSurface,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.username}
        </div>

        <div
          style={{
            fontSize: 12,
            color: checked ? C.onPrimaryContainer : C.onSurfaceVariant,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            marginTop: 3,
          }}
        >
          {user.phone || user.email || "No contact information"}
        </div>
      </div>

      {pending && (
        <Chip
          label="Pending"
          bg={C.orangeBg}
          fg={C.orange}
        />
      )}
    </div>
  );
}

/* ============================================================================
   TICKABLE COURSE ROW
============================================================================ */

function CourseRow({
  course,
  checked,
  pending,
  onToggle,
}: {
  course: any;
  checked: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const paid = course.tuitionType === "paid";

  return (
    <div
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        minHeight: 60,
        borderBottom: `1px solid ${C.outline}`,
        cursor: "pointer",
        background: checked ? C.primaryContainer : C.surface,
        transition: motion,
      }}
      onMouseEnter={(e) => {
        if (!checked) e.currentTarget.style.background = C.inset;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = checked
          ? C.primaryContainer
          : C.surface;
      }}
    >
      <CheckSquare checked={checked} />

      <CourseIcon logo={course.logo} size={38} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13.5,
            color: checked ? C.onPrimaryContainer : C.onSurface,
            fontWeight: 600,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {course.name}
        </div>

        <div
          style={{
            fontSize: 12,
            color: checked ? C.onPrimaryContainer : C.onSurfaceVariant,
            marginTop: 3,
          }}
        >
          {paid
            ? `UGX ${formatCurrency(course.amount)}`
            : "Free course"}
        </div>
      </div>

      {pending && (
        <Chip
          label="Pending"
          bg={C.orangeBg}
          fg={C.orange}
        />
      )}
    </div>
  );
}

/* ============================================================================
   SKELETON
============================================================================ */

function SkeletonRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "13px 16px",
        minHeight: 58,
        borderBottom: `1px solid ${C.outline}`,
      }}
    >
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          background: C.skeletonBase,
          animation: "acShimmer 1.5s ease-in-out infinite",
          flexShrink: 0,
          marginRight: 12,
        }}
      />

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        <div
          style={{
            width: "40%",
            height: 12,
            borderRadius: 4,
            background: C.skeletonBase,
            animation: "acShimmer 1.5s ease-in-out infinite",
          }}
        />

        <div
          style={{
            width: "60%",
            height: 10,
            borderRadius: 4,
            background: C.skeletonBase,
            animation: "acShimmer 1.5s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}

/* ============================================================================
   SEARCH BOX
============================================================================ */

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div
      style={{
        position: "relative",
        height: 42,
        boxSizing: "border-box",
      }}
    >
      <svg
        style={{
          position: "absolute",
          left: 13,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: C.onSurfaceVariant,
        }}
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>

      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          height: 42,
          paddingLeft: 40,
          paddingRight: value ? 40 : 14,
          backgroundColor: C.inset,
          border: `1px solid ${C.outline}`,
          borderRadius: 10,
          fontSize: 13,
          color: C.onSurface,
          outline: "none",
          fontFamily: font,
          boxSizing: "border-box",
          transition: motion,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = C.primary;
          e.currentTarget.style.background = C.surface;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = C.outline;
          e.currentTarget.style.background = C.inset;
        }}
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            position: "absolute",
            right: 5,
            top: "50%",
            transform: "translateY(-50%)",
            width: 30,
            height: 30,
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            color: C.onSurfaceVariant,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: font,
            fontSize: 19,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ============================================================================
   EMPTY STATE
============================================================================ */

function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div
      style={{
        padding: "65px 24px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: 18,
          background: C.primaryContainer,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 17,
        }}
      >
        <svg
          width="29"
          height="29"
          viewBox="0 0 24 24"
          fill="none"
          stroke={C.primary}
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>

      <div
        style={{
          color: C.onSurface,
          fontSize: 15,
          fontWeight: 650,
        }}
      >
        {title}
      </div>

      <div
        style={{
          color: C.onSurfaceVariant,
          fontSize: 13,
          marginTop: 7,
          lineHeight: 1.6,
          maxWidth: 300,
        }}
      >
        {description}
      </div>
    </div>
  );
}

/* ============================================================================
   MAIN COMPONENT
============================================================================ */

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

  const [selectedCourseId, setSelectedCourseId] =
    useState<string | null>(initialCourseId ?? null);

  const [selectedUserId, setSelectedUserId] =
    useState<string | null>(initialUserId ?? null);

  // Draft contains user IDs in course mode and course IDs in user mode.
  const [draft, setDraft] = useState<Set<string>>(new Set());

  const [courseSearch, setCourseSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [detailSearch, setDetailSearch] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [snackbar, setSnackbar] = useState<{
    message: string;
    color: string;
  } | null>(null);

  const loadSeqRef = useRef(0);
  const bootstrappedRef = useRef(false);

  /* --------------------------------------------------------------------------
     SNACKBAR
  -------------------------------------------------------------------------- */

  useEffect(() => {
    if (!snackbar) return;

    const t = setTimeout(() => setSnackbar(null), 3500);

    return () => clearTimeout(t);
  }, [snackbar]);

  const showSnack = (
    message: string,
    color: string = C.green
  ) => {
    setSnackbar({ message, color });
  };

  /* --------------------------------------------------------------------------
     DATA LOAD
     Local database first, Supabase merge second.
     -------------------------------------------------------------------------- */

  async function loadData() {
    const seq = ++loadSeqRef.current;

    const stale = () => seq !== loadSeqRef.current;

    let cu: any = {};

    try {
      cu = JSON.parse(
        localStorage.getItem("currentUser") || "{}"
      );
    } catch {
      // Ignore malformed local storage.
    }

    const tenantId =
      cu?.tenantId || cu?.tenant_id || "";

    // STEP 1: Immediate local paint.

    let localUsers: any[] = [];
    let localCourses: any[] = [];
    let localRows: any[] = [];

    try {
      localUsers = (
        await db.users.toArray()
      ).filter((u: any) => u.role !== "admin");
    } catch {
      // Continue with available data.
    }

    try {
      localCourses = await db.courses.toArray();
    } catch {
      // Continue with available data.
    }

    try {
      localRows = (await getEnrollments(tenantId)) as any[];
    } catch {
      // Continue with available data.
    }

    if (!stale()) {
      setUsers(localUsers);
      setCourses(localCourses);
      setEnrollRows(localRows);
      setIsLoading(false);
    }

    // STEP 2: Background synchronization.

    if (tenantId && navigator.onLine) {
      try {
        await syncPendingEnrollments(tenantId);

        const [uRes, cRes, eRes] = await Promise.all([
          supabase
            .from("users")
            .select("*")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null),

          supabase
            .from("courses")
            .select("*")
            .eq("tenant_id", tenantId)
            .is("deleted_at", null),

          supabase
            .from("enrollments")
            .select("*")
            .eq("tenant_id", tenantId),
        ]);

        if (uRes.error) throw uRes.error;
        if (cRes.error) throw cRes.error;
        if (eRes.error) throw eRes.error;

        const [dU, dC, dE] = await Promise.all([
          getDeletedIds("user"),
          getDeletedIds("course"),
          getDeletedIds("enrollment"),
        ]);

        const deadUsers = new Set(dU);
        const deadCourses = new Set(dC);
        const deadEnroll = new Set(dE);

        for (const u of uRes.data || []) {
          if (
            u.role !== "admin" &&
            !deadUsers.has(u.id)
          ) {
            await db.users.put(
              mapUserFromSupabase(u)
            );
          }
        }

        for (const c of cRes.data || []) {
          if (!deadCourses.has(c.id)) {
            await db.courses.put(
              mapCourseFromSupabase(c)
            );
          }
        }

        for (const e of eRes.data || []) {
          if (
            e.deleted_at ||
            deadEnroll.has(e.id) ||
            deadEnroll.has(`${e.user_id}:${e.course_id}`)
          ) {
            continue;
          }

          await db.enrollments.put(
            mapEnrollmentFromSupabase(e, tenantId)
          );
        }

        await reconcileAllEnrollments(tenantId);

        if (!stale()) {
          const freshUsers = (
            await db.users.toArray()
          ).filter((u: any) => u.role !== "admin");

          const freshCourses = await db.courses.toArray();

          const freshRows =
            (await getEnrollments(tenantId)) as any[];

          setUsers(freshUsers);
          setCourses(freshCourses);
          setEnrollRows(freshRows);
        }
      } catch (e) {
        console.warn(
          "AssignCourses: remote merge failed, using local DB",
          e
        );
      }
    }
  }

  useEffect(() => {
    loadData();

    // Invalidate outstanding loads when the component unmounts.
    return () => {
      loadSeqRef.current++;
    };
  }, []);

  /* --------------------------------------------------------------------------
     DEEP-LINK BOOTSTRAP
  -------------------------------------------------------------------------- */

  useEffect(() => {
    if (isLoading || bootstrappedRef.current) return;

    bootstrappedRef.current = true;

    if (mode === "course" && selectedCourseId) {
      setDraft(
        new Set(
          enrollRows
            .filter((r) => r.courseId === selectedCourseId)
            .map((r) => r.userId)
        )
      );
    } else if (mode === "user" && selectedUserId) {
      setDraft(
        new Set(
          enrollRows
            .filter((r) => r.userId === selectedUserId)
            .map((r) => r.courseId)
        )
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  /* --------------------------------------------------------------------------
     DERIVED STATE
  -------------------------------------------------------------------------- */

  const selectedCourse = useMemo(
    () =>
      courses.find((c) => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const selectedUser = useMemo(
    () =>
      users.find((u) => u.id === selectedUserId) || null,
    [users, selectedUserId]
  );

  const membersByCourse = useMemo(() => {
    const m = new Map<string, Set<string>>();

    for (const r of enrollRows) {
      if (!m.has(r.courseId)) {
        m.set(r.courseId, new Set());
      }

      m.get(r.courseId)!.add(r.userId);
    }

    return m;
  }, [enrollRows]);

  const coursesByUser = useMemo(() => {
    const m = new Map<string, Set<string>>();

    for (const r of enrollRows) {
      if (!m.has(r.userId)) {
        m.set(r.userId, new Set());
      }

      m.get(r.userId)!.add(r.courseId);
    }

    return m;
  }, [enrollRows]);

  // Pending sync state for each assignment pair.

  const pendingPairs = useMemo(() => {
    const m = new Map<string, boolean>();

    for (const r of enrollRows) {
      const key = `${r.userId}:${r.courseId}`;

      if (!m.has(key)) {
        m.set(key, r.synced === false);
      } else {
        m.set(
          key,
          m.get(key)! || r.synced === false
        );
      }
    }

    return m;
  }, [enrollRows]);

  const trainers = useMemo(
    () => users.filter((u) => u.role === "trainer"),
    [users]
  );

  const trainees = useMemo(
    () => users.filter((u) => u.role === "trainee"),
    [users]
  );

  /* --------------------------------------------------------------------------
     FILTERING
  -------------------------------------------------------------------------- */

  const filteredCourseList = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();

    if (!q) return courses;

    return courses.filter((c: any) =>
      (c.name || "").toLowerCase().includes(q) ||
      (c.description || "").toLowerCase().includes(q) ||
      (c.tuitionType || "").toLowerCase().includes(q)
    );
  }, [courses, courseSearch]);

  const filteredUserList = useMemo(() => {
    const q = userSearch.trim().toLowerCase();

    if (!q) return users;

    return users.filter((u: any) =>
      (u.username || "").toLowerCase().includes(q) ||
      (u.phone || "").toLowerCase().includes(q) ||
      (u.email || "").toLowerCase().includes(q) ||
      (u.role || "").toLowerCase().includes(q)
    );
  }, [users, userSearch]);

  const detailQuery = detailSearch.trim().toLowerCase();

  const filteredTrainers = useMemo(() => {
    if (!detailQuery) return trainers;

    return trainers.filter((u: any) =>
      (u.username || "").toLowerCase().includes(detailQuery) ||
      (u.phone || "").toLowerCase().includes(detailQuery) ||
      (u.email || "").toLowerCase().includes(detailQuery)
    );
  }, [trainers, detailQuery]);

  const filteredTrainees = useMemo(() => {
    if (!detailQuery) return trainees;

    return trainees.filter((u: any) =>
      (u.username || "").toLowerCase().includes(detailQuery) ||
      (u.phone || "").toLowerCase().includes(detailQuery) ||
      (u.email || "").toLowerCase().includes(detailQuery)
    );
  }, [trainees, detailQuery]);

  const filteredCoursesDetail = useMemo(() => {
    if (!detailQuery) return courses;

    return courses.filter((c: any) =>
      (c.name || "").toLowerCase().includes(detailQuery) ||
      (c.tuitionType || "").toLowerCase().includes(detailQuery)
    );
  }, [courses, detailQuery]);

  /* --------------------------------------------------------------------------
     CURRENT ASSIGNMENTS AND DIFF
  -------------------------------------------------------------------------- */

  const currentSet = useMemo(() => {
    if (mode === "course" && selectedCourseId) {
      return (
        membersByCourse.get(selectedCourseId) ||
        new Set<string>()
      );
    }

    if (mode === "user" && selectedUserId) {
      return (
        coursesByUser.get(selectedUserId) ||
        new Set<string>()
      );
    }

    return new Set<string>();
  }, [
    mode,
    selectedCourseId,
    selectedUserId,
    membersByCourse,
    coursesByUser,
  ]);

  const addedCount = useMemo(
    () =>
      [...draft].filter((id) => !currentSet.has(id)).length,
    [draft, currentSet]
  );

  const removedCount = useMemo(
    () =>
      [...currentSet].filter((id) => !draft.has(id)).length,
    [draft, currentSet]
  );

  const hasChanges = addedCount > 0 || removedCount > 0;

  /* --------------------------------------------------------------------------
     SELECTION ACTIONS
  -------------------------------------------------------------------------- */

  function selectCourse(id: string) {
    setSelectedCourseId(id);

    setDraft(
      new Set(membersByCourse.get(id) || [])
    );

    setDetailSearch("");
  }

  function selectUser(id: string) {
    setSelectedUserId(id);

    setDraft(
      new Set(coursesByUser.get(id) || [])
    );

    setDetailSearch("");
  }

  function toggleDraft(id: string) {
    setDraft((prev) => {
      const next = new Set(prev);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  function setSectionAll(ids: string[], on: boolean) {
    setDraft((prev) => {
      const next = new Set(prev);

      for (const id of ids) {
        if (on) {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      return next;
    });
  }

  /* --------------------------------------------------------------------------
     SAVE COURSE ROSTER
  -------------------------------------------------------------------------- */

  async function saveRoster() {
    if (!selectedCourse || saving) return;

    setSaving(true);

    try {
      const res = await applyCourseAssignments({
        courseId: selectedCourse.id,
        userIds: [...draft],
      });

      // Best-effort mirror of assigned_courses.
      for (const uid of res.touchedUsers) {
        pushUserAssignmentsMirror(uid).catch(
          () => undefined
        );
      }

      showSnack(
        res.cloudSynced
          ? `Roster saved — ${res.added.length} added, ${res.removed.length} removed · Synced`
          : `Roster saved locally — ${res.added.length} added, ${res.removed.length} removed · Will retry when online`,
        res.cloudSynced ? C.green : C.orange
      );

      await loadData();

      const rows = (await getEnrollments()) as any[];

      setEnrollRows(rows);

      setDraft(
        new Set(
          rows
            .filter((r) => r.courseId === selectedCourse.id)
            .map((r) => r.userId)
        )
      );
    } catch (e: any) {
      showSnack(
        e?.message || "Could not save the roster.",
        C.red
      );
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------------------
     SAVE USER COURSES
  -------------------------------------------------------------------------- */

  async function saveUserCourses() {
    if (!selectedUser || saving) return;

    setSaving(true);

    try {
      const res = await applyUserAssignments({
        userId: selectedUser.id,
        courseIds: [...draft],
      });

      if (res.cloudSynced) {
        pushUserAssignmentsMirror(
          selectedUser.id
        ).catch(() => undefined);
      }

      showSnack(
        res.cloudSynced
          ? `Courses saved — ${res.added.length} added, ${res.removed.length} removed · Synced`
          : `Courses saved locally — ${res.added.length} added, ${res.removed.length} removed · Will retry when online`,
        res.cloudSynced ? C.green : C.orange
      );

      await loadData();

      const rows = (await getEnrollments()) as any[];

      setEnrollRows(rows);

      setDraft(
        new Set(
          rows
            .filter((r) => r.userId === selectedUser.id)
            .map((r) => r.courseId)
        )
      );
    } catch (e: any) {
      showSnack(
        e?.message || "Could not save the courses.",
        C.red
      );
    } finally {
      setSaving(false);
    }
  }

  /* --------------------------------------------------------------------------
     TUITION STYLE
  -------------------------------------------------------------------------- */

  const tuitionPill = (
    course: any
  ): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    padding: "4px 9px",
    borderRadius: 7,
    background:
      course.tuitionType === "paid"
        ? C.paidBg
        : C.freeBg,
    color:
      course.tuitionType === "paid"
        ? C.paidText
        : C.freeText,
    fontSize: 11.5,
    fontWeight: 600,
    whiteSpace: "nowrap",
    flexShrink: 0,
  });

  /* ==========================================================================
     RENDER
  ========================================================================== */

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100%",
        background: C.background,
        fontFamily: font,
        boxSizing: "border-box",
        overflowX: "hidden",
        color: C.onSurface,
      }}
    >
      <style>{`
        @keyframes acShimmer {
          0% { opacity: 1; }
          50% { opacity: 0.4; }
          100% { opacity: 1; }
        }

        @keyframes acFadeUp {
          from {
            opacity: 0;
            transform: translateY(6px);
          }
          to {
            opacity: 1;
            transform: none;
          }
        }

        @keyframes acSnackbar {
          from {
            transform: translate(-50%, 15px);
            opacity: 0;
          }
          to {
            transform: translate(-50%, 0);
            opacity: 1;
          }
        }

        .acLayout {
          display: grid;
          grid-template-columns: minmax(280px, 370px) minmax(0, 1fr);
          gap: 20px;
          align-items: stretch;
        }

        .acMaster,
        .acDetail {
          min-width: 0;
          min-height: 520px;
        }

        .acList {
          max-height: min(620px, 70vh);
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        .acDetailList {
          max-height: min(560px, 62vh);
          overflow-y: auto;
          flex: 1;
          overscroll-behavior: contain;
        }

        .acList::-webkit-scrollbar,
        .acDetailList::-webkit-scrollbar {
          width: 6px;
        }

        .acList::-webkit-scrollbar-thumb,
        .acDetailList::-webkit-scrollbar-thumb {
          background: #CBD5DF;
          border-radius: 10px;
        }

        .acList::-webkit-scrollbar-track,
        .acDetailList::-webkit-scrollbar-track {
          background: transparent;
        }

        .acLayout button:focus-visible,
        .acLayout input:focus-visible {
          outline: 2px solid ${C.primary};
          outline-offset: 2px;
        }

        @media (max-width: 880px) {
          .acLayout {
            grid-template-columns: 1fr;
            gap: 16px;
          }

          .acMaster,
          .acDetail {
            min-height: auto;
          }

          .acList {
            max-height: 380px;
          }

          .acDetailList {
            max-height: 480px;
          }
        }

        @media (max-width: 480px) {
          .acLayout {
            gap: 12px;
          }

          .acSaveBar {
            flex-wrap: wrap;
          }

          .acSaveButton {
            width: 100%;
          }
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: PAGE_MAX,
          margin: "0 auto",
          padding: `20px ${gutter} 36px`,
          boxSizing: "border-box",
        }}
      >
        {/* ==================================================================
            PAGE HEADER
        ================================================================== */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 14,
            columnGap: 16,
            width: "100%",
            animation: "acFadeUp 0.35s ease both",
          }}
        >
          <div style={{ flex: "1 1 230px", minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                color: C.onSurface,
                fontSize: "clamp(23px, 3vw, 28px)",
                fontWeight: 650,
                letterSpacing: "-0.7px",
                lineHeight: 1.3,
              }}
            >
              Course Assignments
            </h1>

            <p
              style={{
                margin: "6px 0 0",
                color: C.onSurfaceVariant,
                fontSize: 13.5,
                fontWeight: 400,
                lineHeight: 1.5,
              }}
            >
              Manage course enrolment for trainers and trainees
            </p>
          </div>

          {/* MODE SWITCH */}

          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: 4,
              border: `1px solid ${C.outline}`,
              borderRadius: 11,
              background: C.surface,
              gap: 3,
              flexShrink: 0,
            }}
          >
            {(
              [
                ["course", "By Course"],
                ["user", "By User"],
              ] as const
            ).map(([key, label]) => {
              const active = mode === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    if (mode !== key) {
                      setMode(key);
                      setSelectedCourseId(null);
                      setSelectedUserId(null);
                      setDraft(new Set());
                      setDetailSearch("");
                    }
                  }}
                  style={{
                    border: "none",
                    borderRadius: 8,
                    background: active
                      ? C.primary
                      : "transparent",
                    color: active
                      ? C.onPrimary
                      : C.onSurfaceVariant,
                    padding: "9px 17px",
                    fontSize: 13,
                    fontWeight: active ? 600 : 500,
                    fontFamily: font,
                    cursor: "pointer",
                    minHeight: 37,
                    transition: motion,
                    whiteSpace: "nowrap",
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* ==================================================================
            MASTER LIST + DETAIL PANEL
        ================================================================== */}

        <div
          className="acLayout"
          style={{
            paddingTop: 20,
            animation: "acFadeUp 0.4s ease both",
          }}
        >
          {/* ================================================================
              MASTER LIST
          ================================================================ */}

          <div
            className="acMaster"
            style={{
              ...cardBase,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* MASTER HEADER */}

            <div
              style={{
                padding: "15px 16px",
                borderBottom: `1px solid ${C.outline}`,
                background: C.surface,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 650,
                    color: C.onSurface,
                  }}
                >
                  {mode === "course"
                    ? "Available courses"
                    : "Users and trainers"}
                </span>

                <Chip
                  label={
                    mode === "course"
                      ? `${courses.length} courses`
                      : `${users.length} users`
                  }
                  bg={C.primaryContainer}
                  fg={C.primary}
                />
              </div>

              {mode === "course" ? (
                <SearchBox
                  value={courseSearch}
                  onChange={setCourseSearch}
                  placeholder="Search courses..."
                />
              ) : (
                <SearchBox
                  value={userSearch}
                  onChange={setUserSearch}
                  placeholder="Search people..."
                />
              )}
            </div>

            {/* MASTER CONTENT */}

            {isLoading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : mode === "course" ? (
              filteredCourseList.length === 0 ? (
                <div
                  style={{
                    padding: "35px 18px",
                    textAlign: "center",
                    color: C.onSurfaceVariant,
                    fontSize: 13,
                    lineHeight: 1.6,
                  }}
                >
                  {courses.length === 0
                    ? "No courses yet. Create a course in Course Management."
                    : `No courses match "${courseSearch}"`}
                </div>
              ) : (
                <div className="acList">
                  {filteredCourseList.map((course: any) => {
                    const memberCount =
                      membersByCourse.get(course.id)?.size || 0;

                    const active =
                      course.id === selectedCourseId;

                    return (
                      <div
                        key={course.id}
                        onClick={() => selectCourse(course.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" ||
                            e.key === " "
                          ) {
                            e.preventDefault();
                            selectCourse(course.id);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          padding: "12px 16px",
                          minHeight: 66,
                          borderBottom: `1px solid ${C.outline}`,
                          cursor: "pointer",
                          background: active
                            ? C.primaryContainer
                            : C.surface,
                          borderLeft: active
                            ? `3px solid ${C.primary}`
                            : "3px solid transparent",
                          transition: motion,
                          boxSizing: "border-box",
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.background =
                              C.inset;
                          }
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background =
                            active
                              ? C.primaryContainer
                              : C.surface;
                        }}
                      >
                        <CourseIcon
                          logo={course.logo}
                          size={42}
                        />

                        <div
                          style={{
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 13.5,
                              color: active
                                ? C.onPrimaryContainer
                                : C.onSurface,
                              fontWeight: 600,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {course.name}
                          </div>

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              flexWrap: "wrap",
                              gap: 8,
                              marginTop: 6,
                            }}
                          >
                            <span style={tuitionPill(course)}>
                              {course.tuitionType === "paid"
                                ? `UGX ${formatCurrency(course.amount)}`
                                : "Free"}
                            </span>

                            <span
                              style={{
                                fontSize: 11.5,
                                color: active
                                  ? C.onPrimaryContainer
                                  : C.onSurfaceVariant,
                              }}
                            >
                              {memberCount} assigned
                            </span>
                          </div>
                        </div>

                        {active && (
                          <svg
                            width="17"
                            height="17"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke={C.primary}
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                        )}
                      </div>
                    );
                  })}
                </div>
              )
            ) : filteredUserList.length === 0 ? (
              <div
                style={{
                  padding: "35px 18px",
                  textAlign: "center",
                  color: C.onSurfaceVariant,
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {users.length === 0
                  ? "No accounts yet. Create accounts in User Management."
                  : `No people match "${userSearch}"`}
              </div>
            ) : (
              <div className="acList">
                {filteredUserList.map((u: any) => {
                  const courseCount =
                    coursesByUser.get(u.id)?.size || 0;

                  const active = u.id === selectedUserId;

                  const isTrainer = u.role === "trainer";

                  return (
                    <div
                      key={u.id}
                      onClick={() => selectUser(u.id)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" ||
                          e.key === " "
                        ) {
                          e.preventDefault();
                          selectUser(u.id);
                        }
                      }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        padding: "12px 16px",
                        minHeight: 66,
                        borderBottom: `1px solid ${C.outline}`,
                        cursor: "pointer",
                        background: active
                          ? C.primaryContainer
                          : C.surface,
                        borderLeft: active
                          ? `3px solid ${C.primary}`
                          : "3px solid transparent",
                        transition: motion,
                        boxSizing: "border-box",
                      }}
                      onMouseEnter={(e) => {
                        if (!active) {
                          e.currentTarget.style.background =
                            C.inset;
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background =
                          active
                            ? C.primaryContainer
                            : C.surface;
                      }}
                    >
                      <Avatar
                        name={u.username}
                        pic={u.profilePic}
                        size={42}
                      />

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 13.5,
                            color: active
                              ? C.onPrimaryContainer
                              : C.onSurface,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {u.username}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            marginTop: 6,
                          }}
                        >
                          <Chip
                            label={
                              isTrainer ? "Trainer" : "Trainee"
                            }
                            bg={C.primaryContainer}
                            fg={C.primary}
                          />

                          <span
                            style={{
                              fontSize: 11.5,
                              color: active
                                ? C.onPrimaryContainer
                                : C.onSurfaceVariant,
                            }}
                          >
                            {courseCount} course
                            {courseCount === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>

                      {active && (
                        <svg
                          width="17"
                          height="17"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={C.primary}
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <polyline points="9 18 15 12 9 6" />
                        </svg>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ================================================================
              DETAIL PANEL
          ================================================================ */}

          <div
            className="acDetail"
            style={{
              ...cardBase,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
              animationDelay: "60ms",
            }}
          >
            {/* NO COURSE SELECTED */}

            {!selectedCourse && mode === "course" ? (
              <EmptyState
                title="Select a course"
                description="Choose a course from the list to manage its trainers and trainee enrolments."
              />
            ) : !selectedUser && mode === "user" ? (
              <EmptyState
                title="Select a user"
                description="Choose a trainer or trainee to manage their course assignments."
              />
            ) : (
              <>
                {/* DETAIL HEADER */}

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 13,
                    padding: "16px 18px",
                    borderBottom: `1px solid ${C.outline}`,
                    background: C.surface,
                  }}
                >
                  {mode === "course" && selectedCourse ? (
                    <>
                      <CourseIcon
                        logo={selectedCourse.logo}
                        size={46}
                      />

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 15,
                            color: C.onSurface,
                            fontWeight: 650,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {selectedCourse.name}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 9,
                            marginTop: 6,
                          }}
                        >
                          <span style={tuitionPill(selectedCourse)}>
                            {selectedCourse.tuitionType === "paid"
                              ? `UGX ${formatCurrency(selectedCourse.amount)}`
                              : "Free course"}
                          </span>

                          <span
                            style={{
                              fontSize: 11.5,
                              color: C.onSurfaceVariant,
                            }}
                          >
                            {currentSet.size} currently assigned
                          </span>
                        </div>
                      </div>
                    </>
                  ) : selectedUser ? (
                    <>
                      <Avatar
                        name={selectedUser.username}
                        pic={selectedUser.profilePic}
                        size={46}
                      />

                      <div
                        style={{
                          flex: 1,
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 15,
                            color: C.onSurface,
                            fontWeight: 650,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {selectedUser.username}
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 9,
                            marginTop: 6,
                          }}
                        >
                          <Chip
                            label={
                              selectedUser.role === "trainer"
                                ? "Trainer"
                                : "Trainee"
                            }
                            bg={C.primaryContainer}
                            fg={C.primary}
                          />

                          <span
                            style={{
                              fontSize: 11.5,
                              color: C.onSurfaceVariant,
                            }}
                          >
                            {currentSet.size} currently assigned
                          </span>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>

                {/* DETAIL SEARCH */}

                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: `1px solid ${C.outline}`,
                    background: C.surface,
                  }}
                >
                  <SearchBox
                    value={detailSearch}
                    onChange={setDetailSearch}
                    placeholder={
                      mode === "course"
                        ? "Search trainers and trainees..."
                        : "Search available courses..."
                    }
                  />
                </div>

                {/* ========================================================
                    ASSIGNMENT LIST
                ======================================================== */}

                <div className="acDetailList">
                  {mode === "course" && selectedCourse ? (
                    <>
                      {/* TRAINERS */}

                      <SectionHeader
                        title={`Trainers (${filteredTrainers.filter((u: any) => draft.has(u.id)).length}/${filteredTrainers.length})`}
                        right={
                          <div
                            style={{
                              display: "flex",
                              gap: 2,
                            }}
                          >
                            <MiniTextButton
                              label="Tick all"
                              onClick={() =>
                                setSectionAll(
                                  filteredTrainers.map(
                                    (u: any) => u.id
                                  ),
                                  true
                                )
                              }
                            />

                            <MiniTextButton
                              label="Clear"
                              onClick={() =>
                                setSectionAll(
                                  filteredTrainers.map(
                                    (u: any) => u.id
                                  ),
                                  false
                                )
                              }
                            />
                          </div>
                        }
                      />

                      {filteredTrainers.length === 0 ? (
                        <div
                          style={{
                            padding: 20,
                            color: C.onSurfaceVariant,
                            fontSize: 12.5,
                            textAlign: "center",
                          }}
                        >
                          {trainers.length === 0
                            ? "No trainers available."
                            : `No trainers match "${detailSearch}"`}
                        </div>
                      ) : (
                        filteredTrainers.map((u: any) => (
                          <PersonRow
                            key={u.id}
                            user={u}
                            checked={draft.has(u.id)}
                            pending={
                              pendingPairs.get(
                                `${u.id}:${selectedCourse.id}`
                              ) === true
                            }
                            onToggle={() =>
                              toggleDraft(u.id)
                            }
                          />
                        ))
                      )}

                      {/* TRAINEES */}

                      <SectionHeader
                        title={`Trainees (${filteredTrainees.filter((u: any) => draft.has(u.id)).length}/${filteredTrainees.length})`}
                        right={
                          <div
                            style={{
                              display: "flex",
                              gap: 2,
                            }}
                          >
                            <MiniTextButton
                              label="Tick all"
                              onClick={() =>
                                setSectionAll(
                                  filteredTrainees.map(
                                    (u: any) => u.id
                                  ),
                                  true
                                )
                              }
                            />

                            <MiniTextButton
                              label="Clear"
                              onClick={() =>
                                setSectionAll(
                                  filteredTrainees.map(
                                    (u: any) => u.id
                                  ),
                                  false
                                )
                              }
                            />
                          </div>
                        }
                      />

                      {filteredTrainees.length === 0 ? (
                        <div
                          style={{
                            padding: 20,
                            color: C.onSurfaceVariant,
                            fontSize: 12.5,
                            textAlign: "center",
                          }}
                        >
                          {trainees.length === 0
                            ? "No trainees available."
                            : `No trainees match "${detailSearch}"`}
                        </div>
                      ) : (
                        filteredTrainees.map((u: any) => (
                          <PersonRow
                            key={u.id}
                            user={u}
                            checked={draft.has(u.id)}
                            pending={
                              pendingPairs.get(
                                `${u.id}:${selectedCourse.id}`
                              ) === true
                            }
                            onToggle={() =>
                              toggleDraft(u.id)
                            }
                          />
                        ))
                      )}
                    </>
                  ) : selectedUser ? (
                    <>
                      {/* USER COURSES */}

                      <SectionHeader
                        title={`Available courses (${filteredCoursesDetail.filter((c: any) => draft.has(c.id)).length}/${filteredCoursesDetail.length})`}
                        right={
                          <div
                            style={{
                              display: "flex",
                              gap: 2,
                            }}
                          >
                            <MiniTextButton
                              label="Tick all"
                              onClick={() =>
                                setSectionAll(
                                  filteredCoursesDetail.map(
                                    (c: any) => c.id
                                  ),
                                  true
                                )
                              }
                            />

                            <MiniTextButton
                              label="Clear"
                              onClick={() =>
                                setSectionAll(
                                  filteredCoursesDetail.map(
                                    (c: any) => c.id
                                  ),
                                  false
                                )
                              }
                            />
                          </div>
                        }
                      />

                      {filteredCoursesDetail.length === 0 ? (
                        <div
                          style={{
                            padding: "24px 16px",
                            color: C.onSurfaceVariant,
                            fontSize: 12.5,
                            textAlign: "center",
                          }}
                        >
                          {courses.length === 0
                            ? "No courses available. Create a course in Course Management."
                            : `No courses match "${detailSearch}"`}
                        </div>
                      ) : (
                        filteredCoursesDetail.map((c: any) => (
                          <CourseRow
                            key={c.id}
                            course={c}
                            checked={draft.has(c.id)}
                            pending={
                              pendingPairs.get(
                                `${selectedUser.id}:${c.id}`
                              ) === true
                            }
                            onToggle={() =>
                              toggleDraft(c.id)
                            }
                          />
                        ))
                      )}
                    </>
                  ) : null}
                </div>

                {/* ========================================================
                    SAVE BAR
                ======================================================== */}

                <div
                  className="acSaveBar"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "14px 17px",
                    borderTop: `1px solid ${C.outline}`,
                    background: C.surface,
                    marginTop: "auto",
                  }}
                >
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    {hasChanges ? (
                      <div>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 650,
                            color: C.onSurface,
                          }}
                        >
                          Unsaved changes
                        </div>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: 10,
                            marginTop: 5,
                          }}
                        >
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: C.green,
                            }}
                          >
                            +{addedCount} added
                          </span>

                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 600,
                              color: C.red,
                            }}
                          >
                            −{removedCount} removed
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div
                          style={{
                            fontSize: 12.5,
                            fontWeight: 600,
                            color: C.onSurfaceVariant,
                          }}
                        >
                          All changes saved
                        </div>

                        <div
                          style={{
                            fontSize: 11.5,
                            color: C.onSurfaceVariant,
                            marginTop: 4,
                          }}
                        >
                          Tick or untick to edit assignments
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    className="acSaveButton"
                    onClick={
                      mode === "course"
                        ? saveRoster
                        : saveUserCourses
                    }
                    disabled={!hasChanges || saving}
                    style={{
                      height: 42,
                      borderRadius: 10,
                      border: "none",
                      padding: "0 24px",
                      background:
                        !hasChanges || saving
                          ? C.secondaryContainer
                          : C.primary,
                      color:
                        !hasChanges || saving
                          ? C.onSurfaceVariant
                          : C.onPrimary,
                      fontSize: 13,
                      fontWeight: 600,
                      fontFamily: font,
                      cursor:
                        !hasChanges || saving
                          ? "default"
                          : "pointer",
                      boxShadow:
                        !hasChanges || saving
                          ? "none"
                          : "0 2px 5px rgba(23,105,170,0.20)",
                      transition: motion,
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      if (hasChanges && !saving) {
                        e.currentTarget.style.background =
                          C.primaryDark;
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (hasChanges && !saving) {
                        e.currentTarget.style.background =
                          C.primary;
                      }
                    }}
                  >
                    {saving
                      ? "Saving..."
                      : "Save assignments"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ====================================================================
          SNACKBAR
      ==================================================================== */}

      {snackbar && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            background: snackbar.color,
            color: C.onPrimary,
            padding: "13px 22px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            fontFamily: font,
            boxShadow: S.level2,
            zIndex: 1000,
            animation: "acSnackbar 0.25s ease both",
            maxWidth: "min(92vw, 640px)",
            boxSizing: "border-box",
            textAlign: "center",
          }}
        >
          {snackbar.message}
        </div>
      )}
    </div>
  );
}
