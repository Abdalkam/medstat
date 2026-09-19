// src/admin/AdminDashboard.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getUsers } from "../database/userDB";
import { getCourses } from "../database/courseDB";

const C = {
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93", textQuaternary: "#AEAEB2",
  bg: "#F2F2F7", card: "#FFFFFF", inset: "#F9F9FB", separator: "#E5E5EA",
  blue: "#007AFF", blueBg: "#EBF2FF", green: "#30D158", greenBg: "#EAF9EE",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", red: "#FF3B30", redBg: "#FFEFEE",
  purple: "#AF52DE", purpleBg: "#F5F0FF", medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  freeText: "#1B8A3A", freeBg: "#EAF9EE", paidText: "#C47F17", paidBg: "#FFF6EB",
  skeletonBase: "#E5E5EA",
};
const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
const iosGroupHeader: React.CSSProperties = { fontSize: "13px", color: C.textTertiary, paddingLeft: "16px", paddingRight: "16px", paddingTop: "24px", paddingBottom: "8px", textTransform: "uppercase" as const, letterSpacing: "-0.08px", fontWeight: "400", flexShrink: 0 };

function parseNum(val: any): number {
  const str = String(val ?? "0").replace(/,/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

function formatCurrency(amount: number): string {
  if (amount === 0) return "0.00";
  return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

const DonutChart = ({ data, colors, size = 120, strokeWidth = 16, centerLabel, centerValue }: any) => {
  const total = data.reduce((sum: number, item: any) => sum + item.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
          {total > 0 ? data.map((item: any, index: number) => {
            const dash = (item.value / total) * circumference;
            const circle = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={colors[index]} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
            offset += dash;
            return circle;
          }) : <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={C.separator} strokeWidth={strokeWidth} />}
        </svg>
        {centerLabel && centerValue && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ fontSize: "11px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600" }}>{centerLabel}</div>
            <div style={{ fontSize: "18px", color: C.textPrimary, fontWeight: "700" }}>{centerValue}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
        {data.map((item: any, index: number) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ width: "12px", height: "12px", borderRadius: "3px", background: colors[index], flexShrink: 0 }}></div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ fontSize: "14px", fontWeight: "600", color: C.textPrimary }}>{item.label}</span>
              <span style={{ fontSize: "12px", color: C.textTertiary }}>{item.value}</span>
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
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", width: "100%" }}>
      {data.map((item: any, index: number) => (
        <div key={index} style={{ width: "100%" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "14px", color: C.textPrimary, fontWeight: "500" }}>{item.label}</span>
            <span style={{ fontSize: "14px", color: C.textTertiary }}>{item.value}</span>
          </div>
          <div style={{ width: "100%", height: "10px", borderRadius: "5px", background: C.inset, overflow: "hidden" }}>
            <div style={{ width: `${(item.value / maxValue) * 100}%`, height: "100%", borderRadius: "5px", background: colors[index], transition: "width 0.5s ease" }}></div>
          </div>
        </div>
      ))}
    </div>
  );
};

const LineChart = ({ schedules }: any) => {
  const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (6 - i)); return d; });
  const data = days.map(day => {
    const count = schedules.filter((s: any) => {
      const sDate = new Date(s.scheduledAt || s.created_at);
      return sDate.toDateString() === day.toDateString();
    }).length;
    return { day: day.toLocaleDateString('en-US', { weekday: 'short' }), value: count };
  });
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const points = data.map((d, i) => `${(i / (data.length - 1)) * 100},${100 - (d.value / maxValue) * 100}`).join(" ");
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
      <svg width="100%" height="120" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={C.medBlue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => <circle key={i} cx={(i / (data.length - 1)) * 100} cy={100 - (d.value / maxValue) * 100} r="1.5" fill={C.medBlue} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
        {data.map((d, i) => <span key={i} style={{ fontSize: "11px", color: C.textTertiary }}>{d.day}</span>)}
      </div>
    </div>
  );
};

const SmsLineChart = ({ data }: any) => {
  if (data.length === 0) return <div style={{ textAlign: "center", color: C.textTertiary, padding: "20px", fontSize: "14px" }}>No SMS data this week</div>;
  const maxValue = Math.max(...data.map((d: any) => d.value), 1);
  const points = data.map((d: any, i: number) => `${(i / (data.length - 1)) * 100},${100 - (d.value / maxValue) * 100}`).join(" ");
  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column" }}>
      <svg width="100%" height="120" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={points} fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {data.map((d: any, i: number) => <circle key={i} cx={(i / (data.length - 1)) * 100} cy={100 - (d.value / maxValue) * 100} r="1.5" fill={C.green} vectorEffect="non-scaling-stroke" />)}
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: "8px" }}>
        {data.map((d: any, i: number) => <span key={i} style={{ fontSize: "11px", color: C.textTertiary }}>{d.day}</span>)}
      </div>
    </div>
  );
};

function SkeletonCard() {
  return (
    <div style={{ background: C.card, borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ width: "40%", height: "12px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite" }}></div>
      <div style={{ width: "60%", height: "24px", borderRadius: "6px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
    </div>
  );
}

function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "16px" }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: "12px", borderBottom: i < rows - 1 ? `0.5px solid ${C.separator}` : "none" }}>
          <div style={{ width: "40px", height: "40px", borderRadius: "50%", background: C.skeletonBase, animation: "pulse 1.5s infinite", flexShrink: 0 }}></div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
            <div style={{ width: "50%", height: "14px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.1s" }}></div>
            <div style={{ width: "35%", height: "10px", borderRadius: "4px", background: C.skeletonBase, animation: "pulse 1.5s infinite 0.2s" }}></div>
          </div>
        </div>
      ))}
    </div>
  );
}

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

        let usersData: any[] = [];
        let coursesData: any[] = [];
        let schedulesData: any[] = [];

        // STEP 1: Try Supabase first
        if (tenantId) {
          try {
            const [usersRes, coursesRes] = await Promise.all([
              supabase.from("users").select("*").eq("tenant_id", tenantId),
              supabase.from("courses").select("*").eq("tenant_id", tenantId),
            ]);

            if (usersRes.data) {
              usersData = usersRes.data.map((u: any) => ({
                ...u,
                assignedCourses: u.assigned_courses || [],
                profilePic: u.profile_pic,
                tuitionType: u.tuition_type,
              }));
            }
            if (coursesRes.data) {
              coursesData = coursesRes.data.map((c: any) => ({
                ...c,
                tuitionType: c.tuition_type,
                startDate: c.start_date,
                mediaUrl: c.logo,
              }));
            }

            try {
              const { data: schedData } = await supabase.from("schedules").select("*").eq("tenant_id", tenantId);
              if (schedData) {
                schedulesData = schedData.map((s: any) => ({
                  ...s,
                  courseId: s.course_id,
                  trainerId: s.trainer_id,
                  scheduledAt: s.scheduled_at || s.created_at,
                }));
              }
            } catch (e) { /* schedules table may not exist */ }

          } catch (onlineError) {
            console.warn("Supabase fetch failed, using local DB", onlineError);
          }
        }

        // STEP 2: Fallback to local DB
        if (usersData.length === 0) usersData = await getUsers();
        if (coursesData.length === 0) coursesData = await getCourses();
        if (schedulesData.length === 0) {
          try { schedulesData = await db.schedules.toArray(); } catch (e) { /* ignore */ }
        }

        const nonAdminUsers = usersData.filter((u: any) => u.role !== "admin");

        setAllUsers(nonAdminUsers);
        setAllCourses(coursesData);
        setAllSchedules(schedulesData);

        // SMS stats from local DB only
        let localSmsLogs: any[] = [];
        try { localSmsLogs = await db.smsLogs.toArray(); } catch (e) { /* table may not exist */ }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const totalThisMonth = localSmsLogs.filter((log: any) => {
          const d = new Date(log.sentAt || log.sent_at);
          return d >= startOfMonth;
        }).length;

        const days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(); d.setDate(d.getDate() - (6 - i)); d.setHours(0, 0, 0, 0);
          return d;
        });

        const last7DaysData = days.map(day => {
          const nextDay = new Date(day); nextDay.setDate(nextDay.getDate() + 1);
          const count = localSmsLogs.filter((log: any) => {
            const logDate = new Date(log.sentAt || log.sent_at);
            return logDate >= day && logDate < nextDay;
          }).length;
          return { day: day.toLocaleDateString('en-US', { weekday: 'short' }), value: count };
        });

        setSmsStats({ totalThisMonth, last7Days: last7DaysData });
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
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

  const tuitionPill = (course: any): React.CSSProperties => course.tuitionType === "paid"
    ? { display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "6px", background: C.paidBg, color: C.paidText, fontSize: "12px", fontWeight: "700", letterSpacing: "0.2px" }
    : { display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "6px", background: C.freeBg, color: C.freeText, fontSize: "12px", fontWeight: "700", letterSpacing: "0.2px" };

  const displayTuition = (course: any) => course.tuitionType === "paid" ? formatCurrency(course.amount || 0) : "Free";

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: iosFont, display: "flex", flexDirection: "column", boxSizing: "border-box", paddingBottom: "40px" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* STAT CARDS */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: "12px", padding: "16px 16px 8px 16px", width: "100%", boxSizing: "border-box" }}>
        {isLoading ? (
          <><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /><SkeletonCard /></>
        ) : (
          <>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.purpleBg, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Trainers</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{trainers.length}</div></div>
            </div>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Learners</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{learners.length}</div></div>
            </div>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Courses</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{allCourses.length}</div></div>
            </div>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.orangeBg, color: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Schedules</div><div style={{ fontSize: "22px", color: C.textPrimary, fontWeight: "700" }}>{allSchedules.length}</div></div>
            </div>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: C.blueBg, color: C.blue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Expected</div><div style={{ fontSize: "18px", color: C.textPrimary, fontWeight: "700" }}>{formatCurrency(totalExpected)}</div></div>
            </div>
            <div style={{ background: C.card, borderRadius: "16px", padding: "16px", display: "flex", alignItems: "center", gap: "12px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
              <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: totalOutstanding > 0 ? C.redBg : C.greenBg, color: totalOutstanding > 0 ? C.red : C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <div><div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "500" }}>Outstanding</div><div style={{ fontSize: "18px", color: totalOutstanding > 0 ? C.red : C.green, fontWeight: "700" }}>{totalExpected <= 0 ? "N/A" : formatCurrency(totalOutstanding)}</div></div>
            </div>
          </>
        )}
      </div>

      {/* CHARTS */}
      {!isLoading && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "16px", width: "100%", boxSizing: "border-box" }}>
          <div style={{ background: C.card, borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", marginBottom: "16px" }}>Course Types</div>
            <DonutChart data={[{ label: "Free", value: freeCourses.length }, { label: "Paid", value: paidCourses.length }]} colors={[C.green, C.orange]} centerLabel="Total" centerValue={String(allCourses.length)} />
          </div>
          <div style={{ background: C.card, borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", marginBottom: "16px" }}>User Distribution</div>
            <BarChart data={[{ label: "Trainers", value: trainers.length }, { label: "Learners", value: learners.length }]} colors={[C.purple, C.green]} />
          </div>
          <div style={{ background: C.card, borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", marginBottom: "16px" }}>Schedules This Week</div>
            <LineChart schedules={allSchedules} />
          </div>
          <div style={{ background: C.card, borderRadius: "16px", padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <div style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600" }}>SMS This Month</div>
              <div style={{ fontSize: "20px", color: C.green, fontWeight: "700" }}>{smsStats.totalThisMonth}</div>
            </div>
            <SmsLineChart data={smsStats.last7Days} />
          </div>
        </div>
      )}

      {/* RECENT USERS */}
      <div style={iosGroupHeader}>RECENT USERS</div>
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : recentUsers.length === 0 ? (
        <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", padding: "32px 16px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "16px" }}>
          <div style={{ color: C.textTertiary, fontSize: "15px" }}>No users yet</div>
        </div>
      ) : (
        <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "16px" }}>
          {recentUsers.map((user: any, index: number) => {
            const expected = parseNum(user.tuition?.expected);
            const paid = parseNum(user.tuition?.paid);
            const balance = expected - paid;
            let balanceColor = C.textTertiary;
            if (expected > 0 && balance <= 0) balanceColor = C.green;
            else if (expected > 0 && balance > 0) balanceColor = C.red;
            return (
              <div key={user.id} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: "12px", borderBottom: index < recentUsers.length - 1 ? `0.5px solid ${C.separator}` : "none", cursor: "pointer" }} onClick={() => navigate("/admin/users")}>
                {user.profilePic ? (
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: C.separator, overflow: "hidden", flexShrink: 0 }}><img src={user.profilePic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /></div>
                ) : (
                  <div style={{ width: "44px", height: "44px", borderRadius: "50%", background: getAvatarColor(user.username || "U"), color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "17px", fontWeight: "600", flexShrink: 0 }}>{(user.username || "U").charAt(0).toUpperCase()}</div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ fontSize: "16px", fontWeight: "600", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
                    <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 7px", borderRadius: "5px", background: user.role === "trainer" ? C.purpleBg : C.greenBg, color: user.role === "trainer" ? C.purple : C.green, fontSize: "11px", fontWeight: "700" }}>{user.role === "trainer" ? "Trainer" : "Trainee"}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: C.textTertiary, marginTop: "2px" }}>{user.phone || user.email || "No contact"}</div>
                </div>
                {user.role === "trainee" && (
                  <div style={{ textAlign: "right", flexShrink: 0 }}>
                    <div style={{ fontSize: "12px", color: C.textTertiary }}>Tuition</div>
                    <div style={{ fontSize: "14px", fontWeight: "600", color: balanceColor }}>{tuitionLabel(expected, paid)}</div>
                  </div>
                )}
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginLeft: "4px" }}><polyline points="9 18 15 12 9 6"/></svg>
              </div>
            );
          })}
        </div>
      )}

      {/* COURSES */}
      <div style={iosGroupHeader}>COURSES</div>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : recentCourses.length === 0 ? (
        <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", padding: "32px 16px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "16px" }}>
          <div style={{ color: C.textTertiary, fontSize: "15px" }}>No courses yet</div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: "16px", padding: "0 16px 16px 16px", width: "100%", boxSizing: "border-box" }}>
          {recentCourses.map((course: any) => {
            const courseTrainees = allUsers.filter((u: any) => u.role === "trainee" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
            const courseTrainer = allUsers.find((u: any) => u.role === "trainer" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
            const courseSchedules = allSchedules.filter((s: any) => s.courseId === course.id);
            return (
              <div key={course.id} style={{ backgroundColor: C.card, borderRadius: "16px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", cursor: "pointer" }} onClick={() => navigate("/admin/courses")}>
                <div style={{ display: "flex", alignItems: "center", padding: "16px", borderBottom: `0.5px solid ${C.separator}` }}>
                  <div style={{ width: "48px", height: "48px", borderRadius: "12px", background: course.logo || course.mediaUrl ? "transparent" : C.medBlueBg, flexShrink: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: course.logo || course.mediaUrl ? "0 2px 8px rgba(0,0,0,0.06)" : "none" }}>
                    {course.logo || course.mediaUrl ? <img src={course.logo || course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="1.8"><path d="M6 2v6a6 6 0 0 0 12 0V2"/><circle cx="12" cy="14" r="2"/></svg>}
                  </div>
                  <div style={{ flex: 1, marginLeft: "12px", minWidth: 0 }}>
                    <div style={{ fontSize: "16px", fontWeight: "600", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.name}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                      <span style={tuitionPill(course)}>{displayTuition(course)}</span>
                      {course.startDate && <span style={{ fontSize: "12px", color: C.textTertiary }}>{course.startDate}</span>}
                    </div>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textQuaternary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6"/></svg>
                </div>
                <div style={{ padding: "12px 16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <div style={{ padding: "8px 12px", borderRadius: "10px", background: C.purpleBg, color: C.purple, fontSize: "12px", fontWeight: "600" }}><div style={{ opacity: 0.7, fontSize: "10px", textTransform: "uppercase" }}>Trainer</div><div style={{ marginTop: "2px" }}>{courseTrainer?.username || "None"}</div></div>
                  <div style={{ padding: "8px 12px", borderRadius: "10px", background: C.greenBg, color: C.green, fontSize: "12px", fontWeight: "600" }}><div style={{ opacity: 0.7, fontSize: "10px", textTransform: "uppercase" }}>Trainees</div><div style={{ marginTop: "2px" }}>{courseTrainees.length}</div></div>
                  <div style={{ padding: "8px 12px", borderRadius: "10px", background: C.orangeBg, color: C.orange, fontSize: "12px", fontWeight: "600" }}><div style={{ opacity: 0.7, fontSize: "10px", textTransform: "uppercase" }}>Duration</div><div style={{ marginTop: "2px" }}>{calculateDuration(course.startDate, course.period)}</div></div>
                  <div style={{ padding: "8px 12px", borderRadius: "10px", background: C.medBlueBg, color: C.medBlue, fontSize: "12px", fontWeight: "600" }}><div style={{ opacity: 0.7, fontSize: "10px", textTransform: "uppercase" }}>Schedules</div><div style={{ marginTop: "2px" }}>{courseSchedules.length}</div></div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* UPCOMING SCHEDULES */}
      <div style={iosGroupHeader}>UPCOMING SCHEDULES</div>
      {isLoading ? (
        <SkeletonList rows={3} />
      ) : upcomingSchedules.length === 0 ? (
        <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", padding: "32px 16px", textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "40px" }}>
          <div style={{ color: C.textTertiary, fontSize: "15px" }}>No upcoming schedules</div>
        </div>
      ) : (
        <div style={{ backgroundColor: C.card, marginLeft: "16px", marginRight: "16px", borderRadius: "12px", overflow: "hidden", boxShadow: "0 1px 4px rgba(0,0,0,0.04)", width: "calc(100% - 32px)", boxSizing: "border-box", marginBottom: "40px" }}>
          {upcomingSchedules.map((schedule: any, index: number) => {
            const linkedCourse = allCourses.find((c: any) => c.id === schedule.courseId);
            const linkedTrainer = allUsers.find((u: any) => u.id === schedule.trainerId);
            const scheduleDate = new Date(schedule.scheduledAt || schedule.created_at);
            const isPast = scheduleDate < new Date();
            return (
              <div key={schedule.id} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: "12px", borderBottom: index < upcomingSchedules.length - 1 ? `0.5px solid ${C.separator}` : "none", opacity: isPast ? 0.5 : 1 }}>
                <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: isPast ? C.inset : C.orangeBg, color: isPast ? C.textTertiary : C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: "15px", fontWeight: "600", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{schedule.title || "Untitled Schedule"}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "3px" }}>
                    {linkedCourse && <span style={{ fontSize: "12px", color: C.medBlue, fontWeight: "500" }}>{linkedCourse.name}</span>}
                    {linkedTrainer && <span style={{ fontSize: "12px", color: C.purple, fontWeight: "500" }}>{linkedTrainer.username}</span>}
                  </div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: "12px", color: C.textTertiary }}>{scheduleDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                  <div style={{ fontSize: "13px", color: C.textPrimary, fontWeight: "500" }}>{scheduleDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}