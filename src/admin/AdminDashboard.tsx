// src/admin/AdminDashboard.tsx — Material You (Android) responsive rewrite
// ----------------------------------------------------------------------------
// RESPONSIVE MD3 v2 — professional Android UI that fits ANY device screen:
//   • Class-based responsive stylesheet (injected once, below) instead of
//     inline-only styles, so real media queries can drive the layout:
//       phones (2-col stats) → large phones (3) → tablets (4) →
//       desktop (7-in-a-row stats, 2-col charts, 3-col courses).
//   • Tiny phones (≤379px, incl. Galaxy Fold cover 280px) get a dedicated
//     compact tier (.mdx-hide-xs trims secondary info instead of squeezing).
//   • Android-native interaction feel: ≥44px touch targets, pressed/selected
//     state layers, hover elevation ONLY on hover-capable devices, no
//     tap-flash, TalkBack/keyboard focus rings, safe-area insets for
//     notched phones, prefers-reduced-motion honored.
//   • Fluid paddings/type via clamp() — no horizontal scroll at any width.
//
// MTN PREPAID WALLET integration (2 marked blocks + stat card):
//   1. "Wallet & Top-up" quick action in the hero → /admin/wallet
//   2. Live "Wallet" stat card — prepaid UGX balance; red at zero, orange
//      under the low-balance threshold, green when healthy
//   Data comes from src/api/walletApi.ts with the same login JWT; a failed
//   wallet fetch never blocks the dashboard (card just stays neutral).
//
// OFFLINE-FIRST + DOC-STORE FIXES:
//   • Courses no longer query `deleted_at=is.null` on public.courses — that
//     table is doc-store { id, tenant_id, course_id, data jsonb, updated_at }
//     and has NO deleted_at / created_at columns, so the old query answered
//     400 on every dashboard load. The pull now goes through the shape-aware
//     fetchCoursesFromSupabase() (supabaseCourseSync v5), which filters
//     soft-deletes itself and returns local-shape courses, or null offline.
//   • Schedules pull maps BOTH table shapes: doc-store rows keep everything
//     inside `data`, so title/courseId/trainerId/scheduledAt are read from
//     there when the row has no relational columns.
// ----------------------------------------------------------------------------

import { useEffect, useState } from "react";
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getUsers } from "../database/userDB";
import { getCourses } from "../database/courseDB";
import { pullRemoteSmsLogs, syncUnsyncedSmsLogs } from "../database/smsLogDB";
// Shape-aware courses pull (doc-store { data jsonb } vs relational) — the
// dashboard must NOT filter courses on columns that do not exist in the cloud.
import { fetchCoursesFromSupabase } from "../database/supabaseCourseSync";
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
// Roboto first: it is the Android system font, so phones render it natively
// (zero font download, true Material look); desktops fall back gracefully.
const font = "'Roboto', 'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

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

/* ================= NON-INTERACTIVE CARD BASE (skeletons / empty states) ==== */
const cardBase: CSSProperties = {
  background: C.surface,
  borderRadius: R.md,
  boxShadow: S.level1,
  border: `1px solid ${C.outline}`,
  boxSizing: "border-box",
  minWidth: 0,
};

/* ============================================================================
   GLOBAL RESPONSIVE STYLESHEET — injected once per dashboard mount.
   Plain CSS (no interpolation) so it stays a single constant string.

   Breakpoint ladder (Android device classes):
     base    ≤479px  phones portrait            stats 2-col, everything 1-col
     480px           large phones / landscape   stats 3-col
     600px           phablets                   hero switches to one row
     768px           tablets                    stats 4-col, charts 2-col
     1024px          desktop / tablet-landscape stats 7-col, courses 3-col
     ≤379px          tiny phones                .mdx-hide-xs trims secondary info
   ============================================================================ */
const GLOBAL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
.mdx-root { -webkit-tap-highlight-color: transparent; -webkit-text-size-adjust: 100%; }

/* ---------- page shell ---------- */
.mdx-page {
  width: 100%; max-width: 1400px; margin: 0 auto;
  padding: 12px clamp(12px, 3.5vw, 24px) calc(clamp(24px, 4vh, 40px) + env(safe-area-inset-bottom, 0px));
}
@media (min-width: 600px) { .mdx-page { padding-top: 16px; } }

/* ---------- surfaces ---------- */
.mdx-card {
  background: #FFFFFF; border: 1px solid #DADCE0; border-radius: 16px;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 6px 2px rgba(60,64,67,0.15);
  min-width: 0;
}
.mdx-anim { animation: fadeUp 0.35s cubic-bezier(0.2,0,0,1) both; }

/* ---------- hero ---------- */
.mdx-hero { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.mdx-hero-top { display: flex; align-items: center; gap: 12px; min-width: 0; }
.mdx-hero-avatar { width: 42px; height: 42px; border-radius: 50%; flex-shrink: 0; }
@media (min-width: 600px) {
  .mdx-hero { flex-direction: row; align-items: center; gap: 16px; padding: 20px clamp(18px, 3vw, 24px); }
  .mdx-hero-top { flex: 1; gap: 14px; }
  .mdx-hero-avatar { width: 46px; height: 46px; }
}

/* ---------- buttons (44-48dp touch targets, pressed state) ---------- */
.mdx-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  min-height: 44px; padding: 0 18px; border: none; border-radius: 24px;
  font-family: inherit; font-size: 14px; font-weight: 500; letter-spacing: 0.01em;
  cursor: pointer; user-select: none; outline: none;
  transition: box-shadow 0.2s cubic-bezier(0.2,0,0,1), background-color 0.15s ease, transform 0.08s ease;
}
.mdx-btn:active { transform: scale(0.98); }
.mdx-btn-primary { background: #1A73E8; color: #FFFFFF; box-shadow: 0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 6px 2px rgba(60,64,67,0.15); }
@media (hover: hover) {
  .mdx-btn-primary:hover { background: #1765CC; box-shadow: 0 1px 3px 0 rgba(60,64,67,0.30), 0 4px 8px 3px rgba(60,64,67,0.15); }
}
.mdx-btn-primary:active { background: #185FC7; }
.mdx-hero-action { width: 100%; }
@media (min-width: 600px) { .mdx-hero-action { width: auto; min-height: 42px; } }

/* keyboard / TalkBack focus ring */
.mdx-btn:focus-visible, .mdx-tap:focus-visible { outline: 2px solid #1A73E8; outline-offset: 2px; }

/* ---------- stat grid: 2 → 3 → 4 → 7 columns ---------- */
.mdx-stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; padding-top: 14px; }
@media (min-width: 480px) { .mdx-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding-top: 16px; } }
@media (min-width: 768px) { .mdx-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1024px) { .mdx-stats { grid-template-columns: repeat(7, minmax(0, 1fr)); } }

.mdx-stat { display: flex; align-items: center; gap: 10px; padding: 12px; border-radius: 14px; }
@media (min-width: 768px) { .mdx-stat { padding: 14px 16px; gap: 12px; } }
.mdx-stat-icon { width: 36px; height: 36px; border-radius: 10px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
@media (min-width: 768px) { .mdx-stat-icon { width: 40px; height: 40px; } }
.mdx-stat-label { font-size: 11px; font-weight: 500; letter-spacing: 0.02em; line-height: 16px; color: #5F6368; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (min-width: 480px) { .mdx-stat-label { font-size: 12px; } }
.mdx-stat-value { font-size: 16px; font-weight: 500; letter-spacing: -0.01em; line-height: 1.3; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (min-width: 480px) { .mdx-stat-value { font-size: 18px; } }
@media (min-width: 1024px) { .mdx-stat-value { font-size: 17px; } }

/* ---------- chart grid: 1 → 2 columns ---------- */
.mdx-charts { display: grid; grid-template-columns: 1fr; gap: 12px; padding-top: 16px; }
@media (min-width: 768px) { .mdx-charts { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; padding-top: 20px; } }
.mdx-chartcard { padding: 14px 16px; }
@media (min-width: 768px) { .mdx-chartcard { padding: 16px 20px; } }

/* ---------- section headers ---------- */
.mdx-section-h { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 16px 4px 8px; }
@media (min-width: 768px) { .mdx-section-h { padding: 20px 4px 8px; } }
.mdx-section-title { font-size: 15px; font-weight: 500; color: #202124; letter-spacing: 0.01em; min-width: 0; }
@media (min-width: 768px) { .mdx-section-title { font-size: 16px; } }
.mdx-section-link {
  background: none; border: none; color: #1A73E8; font-weight: 500; font-size: 14px;
  font-family: inherit; cursor: pointer; padding: 8px 0 8px 12px; flex-shrink: 0;
  letter-spacing: 0.01em; user-select: none; border-radius: 8px; outline: none;
}
.mdx-section-link:active { opacity: 0.7; }

/* ---------- Android state layers: hover only on hover-capable devices,
   pressed state everywhere (finger, stylus, mouse) ---------- */
.mdx-tap { position: relative; cursor: pointer; outline: none; transition: background-color 0.15s ease; }
@media (hover: hover) { .mdx-tap:hover { background-color: rgba(60, 64, 67, 0.06); } }
.mdx-tap:active { background-color: rgba(60, 64, 67, 0.12); }
.mdx-lift { transition: box-shadow 0.2s cubic-bezier(0.2,0,0,1), border-color 0.2s ease, transform 0.15s cubic-bezier(0.2,0,0,1); }
@media (hover: hover) {
  .mdx-lift:hover { box-shadow: 0 1px 3px 0 rgba(60,64,67,0.30), 0 4px 8px 3px rgba(60,64,67,0.15); border-color: #1A73E8; }
}
.mdx-lift:active { transform: scale(0.995); }

/* ---------- list rows (56dp Material rows) ---------- */
.mdx-list {
  background: #FFFFFF; border: 1px solid #DADCE0; border-radius: 16px;
  box-shadow: 0 1px 2px 0 rgba(60,64,67,0.30), 0 1px 6px 2px rgba(60,64,67,0.15);
  overflow: hidden;
}
.mdx-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; min-height: 56px; min-width: 0; }
@media (min-width: 768px) { .mdx-row { padding: 12px 16px; } }
.mdx-row-avatar { width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0; overflow: hidden; }
.mdx-row-main { flex: 1; min-width: 0; }
.mdx-row-title { font-size: 14px; font-weight: 500; color: #202124; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.mdx-row-sub { font-size: 13px; color: #5F6368; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ---------- courses grid: 1 → 2 → 3 columns ---------- */
.mdx-courses { display: grid; grid-template-columns: 1fr; gap: 12px; }
@media (min-width: 600px) { .mdx-courses { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; } }
@media (min-width: 1024px) { .mdx-courses { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.mdx-course-head { display: flex; align-items: center; padding: 14px; border-bottom: 1px solid #DADCE0; gap: 12px; min-width: 0; }
@media (min-width: 768px) { .mdx-course-head { padding: 16px; } }
.mdx-course-logo { width: 44px; height: 44px; border-radius: 12px; flex-shrink: 0; overflow: hidden; display: flex; align-items: center; justify-content: center; }
.mdx-chipgrid { padding: 12px 14px 14px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (min-width: 480px) { .mdx-chipgrid { grid-template-columns: repeat(4, minmax(0, 1fr)); padding: 12px 16px 16px; } }
.mdx-chip { border-radius: 10px; padding: 8px 10px; min-width: 0; }
@media (min-width: 768px) { .mdx-chip { padding: 8px 12px; } }

/* ---------- tiny-phone tier (≤379px, incl. foldables' cover screens) ------- */
@media (max-width: 379px) {
  .mdx-hide-xs { display: none !important; }
  .mdx-row { padding: 12px; gap: 10px; }
  .mdx-stat { padding: 10px; gap: 8px; }
  .mdx-course-head { padding: 12px; }
  .mdx-hero { padding: 14px; }
}

/* ---------- keyframes ---------- */
@keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

/* ---------- accessibility: honor reduced-motion preference ---------- */
@media (prefers-reduced-motion: reduce) {
  .mdx-root *, .mdx-root *::before, .mdx-root *::after { animation: none !important; transition: none !important; }
}
`;

/* ================= SMALL BUILDING BLOCKS ================= */

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

/** Keyboard activation for tappable cards/rows — TalkBack + physical-keyboard
 *  users get the same action as a pointer tap (Android a11y parity). */
function pressActivates(onClick?: () => void) {
  if (!onClick) return undefined;
  return (e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  };
}

function StatCard({ icon, label, value, bg, fg, valueColor, hint, delay, onClick }: {
  icon: ReactNode; label: string; value: string | number;
  bg: string; fg: string; valueColor?: string; hint?: string; delay?: number;
  onClick?: () => void; // MTN PREPAID WALLET: let the wallet card open /admin/wallet
}) {
  return (
    <div
      title={hint}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={pressActivates(onClick)}
      className={`mdx-card mdx-stat mdx-anim${onClick ? " mdx-tap" : ""}`}
      style={{ animationDelay: `${delay ?? 0}ms` }}
    >
      <div className="mdx-stat-icon" style={{ background: bg, color: fg }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="mdx-stat-label">{label}</div>
        <div className="mdx-stat-value" style={{ color: valueColor || C.onSurface }}>{value}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, chip, chipColor, children }: {
  title: string; chip?: string | number; chipColor?: string; children: ReactNode;
}) {
  return (
    <div className="mdx-card mdx-chartcard">
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
    <div className="mdx-section-h">
      <span className="mdx-section-title">{title}</span>
      {onViewAll && (
        <button onClick={onViewAll} className="mdx-section-link">
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
      padding: "clamp(24px, 6vw, 32px) 16px", textAlign: "center",
      color: C.onSurfaceVariant, fontSize: 14,
      boxSizing: "border-box", width: "100%",
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
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, flex: 1 }}>
        {data.map((item: any, index: number) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: colors[index], flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.label}</span>
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
    <div style={{ ...cardBase, borderRadius: 14, padding: 12, display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite", flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ width: "55%", height: 10, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.1s" }} />
        <div style={{ width: "75%", height: 18, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.2s" }} />
      </div>
    </div>
  );
}

function SkeletonChart() {
  return (
    <div style={{ ...cardBase, borderRadius: R.lg, padding: "14px 16px" }}>
      <div style={{ width: "40%", height: 10, borderRadius: 5, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite" }} />
      <div style={{ marginTop: 18, width: "100%", height: 120, borderRadius: R.sm, background: C.skeletonBase, animation: "shimmer 1.5s ease-in-out infinite 0.15s", opacity: 0.7 }} />
    </div>
  );
}

function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="mdx-list">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", padding: "14px 16px", gap: 12, borderBottom: i < rows - 1 ? `1px solid ${C.outline}` : "none", minHeight: 56 }}>
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

        // STEP 1: Load from Local DB FIRST (Instant Load — offline-first)
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

          // Users — the users table IS relational (has deleted_at), so this
          // direct query stays. Guarded so a failure can't kill the rest.
          try {
            const usersRes = await supabase
              .from("users")
              .select("*")
              .eq("tenant_id", tenantId)
              .is("deleted_at", null);

            if (usersRes.data && usersRes.data.length > 0) {
              const mappedUsers = usersRes.data.map((u: any) => ({
                ...u,
                assignedCourses: u.assigned_courses || [],
                profilePic: u.profile_pic,
                tuitionType: u.tuition_type,
              }));
              const mappedNonAdmin = mappedUsers.filter((u: any) => u.role !== "admin");

              // MERGE remote + local instead of replacing local with remote.
              // A newly created user whose cloud upsert failed (offline / API
              // cold-start) must not vanish from the dashboard. Remote wins
              // for known ids; local users not yet synced (cloud confirm
              // still pending) always stay visible.
              const remoteUserIds = new Set(mappedNonAdmin.map((u: any) => u.id));
              const pendingLocalUsers = nonAdminUsers.filter(
                (u: any) => !u.synced && !remoteUserIds.has(u.id)
              );
              setAllUsers(sortUsersByCreatedDesc([...mappedNonAdmin, ...pendingLocalUsers]));
            } else if (usersRes.error) {
              console.warn("Dashboard user refresh failed, keeping local DB", usersRes.error.message);
            }
          } catch (e) {
            console.warn("Dashboard user refresh threw, keeping local DB", e);
          }

          // Courses — SHAPE-AWARE pull (supabaseCourseSync v5). The cloud
          // public.courses table is doc-store { id, tenant_id, course_id,
          // data jsonb, updated_at } with NO deleted_at / created_at columns,
          // so the old `select("*").is("deleted_at", null)` answered 400 on
          // every dashboard load. fetchCoursesFromSupabase filters soft-
          // deletes itself (relational deleted_at OR data.deleted_at) and
          // returns local-shape courses — or null offline (local stays).
          try {
            const cloudCourses = await fetchCoursesFromSupabase(tenantId);
            if (cloudCourses && cloudCourses.length > 0) {
              const remoteIds = new Set(cloudCourses.map((c: any) => c.id));
              const pendingLocalCourses = localCourses.filter(
                (c: any) => c.synced === false && !remoteIds.has(c.id)
              );
              setAllCourses([...cloudCourses, ...pendingLocalCourses]);
            }
          } catch (e) {
            console.warn("Dashboard course refresh failed, keeping local DB", e);
          }

          // Schedules — map BOTH table shapes. Doc-store schedule rows carry
          // everything inside `data` (no scheduled_at / created_at columns),
          // relational rows are the schedule itself.
          try {
            const { data: schedData } = await supabase
              .from("schedules")
              .select("*")
              .eq("tenant_id", tenantId);
            if (schedData && schedData.length > 0) {
              const mappedSchedules = schedData.map((s: any) => {
                const src: any =
                  s && typeof s === "object" && "data" in s && !s.title
                    ? (s.data ?? {})
                    : s;
                return {
                  ...src,
                  id: s.id,
                  tenantId: src.tenantId ?? s.tenant_id,
                  courseId: src.courseId ?? s.course_id ?? src.course_id,
                  trainerId: src.trainerId ?? s.trainer_id ?? src.trainer_id,
                  scheduledAt:
                    src.scheduledAt ?? src.scheduled_at ?? s.scheduled_at ??
                    src.createdAt ?? src.created_at ?? s.updated_at,
                };
              });
              setAllSchedules(mappedSchedules);
            }
          } catch (e) { /* schedules table may not exist */ }

          // Merge cloud SMS logs into Dexie so the graph reflects all devices/updates
          try {
            await syncUnsyncedSmsLogs();
            const added = await pullRemoteSmsLogs(tenantId);
            if (added > 0) await refreshSmsStats();
          } catch (e) { /* sms merge best-effort */ }
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
    <div
      className="mdx-root"
      style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, overflowX: "hidden" }}
    >
      {/* Responsive MD3 stylesheet — one injection, real media queries */}
      <style>{GLOBAL_CSS}</style>

      <div className="mdx-page">

        {/* ===== HERO — greeting bar (stacks on phones, one row from 600px) ===== */}
        <section className="mdx-card mdx-hero mdx-anim">
          <div className="mdx-hero-top">
            {/* Blue accent circle */}
            <div
              className="mdx-hero-avatar"
              style={{ background: C.primaryContainer, color: C.primary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.04em", marginBottom: 2 }}>{dateStr}</div>
              <div style={{ fontSize: "clamp(19px, 4.5vw, 28px)", fontWeight: 400, color: C.onSurface, letterSpacing: "-0.01em", lineHeight: 1.25 }}>
                {greeting}, <span style={{ color: C.primary, fontWeight: 500 }}>{firstName}</span>
              </div>
            </div>
          </div>
          {/* MTN PREPAID WALLET: quick action → /admin/wallet (STK-push top-up).
              Full-width tap target on phones, inline pill on ≥600px. */}
          <button onClick={() => navigate("/admin/wallet")} className="mdx-btn mdx-btn-primary mdx-hero-action">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
            Wallet &amp; Top-up
          </button>
        </section>

        {/* ===== STAT CARDS — 2-col phone · 3-col large phone · 4-col tablet · 7-col desktop ===== */}
        <div className="mdx-stats">
          {isLoading
            ? Array.from({ length: 7 }).map((_, i) => <SkeletonStat key={i} />)
            : statDefs.map((s, i) => (
              <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} bg={s.bg} fg={s.fg} valueColor={s.valueColor} hint={s.hint} onClick={s.onClick} delay={i * 50} />
            ))}
        </div>

        {/* ===== CHARTS — 1-col mobile, 2-col from 768px ===== */}
        <div className="mdx-charts">
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

        {/* ===== RECENT USERS — 56dp Material rows; tuition + chevron trimmed on tiny phones ===== */}
        <SectionHeader title="Recent Users" onViewAll={() => navigate("/admin/users")} />
        {isLoading ? (
          <SkeletonList rows={4} />
        ) : recentUsers.length === 0 ? (
          <EmptyState text="No users yet" />
        ) : (
          <div className="mdx-list">
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
                  onKeyDown={pressActivates(() => navigate("/admin/users"))}
                  tabIndex={0}
                  role="button"
                  className="mdx-row mdx-tap"
                  style={{ borderBottom: index < recentUsers.length - 1 ? `1px solid ${C.outline}` : "none" }}
                >
                  {user.profilePic ? (
                    <div className="mdx-row-avatar" style={{ background: C.surfaceVariant }}>
                      <img src={user.profilePic} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  ) : (
                    <div className="mdx-row-avatar" style={{ background: getAvatarColor(user.username || "U"), color: C.onPrimary, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 500 }}>
                      {(user.username || "U").charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="mdx-row-main">
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <div className="mdx-row-title">{user.username}</div>
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
                    <div className="mdx-row-sub">
                      {user.phone || user.email || "No contact"}
                    </div>
                  </div>
                  {user.role === "trainee" && (
                    <div className="mdx-hide-xs" style={{ textAlign: "right", flexShrink: 0 }}>
                      <div style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.06em" }}>Tuition</div>
                      <div style={{ fontSize: 14, fontWeight: 500, color: balanceColor, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{tuitionLabel(expected, paid)}</div>
                    </div>
                  )}
                  <svg className="mdx-hide-xs" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                </div>
              );
            })}
          </div>
        )}

        {/* ===== COURSES — 1-col mobile · 2-col phablet/tablet · 3-col desktop ===== */}
        <SectionHeader title="Courses" onViewAll={() => navigate("/admin/courses")} />
        {isLoading ? (
          <SkeletonList rows={3} />
        ) : recentCourses.length === 0 ? (
          <EmptyState text="No courses yet" />
        ) : (
          <div className="mdx-courses">
            {recentCourses.map((course: any, index: number) => {
              const courseTrainees = allUsers.filter((u: any) => u.role === "trainee" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseTrainer = allUsers.find((u: any) => u.role === "trainer" && Array.isArray(u.assignedCourses) && u.assignedCourses.includes(course.id));
              const courseSchedules = allSchedules.filter((s: any) => s.courseId === course.id);
              return (
                <div
                  key={course.id}
                  onClick={() => navigate("/admin/courses")}
                  onKeyDown={pressActivates(() => navigate("/admin/courses"))}
                  tabIndex={0}
                  role="button"
                  className="mdx-card mdx-lift mdx-anim"
                  style={{ cursor: "pointer", animationDelay: `${index * 40}ms` }}
                >
                  <div className="mdx-course-head">
                    <div
                      className="mdx-course-logo"
                      style={{ background: course.logo || course.mediaUrl ? "transparent" : C.primaryContainer }}
                    >
                      {course.logo || course.mediaUrl
                        ? <img src={course.logo || course.mediaUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={C.primary} strokeWidth="1.8"><path d="M6 2v6a6 6 0 0 0 12 0V2" /><circle cx="12" cy="14" r="2" /></svg>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="mdx-row-title">{course.name}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, flexWrap: "wrap", minWidth: 0 }}>
                        <span style={tuitionPill(course)}>{displayTuition(course)}</span>
                        {course.startDate && <span className="mdx-hide-xs" style={{ fontSize: 12, color: C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course.startDate}</span>}
                      </div>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.outlineVariant} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                  {/* MD3 tonal chip grid — 2×2 on phones, 4-across from 480px */}
                  <div className="mdx-chipgrid">
                    {[
                      { label: "Trainer", value: courseTrainer?.username || "None", bg: C.purpleBg, fg: C.purple },
                      { label: "Trainees", value: String(courseTrainees.length), bg: C.greenBg, fg: C.green },
                      { label: "Duration", value: calculateDuration(course.startDate, course.period), bg: C.orangeBg, fg: C.orange },
                      { label: "Schedules", value: String(courseSchedules.length), bg: C.medBlueBg, fg: C.medBlue },
                    ].map((chip) => (
                      <div key={chip.label} className="mdx-chip" style={{ background: chip.bg, color: chip.fg }}>
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
          <div className="mdx-list">
            {upcomingSchedules.map((schedule: any, index: number) => {
              const linkedCourse = allCourses.find((c: any) => c.id === schedule.courseId);
              const linkedTrainer = allUsers.find((u: any) => u.id === schedule.trainerId);
              const scheduleDate = new Date(schedule.scheduledAt || schedule.created_at);
              const isPast = scheduleDate < new Date();
              return (
                <div
                  key={schedule.id}
                  className="mdx-row"
                  style={{
                    borderBottom: index < upcomingSchedules.length - 1 ? `1px solid ${C.outline}` : "none",
                    opacity: isPast ? 0.5 : 1,
                  }}
                >
                  <div style={{ width: 40, height: 40, borderRadius: R.sm, background: isPast ? C.surfaceVariant : C.orangeBg, color: isPast ? C.onSurfaceVariant : C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  </div>
                  <div className="mdx-row-main">
                    <div className="mdx-row-title">{schedule.title || "Untitled Schedule"}</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3, flexWrap: "wrap", minWidth: 0 }}>
                      {linkedCourse && <span style={{ fontSize: 12, color: C.primary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "60%" }}>{linkedCourse.name}</span>}
                      {linkedTrainer && <span className="mdx-hide-xs" style={{ fontSize: 12, color: C.purple, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{linkedTrainer.username}</span>}
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
