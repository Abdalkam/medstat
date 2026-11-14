// src/admin/AdminDashboard.tsx — Google Material Design 3 Redesign
// ----------------------------------------------------------------------------
// MTN PREPAID WALLET integration (2 marked blocks + stat card):
//   1. "Wallet & Top-up" quick action in the hero → /admin/wallet
//   2. Live "Wallet" stat card — prepaid UGX balance; red at zero, orange
//      under the low-balance threshold, green when healthy
// Data comes from src/api/walletApi.ts with the same login JWT; a failed
// wallet fetch never blocks the dashboard (card just stays neutral).
// ----------------------------------------------------------------------------
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getUsers } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { pullRemoteSmsLogs, syncUnsyncedSmsLogs } from "../database/smsLogDB";
// MTN PREPAID WALLET: prepaid balance data layer (same JWT as the rest of the app)
import { fetchWallet } from "../api/walletApi";
import type { Wallet } from "../api/walletApi";

/* ================= MD3 COLOR TOKENS ================= */
const C = {
  // Primary
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  // Secondary
  secondary: "#5F6368",
  secondaryContainer: "#E8EAED",
  // Tertiary / Success
  tertiary: "#1E8E3E",
  tertiaryContainer: "#E6F4EA",
  // Error
  error: "#D93025",
  errorContainer: "#F9DEDC",
  // Warning
  warning: "#F9AB00",
  warningContainer: "#FEF7E0",
  // Surface
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  surfaceVariant: "#E8EAED",
  // Background
  background: "#F8F9FA",
  // Outline
  outline: "#DADCE0",
  outlineVariant: "#BDC1C6",
  // Skeleton
  skeletonBase: "#E8EAED",
  // Semantic aliases (backwards compat)
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
  freeText: "#1E8E3E",
  freeBg: "#E6F4EA",
  paidText: "#B06000",
  paidBg: "#FEF7E0",
};

/* ================= MD3 TYPOGRAPHY ================= */
const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/* ================= MD3 ELEVATION SHADOWS ================= */
const S = {
  level1: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  level2: "0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)",
  level3: "0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)",
  // Aliases
  card: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  cardHover: "0 1px 3px 0 rgba(60,64,67,0.3), 0 4px 8px 3px rgba(60,64,67,0.15)",
};

/* ================= MD3 BORDER RADIUS ================= */
const R = { sm: 8, md: 12, lg: 16, xl: 28 };

/* ================= RESPONSIVE LAYOUT ================= */
const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1400;

const cardBase: CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  border: `1px solid ${C.outline}`,
  boxSizing: "border-box",
  minWidth: 0,
};

function parseNum(val: any): number {
  const str = String(val ?? "0").replace(/,/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

// HARDENED: a missing/NaN amount can never crash rendering again (fixes the
// "Cannot read properties of undefined (reading 'toLocaleString')" white screen).
function formatCurrency(amount: number): string {
  if (!amount) return "0.00";
  return Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatCompact(amount: number): string {
  if (!amount) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(Number(amount));
}

function getAvatarColor(str: string) {
  const colors = ["#1A73E8", "#D93025", "#1E8E3E", "#E37400", "#8430CE", "#5F6368", "#C5221F", "#12AFDA"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

/** Newest-first (createdAt camelCase locally, created_at from Supabase).
 *  Keeps "Recent Users" showing genuinely recent accounts — without this a
 *  just-created user could sit beyond the first 5 rows and never be seen. */
function sortUsersByCreatedDesc(arr: any[]): any[] {
  return [...arr].sort((a, b) => {
    const ta = new Date(a?.createdAt || a?.created_at || 0).getTime() || 0;
    const tb = new Date(b?.createdAt || b?.created_at || 0).getTime() || 0;
    return tb - ta;
  });
}

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

/* ================= SMALL BUILDING BLOCKS ================= */

function StatCard({ icon, label, value, bg, fg, valueColor, hint, delay, onClick }: {
  icon: ReactNode; label: string; value: string | number;
  bg: string; fg: string; valueColor?: string; hint?: string; delay?: number;
  onClick?: () => void; // MTN PREPAID WALLET: let the wallet card open /admin/wallet
}) {
  return (
    <div
      title={hint}
      onClick={onClick}
      style={{
        ...cardBase,
        padding: "clamp(12px, 2vw, 16px)",
        display: "flex",
        alignItems: "center",
        gap: 12,
        cursor: onClick ? "pointer" : undefined,
        animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both",
        animationDelay: `${delay ?? 0}ms`,
      }}
    >
      <div style={{
        width: 40, height: 40, borderRadius: R.sm,
        background: bg, color: fg,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500,
          letterSpacing: "0.02em", lineHeight: "16px",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>{label}</div>
        <div style={{
          fontSize: "clamp(16px, 3.4vw, 22px)",
          fontWeight: 500,
          color: valueColor || C.onSurface,
          letterSpacing: "-0.01em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.3,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>{value}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, chip, chipColor, children }: {
  title: string; chip?: string | number; chipColor?: string; children: ReactNode;
}) {
  return (
    <div style={{ ...cardBase, padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>{title}</span>
        {chip != null && (
          <span style={{ fontSize: 16, fontWeight: 500, color: chipColor || C.onSurface, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{chip}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "20px 4px 8px" }}>
      <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, letterSpacing: "0.01em" }}>{title}</span>
      {onViewAll && (
        <button onClick={onViewAll} style={{
          background: "none", border: "none",
          color: C.primary, fontWeight: 500, fontSize: 14,
          cursor: "pointer", fontFamily: font, padding: "4px 0",
          flexShrink: 0, letterSpacing: "0.01em",
        }}>
          See all
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{
      background: C.surface, borderRadius: R.lg,
      border: `1px dashed ${C.outlineVariant}`,
      padding: "32px 16px", textAlign: "center",
      color: C.onSurfaceVariant, fontSize: 14,
      boxSizing: "border-box",
    }}>
      {text}
    </div>
  );
}

/* ================= CHARTS ================= */

const DonutChart = ({ data, colors, size = 120, strokeWidth = 16, centerLabel, centerValue }: any) => {
  const total = data.reduce((sum: number, item: any) => sum + item.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", minWidth: 0 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0, margin: "0 auto" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
          {total > 0 ? data.map((item: any, index: number) => {
            const dash = (item.value / total) * circumference;
            const circle = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={colors[index]} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
            offset += dash;
            return circle;
          }) : <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={C.outline} strokeWidth={strokeWidth} />}
        </svg>
        {centerLabel && centerValue && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>{centerLabel}</div>
            <div style={{ fontSize: 18, color: C.onSurface, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{centerValue}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {data.map((item: any, index: number) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: colors[index], flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface }}>{item.label}</span>
              <span style={{ fontSize: 12, color: C.onSurfaceVariant, fontVariantNumeric: "tabular-nums" }}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const BarChart = ({ data, colors }: any) => {
  const maxValue = Math.max(...data.map((d: any) => d.value), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, width: "100%" }}>
      {data.map((item: any, index: number) => (
        <div key={index} style={{ width: "100%", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6, gap: 10 }}>
            <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
            <span style={{ fontSize: 14, color: C.onSurfaceVariant, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{item.value}</span>
          </div>
          <div style={{ width: "100%", height: 8, borderRadius: 4, background: C.surfaceVariant, overflow: "hidden" }}>
            <div style={{ width: `${(item.value / maxValue) * 100}%`, height: "100%", borderRadius: 4, background: colors[index], transition: "width 0.5s cubic-bezier(0.2,0,0,1)" }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/** Smooth area trend chart — SVG line (stretched) + perfectly round HTML dots overlay */
const TrendChart = ({ data, color, gradientId, emptyText }: {
  data: { day: string; value: number }[]; color: string; gradientId: string; emptyText?: string;
}) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${100 - (d.value / maxValue) * 100}`).join(" ");
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      {total === 0 && emptyText ? (
        <div style={{ textAlign: "center", color: C.onSurfaceVariant, padding: "30px 0", fontSize: 14 }}>{emptyText}</div>
      ) : (
        <>
          <div style={{ position: "relative", height: 140, width: "100%" }}>
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.18} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {[25, 50, 75].map((y) => (
                <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={C.outline} strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" opacity={0.7} />
              ))}
              <polygon points={`0,100 ${pts} 100,100`} fill={`url(#${gradientId})`} />
              <polyline points={pts} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {data.map((d, i) => (
              <div
                key={i}
                style={{
                  position: "absolute",
                  left: `${(i / (data.length - 1)) * 100}%`,
                  top: `${100 - (d.value / maxValue) * 100}%`,
                  width: 9, height: 9, borderRadius: "50%",
                  background: C.surface, border: `2.5px solid ${color}`,
                  transform: "translate(-50%, -50%)",
                  boxShadow: S.level1,
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {data.map((d, i) => (
              <span key={i} style={{ fontSize: "clamp(8px, 2.4vw, 11px)", color: C.onSurfaceVariant, fontWeight: 400 }}>{d.day}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ================= SKELETONS (Google shimmer) ================= */

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

function SkeletonChart() {
  return (
    <div style={{ ...cardBase, padding: 20 }}>
      <div style={{ width: "40%", height: 10, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite" }} />
      <div style={{ marginTop: 18, width: "100%", height: 120, borderRadius: R.sm, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.15s", opacity: 0.7 }} />
    </div>
  );
}

function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 12, borderBottom: i < rows - 1 ? `1px solid ${C.outline}` : "none" }}>
          <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ width: "50%", height: 14, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
            <div style={{ width: "35%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================= MAIN ================= */

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);

  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [allCourses, setAllCourses] = useState<any[]>([]);
  const [allSchedules, setAllSchedules] = useState<any[]>([]);
  const [smsStats, setSmsStats] = useState({ totalThisMonth: 0, last7Days: [] as { day: string; value: number }[] });
  // MTN PREPAID WALLET: prepaid balance for the stat card (null = not loaded)
  const [wallet, setWallet] = useState<Wallet | null>(null);

  useEffect(() => {
    async function loadDashboardData() {
      try {
        const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
        const tenantId = currentUser?.tenantId;

        let localUsers: any[] = [];
        let localCourses: any[] = [];
        let localSchedules: any[] = [];

        // STEP 1: Load from Local DB FIRST (Instant Load)
        try {
          localUsers = await getUsers();
          localCourses = await getCourses();
          localSchedules = await db.schedules.toArray();
        } catch (e) { console.warn("Local DB fetch failed", e); }

        const nonAdminUsers = localUsers.filter((u: any) => u.role !== "admin");

        setAllUsers(sortUsersByCreatedDesc(nonAdminUsers));
        setAllCourses(localCourses);
        setAllSchedules(localSchedules);

        // SMS stats — read from local Dexie (cloud logs get merged into it below).
        // Wrapped in a reusable fn so it can re-run after the cloud merge.
        const refreshSmsStats = async () => {
          let logs: any[] = [];
          try { logs = await db.smsLogs.toArray(); } catch (e) { /* table may not exist */ }
          const now = new Date();
          const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
          const totalThisMonth = logs.filter((log: any) =>
            new Date(log.sentAt || log.sent_at) >= startOfMonth
          ).length;
          const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0, 0, 0, 0);
            return d;
          });
          const last7DaysData = days.map(day => {
            const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
            const count = logs.filter((log: any) => {
              const d = new Date(log.sentAt || log.sent_at);
              return d >= day && d < nextDay;
            }).length;
            return { day: day.toLocaleDateString("en-US", { weekday: "short" }), value: count };
          });
          setSmsStats({ totalThisMonth, last7Days: last7DaysData });
        };
        await refreshSmsStats();

        setIsLoading(false);

        // STEP 2: Silently refresh from Supabase in the background
        if (tenantId && navigator.onLine) {
          // MTN PREPAID WALLET: tiny independent read — runs in parallel with
          // the Supabase refresh; failure (offline, not provisioned yet) just
          // leaves the card neutral, never blocks the dashboard.
          fetchWallet().then(setWallet).catch(() => { /* wallet stays null */ });

          try {
            const [usersRes, coursesRes] = await Promise.all([
              supabase.from("users").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
              supabase.from("courses").select("*").eq("tenant_id", tenantId).is("deleted_at", null),
            ]);

            if (usersRes.data && usersRes.data.length > 0) {
              const mappedUsers = usersRes.data.map((u: any) => ({
                ...u,
                assignedCourses: u.assigned_courses || [],
                profilePic: u.profile_pic,
                tuitionType: u.tuition_type,
              }));
              const mappedNonAdmin = mappedUsers.filter((u: any) => u.role !== "admin");

              // FIX: MERGE remote + local instead of replacing local with remote.
              // Previously ANY remote result overwrote the whole list, so a newly
              // created user whose cloud upsert failed (offline / API cold-start)
              // vanished from the dashboard, then reappeared after a later sync —
              // "newly created users seen on and off" (same bug as UserManagement).
              // Remote wins for known ids; local users not yet synced (cloud
              // confirm still pending) always stay visible; synced-but-absent
              // rows stay hidden (deleted on another device).
              const remoteUserIds = new Set(mappedNonAdmin.map((u: any) => u.id));
              const pendingLocalUsers = nonAdminUsers.filter(
                (u: any) => !u.synced && !remoteUserIds.has(u.id)
              );
              setAllUsers(sortUsersByCreatedDesc([...mappedNonAdmin, ...pendingLocalUsers]));
            }

            if (coursesRes.data && coursesRes.data.length > 0) {
              const mappedCourses = coursesRes.data.map((c: any) => ({
                ...c,
                tuitionType: c.tuition_type,
                startDate: c.start_date,
                mediaUrl: c.logo,
              }));
              setAllCourses(mappedCourses);
            }

            try {
              const { data: schedData } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId);
              if (schedData && schedData.length > 0) {
                const mappedSchedules = schedData.map((s: any) => ({
                  ...s,
                  courseId: s.course_id,
                  trainerId: s.trainer_id,
                  scheduledAt: s.scheduled_at || s.created_at,
                }));
                setAllSchedules(mappedSchedules);
              }
            } catch (e) { /* schedules table may not exist */ }

            // Merge cloud SMS logs into Dexie so the graph reflects all devices/updates
            try {
              await syncUnsyncedSmsLogs();
              const added = await pullRemoteSmsLogs(tenantId);
              if (added > 0) await refreshSmsStats();
            } catch (e) { /* sms merge best-effort */ }

          } catch (onlineError) {
            console.warn("Supabase fetch failed, sticking with local DB", onlineError);
          }
        }
      } catch (error) {
        console.error("Failed to load dashboard data", error);
        setIsLoading(false);
      }
    }
    loadDashboardData();
  }, []);

  const trainers = allUsers.filter(u => u.role === "trainer");
  const learners = allUsers.filter(u => u.role === "trainee");
  const freeCourses = allCourses.filter(c => c.tuitionType === "free");
  const paidCourses = allCourses.filter(c => c.tuitionType === "paid");

  const totalExpected = learners.reduce((sum, u) => sum + parseNum(u.tuition?.expected), 0);
  const totalPaid = learners.reduce((sum, u) => sum + parseNum(u.tuition?.paid), 0);
  const totalOutstanding = totalExpected - totalPaid;

  // MTN PREPAID WALLET: health buckets for the balance card
  //   red    → 0 UGX (prepaid stopped, SMS will 402)
  //   orange → at or under low_balance_threshold_ugx (top up soon)
  //   green  → healthy
  const walletThreshold = wallet?.low_balance_threshold_ugx ?? 0;
  const walletEmpty = !!wallet && wallet.balance_ugx <= 0;
  const walletLow = !!wallet && !walletEmpty && wallet.balance_ugx <= walletThreshold;
  const walletFg = !wallet ? C.onSurfaceVariant : walletEmpty ? C.red : walletLow ? C.orange : C.green;
  const walletBg = !wallet ? C.surfaceVariant : walletEmpty ? C.redBg : walletLow ? C.orangeBg : C.greenBg;

  const recentUsers = allUsers.slice(0, 5);
  const recentCourses = allCourses.slice(0, 5);
  const upcomingSchedules = allSchedules
    .filter((s: any) => new Date(s.scheduledAt || s.created_at) >= new Date())
    .sort((a: any, b: any) => new Date(a.scheduledAt || a.created_at).getTime() - new Date(b.scheduledAt || b.created_at).getTime())
    .slice(0, 5);

  const tuitionLabel = (expected: number, paid: number) => {
    if (expected <= 0) return "N/A";
    const balance = expected - paid;
    if (balance <= 0) return "Fully Paid";
    return "Due: " + formatCurrency(balance);
  };

  const tuitionPill = (course: any): CSSProperties => course.tuitionType === "paid"
    ? { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: R.xl, background: C.paidBg, color: C.paidText, fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap" }
    : { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 10px", borderRadius: R.xl, background: C.freeBg, color: C.freeText, fontSize: 12, fontWeight: 500, letterSpacing: "0.02em", whiteSpace: "nowrap" };

  const displayTuition = (course: any) => course.tuitionType === "paid" ? formatCurrency(course.amount || 0) : "Free";

  // Schedules-per-day series (computed once for chart + chip)
  const scheduleWeekData = (() => {
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
    return days.map(day => {
      const count = allSchedules.filter((s: any) => {
        const sDate = new Date(s.scheduledAt || s.created_at);
        return sDate.toDateString() === day.toDateString();
      }).length;
      return { day: day.toLocaleDateString("en-US", { weekday: "short" }), value: count };
    });
  })();
  const scheduleWeekTotal = scheduleWeekData.reduce((s, d) => s + d.value, 0);

  // Hero content
  const me = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const firstName = (me?.username || "Admin").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const statDefs: { label: string; value: string | number; bg: string; fg: string; valueColor?: string; hint?: string; icon: ReactNode; onClick?: () => void }[] = [
    {
      label: "Trainers", value: trainers.length, bg: C.purpleBg, fg: C.purple,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-9" /><path d="M14 17H5" /><circle cx="17" cy="17" r="3" /><circle cx="7" cy="7" r="3" /></svg>,
    },
    {
      label: "Learners", value: learners.length, bg: C.greenBg, fg: C.green,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 10v6M2 10l10-5 10 5-10 5z" /><path d="M6 12v5c3 3 9 3 12 0v-5" /></svg>,
    },
    {
      label: "Courses", value: allCourses.length, bg: C.medBlueBg, fg: C.medBlue,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>,
    },
    {
      label: "Schedules", value: allSchedules.length, bg: C.orangeBg, fg: C.orange,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>,
    },
    {
      label: "Expected", value: formatCompact(totalExpected), bg: C.blueBg, fg: C.blue,
      hint: `Expected tuition: ${formatCurrency(totalExpected)}`,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2" /><line x1="1" y1="10" x2="23" y2="10" /></svg>,
    },
    {
      label: "Outstanding",
      value: totalExpected <= 0 ? "N/A" : formatCompact(totalOutstanding),
      bg: totalOutstanding > 0 ? C.redBg : C.greenBg,
      fg: totalOutstanding > 0 ? C.red : C.green,
      valueColor: totalOutstanding > 0 ? C.red : C.green,
      hint: totalExpected <= 0 ? "No tuition expected yet" : `Outstanding balance: ${formatCurrency(totalOutstanding)}`,
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>,
    },
    // MTN PREPAID WALLET: live prepaid balance — click opens /admin/wallet
    {
      label: "Wallet",
      // HARDENED: balance_ugx can be undefined (API shape) or a string (Supabase
      // bigint columns arrive as text) — Number() makes both render correctly.
      value: wallet ? `UGX ${formatCompact(Number(wallet.balance_ugx) || 0)}` : "—",
      bg: walletBg,
      fg: walletFg,
      valueColor: wallet ? walletFg : undefined,
      hint: wallet
        ? `Prepaid balance: UGX ${Number(wallet.balance_ugx ?? 0).toLocaleString("en-US")}${walletEmpty ? " — SMS sending is blocked until you top up" : walletLow ? " — below the low-balance threshold, top up soon" : ""}`
        : "Wallet not loaded yet — open Wallet & Top-up",
      onClick: () => navigate("/admin/wallet"),
      icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>,
    },
  ];

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`
        @keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} clamp(20px, 4vh, 44px)`, boxSizing: "border-box" }}>

        {/* ===== HERO — Google-style clean greeting bar ===== */}
        <div style={{
          borderRadius: R.lg, padding: "clamp(16px, 3vw, 24px) clamp(16px, 3vw, 20px)",
          background: C.surface,
          border: `1px solid ${C.outline}`,
          boxShadow: S.level1,
          animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
        }}>
          {/* Blue accent circle */}
          <div style={{
            width: 44, height: 44, borderRadius: "50%",
            background: C.primaryContainer,
            color: C.primary,
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, fontSize: 20,
          }}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.04em", marginBottom: 2 }}>{dateStr}</div>
            <div style={{ fontSize: "clamp(20px, 4.5vw, 28px)", fontWeight: 400, color: C.onSurface, letterSpacing: "-0.01em", lineHeight: 1.25 }}>
              {greeting}, <span style={{ color: C.primary, fontWeight: 500 }}>{firstName}</span>
            </div>
          </div>
          {/* MTN PREPAID WALLET: quick action → /admin/wallet (STK-push top-up) */}
          <button
            onClick={() => navigate("/admin/wallet")}
            style={{
              background: C.primary, color: C.onPrimary, border: "none",
              borderRadius: R.xl, padding: "10px 18px", fontSize: 14,
              fontWeight: 500, fontFamily: font, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 8,
              flexShrink: 0, boxShadow: S.level1, letterSpacing: "0.01em",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
            Wallet & Top-up
          </button>
        </div>

        {/* ===== STAT CARDS — 2-col mobile, 3-col tablet, 6-col desktop ===== */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
          gap: 12, paddingTop: 16, width: "100%", boxSizing: "border-box",
        }}>
          {isLoading
            ? Array.from({ length: 7 }).map((_, i) => <SkeletonStat key={i} />)
            : statDefs.map((s, i) => (
              <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} bg={s.bg} fg={s.fg} valueColor={s.valueColor} hint={s.hint} onClick={s.onClick} delay={i * 50} />
            ))}
        </div>

        {/* ===== CHARTS — 1-col mobile, 2-col tablet/desktop ===== */}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
          gap: 16, paddingTop: 20, width: "100%", boxSizing: "border-box",
        }}>
          {isLoading ? (
            <><SkeletonChart /><SkeletonChart /><SkeletonChart /><SkeletonChart /></>
          ) : (
            <>
              <ChartCard title="Course Types">
                <DonutChart
                  data={[{ label: "Free", value: freeCourses.length }, { label: "Paid", value: paidCourses.length }]}
                  colors={[C.green, C.orange]} centerLabel="Total" centerValue={String(allCourses.length)}
                />
              </ChartCard>

              <ChartCard title="User Distribution">
                <BarChart data={[{ label: "Trainers", value: trainers.length }, { label: "Learners", value: learners.length }]} colors={[C.purple, C.green]} />
              </ChartCard>

              <ChartCard title="Schedules This Week" chip={scheduleWeekTotal}>
                <TrendChart data={scheduleWeekData} color={C.primary} gradientId="gradSchedules" emptyText="No schedules this week" />
              </ChartCard>

              <ChartCard title="SMS — Last 7 Days" chip={smsStats.totalThisMonth} chipColor={C.green}>
                <TrendChart data={smsStats.last7Days} color={C.green} gradientId="gradSms" emptyText="No SMS activity this week" />
              </ChartCard>
            </>
          )}
        </div>

        {/* ===== RECENT USERS ===== */}
        <SectionHeader title="Recent Users" onViewAll={() => navigate("/admin/users")} />
        {isLoading ? (
          <SkeletonList rows={4} />
        ) : recentUsers.length === 0 ? (
          <EmptyState text="No users yet" />
        ) : (
          <div style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
            {recentUsers.map((user: any, index: number) => {
              const expected = parseNum(user.tuition?.expected);
              const paid = parseNum(user.tuition?.paid);
              const balance = expected - paid;
              let balanceColor = C.onSurfaceVariant;
              if (expected > 0 && balance <= 0) balanceColor = C.green;
              else if (expected > 0 && balance > 0) balanceColor = C.red;
              return (
                <div
                  key={user.id}
                  onClick={() => navigate("/admin/users")}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.inset; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, borderBottom: index < recentUsers.length - 1 ? `1px solid ${C.outline}` : "none", cursor: "pointer", transition: "background 0.15s ease", minWidth: 0 }}
                >
                  {user.profilePic ? (
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: C.surfaceVariant, overflow: "hidden", flexShrink: 0 }}>
                      <img src={user.profilePic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ) : (
                    <div style={{ width: 40, height: 40, borderRadius: "50%", background: getAvatarColor(user.username || "U"), color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500, flexShrink: 0 }}>
                      {(user.username || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{user.username}</div>
                      {/* MD3 tonal pill badge */}
                      <span style={{
                        display: "inline-flex", alignItems: "center",
                        padding: "1px 8px", borderRadius: R.xl,
                        background: user.role === "trainer" ? C.purpleBg : C.greenBg,
                        color: user.role === "trainer" ? C.purple : C.green,
                        fontSize: 11, fontWeight: 500, flexShrink: 0,
                      }}>
                        {user.role === "trainer" ? "Trainer" : "Trainee"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.phone || user.email || "No contact"}
                    </div>
                  </div>
                  {user.role === "trainee" && (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Tuition</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: balanceColor, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{tuitionLabel(expected, paid)}</div>
                    </div>
                  )}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== COURSES — 1-col mobile, 2-col tablet, 3-col desktop ===== */}
        <SectionHeader title="Courses" onViewAll={() => navigate("/admin/courses")} />
        {isLoading ? (
          <SkeletonList rows={3} />
        ) : recentCourses.length === 0 ? (
          <EmptyState text="No courses yet" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 16, width: "100%", boxSizing: "border-box" }}>
            {recentCourses.map((course: any) => {
              const courseTrainees = allUsers.filter((u: any) => u.role === "trainee" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseTrainer = allUsers.find((u: any) => u.role === "trainer" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseSchedules = allSchedules.filter((s: any) => s.courseId === course.id);
              return (
                <div
                  key={course.id}
                  onClick={() => navigate("/admin/courses")}
                  onMouseEnter={(e) => { e.currentTarget.style.boxShadow = S.level2; e.currentTarget.style.borderColor = C.primary; }}
                  onMouseLeave={(e) => { e.currentTarget.style.boxShadow = S.level1; e.currentTarget.style.borderColor = C.outline; }}
                  style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, cursor: "pointer", transition: "box-shadow 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s ease", minWidth: 0, boxSizing: "border-box" }}
                >
                  <div style={{ display: "flex", alignItems: "center", padding: 16, borderBottom: `1px solid ${C.outline}`, gap: 12, minWidth: 0 }}>
                    <div style={{ width: 44, height: 44, borderRadius: R.sm, background: course.logo || course.mediaUrl ? "transparent" : C.primaryContainer, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {course.logo || course.mediaUrl
                        ? <img src={course.logo || course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="1.8"><path d="M6 2v6a6 6 0 0 0 12 0V2" /><circle cx="12" cy="14" r="2" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={tuitionPill(course)}>{displayTuition(course)}</span>
                        {course.startDate && <span style={{ fontSize: 12, color: C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.startDate}</span>}
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                  {/* MD3 tonal chip grid */}
                  <div style={{ padding: "12px 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(110px, 100%), 1fr))", gap: 8 }}>
                    {[
                      { label: "Trainer", value: courseTrainer?.username || "None", bg: C.purpleBg, fg: C.purple },
                      { label: "Trainees", value: String(courseTrainees.length), bg: C.greenBg, fg: C.green },
                      { label: "Duration", value: calculateDuration(course.startDate, course.period), bg: C.orangeBg, fg: C.orange },
                      { label: "Schedules", value: String(courseSchedules.length), bg: C.medBlueBg, fg: C.medBlue },
                    ].map((chip) => (
                      <div key={chip.label} style={{ background: chip.bg, color: chip.fg, borderRadius: R.sm, padding: "8px 12px", minWidth: 0 }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700, opacity: 0.7, letterSpacing: "0.06em" }}>{chip.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 500, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chip.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== UPCOMING SCHEDULES ===== */}
        <SectionHeader title="Upcoming Schedules" onViewAll={() => navigate("/admin/courses")} />
        {isLoading ? (
          <SkeletonList rows={3} />
        ) : upcomingSchedules.length === 0 ? (
          <EmptyState text="No upcoming schedules" />
        ) : (
          <div style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
            {upcomingSchedules.map((schedule: any, index: number) => {
              const linkedCourse = allCourses.find((c: any) => c.id === schedule.courseId);
              const linkedTrainer = allUsers.find((u: any) => u.id === schedule.trainerId);
              const scheduleDate = new Date(schedule.scheduledAt || schedule.created_at);
              const isPast = scheduleDate < new Date();
              return (
                <div key={schedule.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, borderBottom: index < upcomingSchedules.length - 1 ? `1px solid ${C.outline}` : "none", opacity: isPast ? 0.5 : 1, minWidth: 0 }}>
                  <div style={{ width: 40, height: 40, borderRadius: R.sm, background: isPast ? C.surfaceVariant : C.orangeBg, color: isPast ? C.onSurfaceVariant : C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{schedule.title || "Untitled Schedule"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap", minWidth: 0 }}>
                      {linkedCourse && <span style={{ fontSize: 12, color: C.primary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%" }}>{linkedCourse.name}</span>}
                      {linkedTrainer && <span style={{ fontSize: 12, color: C.purple, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{linkedTrainer.username}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: C.onSurfaceVariant, whiteSpace: "nowrap" }}>{scheduleDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    <div style={{ fontSize: 13, color: C.onSurface, fontWeight: 500, whiteSpace: "nowrap" }}>{scheduleDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
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
