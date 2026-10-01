// src/admin/AdminDashboard.tsx
import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getUsers } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { pullRemoteSmsLogs, syncUnsyncedSmsLogs } from "../database/smsLogDB";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93", textQuaternary: "#AEAEB2",
  bg: "#F2F2F7", card: "#FFFFFF", inset: "#F9F9FB", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  blue: "#007AFF", blueBg: "#EBF2FF", green: "#30D158", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", red: "#FF3B30", redBg: "#FFEFEE",
  purple: "#AF52DE", purpleBg: "#F5F0FF", medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  freeText: "#1B8A3A", freeBg: "#EAF9EE", paidText: "#C47F17", paidBg: "#FFF6EB",
  skeletonBase: "#E5E5EA",
};
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

const S = {
  card: "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)",
  cardHover: "0 2px 4px rgba(16,24,40,0.06), 0 10px 28px rgba(16,24,40,0.12)",
  hero: "0 10px 30px rgba(94,92,230,0.30)",
};

// Fluid gutter + content cap (centers like Gmail/YouTube on wide monitors)
const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

const cardBase: CSSProperties = {
  background: C.card, borderRadius: 18, boxShadow: S.card,
  border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box", minWidth: 0,
};

function parseNum(val: any): number {
  const str = String(val ?? "0").replace(/,/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "0.00";
  return amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Compact notation for stat cards — "2.5M", "980K" — always fits; exact value in tooltip
function formatCompact(amount: number): string {
  if (amount === 0) return "0";
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function getAvatarColor(str: string) {
  const colors = ["#FF2D55", "#5856D6", "#007AFF", "#34C759", "#FF9500", "#AF52DE", "#0056CC", "#FF3B30"];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
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

function StatCard({ icon, label, value, bg, fg, valueColor, hint, delay }: { icon: ReactNode; label: string; value: string | number; bg: string; fg: string; valueColor?: string; hint?: string; delay?: number }) {
  return (
    <div
      title={hint}
      style={{ ...cardBase, padding: "clamp(12px, 2vw, 16px)", display: "flex", alignItems: "center", gap: 12, animation: "fadeUp 0.45s ease both", animationDelay: `${delay ?? 0}ms` }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 12, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: C.textTertiary, fontWeight: 600, letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        <div style={{
          fontSize: "clamp(16px, 3.4vw, 22px)",
          fontWeight: 800,
          color: valueColor || C.textPrimary,
          letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.2,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}>{value}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, chip, chipColor, children }: { title: string; chip?: string | number; chipColor?: string; children: ReactNode }) {
  return (
    <div style={{ ...cardBase, padding: "18px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, minWidth: 0 }}>
        <span style={{ fontSize: 12, color: C.textTertiary, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.05em" }}>{title}</span>
        {chip != null && (
          <span style={{ fontSize: 17, fontWeight: 800, color: chipColor || C.textPrimary, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{chip}</span>
        )}
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ title, onViewAll }: { title: string; onViewAll?: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, padding: "22px 4px 10px" }}>
      <span style={{ fontSize: 13, color: C.textTertiary, textTransform: "uppercase", letterSpacing: "-0.08px", fontWeight: 600 }}>{title}</span>
      {onViewAll && (
        <button onClick={onViewAll} style={{ background: "none", border: "none", color: C.medBlue, fontWeight: 600, fontSize: 13, cursor: "pointer", fontFamily: iosFont, padding: 0, flexShrink: 0 }}>
          View all ›
        </button>
      )}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: C.card, borderRadius: 16, border: `1.5px dashed ${C.separator}`, padding: "36px 16px", textAlign: "center", color: C.textTertiary, fontSize: 15, boxSizing: "border-box" }}>
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
          }) : <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={C.separator} strokeWidth={strokeWidth} />}
        </svg>
        {centerLabel && centerValue && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", fontWeight: 600 }}>{centerLabel}</div>
            <div style={{ fontSize: 18, color: C.textPrimary, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{centerValue}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {data.map((item: any, index: number) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 4, background: colors[index], flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: C.textPrimary }}>{item.label}</span>
              <span style={{ fontSize: 12, color: C.textTertiary, fontVariantNumeric: "tabular-nums" }}>{item.value}</span>
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
            <span style={{ fontSize: 14, color: C.textPrimary, fontWeight: 600, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
            <span style={{ fontSize: 14, color: C.textTertiary, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{item.value}</span>
          </div>
          <div style={{ width: "100%", height: 10, borderRadius: 5, background: C.inset, overflow: "hidden" }}>
            <div style={{ width: `${(item.value / maxValue) * 100}%`, height: "100%", borderRadius: 5, background: colors[index], transition: "width 0.5s ease" }} />
          </div>
        </div>
      ))}
    </div>
  );
};

/** Smooth area trend chart — SVG line (stretched) + perfectly round HTML dots overlay */
const TrendChart = ({ data, color, gradientId, emptyText }: { data: { day: string; value: number }[]; color: string; gradientId: string; emptyText?: string }) => {
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const total = data.reduce((s, d) => s + d.value, 0);
  const pts = data.map((d, i) => `${(i / (data.length - 1)) * 100},${100 - (d.value / maxValue) * 100}`).join(" ");
  return (
    <div style={{ width: "100%", minWidth: 0 }}>
      {total === 0 && emptyText ? (
        <div style={{ textAlign: "center", color: C.textTertiary, padding: "30px 0", fontSize: 14 }}>{emptyText}</div>
      ) : (
        <>
          <div style={{ position: "relative", height: 140, width: "100%" }}>
            <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ display: "block" }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              {[25, 50, 75].map((y) => (
                <line key={y} x1="0" x2="100" y1={y} y2={y} stroke={C.separator} strokeWidth="1" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" opacity={0.7} />
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
                  background: C.card, border: `2.5px solid ${color}`,
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
                }}
              />
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {data.map((d, i) => (
              <span key={i} style={{ fontSize: "clamp(8px, 2.4vw, 11px)", color: C.textTertiary, fontWeight: 500 }}>{d.day}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/* ================= SKELETONS ================= */

function SkeletonStat() {
  return (
    <div style={{ ...cardBase, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 42, height: 42, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: "55%", height: 11, borderRadius: 5, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }} />
        <div style={{ width: "75%", height: 20, borderRadius: 6, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div style={{ ...cardBase, padding: 20 }}>
      <div style={{ width: "40%", height: 12, borderRadius: 6, background: C.skeletonBase, animation: "pulse 1.5s infinite" }} />
      <div style={{ marginTop: 18, width: "100%", height: 120, borderRadius: 12, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.15s", opacity: 0.7 }} />
    </div>
  );
}

function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ backgroundColor: C.card, borderRadius: 16, overflow: "hidden", boxShadow: S.card, border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 12, borderBottom: i < rows - 1 ? `0.5px solid ${C.separator}` : "none" }}>
          <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
            <div style={{ width: "50%", height: 14, borderRadius: 4, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }} />
            <div style={{ width: "35%", height: 10, borderRadius: 4, background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }} />
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

        setAllUsers(nonAdminUsers);
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
          try {
            const [usersRes, coursesRes] = await Promise.all([
              supabase.from("users").select("*").eq("tenant_id", tenantId),
              supabase.from("courses").select("*").eq("tenant_id", tenantId),
            ]);

            if (usersRes.data && usersRes.data.length > 0) {
              const mappedUsers = usersRes.data.map((u: any) => ({
                ...u,
                assignedCourses: u.assigned_courses || [],
                profilePic: u.profile_pic,
                tuitionType: u.tuition_type,
              }));
              const mappedNonAdmin = mappedUsers.filter((u: any) => u.role !== "admin");
              setAllUsers(mappedNonAdmin);
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
    ? { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: C.paidBg, color: C.paidText, fontSize: 12, fontWeight: 700, letterSpacing: "0.2px", whiteSpace: "nowrap" }
    : { display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 6, background: C.freeBg, color: C.freeText, fontSize: 12, fontWeight: 700, letterSpacing: "0.2px", whiteSpace: "nowrap" };

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

  const statDefs: { label: string; value: string | number; bg: string; fg: string; valueColor?: string; hint?: string; icon: ReactNode }[] = [
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
      // Compact value so it always fits — exact amount on hover
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
  ];

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: iosFont, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} clamp(20px, 4vh, 44px)`, boxSizing: "border-box" }}>

        {/* ===== HERO — greeting only ===== */}
        <div style={{
          borderRadius: 20, padding: "clamp(16px, 3vw, 24px)",
          background: "linear-gradient(135deg, #0A84FF 0%, #5E5CE6 55%, #AF52DE 100%)",
          color: "#fff", position: "relative", overflow: "hidden", boxShadow: S.hero,
          animation: "fadeUp 0.45s ease both", boxSizing: "border-box",
        }}>
          <div style={{ position: "absolute", width: 220, height: 220, borderRadius: "50%", background: "rgba(255,255,255,0.12)", top: -90, right: -60 }} />
          <div style={{ position: "absolute", width: 150, height: 150, borderRadius: "50%", background: "rgba(255,255,255,0.10)", bottom: -80, left: "28%" }} />
          <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.85 }}>{dateStr}</div>
            <div style={{ fontSize: "clamp(20px, 4.5vw, 28px)", fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15 }}>
              {greeting}, {firstName} 👋
            </div>
          </div>
        </div>

        {/* ===== STAT CARDS ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 12, paddingTop: 16, width: "100%", boxSizing: "border-box" }}>
          {isLoading
            ? Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)
            : statDefs.map((s, i) => (
              <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} bg={s.bg} fg={s.fg} valueColor={s.valueColor} hint={s.hint} delay={i * 50} />
            ))}
        </div>

        {/* ===== CHARTS ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 16, paddingTop: 20, width: "100%", boxSizing: "border-box" }}>
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
                <TrendChart data={scheduleWeekData} color={C.medBlue} gradientId="gradSchedules" emptyText="No schedules this week" />
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
          <div style={{ backgroundColor: C.card, borderRadius: 16, overflow: "hidden", boxShadow: S.card, border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box" }}>
            {recentUsers.map((user: any, index: number) => {
              const expected = parseNum(user.tuition?.expected);
              const paid = parseNum(user.tuition?.paid);
              const balance = expected - paid;
              let balanceColor = C.textTertiary;
              if (expected > 0 && balance <= 0) balanceColor = C.green;
              else if (expected > 0 && balance > 0) balanceColor = C.red;
              return (
                <div
                  key={user.id}
                  onClick={() => navigate("/admin/users")}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.inset; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                  style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 12, borderBottom: index < recentUsers.length - 1 ? `0.5px solid ${C.separator}` : "none", cursor: "pointer", transition: "background 0.15s ease", minWidth: 0 }}
                >
                  {user.profilePic ? (
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.separator, overflow: "hidden", flexShrink: 0 }}>
                      <img src={user.profilePic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: "50%", background: getAvatarColor(user.username || "U"), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17, fontWeight: 600, flexShrink: 0 }}>
                      {(user.username || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>{user.username}</div>
                      <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: 5, background: user.role === "trainer" ? C.purpleBg : C.greenBg, color: user.role === "trainer" ? C.purple : C.green, fontSize: 11, fontWeight: 700, flexShrink: 0 }}>
                        {user.role === "trainer" ? "Trainer" : "Trainee"}
                      </span>
                    </div>
                    <div style={{ fontSize: 13, color: C.textTertiary, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {user.phone || user.email || "No contact"}
                    </div>
                  </div>
                  {user.role === "trainee" && (
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: C.textTertiary, textTransform: "uppercase", fontWeight: 600 }}>Tuition</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: balanceColor, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{tuitionLabel(expected, paid)}</div>
                    </div>
                  )}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== COURSES ===== */}
        <SectionHeader title="Courses" onViewAll={() => navigate("/admin/courses")} />
        {isLoading ? (
          <SkeletonList rows={3} />
        ) : recentCourses.length === 0 ? (
          <EmptyState text="No courses yet" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(300px, 100%), 1fr))", gap: 16, width: "100%", boxSizing: "border-box" }}>
            {recentCourses.map((course: any) => {
              const courseTrainees = allUsers.filter((u: any) => u.role === "trainee" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseTrainer = allUsers.find((u: any) => u.role === "trainer" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseSchedules = allSchedules.filter((s: any) => s.courseId === course.id);
              return (
                <div
                  key={course.id}
                  onClick={() => navigate("/admin/courses")}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = S.cardHover; e.currentTarget.style.borderColor = C.medBlue + "44"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = S.card; e.currentTarget.style.borderColor = "rgba(17,24,39,0.05)"; }}
                  style={{ backgroundColor: C.card, borderRadius: 18, overflow: "hidden", boxShadow: S.card, border: "1px solid rgba(17,24,39,0.05)", cursor: "pointer", transition: "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease", minWidth: 0, boxSizing: "border-box" }}
                >
                  <div style={{ display: "flex", alignItems: "center", padding: 16, borderBottom: `0.5px solid ${C.separator}`, gap: 12, minWidth: 0 }}>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: course.logo || course.mediaUrl ? "transparent" : C.medBlueBg, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: course.logo || course.mediaUrl ? "0 2px 8px rgba(0,0,0,0.06)" : "none" }}>
                      {course.logo || course.mediaUrl
                        ? <img src={course.logo || course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.8"><path d="M6 2v6a6 6 0 0 0 12 0V2" /><circle cx="12" cy="14" r="2" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 16, fontWeight: 700, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={tuitionPill(course)}>{displayTuition(course)}</span>
                        {course.startDate && <span style={{ fontSize: 12, color: C.textTertiary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.startDate}</span>}
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                  <div style={{ padding: "12px 14px 14px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(120px, 100%), 1fr))", gap: 8 }}>
                    {[
                      { label: "Trainer", value: courseTrainer?.username || "None", bg: C.purpleBg, fg: C.purple },
                      { label: "Trainees", value: String(courseTrainees.length), bg: C.greenBg, fg: C.green },
                      { label: "Duration", value: calculateDuration(course.startDate, course.period), bg: C.orangeBg, fg: C.orange },
                      { label: "Schedules", value: String(courseSchedules.length), bg: C.medBlueBg, fg: C.medBlue },
                    ].map((chip) => (
                      <div key={chip.label} style={{ background: chip.bg, color: chip.fg, borderRadius: 12, padding: "8px 12px", minWidth: 0 }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", fontWeight: 700, opacity: 0.75, letterSpacing: "0.04em" }}>{chip.label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{chip.value}</div>
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
          <div style={{ backgroundColor: C.card, borderRadius: 16, overflow: "hidden", boxShadow: S.card, border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box" }}>
            {upcomingSchedules.map((schedule: any, index: number) => {
              const linkedCourse = allCourses.find((c: any) => c.id === schedule.courseId);
              const linkedTrainer = allUsers.find((u: any) => u.id === schedule.trainerId);
              const scheduleDate = new Date(schedule.scheduledAt || schedule.created_at);
              const isPast = scheduleDate < new Date();
              return (
                <div key={schedule.id} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 12, borderBottom: index < upcomingSchedules.length - 1 ? `0.5px solid ${C.separator}` : "none", opacity: isPast ? 0.5 : 1, minWidth: 0 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 12, background: isPast ? C.inset : C.orangeBg, color: isPast ? C.textTertiary : C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{schedule.title || "Untitled Schedule"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap", minWidth: 0 }}>
                      {linkedCourse && <span style={{ fontSize: 12, color: C.medBlue, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%" }}>{linkedCourse.name}</span>}
                      {linkedTrainer && <span style={{ fontSize: 12, color: C.purple, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{linkedTrainer.username}</span>}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: 11, color: C.textTertiary, whiteSpace: "nowrap" }}>{scheduleDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    <div style={{ fontSize: 13, color: C.textPrimary, fontWeight: 700, whiteSpace: "nowrap" }}>{scheduleDate.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}</div>
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