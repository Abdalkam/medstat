// src/admin/UserManagement.tsx — v2: fully-typed admin user management.
//
// Drop-in replacement screen. Every value that reaches a typed parameter
// goes through the s() helper first, so the error class
// "Argument of type 'string | undefined' is not assignable to parameter of
// type 'string'" (TS2345 / TS2322 on the Badge label) cannot occur here.
//
// Feature set:
//   • Cloud-first user list (Supabase → Dexie fallback) with offline banner
//   • Search + role filter + live counts
//   • Add / edit / delete users of every role (admin, trainer, trainee)
//   • Tuition ledger (trainees) and pay ledger (trainers)
//   • Assigned courses / departments (comma-separated UUIDs)
//   • Password set/reset — bcrypt-hashed, same convention as ProfileSettings
//   • Tombstone-aware deletes with cloud soft-delete + automatic retry
//   • Pending-sync badges + CSV export
//
// Data flow mirrors trainerDB.ts v3 exactly:
//   local put (synced:false) → clash checks → pushUserToSupabase →
//   update {synced:true} → noteUserPushed.
//   Deletes: tombstone first → local cascade → deleteUserFromSupabase
//   (unmark on success, mark "failed" on error so the sync job retries).

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
  deleteUserFromSupabase,
  pushUserToSupabase,
} from "../database/supabaseCourseSync";
import {
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
/* Form state — strings only, parsed at save time                             */
/* -------------------------------------------------------------------------- */

type UserRow = MedStatUser & Record<string, any>;

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
  assignedCourses: string;
  assignedDepartments: string;
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
  assignedCourses: "",
  assignedDepartments: "",
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
  const courses: unknown[] = Array.isArray(row?.assigned_courses)
    ? row.assigned_courses
    : Array.isArray(row?.assignedCourses)
      ? row.assignedCourses
      : [];
  const departments: unknown[] = Array.isArray(row?.assignedDepartments)
    ? row.assignedDepartments
    : [];

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
    assignedCourses: courses.map((c) => s(c)).filter(Boolean).join(", "),
    assignedDepartments: departments.map((d) => s(d)).filter(Boolean).join(", "),
  };
}

function parseIdList(raw: string): string[] {
  return raw.split(",").map((part) => part.trim()).filter(Boolean);
}

/* -------------------------------------------------------------------------- */
/* Styles                                                                     */
/* -------------------------------------------------------------------------- */

const S: Record<string, CSSProperties> = {
  screen: {
    minHeight: "100%",
    background: "#f1f5f9",
    padding: "20px 18px 48px",
    color: "#0f172a",
  },
  shell: { maxWidth: 1080, margin: "0 auto" },
  headerRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 13, color: "#64748b", marginTop: 4 },
  actions: { display: "flex", gap: 8, flexWrap: "wrap" },
  btn: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 10,
    padding: "9px 14px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnPrimary: {
    border: "1px solid #2563eb",
    background: "#2563eb",
    color: "#ffffff",
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnDanger: {
    border: "1px solid #dc2626",
    background: "#dc2626",
    color: "#ffffff",
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSmall: {
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#0f172a",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  btnSmallDanger: {
    border: "1px solid #fecaca",
    background: "#fef2f2",
    color: "#b91c1c",
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  bannerOffline: {
    background: "#fffbeb",
    border: "1px solid #fde68a",
    color: "#92400e",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
  },
  bannerError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
  },
  bannerNotice: {
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    color: "#1d4ed8",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 10,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  noticeClose: {
    border: "none",
    background: "transparent",
    color: "#1d4ed8",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    lineHeight: 1,
  },
  statsRow: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  chip: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "10px 16px",
    minWidth: 96,
  },
  chipValue: { display: "block", fontSize: 20, fontWeight: 700 },
  chipLabel: { display: "block", fontSize: 12, color: "#64748b", marginTop: 2 },
  toolbar: { display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 },
  input: {
    flex: "1 1 240px",
    minWidth: 200,
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    background: "#ffffff",
    color: "#0f172a",
  },
  select: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    background: "#ffffff",
    color: "#0f172a",
  },
  card: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 14,
    overflow: "hidden",
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: {
    textAlign: "left",
    padding: "12px 14px",
    background: "#f8fafc",
    borderBottom: "1px solid #e2e8f0",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "#64748b",
    whiteSpace: "nowrap",
  },
  td: {
    padding: "12px 14px",
    borderBottom: "1px solid #f1f5f9",
    verticalAlign: "middle",
  },
  userCell: { display: "flex", alignItems: "center", gap: 10 },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    color: "#ffffff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 14,
    fontWeight: 700,
    flexShrink: 0,
  },
  usernameText: { fontWeight: 600, wordBreak: "break-word" },
  dimText: { fontSize: 12, color: "#64748b", marginTop: 2, wordBreak: "break-word" },
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(15, 23, 42, 0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    zIndex: 60,
  },
  modal: {
    background: "#ffffff",
    borderRadius: 16,
    width: "min(600px, 94vw)",
    maxHeight: "88vh",
    overflowY: "auto",
    padding: 20,
  },
  modalTitle: { fontSize: 18, fontWeight: 700, margin: "0 0 12px" },
  formError: {
    background: "#fef2f2",
    border: "1px solid #fecaca",
    color: "#b91c1c",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 13,
    marginBottom: 12,
  },
  modalGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  field: { display: "flex", flexDirection: "column", gap: 5 },
  label: { fontSize: 12, fontWeight: 600, color: "#334155" },
  inputFull: {
    border: "1px solid #cbd5e1",
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    background: "#ffffff",
    color: "#0f172a",
    width: "100%",
    boxSizing: "border-box",
  },
  hint: { fontSize: 11, color: "#64748b" },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  deleteText: { fontSize: 14, lineHeight: 1.55, color: "#334155", margin: "0 0 10px" },
};

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
        fontSize: 12,
        fontWeight: 600,
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

  const currentUserId = readSessionUserId();

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

  /* ---------------------------------------------------------------- modal */

  const openAdd = (): void => {
    setForm(EMPTY_FORM);
    setEditing(false);
    setFormError("");
    setFormOpen(true);
  };

  const openEdit = (row: UserRow): void => {
    setForm(formFromRow(row));
    setEditing(true);
    setFormError("");
    setFormOpen(true);
  };

  const closeModal = (): void => {
    if (saving) return;
    setFormOpen(false);
    setFormError("");
  };

  const patchForm = (patch: Partial<FormState>): void => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  /** Cloud push with the trainerDB retry semantics: on failure the row stays
   *  synced:false locally and the sync job retries it later. */
  const pushToCloud = async (row: any): Promise<void> => {
    if (!tenantId) {
      setNotice(
        "Saved on this device only — no institution is linked to your session, so nothing was synced.",
      );
      return;
    }
    try {
      await pushUserToSupabase(row, tenantId);
      await db.users.update(row.id, { synced: true });
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

    const courseIds = parseIdList(form.assignedCourses);
    for (const courseId of courseIds) {
      if (!UUID_RE.test(courseId)) {
        return setFormError(`"${courseId}" is not a valid course ID (UUID expected).`);
      }
    }
    const departmentIds = parseIdList(form.assignedDepartments);
    for (const departmentId of departmentIds) {
      if (!UUID_RE.test(departmentId)) {
        return setFormError(`"${departmentId}" is not a valid department ID (UUID expected).`);
      }
    }

    setSaving(true);
    try {
      // Uniqueness inside the institution (case-insensitive) — the same
      // guard trainerDB enforces and the UNIQUE (tenant_id, username) index
      // enforces in Supabase.
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

      if (editing) {
        if (await isDeleted("user", form.id)) {
          throw new Error("This user was deleted on this device — refresh the list first.");
        }
        const existing: any = await db.users.get(form.id);
        if (!existing) {
          throw new Error("This user is no longer in the local database — refresh the list first.");
        }

        const updated: any = {
          ...existing,
          username,
          phone: phone || null,
          email: email || null,
          role: form.role,
          tenantId: existing?.tenantId || tenantId,
          tenant_id: existing?.tenant_id || tenantId,
          assigned_courses: courseIds.length ? courseIds : existing?.assigned_courses ?? [],
          assignedCourses: courseIds.length ? courseIds : existing?.assignedCourses ?? [],
          assignedDepartments: departmentIds.length
            ? departmentIds
            : existing?.assignedDepartments ?? [],
          synced: false,
        };
        if (form.role === "trainee") {
          updated.tuition = { expected: num(form.tuitionExpected), paid: num(form.tuitionPaid) };
        }
        if (form.role === "trainer") {
          updated.remuneration = { netSalary: num(form.netSalary), perDiem: num(form.perDiem) };
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
        };
        if (form.role === "trainee") {
          row.tuition = { expected: num(form.tuitionExpected), paid: num(form.tuitionPaid) };
        }
        if (form.role === "trainer") {
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

      // Local cascade — each step guarded so a missing/unindexed table cannot abort.
      try { await db.enrollments.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.assignmentSubmissions.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.chatMessages.where("userId").equals(id).delete(); } catch { /* table may not exist */ }
      try { await db.schedules.where("trainerId").equals(id).delete(); } catch { /* table may not exist */ }
      await db.users.delete(id);

      if (tenantId) {
        try {
          await deleteUserFromSupabase(id, tenantId);
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
      "Sync status",
      "Created at",
    ];

    const lines: string[] = [header.map(escape).join(",")];
    for (const row of filtered) {
      const tuition = (row?.tuition ?? {}) as Record<string, any>;
      const remuneration = (row?.remuneration ?? {}) as Record<string, any>;
      const courses: unknown[] = Array.isArray(row?.assigned_courses)
        ? row.assigned_courses
        : Array.isArray(row?.assignedCourses)
          ? row.assignedCourses
          : [];
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

  return (
    <div style={S.screen}>
      <div style={S.shell}>
        <div style={S.headerRow}>
          <div>
            <h1 style={S.title}>User Management</h1>
            <div style={S.subtitle}>
              {loading
                ? "Loading users…"
                : offline
                  ? "Offline — showing users saved on this device"
                  : `${filtered.length} of ${rows.length} users`}
            </div>
          </div>
          <div style={S.actions}>
            <button
              style={S.btn}
              onClick={() => {
                void refresh();
              }}
              disabled={loading}
            >
              Refresh
            </button>
            <button style={S.btn} onClick={exportCsv} disabled={loading || filtered.length === 0}>
              Export CSV
            </button>
            <button style={S.btnPrimary} onClick={openAdd}>
              + Add user
            </button>
          </div>
        </div>

        {offline && !loading && (
          <div style={S.bannerOffline}>
            You are offline — the list comes from this device and may be out of date. Changes are
            queued and sync automatically once the connection returns.
          </div>
        )}
        {loadError && <div style={S.bannerError}>{loadError}</div>}
        {notice && (
          <div style={S.bannerNotice}>
            <span>{notice}</span>
            <button style={S.noticeClose} onClick={() => setNotice("")} title="Dismiss">
              ×
            </button>
          </div>
        )}
        {!tenantId && !loading && (
          <div style={S.bannerError}>
            No institution is linked to your session — the list is not tenant-scoped and new users
            cannot sync. Sign in again to fix this.
          </div>
        )}

        <div style={S.statsRow}>
          <div style={S.chip}>
            <span style={S.chipValue}>{counts.total}</span>
            <span style={S.chipLabel}>Users</span>
          </div>
          <div style={S.chip}>
            <span style={S.chipValue}>{counts.admins}</span>
            <span style={S.chipLabel}>Admins</span>
          </div>
          <div style={S.chip}>
            <span style={S.chipValue}>{counts.trainers}</span>
            <span style={S.chipLabel}>Trainers</span>
          </div>
          <div style={S.chip}>
            <span style={S.chipValue}>{counts.trainees}</span>
            <span style={S.chipLabel}>Trainees</span>
          </div>
          <div style={S.chip}>
            <span style={S.chipValue}>{counts.pending}</span>
            <span style={S.chipLabel}>Pending sync</span>
          </div>
        </div>

        <div style={S.toolbar}>
          <input
            style={S.input}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search username, phone or email…"
          />
          <select
            style={S.select}
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value as "all" | RoleKey)}
          >
            <option value="all">All roles</option>
            <option value="admin">Admins</option>
            <option value="trainer">Trainers</option>
            <option value="trainee">Trainees</option>
          </select>
        </div>

        <div style={S.card}>
          <div style={S.tableWrap}>
            <table style={S.table}>
              <thead>
                <tr>
                  <th style={S.th}>User</th>
                  <th style={S.th}>Role</th>
                  <th style={S.th}>Contact</th>
                  <th style={S.th}>Ledger</th>
                  <th style={S.th}>Sync</th>
                  <th style={S.th}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td style={S.td} colSpan={6}>
                      Loading users…
                    </td>
                  </tr>
                )}
                {!loading && filtered.length === 0 && (
                  <tr>
                    <td style={S.td} colSpan={6}>
                      {rows.length === 0
                        ? "No users yet — add your first user, or check the connection and press Refresh."
                        : "No users match the current search or role filter."}
                    </td>
                  </tr>
                )}
                {filtered.map((row) => {
                  const badge = roleBadge(row?.role);
                  const sync = syncBadge(row?.synced);
                  const joinedAt = s(row?.created_at ?? row?.createdAt);
                  return (
                    <tr key={s(row?.id) || s(row?.username)}>
                      <td style={S.td}>
                        <div style={S.userCell}>
                          <div style={{ ...S.avatar, background: avatarColor(row?.username) }}>
                            {initials(row?.username)}
                          </div>
                          <div>
                            <div style={S.usernameText}>{s(row?.username)}</div>
                            <div style={S.dimText}>
                              {joinedAt ? `Joined ${joinedAt.slice(0, 10)}` : ""}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td style={S.td}>
                        <Badge label={badge.label} bg={badge.bg} fg={badge.fg} />
                      </td>
                      <td style={S.td}>
                        <div>{s(row?.phone) || "—"}</div>
                        <div style={S.dimText}>{s(row?.email)}</div>
                      </td>
                      <td style={S.td}>{ledger(row)}</td>
                      <td style={S.td}>
                        <Badge label={sync.label} bg={sync.bg} fg={sync.fg} />
                      </td>
                      <td style={S.td}>
                        <div style={S.actions}>
                          <button style={S.btnSmall} onClick={() => openEdit(row)}>
                            Edit
                          </button>
                          <button style={S.btnSmallDanger} onClick={() => askDelete(row)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {formOpen && (
        <div style={S.overlay} onClick={closeModal}>
          <div style={S.modal} onClick={(event) => event.stopPropagation()}>
            <h2 style={S.modalTitle}>{editing ? "Edit user" : "Add user"}</h2>
            {formError && <div style={S.formError}>{formError}</div>}
            <div style={S.modalGrid}>
              <div style={S.field}>
                <label style={S.label}>Username *</label>
                <input
                  style={S.inputFull}
                  value={form.username}
                  onChange={(event) => patchForm({ username: event.target.value })}
                  placeholder="e.g. jdoe"
                  autoComplete="off"
                />
              </div>
              <div style={S.field}>
                <label style={S.label}>Role *</label>
                <select
                  style={S.inputFull}
                  value={form.role}
                  onChange={(event) => patchForm({ role: event.target.value as RoleKey })}
                >
                  <option value="admin">Admin</option>
                  <option value="trainer">Trainer</option>
                  <option value="trainee">Trainee</option>
                </select>
              </div>
              <div style={S.field}>
                <label style={S.label}>Phone</label>
                <input
                  style={S.inputFull}
                  value={form.phone}
                  onChange={(event) => patchForm({ phone: event.target.value })}
                  placeholder="e.g. 0722 123 456"
                  autoComplete="off"
                />
              </div>
              <div style={S.field}>
                <label style={S.label}>Email</label>
                <input
                  style={S.inputFull}
                  value={form.email}
                  onChange={(event) => patchForm({ email: event.target.value })}
                  placeholder="name@institution.com"
                  autoComplete="off"
                />
              </div>
              <div style={S.field}>
                <label style={S.label}>{editing ? "New password" : "Password *"}</label>
                <input
                  style={S.inputFull}
                  type="password"
                  value={form.password}
                  onChange={(event) => patchForm({ password: event.target.value })}
                  placeholder={editing ? "Leave blank to keep current" : "At least 4 characters"}
                  autoComplete="new-password"
                />
                <span style={S.hint}>
                  {editing
                    ? "Leave blank to keep the current password. A typed password is stored bcrypt-hashed."
                    : "Stored bcrypt-hashed — the user signs in with the plaintext version."}
                </span>
              </div>
              {form.role === "trainee" && (
                <>
                  <div style={S.field}>
                    <label style={S.label}>Tuition expected</label>
                    <input
                      style={S.inputFull}
                      value={form.tuitionExpected}
                      onChange={(event) => patchForm({ tuitionExpected: event.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Tuition paid</label>
                    <input
                      style={S.inputFull}
                      value={form.tuitionPaid}
                      onChange={(event) => patchForm({ tuitionPaid: event.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                </>
              )}
              {form.role === "trainer" && (
                <>
                  <div style={S.field}>
                    <label style={S.label}>Net salary</label>
                    <input
                      style={S.inputFull}
                      value={form.netSalary}
                      onChange={(event) => patchForm({ netSalary: event.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                  <div style={S.field}>
                    <label style={S.label}>Per diem</label>
                    <input
                      style={S.inputFull}
                      value={form.perDiem}
                      onChange={(event) => patchForm({ perDiem: event.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                  </div>
                </>
              )}
              <div style={S.field}>
                <label style={S.label}>Assigned course IDs</label>
                <input
                  style={S.inputFull}
                  value={form.assignedCourses}
                  onChange={(event) => patchForm({ assignedCourses: event.target.value })}
                  placeholder="Comma-separated UUIDs (optional)"
                  autoComplete="off"
                />
              </div>
              <div style={S.field}>
                <label style={S.label}>Assigned department IDs</label>
                <input
                  style={S.inputFull}
                  value={form.assignedDepartments}
                  onChange={(event) => patchForm({ assignedDepartments: event.target.value })}
                  placeholder="Comma-separated UUIDs (optional)"
                  autoComplete="off"
                />
              </div>
            </div>
            <div style={S.modalFooter}>
              <button style={S.btn} onClick={closeModal} disabled={saving}>
                Cancel
              </button>
              <button
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

      {confirmTarget && (
        <div style={S.overlay}>
          <div style={S.modal} onClick={(event) => event.stopPropagation()}>
            <h2 style={S.modalTitle}>Delete user</h2>
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
              <button style={S.btn} onClick={cancelDelete} disabled={working}>
                Cancel
              </button>
              <button
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
