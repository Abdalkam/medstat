// src/admin/UserManagement.tsx — v4: Material Android UI + schema-exact CRUD
//
// Changes vs v3 (the v3 fix list is preserved — nothing regressed):
//  UI — professional Android (Material) look:
//   • sticky top app bar with icon actions (refresh, export CSV)
//   • extended FAB for "+ Add user", docked search bar, role choice chips
//   • stat pills, list items with avatars/badges (the desktop-only table is
//     gone — the list works on any screen width)
//   • the form renders as a bottom sheet on phones and a centered dialog on
//     ≥640px screens; notices are snackbars (auto-dismiss 6s)
//   • injected stylesheet adds focus rings, pressed states, animations —
//     inline styles alone can't express pseudo-classes
//  Creation/editing — "create users effectively":
//   • role is a segmented button (Admin | Trainer | Trainee)
//   • courses and departments are searchable multi-select pickers fed from
//     the local Dexie tables — raw UUID typing is gone. When a table hasn't
//     synced yet (fresh device) the picker falls back to a paste field so
//     creation never blocks; ids already assigned but missing from the list
//     show as removable "pinned" chips
//   • password visibility toggle on the password field
//  Schema alignment (matches public.users DDL exactly):
//   • cloud pushes go through supabaseUserSync.pushUserRowToSupabase —
//     explicit column whitelist, camelCase "assignedDepartments" column,
//     snake_case remuneration jsonb, CHECK-safe role (see that file)
//   • local rows consolidate departments to the camelCase key (the legacy
//     assigned_departments key is removed on update) and stamp updated_at
//   • soft-deletes go through deleteUserRowFromSupabase (verifies row count)
//  Preserved from v3: username/phone/email tenant-scoped uniqueness, password
//  length on create AND edit, role-change ledger wipe, tombstone-aware
//  delete cascade (incl. chatMessages.senderId + schedules.traineeId),
//  CSV export with departments column, offline + pending-sync semantics.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { hashSync } from "bcryptjs";

import { db } from "../database/db";
import {
  getUsersDetailed,
  noteUserPushed,
  type MedStatUser,
} from "../database/userDB";
import {
  deleteUserRowFromSupabase,
  pushUserRowToSupabase,
} from "../database/supabaseUserSync";
import {
  getDeletedIds,
  isDeleted,
  markDeleted,
  unmarkDeleted,
} from "../database/deletedIdsTracker";

/* -------------------------------------------------------------------------- */
/* Small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Converts anything to a display string — the single wall that keeps
 *  `string | undefined` out of every typed parameter in this file. */
function s(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

/** Parses a money input into a jsonb-friendly value (number when possible,
 *  raw text otherwise — types.ts allows number | string for both ledgers). */
function num(value: string): number | string {
  const text = value.trim();
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : text;
}

function makeId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch {
    // Use the fallback below.
  }
  return `u-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** camelCase/snake_case tenant tolerance (same policy as trainerDB). */
function sameTenant(row: any, tenantId: string): boolean {
  if (!tenantId) return true;
  return row?.tenantId === tenantId || row?.tenant_id === tenantId;
}

/** camelCase/snake_case list tolerance — prefers the snake_case copy
 *  (legacy local rows) and falls back to the camelCase copy. Used for
 *  assigned_courses and assignedDepartments everywhere. */
function readIdField(row: any, snakeKey: string, camelKey: string): unknown[] {
  const snakeValue = row?.[snakeKey];
  if (Array.isArray(snakeValue)) return snakeValue;
  const camelValue = row?.[camelKey];
  if (Array.isArray(camelValue)) return camelValue;
  return [];
}

function readSessionTenant(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return s(user?.tenantId || user?.tenant_id || "").trim();
  } catch {
    return "";
  }
}

function readSessionUserId(): string {
  try {
    const user: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    return s(user?.id ?? "");
  } catch {
    return "";
  }
}

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

type RoleKey = "admin" | "trainer" | "trainee";
const ROLE_KEYS: RoleKey[] = ["admin", "trainer", "trainee"];

const ROLE_BADGES: Record<RoleKey, { label: string; bg: string; fg: string }> = {
  admin: { label: "Admin", bg: "#ede9fe", fg: "#5b21b6" },
  trainer: { label: "Trainer", bg: "#dbeafe", fg: "#1d4ed8" },
  trainee: { label: "Trainee", bg: "#dcfce7", fg: "#166534" },
};

function roleBadge(role: unknown): { label: string; bg: string; fg: string } {
  const key = s(role).trim().toLowerCase();
  if ((ROLE_KEYS as string[]).includes(key)) {
    return ROLE_BADGES[key as RoleKey];
  }
  return { label: s(role) || "Unknown", bg: "#e2e8f0", fg: "#334155" };
}

const SYNCED_BADGE = { label: "Synced", bg: "#dcfce7", fg: "#166534" };
const PENDING_BADGE = { label: "Pending sync", bg: "#fef3c7", fg: "#92400e" };

function syncBadge(synced: unknown): { label: string; bg: string; fg: string } {
  return synced === false ? PENDING_BADGE : SYNCED_BADGE;
}

function initials(username: unknown): string {
  const text = s(username).trim();
  return text ? text.slice(0, 2).toUpperCase() : "?";
}

const AVATAR_COLORS = [
  "#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981",
  "#ef4444", "#3b82f6", "#6366f1", "#ec4899",
];

function avatarColor(username: unknown): string {
  const text = s(username);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/* -------------------------------------------------------------------------- */
/* Form state — strings for identity/money, arrays for assignments            */
/* -------------------------------------------------------------------------- */

type UserRow = MedStatUser & Record<string, any>;

interface PickerOption {
  id: string;
  label: string;
}

interface FormState {
  id: string;
  username: string;
  phone: string;
  email: string;
  role: RoleKey;
  password: string;
  tuitionExpected: string;
  tuitionPaid: string;
  netSalary: string;
  perDiem: string;
  /** Picker selections — used whenever the local table has data. */
  courseIds: string[];
  departmentIds: string[];
  /** Paste fallback — used only while the local table is still empty. */
  coursePaste: string;
  departmentPaste: string;
}

const EMPTY_FORM: FormState = {
  id: "",
  username: "",
  phone: "",
  email: "",
  role: "trainee",
  password: "",
  tuitionExpected: "",
  tuitionPaid: "",
  netSalary: "",
  perDiem: "",
  courseIds: [],
  departmentIds: [],
  coursePaste: "",
  departmentPaste: "",
};

function moneyText(value: unknown): string {
  if (value === undefined || value === null) return "";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : s(value);
}

function formFromRow(row: UserRow): FormState {
  const tuition = (row?.tuition ?? {}) as Record<string, any>;
  const remuneration = (row?.remuneration ?? {}) as Record<string, any>;
  const roleKey = s(row?.role).trim().toLowerCase();
  const courses = readIdField(row, "assigned_courses", "assignedCourses");
  const departments = readIdField(row, "assigned_departments", "assignedDepartments");

  return {
    id: s(row?.id),
    username: s(row?.username),
    phone: s(row?.phone),
    email: s(row?.email),
    role: (ROLE_KEYS as string[]).includes(roleKey)
      ? (roleKey as RoleKey)
      : "trainee",
    password: "",
    tuitionExpected: moneyText(tuition?.expected),
    tuitionPaid: moneyText(tuition?.paid),
    netSalary: moneyText(remuneration?.netSalary),
    perDiem: moneyText(remuneration?.perDiem),
    courseIds: courses.map((c) => s(c)).filter(Boolean),
    departmentIds: departments.map((d) => s(d)).filter(Boolean),
    coursePaste: courses.map((c) => s(c)).filter(Boolean).join(", "),
    departmentPaste: departments.map((d) => s(d)).filter(Boolean).join(", "),
  };
}

function parseIdList(raw: string): string[] {
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Injected stylesheet — pseudo-class states, animations, responsive sheet    */
/* -------------------------------------------------------------------------- */

const UMS_CSS = `
.ums-root{font-family:Roboto,'Segoe UI',system-ui,-apple-system,sans-serif;}
.ums-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
.ums-iconbtn{border:none;background:transparent;border-radius:999px;width:40px;height:40px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:#334155;flex-shrink:0;}
.ums-iconbtn:hover{background:#e2e8f0;}
.ums-iconbtn:disabled{opacity:.35;cursor:default;}
.ums-iconbtn:disabled:hover{background:transparent;}
.ums-iconbtn--ondark{color:#f8fafc;}
.ums-iconbtn--ondark:hover{background:rgba(255,255,255,.14);}
.ums-btn{transition:transform .06s ease;}
.ums-btn:active:not(:disabled){transform:scale(.97);}
.ums-btn:disabled{opacity:.5;cursor:default;}
.ums-field:focus-within{border-color:#2563eb !important;box-shadow:inset 0 0 0 1px #2563eb;}
.ums-field input:focus{outline:none;}
.ums-chip{transition:background .15s ease,color .15s ease,border-color .15s ease;}
.ums-seg{flex:1;padding:10px 8px;font-size:13px;font-weight:600;border:1px solid #cbd5e1;
  background:#ffffff;color:#334155;cursor:pointer;transition:background .15s ease,color .15s ease;}
.ums-seg:first-child{border-radius:999px 0 0 999px;}
.ums-seg:last-child{border-radius:0 999px 999px 0;}
.ums-seg+.ums-seg{margin-left:-1px;}
.ums-seg--on{background:#dbeafe;color:#1e40af;border-color:#2563eb;position:relative;z-index:1;}
.ums-rowitem{transition:background .12s ease;}
.ums-rowitem:hover{background:#f8fafc;}
.ums-cb{appearance:none;-webkit-appearance:none;width:18px;height:18px;border:2px solid #94a3b8;
  border-radius:4px;margin:0;cursor:pointer;flex-shrink:0;padding:0;}
.ums-cb:checked{background-color:#2563eb;border-color:#2563eb;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ffffff' d='M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z'/%3E%3C/svg%3E");
  background-size:14px 14px;background-position:center;background-repeat:no-repeat;}
.ums-cb:focus-visible{outline:2px solid #93c5fd;outline-offset:2px;}
.ums-shell{position:fixed;inset:0;z-index:60;background:rgba(15,23,42,.45);
  display:flex;align-items:flex-end;justify-content:center;padding:0;}
.ums-shell>.ums-sheet{position:relative;width:100%;max-height:92vh;
  border-radius:28px 28px 0 0;animation:ums-sheet-in .22s cubic-bezier(.2,.8,.3,1);}
@media (min-width:640px){
  .ums-shell{align-items:center;padding:24px;}
  .ums-shell>.ums-sheet{width:600px;max-height:88vh;border-radius:28px;animation:ums-dialog-in .18s ease-out;}
}
@keyframes ums-sheet-in{from{transform:translateY(48px);opacity:.5;}to{transform:translateY(0);opacity:1;}}
@keyframes ums-dialog-in{from{transform:scale(.96);opacity:0;}to{transform:scale(1);opacity:1;}}
.ums-snack{animation:ums-snack-in .2s ease-out;}
@keyframes ums-snack-in{from{transform:translateY(16px);opacity:0;}to{transform:translateY(0);opacity:1;}}
.ums-scroll::-webkit-scrollbar{width:8px;height:8px;}
.ums-scroll::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:8px;}
`;

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const S: Record<string, CSSProperties> = {
  screen: {
    minHeight: "100%",
    background: "#f1f5f9",
    color: "#0f172a",
    paddingBottom: 96,
  },
  appbar: {
    position: "sticky",
    top: 0,
    zIndex: 20,
    background: "#ffffff",
    borderBottom: "1px solid #e2e8f0",
    padding: "10px 12px",
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  appbarTitles: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 20, fontWeight: 700, margin: 0, lineHeight: 1.2 },
  appbarSubtitle: { fontSize: 12, color: "#64748b", marginTop: 2 },
  shell: { maxWidth: 860, margin: "0 auto", padding: "16px 16px 0" },
  actionsRow: { display: "flex", gap: 8, flexWrap: "wrap" },
  bannerOffline: {
    background: "#fef3c7",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
  },
  bannerError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
  },
  bannerNotice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
  },
  statsRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 4,
    marginBottom: 12,
  },
  pill: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "8px 14px",
    minWidth: 88,
    flexShrink: 0,
  },
  pillValue: { display: "block", fontSize: 20, fontWeight: 700, lineHeight: 1.2 },
  pillLabel: { display: "block", fontSize: 11, color: "#64748b", marginTop: 2 },
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    padding: "2px 6px 2px 12px",
    marginBottom: 10,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 14,
    padding: "10px 0",
    color: "#0f172a",
  },
  chipsRow: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 },
  chip: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#334155",
    borderRadius: 999,
    padding: "7px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  chipOn: {
    border: "1px solid #2563eb",
    background: "#dbeafe",
    color: "#1e40af",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 16,
    overflow: "hidden",
  },
  item: {
    display: "flex",
    gap: 12,
    alignItems: "flex-start",
    padding: "12px 14px",
    borderBottom: "1px solid #f1f5f9",
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 999,
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
    marginTop: 2,
  },
  itemBody: { flex: 1, minWidth: 0 },
  titleRow: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  itemTitle: { fontSize: 15, fontWeight: 600, wordBreak: "break-word" },
  itemSub: { fontSize: 12, color: "#64748b", marginTop: 2, wordBreak: "break-word" },
  itemMeta: { display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" },
  metaText: { fontSize: 12, color: "#64748b" },
  itemActions: { display: "flex", gap: 2, flexShrink: 0 },
  loadingRow: { padding: 28, textAlign: "center", color: "#64748b", fontSize: 13 },
  emptyTitle: { fontSize: 14, fontWeight: 600, color: "#334155", margin: 0 },
  emptyBody: { fontSize: 13, color: "#64748b", margin: "6px auto 0", maxWidth: 420, lineHeight: 1.5 },
  emptyState: { padding: "36px 20px", textAlign: "center" },
  fab: {
    position: "fixed",
    right: 20,
    bottom: 20,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    gap: 8,
    background: "#2563eb",
    color: "#ffffff",
    border: "none",
    borderRadius: 999,
    padding: "15px 20px 15px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
    boxShadow: "0 4px 14px rgba(37, 99, 235, 0.4)",
  },
  snack: {
    position: "fixed",
    left: 16,
    bottom: 84,
    zIndex: 70,
    background: "#1e293b",
    color: "#f8fafc",
    borderRadius: 12,
    padding: "12px 10px 12px 14px",
    fontSize: 13,
    lineHeight: 1.5,
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
    maxWidth: "min(460px, calc(100vw - 32px))",
    boxShadow: "0 6px 20px rgba(15, 23, 42, 0.35)",
  },
  snackText: { flex: 1, wordBreak: "break-word" },
  sheet: {
    background: "#ffffff",
    padding: "4px 20px 24px",
    overflowY: "auto",
    color: "#0f172a",
  },
  dragHandle: {
    width: 36,
    height: 4,
    borderRadius: 999,
    background: "#cbd5e1",
    margin: "8px auto 6px",
  },
  sheetHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: 700, margin: 0 },
  formError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 12,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 12,
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#94a3b8",
    margin: "16px 0 8px",
  },
  field: { display: "flex", flexDirection: "column", gap: 5, minWidth: 0 },
  label: { fontSize: 12, fontWeight: 600, color: "#334155" },
  textField: {
    border: "1px solid #cbd5e1",
    borderRadius: 12,
    background: "#ffffff",
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 10px",
  },
  textInput: {
    border: "none",
    outline: "none",
    background: "transparent",
    fontSize: 14,
    padding: "12px 2px",
    width: "100%",
    minWidth: 0,
    color: "#0f172a",
  },
  hint: { fontSize: 11, color: "#64748b", lineHeight: 1.5 },
  pickerHead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  countChip: {
    background: "#eff6ff",
    color: "#1d4ed8",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    padding: "3px 10px",
    whiteSpace: "nowrap",
  },
  pickerList: {
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    maxHeight: 200,
    overflowY: "auto",
    marginTop: 6,
    background: "#ffffff",
  },
  pickRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
    borderBottom: "1px solid #f1f5f9",
  },
  pickLabel: { fontSize: 13, color: "#0f172a", wordBreak: "break-word" },
  pickerEmpty: { padding: 14, fontSize: 12, color: "#64748b" },
  pinnedRow: { display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 },
  pinnedChip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "#f1f5f9",
    border: "1px solid #e2e8f0",
    borderRadius: 999,
    padding: "3px 4px 3px 10px",
    fontSize: 11,
    color: "#334155",
  },
  pinnedX: {
    border: "none",
    background: "transparent",
    color: "#64748b",
    width: 20,
    height: 20,
    borderRadius: 999,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  btn: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 999,
    padding: "10px 18px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnPrimary: {
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 999,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnDanger: {
    border: "1px solid #dc2626",
    background: "#dc2626",
    color: "#ffffff",
    borderRadius: 999,
    padding: "10px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  deleteText: { fontSize: 14, lineHeight: 1.55, color: "#334155", margin: "0 0 10px" },
};

/* -------------------------------------------------------------------------- */
/* Icons — inline Material paths, no icon dependency                          */
/* -------------------------------------------------------------------------- */

const ICON_PATHS: Record<string, string> = {
  refresh:
    "M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
  add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
  search:
    "M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
  close:
    "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z",
  edit:
    "M3 17.25V21h3.75L17.81 10.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
  delete:
    "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
  download: "M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z",
  visibility:
    "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  visibilityOff:
    "M12 7c2.76 0 5 2.24 5 5 0 .65-.13 1.26-.36 1.83l2.92 2.92c1.51-1.26 2.7-2.89 3.43-4.75-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16C10.74 7.13 11.35 7 12 7zM2 4.27l2.28 2.28.46.46C3.08 8.3 1.78 10.02 1 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55c-.05.21-.08.43-.08.65 0 1.66 1.34 3 3 3 .22 0 .44-.03.65-.08l1.55 1.55c-.67.33-1.41.53-2.2.53-2.76 0-5-2.24-5-5 0-.79.2-1.53.53-2.2zm4.31-.78 3.15 3.15.02-.16c0-1.66-1.34-3-3-3l-.17.01z",
};

function Icon({
  path,
  size = 22,
  style,
}: {
  path: string;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={style}
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Badge — all props are required strings; call sites always pass them        */
/* -------------------------------------------------------------------------- */

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 700,
        background: bg,
        color: fg,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Assignment picker — searchable multi-select with paste fallback            */
/* -------------------------------------------------------------------------- */

interface IdPickerProps {
  title: string;
  options: PickerOption[];
  selected: string[];
  onToggle: (id: string) => void;
  onRemovePinned: (id: string) => void;
  search: string;
  onSearch: (text: string) => void;
  fallbackText: string;
  onFallbackText: (text: string) => void;
  emptyHint: string;
}

function IdPicker({
  title,
  options,
  selected,
  onToggle,
  onRemovePinned,
  search,
  onSearch,
  fallbackText,
  onFallbackText,
  emptyHint,
}: IdPickerProps) {
  const pinned = selected.filter((id) => !options.some((option) => option.id === id));
  const needle = search.trim().toLowerCase();
  const filtered = needle
    ? options.filter(
        (option) =>
          option.label.toLowerCase().includes(needle) ||
          option.id.toLowerCase().includes(needle),
      )
    : options;

  return (
    <div style={S.field}>
      <div style={S.pickerHead}>
        <label style={S.label}>{title}</label>
        <span style={S.countChip}>{selected.length} selected</span>
      </div>

      {options.length > 0 ? (
        <>
          <div style={{ ...S.textField, marginTop: 4 }}>
            <Icon path={ICON_PATHS.search} size={18} style={{ color: "#94a3b8" }} />
            <input
              style={S.textInput}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder={`Search ${title.toLowerCase()}…`}
              autoComplete="off"
            />
          </div>
          <div style={S.pickerList} className="ums-scroll">
            {filtered.map((option) => (
              <label key={option.id} style={S.pickRow} className="ums-rowitem">
                <input
                  type="checkbox"
                  className="ums-cb"
                  checked={selected.includes(option.id)}
                  onChange={() => onToggle(option.id)}
                />
                <span style={S.pickLabel}>{option.label}</span>
              </label>
            ))}
            {filtered.length === 0 && (
              <div style={S.pickerEmpty}>No matches for “{search}”.</div>
            )}
          </div>
          {pinned.length > 0 && (
            <div style={S.pinnedRow}>
              {pinned.map((id) => (
                <span key={id} style={S.pinnedChip} title={id}>
                  {`${id.slice(0, 8)}…`}
                  <button
                    style={S.pinnedX}
                    onClick={() => onRemovePinned(id)}
                    title="Remove this ID"
                    aria-label={`Remove ${id}`}
                  >
                    <Icon path={ICON_PATHS.close} size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ ...S.textField, marginTop: 4 }}>
            <input
              style={S.textInput}
              value={fallbackText}
              onChange={(event) => onFallbackText(event.target.value)}
              placeholder="Comma-separated UUIDs (optional)"
              autoComplete="off"
            />
          </div>
          <span style={S.hint}>{emptyHint}</span>
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Screen                                                                     */
/* -------------------------------------------------------------------------- */

export default function UserManagement() {
  const [tenantId] = useState<string>(readSessionTenant());
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [offline, setOffline] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [notice, setNotice] = useState<string>("");
  const [search, setSearch] = useState<string>("");
  const [roleFilter, setRoleFilter] = useState<"all" | RoleKey>("all");
  const [formOpen, setFormOpen] = useState<boolean>(false);
  const [editing, setEditing] = useState<boolean>(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState<boolean>(false);
  const [formError, setFormError] = useState<string>("");
  const [confirmTarget, setConfirmTarget] = useState<UserRow | null>(null);
  const [deleteError, setDeleteError] = useState<string>("");
  const [working, setWorking] = useState<boolean>(false);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [courseOptions, setCourseOptions] = useState<PickerOption[]>([]);
  const [departmentOptions, setDepartmentOptions] = useState<PickerOption[]>([]);
  const [optionsLoading, setOptionsLoading] = useState<boolean>(false);
  const [courseSearch, setCourseSearch] = useState<string>("");
  const [departmentSearch, setDepartmentSearch] = useState<string>("");

  const currentUserId = readSessionUserId();

  /* ------------------------------------------------------ assignment options */

  const loadOptions = useCallback(async (): Promise<void> => {
    setOptionsLoading(true);
    try {
      // Courses known to be deleted (tombstoned) must not be assignable.
      let deadCourses = new Set<string>();
      try {
        deadCourses = new Set(await getDeletedIds("course"));
      } catch {
        // Tracker unavailable — filtering is skipped.
      }

      let courses: any[] = [];
      try {
        courses = (await (db as any).courses.toArray()) || [];
      } catch {
        courses = [];
      }
      const courseOpts: PickerOption[] = courses
        .filter((c: any) => sameTenant(c, tenantId))
        .map((c: any) => ({
          id: String(c?.id ?? ""),
          label: s(c?.name || c?.title || c?.id),
        }))
        .filter((o) => o.id && UUID_RE.test(o.id) && !deadCourses.has(o.id))
        .sort((a, b) => a.label.localeCompare(b.label));
      setCourseOptions(courseOpts);

      // Departments: the table name has varied across schema versions —
      // try "departments", then "department". Either may be absent.
      let departments: any[] = [];
      try {
        departments = (await (db as any).departments?.toArray()) || [];
      } catch {
        departments = [];
      }
      if (departments.length === 0) {
        try {
          departments = (await (db as any).department?.toArray()) || [];
        } catch {
          departments = [];
        }
      }
      const deptOpts: PickerOption[] = departments
        .filter((d: any) => sameTenant(d, tenantId))
        .map((d: any) => ({
          id: String(d?.id ?? ""),
          label: s(d?.name || d?.title || d?.departmentName || d?.id),
        }))
        .filter((o) => o.id && UUID_RE.test(o.id))
        .sort((a, b) => a.label.localeCompare(b.label));
      setDepartmentOptions(deptOpts);
    } finally {
      setOptionsLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void loadOptions();
  }, [loadOptions]);

  /* ---------------------------------------------------------------- load */

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError("");
    try {
      const result = await getUsersDetailed(tenantId || undefined);
      setRows(result.users as UserRow[]);
      setOffline(result.offline);
    } catch (error: any) {
      setLoadError(s(error?.message ?? error) || "Could not load users.");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo<UserRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (roleFilter !== "all" && s(row?.role).trim().toLowerCase() !== roleFilter) {
        return false;
      }
      if (!needle) return true;
      const haystack = [row?.username, row?.phone, row?.email].map((v) =>
        s(v).toLowerCase(),
      );
      return haystack.some((text) => text.includes(needle));
    });
  }, [rows, roleFilter, search]);

  const counts = useMemo<{
    total: number;
    admins: number;
    trainers: number;
    trainees: number;
    pending: number;
  }>(() => {
    let admins = 0;
    let trainers = 0;
    let trainees = 0;
    let pending = 0;
    for (const row of rows) {
      const role = s(row?.role).trim().toLowerCase();
      if (role === "admin") admins++;
      else if (role === "trainer") trainers++;
      else if (role === "trainee") trainees++;
      if (row?.synced === false) pending++;
    }
    return { total: rows.length, admins, trainers, trainees, pending };
  }, [rows]);

  const ledger = (row: UserRow): string => {
    const role = s(row?.role).trim().toLowerCase();
    if (role === "trainee") {
      const tuition = (row?.tuition ?? {}) as Record<string, any>;
      return `Tuition: ${moneyText(tuition?.expected)} / ${moneyText(tuition?.paid)}`;
    }
    if (role === "trainer") {
      const remuneration = (row?.remuneration ?? {}) as Record<string, any>;
      return `Pay: ${moneyText(remuneration?.netSalary)} / ${moneyText(remuneration?.perDiem)}`;
    }
    return "—";
  };

  // Snackbar auto-dismiss — notices never block the UI for more than 6s.
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  /* ---------------------------------------------------------------- modal */

  const openAdd = (): void => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setFormError("");
    setShowPassword(false);
    setCourseSearch("");
    setDepartmentSearch("");
    setFormOpen(true);
    void loadOptions();
  };

  const openEdit = (row: UserRow): void => {
    setForm(formFromRow(row));
    setEditing(true);
    setFormError("");
    setShowPassword(false);
    setCourseSearch("");
    setDepartmentSearch("");
    setFormOpen(true);
    void loadOptions();
  };

  const closeModal = (): void => {
    if (saving) return;
    setFormOpen(false);
    setFormError("");
  };

  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const toggleCourseId = (id: string): void => {
    setForm((prev) => ({
      ...prev,
      courseIds: prev.courseIds.includes(id)
        ? prev.courseIds.filter((existing) => existing !== id)
        : [...prev.courseIds, id],
    }));
  };

  const toggleDepartmentId = (id: string): void => {
    setForm((prev) => ({
      ...prev,
      departmentIds: prev.departmentIds.includes(id)
        ? prev.departmentIds.filter((existing) => existing !== id)
        : [...prev.departmentIds, id],
    }));
  };

  /** Cloud push through the schema-exact helper: on failure the row stays
   *  synced:false locally and the sync job retries it later. */
  const pushToCloud = async (row: any): Promise<void> => {
    if (!tenantId) {
      setNotice(
        "Saved on this device only — no institution is linked to your session, so nothing was synced.",
      );
      return;
    }
    try {
      await pushUserRowToSupabase(row, tenantId);
      await db.users.update(row.id, { synced: true, syncedAt: new Date().toISOString() });
      noteUserPushed(s(row.id));
    } catch (error: any) {
      setNotice(
        "Saved on this device, but the cloud sync failed — it will be retried automatically. " +
          s(error?.message ?? error),
      );
    }
  };

  const handleSave = async (): Promise<void> => {
    if (saving) return;
    setFormError("");

    const username = form.username.trim();
    const phone = form.phone.trim();
    const email = form.email.trim();
    const password = form.password.trim();

    if (!username) return setFormError("Username is required.");
    if (!phone && !email) {
      return setFormError("Add at least a phone number or an email address.");
    }
    if (!editing && password.length < 4) {
      return setFormError("New users need a password of at least 4 characters.");
    }
    if (editing && password && password.length < 4) {
      return setFormError(
        "The new password must be at least 4 characters — or leave the field blank to keep the current one.",
      );
    }

    // Assignments: picker selections when the local tables have data,
    // paste parsing while they are still empty (fresh device).
    const useCoursePicker = courseOptions.length > 0;
    const useDepartmentPicker = departmentOptions.length > 0;
    const courseIds = useCoursePicker ? [...form.courseIds] : parseIdList(form.coursePaste);
    const departmentIds = useDepartmentPicker
      ? [...form.departmentIds]
      : parseIdList(form.departmentPaste);

    for (const courseId of courseIds) {
      if (!UUID_RE.test(courseId)) {
        return setFormError(`"${courseId}" is not a valid course ID (UUID expected).`);
      }
    }
    for (const departmentId of departmentIds) {
      if (!UUID_RE.test(departmentId)) {
        return setFormError(`"${departmentId}" is not a valid department ID (UUID expected).`);
      }
    }

    setSaving(true);
    try {
      // Uniqueness inside the institution (case-insensitive) — mirrors the
      // UNIQUE (tenant_id, username) index in Supabase.
      const uname = username.toLowerCase();
      const usernameClash = await db.users
        .filter(
          (u: any) =>
            u?.id !== form.id &&
            s(u?.username).trim().toLowerCase() === uname &&
            sameTenant(u, tenantId),
        )
        .first();
      if (usernameClash) {
        throw new Error(
          "That username is already used in this institution (names differing only by capitalization are not allowed).",
        );
      }

      if (phone) {
        const phoneClash = await db.users
          .filter(
            (u: any) =>
              u?.id !== form.id &&
              s(u?.phone).trim() === phone &&
              sameTenant(u, tenantId),
          )
          .first();
        if (phoneClash) {
          throw new Error("That phone number is already registered to another user.");
        }
      }

      if (email) {
        const emailLower = email.toLowerCase();
        const emailClash = await db.users
          .filter(
            (u: any) =>
              u?.id !== form.id &&
              s(u?.email).trim().toLowerCase() === emailLower &&
              sameTenant(u, tenantId),
          )
          .first();
        if (emailClash) {
          throw new Error(
            "That email address is already registered to another user in this institution.",
          );
        }
      }

      if (editing) {
        if (await isDeleted("user", form.id)) {
          throw new Error("This user was deleted on this device — refresh the list first.");
        }
        const existing: any = await db.users.get(form.id);
        if (!existing) {
          throw new Error("This user is no longer in the local database — refresh the list first.");
        }

        // Assignment lists are written exactly as resolved — clearing the
        // picker (or the paste field) actually clears the assignments.
        const updated: any = {
          ...existing,
          username,
          phone: phone || null,
          email: email || null,
          role: form.role,
          tenantId: existing?.tenantId || tenantId,
          tenant_id: existing?.tenant_id || tenantId,
          assigned_courses: courseIds,
          assignedCourses: courseIds,
          assignedDepartments: departmentIds,
          synced: false,
          updated_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        // The camelCase key is the canonical local shape (it is the literal
        // column name in Supabase); drop the legacy snake_case copy so the
        // two can never diverge.
        delete updated.assigned_departments;
        // This edit invalidates any previous sync stamp.
        delete updated.syncedAt;
        delete updated.synced_at;
        // Role-ledger hygiene: keep exactly the ledger that matches the role —
        // a role change wipes the old object so stale jsonb never syncs up.
        if (form.role === "trainee") {
          updated.tuition = { expected: num(form.tuitionExpected), paid: num(form.tuitionPaid) };
          delete updated.remuneration;
        } else if (form.role === "trainer") {
          updated.remuneration = { netSalary: num(form.netSalary), perDiem: num(form.perDiem) };
          delete updated.tuition;
        } else {
          delete updated.tuition;
          delete updated.remuneration;
        }
        // Blank password field = keep the current password. A typed password
        // is stored bcrypt-hashed, exactly like ProfileSettings stores it.
        if (password) {
          updated.password = hashSync(password, 10);
        }

        await db.users.put(updated);
        await pushToCloud(updated);
        setNotice(`${username} saved.`);
      } else {
        if (!tenantId) {
          throw new Error(
            "No institution is linked to your session — sign in again, then create users.",
          );
        }

        const row: any = {
          id: makeId(),
          username,
          phone: phone || null,
          email: email || null,
          role: form.role,
          password: hashSync(password, 10),
          tenantId,
          tenant_id: tenantId,
          assigned_courses: courseIds,
          assignedCourses: courseIds,
          assignedDepartments: departmentIds,
          synced: false,
          created_at: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        if (form.role === "trainee") {
          row.tuition = { expected: num(form.tuitionExpected), paid: num(form.tuitionPaid) };
        } else if (form.role === "trainer") {
          row.remuneration = { netSalary: num(form.netSalary), perDiem: num(form.perDiem) };
        }

        await db.users.put(row);
        await pushToCloud(row);
        setNotice(`${username} created.`);
      }

      try {
        window.dispatchEvent(new Event("userChanged"));
      } catch {
        // Listeners may not exist.
      }

      setFormOpen(false);
      await refresh();
    } catch (error: any) {
      setFormError(s(error?.message ?? error) || "Could not save the user.");
    } finally {
      setSaving(false);
    }
  };

  /* --------------------------------------------------------------- delete */

  const askDelete = (row: UserRow): void => {
    setDeleteError("");
    setConfirmTarget(row);
  };

  const cancelDelete = (): void => {
    if (working) return;
    setConfirmTarget(null);
    setDeleteError("");
  };

  const handleDelete = async (): Promise<void> => {
    if (!confirmTarget || working) return;
    const target = confirmTarget;
    const id = s(target?.id);
    setWorking(true);
    setDeleteError("");
    try {
      if (!id) throw new Error("Missing user id.");

      // Tombstone FIRST — closes the resurrection race window (same as trainerDB).
      await markDeleted("user", id, tenantId, "pending");

      // Local cascade — each step guarded so a missing/unindexed table cannot
      // abort. chatMessages is purged by BOTH userId and senderId; schedules
      // by BOTH trainerId and traineeId (guarded no-ops when absent).
      try { await db.enrollments.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.assignmentSubmissions.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.chatMessages.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.chatMessages.where("senderId").equals(id).delete(); } catch { /* senderId may not be indexed */ }
      try { await db.schedules.where("trainerId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.schedules.where("traineeId").equals(id).delete(); } catch { /* traineeId may not be indexed */ }
      await db.users.delete(id);

      if (tenantId) {
        try {
          await deleteUserRowFromSupabase(id, tenantId);
          await unmarkDeleted("user", id);
        } catch (error: any) {
          const message = s(error?.message ?? error) || "unknown error";
          await markDeleted("user", id, tenantId, "failed", message);
          throw new Error(
            `Deleted on this device, but the cloud delete failed: ${message}. The sync job will retry it automatically.`,
          );
        }
      }

      setConfirmTarget(null);
      setNotice(`${s(target?.username) || "User"} deleted.`);
      try {
        window.dispatchEvent(new Event("userChanged"));
      } catch {
        // Listeners may not exist.
      }
      await refresh();
    } catch (error: any) {
      setDeleteError(s(error?.message ?? error) || "Could not delete the user.");
      await refresh();
    } finally {
      setWorking(false);
    }
  };

  /* ----------------------------------------------------------------- csv */

  const exportCsv = (): void => {
    const escape = (value: unknown): string =>
      `"${s(value).replace(/"/g, '""')}"`;

    const header = [
      "Username",
      "Role",
      "Phone",
      "Email",
      "Tuition expected",
      "Tuition paid",
      "Net salary",
      "Per diem",
      "Assigned courses",
      "Assigned departments",
      "Sync status",
      "Created at",
    ];

    const lines: string[] = [header.map(escape).join(",")];
    for (const row of filtered) {
      const tuition = (row?.tuition ?? {}) as Record<string, any>;
      const remuneration = (row?.remuneration ?? {}) as Record<string, any>;
      const courses = readIdField(row, "assigned_courses", "assignedCourses");
      const departments = readIdField(row, "assigned_departments", "assignedDepartments");
      lines.push(
        [
          row?.username,
          roleBadge(row?.role).label,
          row?.phone,
          row?.email,
          tuition?.expected,
          tuition?.paid,
          remuneration?.netSalary,
          remuneration?.perDiem,
          courses.map((course) => s(course)).join(" "),
          departments.map((department) => s(department)).join(" "),
          row?.synced === false ? "pending" : "synced",
          s(row?.created_at ?? row?.createdAt),
        ]
          .map(escape)
          .join(","),
      );
    }

    try {
      const blob = new Blob(["\uFEFF" + lines.join("\r\n")], {
        type: "text/csv;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `medstat-users-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${filtered.length} users to CSV.`);
    } catch (error: any) {
      setLoadError(s(error?.message ?? error) || "Could not export the CSV.");
    }
  };

  /* -------------------------------------------------------------- render */

  const subtitle = loading
    ? "Loading users…"
    : offline
      ? "Offline — showing users saved on this device"
      : `${filtered.length} of ${rows.length} users`;

  return (
    <div style={S.screen} className="ums-root">
      <style>{UMS_CSS}</style>

      {/* Top app bar */}
      <div style={S.appbar}>
        <div style={S.appbarTitles}>
          <h1 style={S.appbarTitle}>Users</h1>
          <div style={S.appbarSubtitle}>{subtitle}</div>
        </div>
        <div style={S.actionsRow}>
          <button
            className="ums-iconbtn"
            onClick={() => {
              void refresh();
            }}
            disabled={loading}
            title="Refresh"
            aria-label="Refresh users"
          >
            <Icon path={ICON_PATHS.refresh} />
          </button>
          <button
            className="ums-iconbtn"
            onClick={exportCsv}
            disabled={loading || filtered.length === 0}
            title="Export CSV"
            aria-label="Export users to CSV"
          >
            <Icon path={ICON_PATHS.download} />
          </button>
        </div>
      </div>

      <div style={S.shell}>
        {offline && !loading && (
          <div style={S.bannerOffline}>
            You are offline — the list comes from this device and may be out of date. Changes are
            queued and sync automatically once the connection returns.
          </div>
        )}
        {loadError && <div style={S.bannerError}>{loadError}</div>}
        {!tenantId && !loading && (
          <div style={S.bannerError}>
            No institution is linked to your session — the list is not tenant-scoped and new users
            cannot sync. Sign in again to fix this.
          </div>
        )}

        {/* Stat pills */}
        <div style={S.statsRow} className="ums-scroll">
          <div style={S.pill}>
            <span style={S.pillValue}>{counts.total}</span>
            <span style={S.pillLabel}>Users</span>
          </div>
          <div style={S.pill}>
            <span style={S.pillValue}>{counts.admins}</span>
            <span style={S.pillLabel}>Admins</span>
          </div>
          <div style={S.pill}>
            <span style={S.pillValue}>{counts.trainers}</span>
            <span style={S.pillLabel}>Trainers</span>
          </div>
          <div style={S.pill}>
            <span style={S.pillValue}>{counts.trainees}</span>
            <span style={S.pillLabel}>Trainees</span>
          </div>
          <div style={S.pill}>
            <span style={S.pillValue}>{counts.pending}</span>
            <span style={S.pillLabel}>Pending sync</span>
          </div>
        </div>

        {/* Search + role chips */}
        <div style={S.searchWrap}>
          <Icon path={ICON_PATHS.search} size={20} style={{ color: "#64748b" }} />
          <input
            style={S.searchInput}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search username, phone or email…"
          />
          {search && (
            <button
              className="ums-iconbtn"
              onClick={() => setSearch("")}
              title="Clear search"
              aria-label="Clear search"
            >
              <Icon path={ICON_PATHS.close} size={18} />
            </button>
          )}
        </div>
        <div style={S.chipsRow}>
          {(["all", "admin", "trainer", "trainee"] as const).map((key) => {
            const labels: Record<string, string> = {
              all: "All roles",
              admin: "Admins",
              trainer: "Trainers",
              trainee: "Trainees",
            };
            const on = roleFilter === key;
            return (
              <button
                key={key}
                className="ums-chip"
                style={on ? { ...S.chip, ...S.chipOn } : S.chip}
                onClick={() => setRoleFilter(key)}
              >
                {labels[key]}
              </button>
            );
          })}
        </div>

        {/* User list */}
        <div style={S.card}>
          {loading && <div style={S.loadingRow}>Loading users…</div>}
          {!loading && filtered.length === 0 && (
            <div style={S.emptyState}>
              <p style={S.emptyTitle}>
                {rows.length === 0 ? "No users yet" : "No matching users"}
              </p>
              <p style={S.emptyBody}>
                {rows.length === 0
                  ? "Tap “Add user” to create the first trainer or trainee. If you just signed in on a new device, give the first sync a moment and press refresh."
                  : "No users match the current search or role filter."}
              </p>
            </div>
          )}
          {filtered.map((row) => {
            const badge = roleBadge(row?.role);
            const sync = syncBadge(row?.synced);
            const joinedAt = s(row?.created_at ?? row?.createdAt);
            return (
              <div key={s(row?.id) || s(row?.username)} style={S.item} className="ums-rowitem">
                <div style={{ ...S.avatar, background: avatarColor(row?.username) }}>
                  {initials(row?.username)}
                </div>
                <div style={S.itemBody}>
                  <div style={S.titleRow}>
                    <span style={S.itemTitle}>{s(row?.username)}</span>
                    <Badge label={badge.label} bg={badge.bg} fg={badge.fg} />
                  </div>
                  <div style={S.itemSub}>
                    {s(row?.phone) || "No phone"} · {s(row?.email) || "No email"}
                  </div>
                  <div style={S.itemMeta}>
                    <Badge label={sync.label} bg={sync.bg} fg={sync.fg} />
                    <span style={S.metaText}>
                      {joinedAt ? `Joined ${joinedAt.slice(0, 10)}` : "Join date unknown"}
                    </span>
                    <span style={S.metaText}>{ledger(row)}</span>
                  </div>
                </div>
                <div style={S.itemActions}>
                  <button
                    className="ums-iconbtn"
                    onClick={() => openEdit(row)}
                    title={`Edit ${s(row?.username)}`}
                    aria-label={`Edit ${s(row?.username)}`}
                  >
                    <Icon path={ICON_PATHS.edit} size={20} />
                  </button>
                  <button
                    className="ums-iconbtn"
                    onClick={() => askDelete(row)}
                    title={`Delete ${s(row?.username)}`}
                    aria-label={`Delete ${s(row?.username)}`}
                  >
                    <Icon path={ICON_PATHS.delete} size={20} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Extended FAB */}
      <button style={S.fab} className="ums-btn" onClick={openAdd}>
        <Icon path={ICON_PATHS.add} size={22} />
        Add user
      </button>

      {/* Snackbar */}
      {notice && (
        <div style={S.snack} className="ums-snack" role="status">
          <span style={S.snackText}>{notice}</span>
          <button
            className="ums-iconbtn ums-iconbtn--ondark"
            onClick={() => setNotice("")}
            title="Dismiss"
            aria-label="Dismiss notification"
          >
            <Icon path={ICON_PATHS.close} size={18} />
          </button>
        </div>
      )}

      {/* Add / edit — bottom sheet on phones, dialog on wide screens */}
      {formOpen && (
        <div className="ums-shell" onClick={closeModal}>
          <div
            className="ums-sheet"
            style={S.sheet}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={S.dragHandle} />
            <div style={S.sheetHead}>
              <h2 style={S.sheetTitle}>{editing ? "Edit user" : "Add user"}</h2>
              <button
                className="ums-iconbtn"
                onClick={closeModal}
                disabled={saving}
                title="Close"
                aria-label="Close form"
              >
                <Icon path={ICON_PATHS.close} size={20} />
              </button>
            </div>
            {formError && <div style={S.formError}>{formError}</div>}

            <div style={S.sectionLabel}>Identity</div>
            <div style={S.formGrid}>
              <div style={S.field}>
                <label style={S.label}>Username *</label>
                <div style={S.textField}>
                  <input
                    style={S.textInput}
                    value={form.username}
                    onChange={(event) => patchForm({ username: event.target.value })}
                    placeholder="e.g. jdoe"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div style={S.field}>
                <label style={S.label}>Role *</label>
                <div style={{ display: "flex" }}>
                  {ROLE_KEYS.map((key) => (
                    <button
                      key={key}
                      className={"ums-seg" + (form.role === key ? " ums-seg--on" : "")}
                      onClick={() => patchForm({ role: key })}
                      type="button"
                    >
                      {ROLE_BADGES[key].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={S.sectionLabel}>Contact</div>
            <div style={S.formGrid}>
              <div style={S.field}>
                <label style={S.label}>Phone</label>
                <div style={S.textField}>
                  <input
                    style={S.textInput}
                    value={form.phone}
                    onChange={(event) => patchForm({ phone: event.target.value })}
                    placeholder="e.g. 0722 123 456"
                    autoComplete="off"
                    inputMode="tel"
                  />
                </div>
              </div>
              <div style={S.field}>
                <label style={S.label}>Email</label>
                <div style={S.textField}>
                  <input
                    style={S.textInput}
                    value={form.email}
                    onChange={(event) => patchForm({ email: event.target.value })}
                    placeholder="name@institution.com"
                    autoComplete="off"
                    inputMode="email"
                  />
                </div>
              </div>
            </div>

            <div style={S.sectionLabel}>Security</div>
            <div style={S.formGrid}>
              <div style={S.field}>
                <label style={S.label}>{editing ? "New password" : "Password *"}</label>
                <div style={S.textField}>
                  <input
                    style={S.textInput}
                    type={showPassword ? "text" : "password"}
                    value={form.password}
                    onChange={(event) => patchForm({ password: event.target.value })}
                    placeholder={editing ? "Leave blank to keep current" : "At least 4 characters"}
                    autoComplete="new-password"
                  />
                  <button
                    className="ums-iconbtn"
                    onClick={() => setShowPassword((prev) => !prev)}
                    title={showPassword ? "Hide password" : "Show password"}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    type="button"
                  >
                    <Icon path={showPassword ? ICON_PATHS.visibilityOff : ICON_PATHS.visibility} size={20} />
                  </button>
                </div>
                <span style={S.hint}>
                  {editing
                    ? "Leave blank to keep the current password. A typed password is stored bcrypt-hashed."
                    : "Stored bcrypt-hashed — the user signs in with the plaintext version."}
                </span>
              </div>
            </div>

            {form.role === "trainee" && (
              <>
                <div style={S.sectionLabel}>Tuition ledger</div>
                <div style={S.formGrid}>
                  <div style={S.field}>
                    <label style={S.label}>Tuition expected</label>
                    <div style={S.textField}>
                      <input
                        style={S.textInput}
                        value={form.tuitionExpected}
                        onChange={(event) => patchForm({ tuitionExpected: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Tuition paid</label>
                    <div style={S.textField}>
                      <input
                        style={S.textInput}
                        value={form.tuitionPaid}
                        onChange={(event) => patchForm({ tuitionPaid: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}
            {form.role === "trainer" && (
              <>
                <div style={S.sectionLabel}>Remuneration</div>
                <div style={S.formGrid}>
                  <div style={S.field}>
                    <label style={S.label}>Net salary</label>
                    <div style={S.textField}>
                      <input
                        style={S.textInput}
                        value={form.netSalary}
                        onChange={(event) => patchForm({ netSalary: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Per diem</label>
                    <div style={S.textField}>
                      <input
                        style={S.textInput}
                        value={form.perDiem}
                        onChange={(event) => patchForm({ perDiem: event.target.value })}
                        inputMode="decimal"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            <div style={S.sectionLabel}>Access</div>
            <div style={S.formGrid}>
              <IdPicker
                title="Courses"
                options={courseOptions}
                selected={form.courseIds}
                onToggle={toggleCourseId}
                onRemovePinned={toggleCourseId}
                search={courseSearch}
                onSearch={(text) => setCourseSearch(text)}
                fallbackText={form.coursePaste}
                onFallbackText={(text) => patchForm({ coursePaste: text })}
                emptyHint={
                  optionsLoading
                    ? "Loading courses…"
                    : "Courses have not synced to this device yet — paste UUIDs here, or press refresh after the next sync."
                }
              />
              <IdPicker
                title="Departments"
                options={departmentOptions}
                selected={form.departmentIds}
                onToggle={toggleDepartmentId}
                onRemovePinned={toggleDepartmentId}
                search={departmentSearch}
                onSearch={(text) => setDepartmentSearch(text)}
                fallbackText={form.departmentPaste}
                onFallbackText={(text) => patchForm({ departmentPaste: text })}
                emptyHint={
                  optionsLoading
                    ? "Loading departments…"
                    : "No departments table data on this device yet — paste UUIDs here."
                }
              />
            </div>

            <div style={S.modalFooter}>
              <button className="ums-btn" style={S.btn} onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
                className="ums-btn"
                style={S.btnPrimary}
                onClick={() => {
                  void handleSave();
                }}
                disabled={saving}
              >
                {saving ? "Saving…" : editing ? "Save changes" : "Create user"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation — same sheet/dialog behavior */}
      {confirmTarget && (
        <div className="ums-shell">
          <div
            className="ums-sheet"
            style={S.sheet}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={S.dragHandle} />
            <div style={S.sheetHead}>
              <h2 style={S.sheetTitle}>Delete user</h2>
              <button
                className="ums-iconbtn"
                onClick={cancelDelete}
                disabled={working}
                title="Close"
                aria-label="Close delete confirmation"
              >
                <Icon path={ICON_PATHS.close} size={20} />
              </button>
            </div>
            {deleteError && <div style={S.formError}>{deleteError}</div>}
            <p style={S.deleteText}>
              Delete <strong>{s(confirmTarget?.username) || "this user"}</strong>? This removes the
              account from this device and from Supabase (soft delete), together with their
              enrollments, submissions, chat messages and schedules. This cannot be undone.
            </p>
            {s(confirmTarget?.id) === currentUserId && (
              <p style={S.deleteText}>
                Note: this is your own account — you will be signed out of features that depend on
                it.
              </p>
            )}
            <div style={S.modalFooter}>
              <button className="ums-btn" style={S.btn} onClick={cancelDelete} disabled={working}>
                Cancel
              </button>
              <button
                className="ums-btn"
                style={S.btnDanger}
                onClick={() => {
                  void handleDelete();
                }}
                disabled={working}
              >
                {working ? "Deleting…" : "Delete user"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
