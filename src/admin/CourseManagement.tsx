// src/admin/CourseManagement.tsx — v1: single-screen course CRUD + member assignment
// Medstat — Material Design 3 (Android) redesign — master/detail course layout
//
// WHAT THIS SCREEN DOES
//  • Course CRUD in one place: searchable course list, inline Details form
//    (name, description, Free/Paid tuition + UGX amount, start date, period,
//    logo), "+ New course" dialog, and a confirmed Delete that cascades
//    locally and soft-deletes in the cloud.
//  • Attaching users to courses: a Members tab per course — tick trainers and
//    trainees, "Save roster" runs enrollmentDB.applyCourseAssignments, the
//    canonical diff-based / tombstone-aware assignment engine. Unchecking a
//    member REMOVES the enrollment (locally + in the cloud), so unchecked
//    members cannot resurrect on the next pull.
//  • Offline-first: local Dexie paints immediately; a background merge pulls
//    courses through supabaseCourseSync.fetchCoursesFromSupabase (SHAPE-AWARE —
//    works with the doc-store public.courses DDL and a relational table), users
//    through public.users, and reconciles enrollments. Drafts are rebuilt from
//    the MERGED rows while the admin has not ticked anything, so a cold
//    deep-link can never wipe cloud-only members with one Save.
//  • Tenant-scoped: courses, users and enrollments are filtered to the
//    institution in localStorage.currentUser.
//  • Currency displayed in UGX.
//  • Deep-link support: <CourseManagement initialCourseId={id} /> opens the
//    course directly (e.g. from UserManagement).
//
// All writes go through courseDB.addCourse/updateCourse/deleteCourse and
// enrollmentDB.applyCourseAssignments — no component-local sync logic.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

import { db } from "../database/db";
import { supabase } from "../auth/supabase";
import { getDeletedIds } from "../database/deletedIdsTracker";
import type { Course } from "../types";
import { addCourse, updateCourse, deleteCourse } from "../database/courseDB";
import {
  getEnrollments,
  applyCourseAssignments,
  syncPendingEnrollments,
  reconcileAllEnrollments,
  pushUserAssignmentsMirror,
} from "../database/enrollmentDB";
import { fetchCoursesFromSupabase } from "../database/supabaseCourseSync";

/* ============================================================================
   MATERIAL DESIGN 3 (MD3) DESIGN SYSTEM — Material You, light scheme
============================================================================ */

const C = {
  primary: "#0B57D0",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",

  surface: "#FFFFFF",
  background: "#F8FAFD",

  onSurface: "#1F1F1F",
  onSurfaceVariant: "#444746",

  secondaryContainer: "#DAE2F2",
  surfaceVariant: "#E9EEF6",

  outline: "#747775",
  outlineVariant: "#C4C7C5",

  inset: "#F0F4F9",
  skeletonBase: "#E1E6ED",

  separatorLight: "#E1E6ED",

  green: "#146C2E",
  greenBg: "#E6F4EA",

  orange: "#B06000",
  orangeBg: "#FEF7E0",

  red: "#B3261E",
  redBg: "#F9DEDC",

  blue: "#0B57D0",
  blueBg: "#D3E3FD",

  inverseSurface: "#2D2F31",
  inverseOnSurface: "#F0F4F9",

  errorContainer: "#F9DEDC",
  scrim: "rgba(0,0,0,0.40)",
};

const font =
  "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const S = {
  level1: "0 1px 2px 0 rgba(0,0,0,0.10), 0 1px 3px 1px rgba(0,0,0,0.07)",
  level2: "0 1px 2px 0 rgba(0,0,0,0.12), 0 2px 6px 2px rgba(0,0,0,0.08)",
};

const R = { sm: 8, md: 12, lg: 16, xl: 28 };

const gutter = "clamp(14px, 3vw, 28px)";
const PAGE_MAX = 1440;
const motion = "all 0.2s cubic-bezier(0.2, 0, 0, 1)";

const cardBase: CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  boxSizing: "border-box",
  minWidth: 0,
};

/* ============================================================================
   HELPERS
============================================================================ */

function getAvatarColor(str: string) {
  const colors = ["#0B57D0", "#B3261E", "#146C2E", "#B06000", "#8430CE", "#444746"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

/** MD3 ripple — transient ink wash spawned at the click point. Purely
 *  presentational; rows using it are position:relative + overflow:hidden. */
function spawnRipple(e: { currentTarget: Element; clientX: number; clientY: number }) {
  const rect = e.currentTarget.getBoundingClientRect();
  const ripple = document.createElement("div");
  ripple.style.cssText = `position:absolute;left:${e.clientX - rect.left}px;top:${e.clientY - rect.top}px;width:40px;height:40px;margin-left:-20px;margin-top:-20px;border-radius:50%;background:${C.primary};pointer-events:none;animation:cmRipple 0.6s cubic-bezier(0.2,0,0,1) forwards;`;
  e.currentTarget.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
}

/** Uganda Shillings formatter. */
function formatCurrency(amount: number | string | undefined | null): string {
  if (amount === null || amount === undefined || amount === "") return "0";
  const num = typeof amount === "string" ? parseFloat(amount.replace(/,/g, "")) : amount;
  if (!Number.isFinite(num)) return "0";
  return num.toLocaleString("en-UG", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(iso: unknown): string {
  if (!iso) return "";
  const d = new Date(String(iso));
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Tenant match tolerant of camelCase (local writes) and snake_case (rows
 *  mirrored straight from Supabase). Rows with NO tenant at all count as
 *  this tenant's legacy rows — same policy as enrollmentDB.sameTenant. */
function sameTenantLoose(row: any, tenantId: string): boolean {
  if (!tenantId) return true;
  return (
    row?.tenantId === tenantId ||
    row?.tenant_id === tenantId ||
    (!row?.tenantId && !row?.tenant_id)
  );
}

function mapUserFromSupabase(u: any): any {
  return {
    ...u,
    id: u.id,
    username: u.username || "",
    phone: u.phone || "",
    email: u.email || "",
    role: u.role || "trainee",
    profilePic: u.profile_pic || u.profilePic || "",
    tenantId: u.tenant_id || u.tenantId,
    synced: true,
  };
}

interface CourseForm {
  name: string;
  description: string;
  tuitionType: "free" | "paid";
  amount: string;
  startDate: string; // YYYY-MM-DD from <input type="date">
  period: string;
  logo: string;
}

const EMPTY_COURSE_FORM: CourseForm = {
  name: "",
  description: "",
  tuitionType: "free",
  amount: "",
  startDate: "",
  period: "",
  logo: "",
};

function fromCourse(c: any): CourseForm {
  const raw = c?.startDate ? String(c.startDate) : "";
  const date = raw && !isNaN(Date.parse(raw)) ? raw.slice(0, 10) : "";
  return {
    name: c?.name || "",
    description: c?.description || "",
    tuitionType: c?.tuitionType === "paid" ? "paid" : "free",
    amount: c?.amount === 0 || c?.amount ? String(c.amount) : "",
    startDate: date,
    period: c?.period || "",
    logo: c?.logo || "",
  };
}

/** Returns an error message, or null when the form is valid. */
function validateCourseForm(form: CourseForm): string | null {
  if (!form.name.trim()) return "The course needs a name.";
  if (form.tuitionType === "paid") {
    const amount = parseFloat(form.amount.replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 0) {
      return "Paid courses need a valid amount in UGX (0 or more).";
    }
  }
  return null;
}

function isoFromFormDate(date: string): string {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00`);
  return isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

/* ============================================================================
   SMALL UI COMPONENTS
============================================================================ */

function Chip({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: R.sm,
        background: bg,
        color: fg,
        fontSize: 12,
        fontWeight: 500,
        letterSpacing: "0.02em",
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
        padding: "12px 8px 6px 16px",
      }}
    >
      <span
        style={{
          fontSize: 14,
          color: C.onSurfaceVariant,
          fontWeight: 500,
          letterSpacing: "0.01em",
        }}
      >
        {title}
      </span>
      {right}
    </div>
  );
}

/** MD3 text button — transparent pill with 8% primary state layer on hover. */
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
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.01em",
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        padding: "0 16px",
        minHeight: 40,
        borderRadius: R.xl,
        transition: motion,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = "rgba(11,87,208,0.08)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {label}
    </button>
  );
}

/** MD3 filled button. */
function FilledButton({
  label,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const bg = danger ? C.red : C.primary;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        border: "none",
        background: disabled ? C.surfaceVariant : bg,
        color: disabled ? C.outline : C.onPrimary,
        fontSize: 14,
        fontWeight: 500,
        letterSpacing: "0.01em",
        fontFamily: font,
        cursor: disabled ? "default" : "pointer",
        padding: "0 22px",
        minHeight: 40,
        borderRadius: R.xl,
        transition: motion,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: disabled ? "none" : S.level1,
      }}
    >
      {label}
    </button>
  );
}

/** MD3 checkbox — 20dp, 4dp corners, primary fill + white check when ticked. */
function CheckSquare({ checked }: { checked: boolean }) {
  return (
    <div
      style={{
        width: 20,
        height: 20,
        borderRadius: 4,
        boxSizing: "border-box",
        flexShrink: 0,
        border: checked ? "none" : `2px solid ${C.outlineVariant}`,
        background: checked ? C.primary : "transparent",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: motion,
      }}
    >
      {checked && (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.onPrimary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      )}
    </div>
  );
}

function Avatar({ name, pic, size = 40 }: { name: string; pic?: string; size?: number }) {
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
        <img src={pic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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
            fontWeight: 500,
          }}
        >
          {(name || "?").charAt(0).toUpperCase()}
        </div>
      )}
    </div>
  );
}

/** MD3 leading icon tile — 40dp, 12dp corners, container color. */
function CourseIcon({ logo, size = 40 }: { logo?: string; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: R.md,
        background: logo ? "transparent" : C.primaryContainer,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      {logo ? (
        <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

const rowBase: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 20px 14px 16px",
  minHeight: 64,
  borderBottom: `1px solid ${C.separatorLight}`,
  cursor: "pointer",
  transition: motion,
  position: "relative",
  overflow: "hidden",
};

/** Tickable person row — MD3 list item with ripple + state layers. */
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
      onClick={(e) => {
        spawnRipple(e);
        onToggle();
      }}
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
        ...rowBase,
        background: checked ? C.primaryContainer : C.surface,
      }}
      onMouseEnter={(e) => {
        if (!checked) {
          e.currentTarget.style.background = C.surfaceVariant;
          e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(11,87,208,0.08)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = checked ? C.primaryContainer : C.surface;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <CheckSquare checked={checked} />
      <Avatar name={user.username} pic={user.profilePic} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            color: checked ? C.onPrimaryContainer : C.onSurface,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {user.username}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 400,
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
      {pending && <Chip label="Pending" bg={C.orangeBg} fg={C.orange} />}
    </div>
  );
}

/** Selectable course row for the master list. */
function CourseListRow({
  course,
  selected,
  memberCount,
  onSelect,
}: {
  course: any;
  selected: boolean;
  memberCount: number;
  onSelect: () => void;
}) {
  const paid = course.tuitionType === "paid";
  return (
    <div
      onClick={(e) => {
        spawnRipple(e);
        onSelect();
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        ...rowBase,
        background: selected ? C.secondaryContainer : C.surface,
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background = C.surfaceVariant;
          e.currentTarget.style.boxShadow = "inset 0 0 0 9999px rgba(11,87,208,0.08)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = selected ? C.secondaryContainer : C.surface;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <CourseIcon logo={course.logo} size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 15,
            color: selected ? C.onPrimaryContainer : C.onSurface,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {course.name || "Untitled course"}
        </div>
        <div
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: selected ? C.onPrimaryContainer : C.onSurfaceVariant,
            marginTop: 3,
          }}
        >
          {paid ? `UGX ${formatCurrency(course.amount)}` : "Free course"}
          {` · ${memberCount} ${memberCount === 1 ? "member" : "members"}`}
        </div>
      </div>
      {course.synced === false && <Chip label="Pending" bg={C.orangeBg} fg={C.orange} />}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "14px 20px 14px 16px",
        minHeight: 64,
        borderBottom: `1px solid ${C.separatorLight}`,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: R.md,
          background: C.skeletonBase,
          animation: "cmShimmer 1.5s ease-in-out infinite",
          flexShrink: 0,
          marginRight: 12,
        }}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 }}>
        <div style={{ width: "40%", height: 12, borderRadius: 4, background: C.skeletonBase, animation: "cmShimmer 1.5s ease-in-out infinite" }} />
        <div style={{ width: "60%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "cmShimmer 1.5s ease-in-out infinite" }} />
      </div>
    </div>
  );
}

/** MD3 search bar — 48dp tonal pill, leading icon, trailing clear. */
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
    <div style={{ position: "relative", height: 48, boxSizing: "border-box" }}>
      <svg
        style={{
          position: "absolute",
          left: 14,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
          color: C.onSurfaceVariant,
        }}
        width="18"
        height="18"
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
          height: 48,
          paddingLeft: 46,
          paddingRight: value ? 44 : 16,
          backgroundColor: C.surfaceVariant,
          border: "1px solid transparent",
          borderRadius: 24,
          fontSize: 14,
          color: C.onSurface,
          outline: "none",
          fontFamily: font,
          boxSizing: "border-box",
          transition: motion,
        }}
        onFocus={(e) => {
          e.currentTarget.style.background = C.separatorLight;
        }}
        onBlur={(e) => {
          e.currentTarget.style.background = C.surfaceVariant;
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          style={{
            position: "absolute",
            right: 6,
            top: "50%",
            transform: "translateY(-50%)",
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            color: C.onSurfaceVariant,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: font,
            fontSize: 16,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
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
          borderRadius: R.xl,
          background: C.primaryContainer,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 17,
        }}
      >
        <svg width="29" height="29" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
      </div>
      <div style={{ color: C.onSurface, fontSize: 15, fontWeight: 500 }}>{title}</div>
      <div
        style={{
          color: C.onSurfaceVariant,
          fontSize: 13,
          fontWeight: 400,
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

/** Labeled form field wrapper. */
function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: C.onSurfaceVariant, letterSpacing: "0.01em" }}>
        {label}
      </label>
      {children}
      {hint ? <span style={{ fontSize: 11, color: C.outline, lineHeight: 1.4 }}>{hint}</span> : null}
    </div>
  );
}

/** Modal shell — bottom sheet on phones, centered dialog on ≥640px screens. */
function DialogShell({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 60,
        background: C.scrim,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        padding: 0,
        boxSizing: "border-box",
      }}
      className="cmDialogShell"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cmDialog"
        style={{
          background: C.surface,
          width: "100%",
          maxHeight: "92vh",
          borderRadius: `${R.xl}px ${R.xl}px 0 0`,
          padding: "18px 20px 22px",
          overflowY: "auto",
          boxSizing: "border-box",
          animation: "cmFadeUp 0.22s cubic-bezier(0.2,0,0,1)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 14,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 500, color: C.onSurface }}>{title}</h2>
          <MiniTextButton label="Cancel" onClick={onClose} />
        </div>
        {children}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>{footer}</div>
      </div>
    </div>
  );
}

/* ============================================================================
   MAIN COMPONENT
============================================================================ */

export default function CourseManagement({ initialCourseId }: { initialCourseId?: string }) {
  const [courses, setCourses] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [enrollRows, setEnrollRows] = useState<any[]>([]);

  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(initialCourseId ?? null);
  const [tab, setTab] = useState<"details" | "members">("details");

  const [courseSearch, setCourseSearch] = useState("");
  const [memberSearch, setMemberSearch] = useState("");

  const [isLoading, setIsLoading] = useState(true);
  const [merging, setMerging] = useState(false);
  const [savingCourse, setSavingCourse] = useState(false);
  const [savingRoster, setSavingRoster] = useState(false);
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [snackbar, setSnackbar] = useState<{ message: string; color: string } | null>(null);

  // Details form — owned by the admin while editing; reloaded on selection.
  const [form, setForm] = useState<CourseForm>(EMPTY_COURSE_FORM);
  const [formDirty, setFormDirty] = useState(false);

  // New-course dialog form.
  const [newForm, setNewForm] = useState<CourseForm>(EMPTY_COURSE_FORM);

  // Members draft — user ids ticked in the Members tab.
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const draftDirtyRef = useRef(false);
  const loadSeqRef = useRef(0);

  /* ------------------------------------------------------------------------
     SNACKBAR
  -------------------------------------------------------------------------- */

  useEffect(() => {
    if (!snackbar) return;
    const t = setTimeout(() => setSnackbar(null), 3500);
    return () => clearTimeout(t);
  }, [snackbar]);

  function showSnack(message: string, color: string = C.green) {
    setSnackbar({ message, color });
  }

  /* ------------------------------------------------------------------------
     DATA LOAD — local paint first, Supabase merge second.
  -------------------------------------------------------------------------- */

  async function loadData() {
    const seq = ++loadSeqRef.current;
    const stale = () => seq !== loadSeqRef.current;

    let cu: any = {};
    try {
      cu = JSON.parse(localStorage.getItem("currentUser") || "{}");
    } catch {
      /* ignore malformed localStorage */
    }
    const tenantId = cu?.tenantId || cu?.tenant_id || "";

    // STEP 1: immediate local paint.
    let localCourses: any[] = [];
    let localUsers: any[] = [];
    let localRows: any[] = [];

    try {
      localCourses = (await db.courses.toArray()).filter((c: any) => sameTenantLoose(c, tenantId));
    } catch {
      /* continue with available data */
    }
    try {
      localUsers = (await db.users.toArray()).filter(
        (u: any) => u.role !== "admin" && sameTenantLoose(u, tenantId)
      );
    } catch {
      /* continue with available data */
    }
    try {
      localRows = (await getEnrollments(tenantId)) as any[];
    } catch {
      /* continue with available data */
    }

    if (!stale()) {
      setCourses(localCourses);
      setUsers(localUsers);
      setEnrollRows(localRows);
      setIsLoading(false);
    }

    // STEP 2: background merge (courses via the SHAPE-AWARE pull).
    if (tenantId && navigator.onLine) {
      setMerging(true);
      try {
        await syncPendingEnrollments(tenantId);

        const cloudCourses = await fetchCoursesFromSupabase(tenantId);
        if (cloudCourses) {
          const deadCourses = new Set(await getDeletedIds("course"));
          for (const c of cloudCourses) {
            // ✅ Course.id is optional on the shared type — skip id-less rows
            //    (keeps the Dexie string-key overloads happy).
            if (!c.id || deadCourses.has(c.id)) continue; // tombstoned locally — stays deleted
            const local: any = await db.courses.get(c.id);
            if (local && local.synced === false) continue; // pending local edits win
            await db.courses.put({ ...c, synced: true });
          }
        }

        const uRes = await supabase
          .from("users")
          .select("*")
          .eq("tenant_id", tenantId)
          .is("deleted_at", null);
        if (!uRes.error) {
          const deadUsers = new Set(await getDeletedIds("user"));
          for (const u of uRes.data || []) {
            if (u.role !== "admin" && !deadUsers.has(u.id)) {
              await db.users.put(mapUserFromSupabase(u));
            }
          }
        } else {
          console.warn("CourseManagement: user merge failed", uRes.error.message);
        }

        await reconcileAllEnrollments(tenantId);

        if (!stale()) {
          const freshCourses = (await db.courses.toArray()).filter((c: any) =>
            sameTenantLoose(c, tenantId)
          );
          const freshUsers = (await db.users.toArray()).filter(
            (u: any) => u.role !== "admin" && sameTenantLoose(u, tenantId)
          );
          const freshRows = (await getEnrollments(tenantId)) as any[];
          setCourses(freshCourses);
          setUsers(freshUsers);
          setEnrollRows(freshRows);
        }
      } catch (e) {
        console.warn("CourseManagement: remote merge failed, using local DB", e);
      } finally {
        if (!stale()) setMerging(false);
      }
    }
  }

  useEffect(() => {
    loadData();
    return () => {
      loadSeqRef.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ------------------------------------------------------------------------
     DERIVED STATE
  -------------------------------------------------------------------------- */

  const selectedCourse = useMemo(
    () => courses.find((c) => c.id === selectedCourseId) || null,
    [courses, selectedCourseId]
  );

  const membersByCourse = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of enrollRows) {
      if (!m.has(r.courseId)) m.set(r.courseId, new Set());
      m.get(r.courseId)!.add(r.userId);
    }
    return m;
  }, [enrollRows]);

  /** Pending sync state for each (userId, courseId) pair. */
  const pendingPairs = useMemo(() => {
    const m = new Map<string, boolean>();
    for (const r of enrollRows) {
      const key = `${r.userId}:${r.courseId}`;
      m.set(key, m.has(key) ? m.get(key)! || r.synced === false : r.synced === false);
    }
    return m;
  }, [enrollRows]);

  const trainers = useMemo(() => users.filter((u) => u.role === "trainer"), [users]);
  const trainees = useMemo(() => users.filter((u) => u.role === "trainee"), [users]);

  const filteredCourseList = useMemo(() => {
    const q = courseSearch.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c: any) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.description || "").toLowerCase().includes(q) ||
        (c.tuitionType || "").toLowerCase().includes(q)
    );
  }, [courses, courseSearch]);

  const memberQuery = memberSearch.trim().toLowerCase();

  const filteredTrainers = useMemo(() => {
    if (!memberQuery) return trainers;
    return trainers.filter(
      (u: any) =>
        (u.username || "").toLowerCase().includes(memberQuery) ||
        (u.phone || "").toLowerCase().includes(memberQuery) ||
        (u.email || "").toLowerCase().includes(memberQuery)
    );
  }, [trainers, memberQuery]);

  const filteredTrainees = useMemo(() => {
    if (!memberQuery) return trainees;
    return trainees.filter(
      (u: any) =>
        (u.username || "").toLowerCase().includes(memberQuery) ||
        (u.phone || "").toLowerCase().includes(memberQuery) ||
        (u.email || "").toLowerCase().includes(memberQuery)
    );
  }, [trainees, memberQuery]);

  const currentSet = useMemo(
    () => (selectedCourseId ? membersByCourse.get(selectedCourseId) || new Set<string>() : new Set<string>()),
    [selectedCourseId, membersByCourse]
  );

  const addedCount = useMemo(() => [...draft].filter((id) => !currentSet.has(id)).length, [draft, currentSet]);
  const removedCount = useMemo(() => [...currentSet].filter((id) => !draft.has(id)).length, [draft, currentSet]);
  const hasChanges = addedCount > 0 || removedCount > 0;

  /* ------------------------------------------------------------------------
     SELECTION + FORM LOADING
  -------------------------------------------------------------------------- */

  function selectCourse(id: string) {
    setSelectedCourseId(id);
    draftDirtyRef.current = false;
    setDetailTabFromCourse(id);
    setMemberSearch("");
  }

  /** Courses with members open on the Members tab; empty ones on Details. */
  function setDetailTabFromCourse(id: string) {
    setTab((membersByCourse.get(id)?.size ?? 0) > 0 ? "members" : "details");
  }

  // Load the edit form whenever the selection changes. Deliberately NOT
  // re-run on every courses repaint — the admin owns the form while editing.
  useEffect(() => {
    const sel = courses.find((c) => c.id === selectedCourseId);
    setForm(sel ? fromCourse(sel) : EMPTY_COURSE_FORM);
    setFormDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCourseId]);

  // Draft follows the canonical enrollment rows while the admin has not
  // ticked anything — a background merge can freely correct it.
  useEffect(() => {
    if (isLoading) return;
    if (draftDirtyRef.current) return;
    if (!selectedCourseId) {
      setDraft(new Set());
      return;
    }
    setDraft(new Set(membersByCourse.get(selectedCourseId) || new Set<string>()));
  }, [selectedCourseId, membersByCourse, isLoading]);

  function patchForm(patch: Partial<CourseForm>) {
    setFormDirty(true);
    setForm((prev) => ({ ...prev, ...patch }));
  }

  /* ------------------------------------------------------------------------
     COURSE CRUD
  -------------------------------------------------------------------------- */

  async function saveCourseEdits() {
    if (!selectedCourse || savingCourse) return;
    const error = validateCourseForm(form);
    if (error) {
      showSnack(error, C.red);
      return;
    }
    setSavingCourse(true);
    try {
      const updated: any = {
        ...selectedCourse,
        name: form.name.trim(),
        description: form.description.trim(),
        tuitionType: form.tuitionType,
        amount: form.tuitionType === "paid" ? Number(form.amount.replace(/,/g, "")) || 0 : 0,
        startDate: isoFromFormDate(form.startDate),
        period: form.period.trim(),
        logo: form.logo.trim(),
      };
      await updateCourse(updated as Course);
      showSnack(`${updated.name} saved.`);
      await loadData();
    } catch (e: any) {
      showSnack(e?.message || "Could not save the course.", C.red);
    } finally {
      setSavingCourse(false);
    }
  }

  async function createCourse() {
    if (savingCourse) return;
    const error = validateCourseForm(newForm);
    if (error) {
      showSnack(error, C.red);
      return;
    }
    let cu: any = {};
    try {
      cu = JSON.parse(localStorage.getItem("currentUser") || "{}");
    } catch {
      /* ignore */
    }
    const tenantId = cu?.tenantId || cu?.tenant_id || "";
    if (!tenantId) {
      showSnack("No institution is linked to your session — sign in again, then create courses.", C.red);
      return;
    }
    setSavingCourse(true);
    try {
      const row: any = {
        id: makeId(),
        name: newForm.name.trim(),
        description: newForm.description.trim(),
        tuitionType: newForm.tuitionType,
        amount: newForm.tuitionType === "paid" ? Number(newForm.amount.replace(/,/g, "")) || 0 : 0,
        startDate: isoFromFormDate(newForm.startDate),
        period: newForm.period.trim(),
        logo: newForm.logo.trim(),
        tenantId,
        createdAt: new Date().toISOString(),
        synced: false,
      };
      const id = await addCourse(row as Course);
      setCreating(false);
      showSnack(`${row.name} created.`);
      await loadData();
      setSelectedCourseId(id);
      setTab("details");
    } catch (e: any) {
      showSnack(e?.message || "Could not create the course.", C.red);
    } finally {
      setSavingCourse(false);
    }
  }

  async function removeCourse() {
    if (!confirmDelete || deleting) return;
    const target = confirmDelete;
    setDeleting(true);
    try {
      // Cascades locally (materials, assignments, submissions, enrollments,
      // schedules, chat, live sessions) and soft-deletes in the cloud.
      await deleteCourse(target.id);
      setConfirmDelete(null);
      if (selectedCourseId === target.id) setSelectedCourseId(null);
      showSnack(`${target.name || "Course"} deleted.`);
    } catch (e: any) {
      // Local delete already succeeded; the cloud delete keeps retrying.
      setConfirmDelete(null);
      if (selectedCourseId === target.id) setSelectedCourseId(null);
      showSnack(e?.message || "Deleted locally, but the cloud delete will retry.", C.orange);
    } finally {
      setDeleting(false);
      await loadData();
    }
  }

  /* ------------------------------------------------------------------------
     MEMBERS (attach users to the course)
  -------------------------------------------------------------------------- */

  function toggleDraft(id: string) {
    draftDirtyRef.current = true;
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setSectionAll(ids: string[], on: boolean) {
    draftDirtyRef.current = true;
    setDraft((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function saveRoster() {
    if (!selectedCourse || savingRoster) return;
    setSavingRoster(true);
    try {
      const res = await applyCourseAssignments({
        courseId: selectedCourse.id,
        userIds: [...draft],
      });

      // Best-effort mirror of assigned_courses for every touched user.
      for (const uid of res.touchedUsers) {
        pushUserAssignmentsMirror(uid).catch(() => undefined);
      }

      showSnack(
        res.cloudSynced
          ? `Roster saved — ${res.added.length} added, ${res.removed.length} removed · Synced`
          : `Roster saved locally — ${res.added.length} added, ${res.removed.length} removed · Will retry when online`,
        res.cloudSynced ? C.green : C.orange
      );
      if (res.errors.length > 0) {
        console.warn("CourseManagement: roster sync errors", res.errors);
      }

      await loadData();
      draftDirtyRef.current = false;
    } catch (e: any) {
      showSnack(e?.message || "Could not save the roster.", C.red);
    } finally {
      setSavingRoster(false);
    }
  }

  /* ==========================================================================
     RENDER
  ========================================================================== */

  const detailStartDate = selectedCourse ? formatDate(selectedCourse.startDate) : "";
  const memberCount = selectedCourseId ? membersByCourse.get(selectedCourseId)?.size ?? 0 : 0;

  const trainersOn = filteredTrainers.every((u: any) => draft.has(u.id));
  const traineesOn = filteredTrainees.every((u: any) => draft.has(u.id));

  const courseFormPane = (target: CourseForm, setTarget: (patch: Partial<CourseForm>) => void) => (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
        <Field label="Course name">
          <input
            className="cmInput"
            value={target.name}
            onChange={(e) => setTarget({ name: e.target.value })}
            placeholder="e.g. Mathematics P4"
          />
        </Field>
        <Field label="Period">
          <input
            className="cmInput"
            value={target.period}
            onChange={(e) => setTarget({ period: e.target.value })}
            placeholder="e.g. Term 1 · Mon & Wed"
          />
        </Field>
        <Field label="Tuition">
          <div style={{ display: "flex", border: `1px solid ${C.outline}`, borderRadius: R.xl, overflow: "hidden" }}>
            {(["free", "paid"] as const).map((k) => {
              const on = target.tuitionType === k;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTarget({ tuitionType: k })}
                  style={{
                    flex: 1,
                    padding: "9px 8px",
                    border: "none",
                    background: on ? C.primaryContainer : C.surface,
                    color: on ? C.onPrimaryContainer : C.onSurfaceVariant,
                    fontSize: 13,
                    fontWeight: 500,
                    fontFamily: font,
                    cursor: "pointer",
                    transition: motion,
                  }}
                >
                  {k === "free" ? "Free" : "Paid"}
                </button>
              );
            })}
          </div>
        </Field>
        <Field label="Amount (UGX)" hint={target.tuitionType === "free" ? "Free courses carry no amount." : undefined}>
          <input
            className="cmInput"
            value={target.tuitionType === "free" ? "" : target.amount}
            disabled={target.tuitionType === "free"}
            onChange={(e) => setTarget({ amount: e.target.value })}
            placeholder={target.tuitionType === "free" ? "—" : "e.g. 150000"}
            inputMode="numeric"
          />
        </Field>
        <Field label="Start date">
          <input
            className="cmInput"
            type="date"
            value={target.startDate}
            onChange={(e) => setTarget({ startDate: e.target.value })}
          />
        </Field>
        <Field label="Logo URL" hint="Optional image shown as the course icon.">
          <input
            className="cmInput"
            value={target.logo}
            onChange={(e) => setTarget({ logo: e.target.value })}
            placeholder="https://…"
          />
        </Field>
      </div>
      <div style={{ marginTop: 14 }}>
        <Field label="Description">
          <textarea
            className="cmInput"
            rows={3}
            value={target.description}
            onChange={(e) => setTarget({ description: e.target.value })}
            placeholder="What the course covers…"
            style={{ resize: "vertical" }}
          />
        </Field>
      </div>
    </>
  );

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
        @keyframes cmShimmer {
          0% { opacity: 1; }
          50% { opacity: 0.35; }
          100% { opacity: 1; }
        }

        @keyframes cmFadeUp {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: none; }
        }

        @keyframes cmSnackbar {
          from { transform: translate(-50%, 100%); opacity: 0; }
          to { transform: translate(-50%, 0); opacity: 1; }
        }

        @keyframes cmRipple {
          from { transform: scale(0); opacity: 0.12; }
          to { transform: scale(4); opacity: 0; }
        }

        .cmLayout {
          display: grid;
          grid-template-columns: minmax(280px, 370px) minmax(0, 1fr);
          gap: 20px;
          align-items: stretch;
        }

        .cmMaster, .cmDetail { min-width: 0; min-height: 520px; display: flex; flex-direction: column; }

        .cmList {
          max-height: min(620px, 70vh);
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        .cmDetailBody {
          flex: 1;
          overflow-y: auto;
          overscroll-behavior: contain;
        }

        .cmList::-webkit-scrollbar, .cmDetailBody::-webkit-scrollbar, .cmDialog::-webkit-scrollbar { width: 6px; }
        .cmList::-webkit-scrollbar-thumb, .cmDetailBody::-webkit-scrollbar-thumb, .cmDialog::-webkit-scrollbar-thumb {
          background: #C4C7C5;
          border-radius: 10px;
        }
        .cmList::-webkit-scrollbar-track, .cmDetailBody::-webkit-scrollbar-track, .cmDialog::-webkit-scrollbar-track {
          background: transparent;
        }

        .cmInput:focus { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; outline: none; }
        .cmInput:disabled { background: ${C.inset}; color: ${C.outline}; cursor: default; }
        .cmTextarea:focus { border-color: ${C.primary}; box-shadow: inset 0 0 0 1px ${C.primary}; outline: none; }

        .cmLayout button:focus-visible, .cmLayout input:focus-visible, .cmLayout [tabindex]:focus-visible {
          outline: 2px solid ${C.primary};
          outline-offset: 2px;
        }

        @media (min-width: 640px) {
          .cmDialogShell { align-items: center; padding: 24px; }
          .cmDialog { width: 620px; max-height: 88vh; border-radius: ${R.xl}px; }
        }

        @media (max-width: 880px) {
          .cmLayout { grid-template-columns: 1fr; gap: 16px; }
          .cmMaster, .cmDetail { min-height: auto; }
          .cmList { max-height: 380px; }
          .cmDetailBody { max-height: 560px; }
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
        {/* ================================================================
            PAGE HEADER — MD3 top app bar (flat, no card)
        ================================================================= */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            rowGap: 14,
            columnGap: 16,
            width: "100%",
            animation: "cmFadeUp 0.35s cubic-bezier(0.2,0,0,1) both",
          }}
        >
          <div style={{ flex: "1 1 230px", minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                color: C.onSurface,
                fontSize: "clamp(23px, 3vw, 28px)",
                fontWeight: 500,
                letterSpacing: "-0.01em",
                lineHeight: 1.25,
              }}
            >
              Courses
            </h1>
            <p style={{ margin: "6px 0 0", color: C.onSurfaceVariant, fontSize: 14, fontWeight: 400, lineHeight: 1.5 }}>
              Create courses, edit their details, and attach trainers and trainees
              {merging ? " · syncing…" : ""}
            </p>
          </div>

          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            {merging && <Chip label="Syncing…" bg={C.blueBg} fg={C.blue} />}
            <MiniTextButton label="Refresh" onClick={() => void loadData()} />
            <FilledButton
              label="+ New course"
              onClick={() => {
                setNewForm(EMPTY_COURSE_FORM);
                setCreating(true);
              }}
            />
          </div>
        </div>

        {/* ================================================================
            MASTER / DETAIL LAYOUT
        ================================================================= */}

        <div className="cmLayout" style={{ marginTop: 18 }}>
          {/* MASTER — course list */}
          <div className="cmMaster" style={cardBase}>
            <div style={{ padding: "14px 16px 10px" }}>
              <SearchBox value={courseSearch} onChange={setCourseSearch} placeholder="Search courses…" />
            </div>
            <div className="cmList" style={{ borderTop: `1px solid ${C.separatorLight}` }}>
              {isLoading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : filteredCourseList.length === 0 ? (
                <EmptyState
                  title={courseSearch ? "No matching courses" : "No courses yet"}
                  description={
                    courseSearch
                      ? "Try a different search term, or clear the search box."
                      : "Create your first course with “+ New course” — then attach trainers and trainees on the Members tab."
                  }
                />
              ) : (
                filteredCourseList.map((c: any) => (
                  <CourseListRow
                    key={c.id}
                    course={c}
                    selected={c.id === selectedCourseId}
                    memberCount={membersByCourse.get(c.id)?.size ?? 0}
                    onSelect={() => selectCourse(c.id)}
                  />
                ))
              )}
            </div>
          </div>

          {/* DETAIL — selected course */}
          <div className="cmDetail" style={cardBase}>
            {!selectedCourse ? (
              <EmptyState
                title="Select a course"
                description="Pick a course on the left to edit its details or attach members — or create a new one."
              />
            ) : (
              <>
                {/* DETAIL HEADER */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    padding: "16px 20px 12px",
                    borderBottom: `1px solid ${C.separatorLight}`,
                    flexWrap: "wrap",
                  }}
                >
                  <CourseIcon logo={selectedCourse.logo} size={48} />
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 18, fontWeight: 500, color: C.onSurface, lineHeight: 1.3 }}>
                      {selectedCourse.name || "Untitled course"}
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      <Chip
                        label={selectedCourse.tuitionType === "paid" ? `UGX ${formatCurrency(selectedCourse.amount)}` : "Free"}
                        bg={selectedCourse.tuitionType === "paid" ? C.orangeBg : C.greenBg}
                        fg={selectedCourse.tuitionType === "paid" ? C.orange : C.green}
                      />
                      {detailStartDate && (
                        <Chip label={`Starts ${detailStartDate}`} bg={C.surfaceVariant} fg={C.onSurfaceVariant} />
                      )}
                      <Chip label={`${memberCount} member${memberCount === 1 ? "" : "s"}`} bg={C.blueBg} fg={C.blue} />
                      {selectedCourse.synced === false ? (
                        <Chip label="Pending sync" bg={C.orangeBg} fg={C.orange} />
                      ) : (
                        <Chip label="Synced" bg={C.greenBg} fg={C.green} />
                      )}
                    </div>
                  </div>
                </div>

                {/* TAB SWITCH */}
                <div style={{ display: "flex", gap: 8, padding: "10px 20px 0" }}>
                  {(
                    [
                      ["details", "Details"],
                      ["members", `Members (${memberCount})`],
                    ] as const
                  ).map(([key, label]) => {
                    const on = tab === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTab(key)}
                        style={{
                          border: "none",
                          background: on ? C.primaryContainer : "transparent",
                          color: on ? C.onPrimaryContainer : C.onSurfaceVariant,
                          fontSize: 14,
                          fontWeight: 500,
                          fontFamily: font,
                          cursor: "pointer",
                          padding: "8px 18px",
                          borderRadius: R.xl,
                          transition: motion,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                {/* DETAILS TAB — edit form + danger zone */}
                {tab === "details" ? (
                  <div className="cmDetailBody" style={{ padding: "14px 20px 20px" }}>
                    {courseFormPane(form, patchForm)}

                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        marginTop: 18,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: 13, color: formDirty ? C.orange : C.onSurfaceVariant }}>
                        {formDirty ? "Unsaved changes" : "Everything saved"}
                      </span>
                      <FilledButton
                        label={savingCourse ? "Saving…" : "Save changes"}
                        onClick={() => void saveCourseEdits()}
                        disabled={!formDirty || savingCourse}
                      />
                    </div>

                    <div
                      style={{
                        marginTop: 26,
                        border: `1px solid ${C.outlineVariant}`,
                        borderRadius: R.md,
                        padding: "16px 18px",
                        background: C.surface,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: C.red }}>Delete this course</div>
                        <div style={{ fontSize: 12.5, color: C.onSurfaceVariant, lineHeight: 1.5, marginTop: 4 }}>
                          Removes the course, its materials, assignments, schedules and every member
                          enrollment on this device, then soft-deletes it in the cloud so other devices
                          drop it on their next pull.
                        </div>
                      </div>
                      <FilledButton danger label="Delete course" onClick={() => setConfirmDelete(selectedCourse)} />
                    </div>
                  </div>
                ) : (
                  /* MEMBERS TAB — attach users to the course */
                  <div className="cmDetailBody" style={{ display: "flex", flexDirection: "column" }}>
                    <div style={{ padding: "12px 20px 6px" }}>
                      <SearchBox
                        value={memberSearch}
                        onChange={setMemberSearch}
                        placeholder="Search trainers or trainees…"
                      />
                    </div>

                    <div style={{ flex: 1, borderTop: `1px solid ${C.separatorLight}` }}>
                      <SectionHeader
                        title={`Trainers (${filteredTrainers.length})`}
                        right={
                          filteredTrainers.length > 0 ? (
                            <MiniTextButton
                              label={trainersOn ? "Deselect all" : "Select all"}
                              onClick={() => setSectionAll(filteredTrainers.map((u: any) => u.id), !trainersOn)}
                            />
                          ) : undefined
                        }
                      />
                      {filteredTrainers.map((u: any) => (
                        <PersonRow
                          key={u.id}
                          user={u}
                          checked={draft.has(u.id)}
                          pending={!!pendingPairs.get(`${u.id}:${selectedCourse.id}`)}
                          onToggle={() => toggleDraft(u.id)}
                        />
                      ))}
                      {filteredTrainers.length === 0 && (
                        <div style={{ padding: "14px 20px", fontSize: 13, color: C.onSurfaceVariant }}>
                          No trainers in this institution yet.
                        </div>
                      )}

                      <SectionHeader
                        title={`Trainees (${filteredTrainees.length})`}
                        right={
                          filteredTrainees.length > 0 ? (
                            <MiniTextButton
                              label={traineesOn ? "Deselect all" : "Select all"}
                              onClick={() => setSectionAll(filteredTrainees.map((u: any) => u.id), !traineesOn)}
                            />
                          ) : undefined
                        }
                      />
                      {filteredTrainees.map((u: any) => (
                        <PersonRow
                          key={u.id}
                          user={u}
                          checked={draft.has(u.id)}
                          pending={!!pendingPairs.get(`${u.id}:${selectedCourse.id}`)}
                          onToggle={() => toggleDraft(u.id)}
                        />
                      ))}
                      {filteredTrainees.length === 0 && (
                        <div style={{ padding: "14px 20px", fontSize: 13, color: C.onSurfaceVariant }}>
                          No trainees in this institution yet.
                        </div>
                      )}
                    </div>

                    {/* SAVE BAR */}
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "12px 20px",
                        borderTop: `1px solid ${C.separatorLight}`,
                        background: C.inset,
                        flexWrap: "wrap",
                      }}
                    >
                      <span style={{ fontSize: 13, color: C.onSurfaceVariant }}>
                        {hasChanges
                          ? `${addedCount} to add · ${removedCount} to remove`
                          : `${draft.size} member${draft.size === 1 ? "" : "s"} selected`}
                      </span>
                      <FilledButton
                        label={savingRoster ? "Saving…" : "Save roster"}
                        onClick={() => void saveRoster()}
                        disabled={!hasChanges || savingRoster}
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ==================================================================
          NEW COURSE DIALOG
      ================================================================== */}

      {creating && (
        <DialogShell
          title="New course"
          onClose={() => setCreating(false)}
          footer={
            <>
              <MiniTextButton label="Cancel" onClick={() => setCreating(false)} />
              <FilledButton
                label={savingCourse ? "Creating…" : "Create course"}
                onClick={() => void createCourse()}
                disabled={savingCourse}
              />
            </>
          }
        >
          {courseFormPane(newForm, (patch) => setNewForm((prev) => ({ ...prev, ...patch })))}
        </DialogShell>
      )}

      {/* ==================================================================
          DELETE CONFIRMATION
      ================================================================== */}

      {confirmDelete && (
        <DialogShell
          title="Delete course?"
          onClose={() => {
            if (!deleting) setConfirmDelete(null);
          }}
          footer={
            <>
              <MiniTextButton
                label="Cancel"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              />
              <FilledButton danger label={deleting ? "Deleting…" : "Delete"} onClick={() => void removeCourse()} />
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: C.onSurfaceVariant }}>
            <strong style={{ color: C.onSurface }}>{confirmDelete.name || "This course"}</strong> will be
            removed from this device together with its materials, assignments, submissions, schedules and
            all member enrollments. The cloud copy is soft-deleted so every other device drops it too.
          </p>
        </DialogShell>
      )}

      {/* ==================================================================
          SNACKBAR
      ================================================================== */}

      {snackbar && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            bottom: 24,
            transform: "translateX(-50%)",
            zIndex: 70,
            background: C.inverseSurface,
            color: C.inverseOnSurface,
            borderRadius: R.sm,
            padding: "12px 18px",
            fontSize: 13.5,
            lineHeight: 1.5,
            maxWidth: "min(560px, calc(100vw - 32px))",
            boxShadow: S.level2,
            animation: "cmSnackbar 0.25s cubic-bezier(0.2,0,0,1)",
            textAlign: "center",
          }}
        >
          {snackbar.message}
        </div>
      )}
    </div>
  );
}
