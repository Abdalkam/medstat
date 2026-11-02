// ============================================================================
// src/admin/WalletDashboard.tsx — PREPAID WALLET · MTN MoMo top-ups
// Google Material Design 3 — matches AdminDashboard.tsx design system.
//
// Admin loads money onto the tenant wallet with MTN MoMo (STK push), then
// watches the prepaid balance burn down to zero as usage is billed. When the
// balance hits zero the database rejects further usage until the next top-up.
//
// Route:  /admin/wallet    (see README for wiring)
// Data:   wallets · wallet_transactions · usage_records · billing_services
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  activeRate,
  fetchServices,
  fetchTransactions,
  fetchUsage,
  fetchWallet,
  fetchWalletConfig,
  initiateMtnTopup,
  normalizePhone,
  pollTopupStatus,
  subscribeWalletChanges,
} from "../api/walletApi";
import type {
  BillingServiceRow,
  MtnConfigInfo,
  UsageRecord,
  Wallet,
  WalletTransaction,
} from "../api/walletApi";

/* ================= MD3 COLOR TOKENS (same palette as AdminDashboard) ================= */
const C = {
  primary: "#1A73E8",
  onPrimary: "#FFFFFF",
  primaryContainer: "#D3E3FD",
  onPrimaryContainer: "#041E49",
  secondary: "#5F6368",
  secondaryContainer: "#E8EAED",
  tertiary: "#1E8E3E",
  tertiaryContainer: "#E6F4EA",
  error: "#D93025",
  errorContainer: "#F9DEDC",
  warning: "#F9AB00",
  warningContainer: "#FEF7E0",
  surface: "#FFFFFF",
  onSurface: "#202124",
  onSurfaceVariant: "#5F6368",
  surfaceVariant: "#E8EAED",
  background: "#F8F9FA",
  outline: "#DADCE0",
  outlineVariant: "#BDC1C6",
  skeletonBase: "#E8EAED",
  inset: "#F1F3F4",
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
};

const font = "'Google Sans', 'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const S = {
  level1: "0 1px 2px 0 rgba(60,64,67,0.3), 0 1px 6px 2px rgba(60,64,67,0.15)",
  level2: "0 1px 2px 0 rgba(60,64,67,0.3), 0 2px 6px 2px rgba(60,64,67,0.15)",
};

const R = { sm: 8, md: 12, lg: 16, xl: 28 };
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

/* ================= HELPERS ================= */

function parseNum(val: unknown): number {
  const str = String(val ?? "0").replace(/,/g, "").trim();
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/** UGX has no minor units — balances are bigint, always whole. */
function formatUgx(amount: number): string {
  return "UGX " + Math.round(amount).toLocaleString("en-US");
}

function formatUgxCompact(amount: number): string {
  if (amount === 0) return "UGX 0";
  return "UGX " + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + ", " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
}

function getMe(): any {
  try { return JSON.parse(localStorage.getItem("currentUser") || "{}"); } catch { return {}; }
}

function friendlyError(e: unknown): string {
  const msg = (e as Error)?.message || String(e || "Something went wrong.");
  if (msg.includes("MTN_NOT_CONFIGURED")) return "MTN MoMo is not configured on the server yet. Add the MTN secrets (see README).";
  if (msg.toLowerCase().includes("failed to fetch")) return "Could not reach the server. Check your connection and try again.";
  return msg;
}

/* ================= ICONS (feather-style, matches AdminDashboard) ================= */

const Ic = {
  wallet: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" /><path d="M3 5v14a2 2 0 0 0 2 2h16v-5" /><path d="M18 12a2 2 0 0 0 0 4h4v-4Z" /></svg>
  ),
  plus: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
  ),
  minus: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /></svg>
  ),
  phone: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="2" width="14" height="20" rx="2" ry="2" /><line x1="12" y1="18" x2="12.01" y2="18" /></svg>
  ),
  check: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
  ),
  alert: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
  ),
  clock: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
  ),
  flame: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" /></svg>
  ),
  receipt: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" /><line x1="8" y1="7" x2="16" y2="7" /><line x1="8" y1="11" x2="16" y2="11" /><line x1="8" y1="15" x2="13" y2="15" /></svg>
  ),
  tag: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" /><line x1="7" y1="7" x2="7.01" y2="7" /></svg>
  ),
  refresh: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" /></svg>
  ),
  x: (s = 20): ReactNode => (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
  ),
};

/* ================= SMALL BUILDING BLOCKS ================= */

function StatCard({ icon, label, value, bg, fg, valueColor, hint, delay }: {
  icon: ReactNode; label: string; value: string | number;
  bg: string; fg: string; valueColor?: string; hint?: string; delay?: number;
}) {
  return (
    <div title={hint} style={{
      ...cardBase, padding: "clamp(12px, 2vw, 16px)",
      display: "flex", alignItems: "center", gap: 12,
      animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both",
      animationDelay: `${delay ?? 0}ms`,
    }}>
      <div style={{ width: 40, height: 40, borderRadius: R.sm, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.02em", lineHeight: "16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        <div style={{ fontSize: "clamp(15px, 3vw, 20px)", fontWeight: 500, color: valueColor || C.onSurface, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", lineHeight: 1.3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
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
        {chip != null && <span style={{ fontSize: 16, fontWeight: 500, color: chipColor || C.onSurface, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{chip}</span>}
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={{ padding: "20px 4px 8px" }}>
      <span style={{ fontSize: 14, color: C.onSurface, fontWeight: 500, letterSpacing: "0.01em" }}>{title}</span>
      {subtitle && <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div style={{ background: C.surface, borderRadius: R.lg, border: `1px dashed ${C.outlineVariant}`, padding: "32px 16px", textAlign: "center", color: C.onSurfaceVariant, fontSize: 14, boxSizing: "border-box" }}>
      {text}
    </div>
  );
}

function Banner({ tone, icon, text }: { tone: "error" | "warning" | "info"; icon: ReactNode; text: string }) {
  const map = {
    error: { bg: C.errorContainer, fg: C.error },
    warning: { bg: C.warningContainer, fg: C.orange },
    info: { bg: C.blueBg, fg: C.primary },
  } as const;
  const t = map[tone];
  return (
    <div style={{ background: t.bg, borderRadius: R.md, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, color: t.fg, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
      <span style={{ display: "flex", flexShrink: 0 }}>{icon}</span>
      <span style={{ fontSize: 13.5, fontWeight: 500, lineHeight: 1.45 }}>{text}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const s = status.toLowerCase();
  const style: CSSProperties = s === "successful"
    ? { background: C.greenBg, color: C.green }
    : s === "failed"
      ? { background: C.redBg, color: C.red }
      : { background: C.orangeBg, color: C.orange };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "1px 8px", borderRadius: R.xl, fontSize: 11, fontWeight: 500, ...style }}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

/* ================= CHARTS ================= */

const DonutChart = ({ data, colors, size = 120, strokeWidth = 16, centerLabel, centerValue }: {
  data: { label: string; value: number }[]; colors: string[]; size?: number; strokeWidth?: number;
  centerLabel?: string; centerValue?: string;
}) => {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  let offset = 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", minWidth: 0 }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0, margin: "0 auto" }}>
        <svg width={size} height={size} style={{ transform: "rotate(-90deg)", display: "block" }}>
          {total > 0 ? data.map((item, index) => {
            const dash = (item.value / total) * circumference;
            const circle = <circle key={index} cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={colors[index]} strokeWidth={strokeWidth} strokeDasharray={`${dash} ${circumference - dash}`} strokeDashoffset={-offset} />;
            offset += dash;
            return circle;
          }) : <circle cx={size / 2} cy={size / 2} r={radius} fill="transparent" stroke={C.outline} strokeWidth={strokeWidth} />}
        </svg>
        {centerLabel && centerValue && (
          <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)", textAlign: "center" }}>
            <div style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>{centerLabel}</div>
            <div style={{ fontSize: 16, color: C.onSurface, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>{centerValue}</div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
        {data.map((item, index) => (
          <div key={index} style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 12, height: 12, borderRadius: 3, background: colors[index], flexShrink: 0 }} />
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface }}>{item.label}</span>
              <span style={{ fontSize: 12, color: C.onSurfaceVariant, fontVariantNumeric: "tabular-nums" }}>{formatUgxCompact(item.value)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

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
              <div key={i} style={{
                position: "absolute",
                left: `${(i / (data.length - 1)) * 100}%`,
                top: `${100 - (d.value / maxValue) * 100}%`,
                width: 9, height: 9, borderRadius: "50%",
                background: C.surface, border: `2.5px solid ${color}`,
                transform: "translate(-50%, -50%)",
                boxShadow: S.level1,
              }} />
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

/* ================= SKELETONS ================= */

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

type TopupStage = "form" | "awaitingApproval" | "success" | "failed" | "timeout";

const AMOUNT_PRESETS = [10_000, 20_000, 50_000, 100_000, 200_000, 500_000];
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX_TRIES = 40; // ~2 minutes

export default function WalletDashboard() {
  const [isLoading, setIsLoading] = useState(true);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [services, setServices] = useState<BillingServiceRow[]>([]);
  const [envInfo, setEnvInfo] = useState<MtnConfigInfo | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Top-up flow state
  const [stage, setStage] = useState<TopupStage>("form");
  const [amountInput, setAmountInput] = useState("50000");
  const [phoneInput, setPhoneInput] = useState("");
  const [approvalPhone, setApprovalPhone] = useState("");
  const [approvalAmount, setApprovalAmount] = useState(0);
  const [reference, setReference] = useState<string | null>(null);
  const [statusReason, setStatusReason] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [successBalance, setSuccessBalance] = useState(0);

  const pollRef = useRef<number | null>(null);
  const topupCardRef = useRef<HTMLDivElement | null>(null);

  /* ---------- data loading ---------- */

  const refreshQuiet = useCallback(async () => {
    const me = getMe();
    if (!me?.tenantId) return;
    try {
      const [w, txs, us] = await Promise.all([
        fetchWallet(me.tenantId),
        fetchTransactions(me.tenantId, 60),
        fetchUsage(me.tenantId, 25),
      ]);
      setWallet(w);
      setTransactions(txs);
      setUsage(us);
    } catch {
      /* keep the last good data */
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  /** Runs after MTN confirms SUCCESSFUL: refresh all data, then capture the
   *  fresh balance for the success screen. */
  const handleTopupSuccess = useCallback(async () => {
    await refreshQuiet();
    try {
      const w = await fetchWallet(getMe()?.tenantId ?? "");
      if (w) setSuccessBalance(w.balance_ugx);
    } catch {
      /* success screen falls back to the refreshed wallet state */
    }
  }, [refreshQuiet]);

  const startPolling = useCallback((ref: string, onSuccess: () => Promise<void> | void) => {
    stopPolling();
    let tries = 0;
    pollRef.current = window.setInterval(async () => {
      tries += 1;
      if (tries > POLL_MAX_TRIES) {
        stopPolling();
        setStage("timeout");
        return;
      }
      try {
        const res = await pollTopupStatus(ref);
        if (res.status === "SUCCESSFUL") {
          stopPolling();
          await onSuccess();
          setStage("success");
        } else if (res.status === "FAILED") {
          stopPolling();
          setStatusReason(res.reason || "The payment was not completed. No money left your MoMo account.");
          setStage("failed");
        }
      } catch {
        /* transient network error — keep polling */
      }
    }, POLL_INTERVAL_MS);
  }, [stopPolling]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const me = getMe();
      if (!me?.tenantId) {
        if (!cancelled) setAuthError("Sign in as an admin to manage the prepaid wallet.");
        if (!cancelled) setIsLoading(false);
        return;
      }
      if (me.phone) setPhoneInput(String(me.phone));
      try {
        const [w, txs, us, svcs, cfg] = await Promise.all([
          fetchWallet(me.tenantId),
          fetchTransactions(me.tenantId, 60),
          fetchUsage(me.tenantId, 25),
          fetchServices(me.tenantId),
          fetchWalletConfig().catch(() => null),
        ]);
        if (cancelled) return;
        setWallet(w);
        setTransactions(txs);
        setUsage(us);
        setServices(svcs);
        setEnvInfo(cfg);
        // Resume an in-flight top-up after a page refresh (pending < 15 min old)
        const pending = txs.find((t: WalletTransaction) =>
          t.status === "pending" && t.tx_type === "topup" && t.external_reference &&
          Date.now() - new Date(t.created_at).getTime() < 15 * 60_000
        );
        if (pending?.external_reference) {
          setReference(pending.external_reference);
          setApprovalAmount(pending.amount_ugx);
          setApprovalPhone(pending.payer_msisdn ? `+${pending.payer_msisdn}` : "");
          setStage("awaitingApproval");
          startPolling(pending.external_reference, handleTopupSuccess);
        }
      } catch (e) {
        if (!cancelled) setFormError(friendlyError(e));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    const unsubscribe = subscribeWalletChanges(getMe()?.tenantId ?? "", () => { refreshQuiet(); });

    return () => {
      cancelled = true;
      unsubscribe();
      stopPolling();
    };
  }, [refreshQuiet, startPolling, stopPolling, handleTopupSuccess]);

  /* ---------- derived numbers ---------- */

  const balance = wallet?.balance_ugx ?? 0;
  const threshold = wallet?.low_balance_threshold_ugx ?? 5000;

  const successfulTx = useMemo(() => transactions.filter((t) => t.status === "successful"), [transactions]);

  const monthStart = useMemo(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  }, []);

  const loadedThisMonth = useMemo(
    () => successfulTx.filter((t) => t.direction === "credit" && new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.amount_ugx, 0),
    [successfulTx, monthStart],
  );

  const spentThisMonth = useMemo(
    () => successfulTx.filter((t) => t.direction === "debit" && new Date(t.created_at) >= monthStart)
      .reduce((s, t) => s + t.amount_ugx, 0),
    [successfulTx, monthStart],
  );

  const burn7 = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      d.setHours(0, 0, 0, 0);
      const next = new Date(d);
      next.setDate(d.getDate() + 1);
      const value = successfulTx
        .filter((t) => t.direction === "debit" && new Date(t.created_at) >= d && new Date(t.created_at) < next)
        .reduce((s, t) => s + t.amount_ugx, 0);
      return { day: d.toLocaleDateString("en-US", { weekday: "short" }), value };
    });
  }, [successfulTx]);

  const avgDailyBurn = burn7.reduce((s, d) => s + d.value, 0) / 7;
  const daysToZero: number | null =
    balance <= 0 ? 0 : avgDailyBurn > 0 ? Math.max(1, Math.ceil(balance / avgDailyBurn)) : null;

  /** Wallet walk-down to zero: daily closing balance from the ledger,
   *  back-filled backwards so quiet days carry the previous balance. */
  const balanceHistory7 = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const t of successfulTx) {
      if (t.balance_after_ugx == null) continue;
      const key = new Date(t.created_at).toDateString();
      if (!byDay.has(key)) byDay.set(key, t.balance_after_ugx); // newest-first input
    }
    let prev = balance;
    const out: { day: string; value: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const known = byDay.get(d.toDateString());
      if (known !== undefined) prev = known;
      out.push({ day: d.toLocaleDateString("en-US", { weekday: "short" }), value: prev });
    }
    out.reverse();
    return out;
  }, [successfulTx, balance]);

  const pendingCount = transactions.filter((t) => t.status === "pending" && t.tx_type === "topup").length;

  const balanceByTxId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of transactions) {
      if (t.balance_after_ugx != null) m.set(t.id, t.balance_after_ugx);
    }
    return m;
  }, [transactions]);

  const zeroBalance = balance <= 0;
  const lowBalance = !zeroBalance && balance <= threshold;
  const burnedPct = loadedThisMonth > 0 ? Math.min(100, (spentThisMonth / loadedThisMonth) * 100) : 0;

  /* ---------- top-up actions ---------- */

  const resetTopup = useCallback(() => {
    stopPolling();
    setStage("form");
    setReference(null);
    setStatusReason(null);
  }, [stopPolling]);

  const submitTopup = useCallback(async () => {
    const me = getMe();
    const amount = Math.round(parseNum(amountInput));
    if (amount < 1000) { setFormError("Minimum top-up is UGX 1,000."); return; }
    if (amount > 10_000_000) { setFormError("Maximum single top-up is UGX 10,000,000."); return; }
    const msisdn = normalizePhone(phoneInput);
    if (msisdn.length < 9) { setFormError("Enter a valid phone number, e.g. 0772123456."); return; }

    setFormError(null);
    setSubmitting(true);
    try {
      const res = await initiateMtnTopup({
        amount,
        msisdn,
        description: `Wallet top-up by ${me?.username || "admin"}`,
      });
      setReference(res.referenceId);
      setApprovalAmount(amount);
      setApprovalPhone(`+${msisdn}`);
      setStage("awaitingApproval");
      startPolling(res.referenceId, handleTopupSuccess);
    } catch (e) {
      setFormError(friendlyError(e));
    } finally {
      setSubmitting(false);
    }
  }, [amountInput, phoneInput, startPolling, handleTopupSuccess]);

  const repollNow = useCallback(() => {
    if (!reference) return;
    setStage("awaitingApproval");
    startPolling(reference, refreshQuiet);
  }, [reference, startPolling, refreshQuiet]);

  /* ---------- stat cards ---------- */

  const statDefs: { label: string; value: string; bg: string; fg: string; valueColor?: string; hint?: string; icon: ReactNode }[] = [
    {
      label: "Balance", value: formatUgxCompact(balance), bg: C.blueBg, fg: C.blue,
      hint: `Available prepaid balance: ${formatUgx(balance)}`, icon: Ic.wallet(20),
    },
    {
      label: "Loaded this month", value: formatUgxCompact(loadedThisMonth), bg: C.greenBg, fg: C.green,
      hint: `MTN MoMo top-ups this month: ${formatUgx(loadedThisMonth)}`, icon: Ic.plus(20),
    },
    {
      label: "Spent this month", value: formatUgxCompact(spentThisMonth), bg: C.orangeBg, fg: C.orange,
      hint: `Usage charges this month: ${formatUgx(spentThisMonth)}`, icon: Ic.minus(20),
    },
    {
      label: "Avg daily burn", value: formatUgxCompact(Math.round(avgDailyBurn)), bg: C.purpleBg, fg: C.purple,
      hint: `7-day average daily usage: ${formatUgx(Math.round(avgDailyBurn))}`, icon: Ic.flame(20),
    },
    {
      label: "Days to zero",
      value: daysToZero == null ? "—" : `${daysToZero} day${daysToZero === 1 ? "" : "s"}`,
      bg: zeroBalance ? C.redBg : daysToZero != null && daysToZero <= 3 ? C.orangeBg : C.greenBg,
      fg: zeroBalance ? C.red : daysToZero != null && daysToZero <= 3 ? C.orange : C.green,
      valueColor: zeroBalance ? C.red : daysToZero != null && daysToZero <= 3 ? C.orange : C.green,
      hint: daysToZero == null
        ? "No usage yet — nothing burning the balance"
        : `At ${formatUgx(Math.round(avgDailyBurn))}/day the balance reaches zero in about ${daysToZero} day(s)`,
      icon: Ic.clock(20),
    },
    {
      label: "Pending approvals", value: String(pendingCount), bg: C.blueBg, fg: C.blue,
      hint: "Top-ups waiting for a MoMo PIN", icon: Ic.phone(20),
    },
  ];

  /* ---------- render ---------- */

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.background, fontFamily: font, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`
        @keyframes shimmer { 0% { opacity: 1; } 50% { opacity: 0.35; } 100% { opacity: 1; } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @keyframes momoPulse { 0% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.12); opacity: 0.7; } 100% { transform: scale(1); opacity: 1; } }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `16px ${gutter} clamp(20px, 4vh, 44px)`, boxSizing: "border-box" }}>

        {authError ? (
          <EmptyState text={authError} />
        ) : (
          <>
            {/* ===== HERO — the prepaid balance, walking down to zero ===== */}
            <div style={{
              ...cardBase, borderRadius: R.lg,
              padding: "clamp(16px, 3vw, 24px)",
              animation: "fadeUp 0.35s cubic-bezier(0.2,0,0,1) both",
              display: "flex", flexDirection: "column", gap: 16,
            }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
                <div style={{
                  width: 48, height: 48, borderRadius: "50%", background: C.primaryContainer, color: C.primary,
                  display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                }}>{Ic.wallet(24)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, fontWeight: 500, letterSpacing: "0.04em" }}>
                    WALLET &amp; BILLING — PREPAID
                  </div>
                  <div style={{ fontSize: "clamp(26px, 5vw, 40px)", fontWeight: 500, color: zeroBalance ? C.error : C.onSurface, letterSpacing: "-0.02em", lineHeight: 1.2, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>
                    {formatUgx(balance)}
                  </div>
                  <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4 }}>
                    Available balance — every service charge burns it down to zero.
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <span style={{ padding: "2px 10px", borderRadius: R.xl, background: C.blueBg, color: C.primary, fontSize: 12, fontWeight: 500 }}>{wallet?.currency || "UGX"}</span>
                    <span style={{ padding: "2px 10px", borderRadius: R.xl, background: C.warningContainer, color: C.orange, fontSize: 12, fontWeight: 500 }}>MTN MoMo</span>
                    <span style={{
                      padding: "2px 10px", borderRadius: R.xl, fontSize: 12, fontWeight: 500,
                      background: zeroBalance ? C.redBg : lowBalance ? C.orangeBg : C.greenBg,
                      color: zeroBalance ? C.red : lowBalance ? C.orange : C.green,
                    }}>
                      {zeroBalance ? "Empty — usage blocked" : lowBalance ? "Low balance" : "Active"}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => topupCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })}
                  style={{
                    background: C.primary, color: C.onPrimary, border: "none", borderRadius: R.xl,
                    padding: "12px 22px", fontSize: 14, fontWeight: 500, fontFamily: font,
                    cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8,
                    boxShadow: S.level1, flexShrink: 0,
                  }}
                >
                  {Ic.plus(18)} Load money
                </button>
              </div>

              {/* burn-down bar: this month's float walking to zero */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: C.onSurfaceVariant, marginBottom: 6, gap: 10, flexWrap: "wrap" }}>
                  <span>This month&apos;s float used: <b style={{ color: C.onSurface, fontWeight: 500 }}>{loadedThisMonth > 0 ? `${Math.round(burnedPct)}%` : "—"}</b></span>
                  <span>{formatUgx(spentThisMonth)} of {formatUgx(loadedThisMonth)} burned</span>
                </div>
                <div style={{ width: "100%", height: 10, borderRadius: 5, background: C.surfaceVariant, overflow: "hidden" }}>
                  <div style={{ width: `${burnedPct}%`, height: "100%", borderRadius: 5, background: `linear-gradient(90deg, ${C.warning}, ${C.error})`, transition: "width 0.5s cubic-bezier(0.2,0,0,1)" }} />
                </div>
                {daysToZero != null && avgDailyBurn > 0 && (
                  <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 6 }}>
                    At the current 7-day burn rate of about <b style={{ color: C.onSurface, fontWeight: 500 }}>{formatUgx(Math.round(avgDailyBurn))}/day</b>, the balance reaches zero in roughly <b style={{ color: daysToZero <= 3 ? C.orange : C.onSurface, fontWeight: 500 }}>{daysToZero} day{daysToZero === 1 ? "" : "s"}</b>.
                  </div>
                )}
              </div>
            </div>

            {/* ===== BANNERS ===== */}
            <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16 }}>
              {envInfo && !envInfo.configured && (
                <Banner tone="warning" icon={Ic.alert(18)} text="MTN MoMo keys are not configured on the server — top-ups will fail. Set MTN_SUBSCRIPTION_KEY, MTN_API_USER and MTN_API_KEY (see README)." />
              )}
              {zeroBalance && !isLoading && (
                <Banner tone="error" icon={Ic.alert(18)} text="The wallet is empty. Prepaid usage is rejected at zero — load money to keep services running." />
              )}
              {!zeroBalance && lowBalance && (
                <Banner tone="warning" icon={Ic.alert(18)} text={`Low balance: ${formatUgx(balance)} left (threshold ${formatUgx(threshold)}). Load money before it hits zero.`} />
              )}
              {envInfo?.environment === "sandbox" && (
                <Banner tone="info" icon={Ic.phone(18)} text="MTN sandbox mode: approvals use MTN test accounts (billed in EUR). Switch MTN_TARGET_ENV to mtnuganda and UGX for production." />
              )}
            </div>

            {/* ===== STAT CARDS ===== */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(160px, 100%), 1fr))",
              gap: 12, paddingTop: 16, width: "100%", boxSizing: "border-box",
            }}>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => <SkeletonStat key={i} />)
                : statDefs.map((s, i) => (
                  <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} bg={s.bg} fg={s.fg} valueColor={s.valueColor} hint={s.hint} delay={i * 50} />
                ))}
            </div>

            {/* ===== LOAD MONEY CARD (MTN MoMo) ===== */}
            <div ref={topupCardRef} style={{ paddingTop: 20 }}>
              <div style={{ ...cardBase, padding: "16px 20px", borderColor: C.primary }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 11, color: C.onSurfaceVariant, textTransform: "uppercase", fontWeight: 700, letterSpacing: "0.08em" }}>Load Money — MTN MoMo</span>
                  <span style={{ fontSize: 12, color: C.onSurfaceVariant }}>Money lands the moment you approve the prompt</span>
                </div>

                {stage === "form" && (
                  <>
                    <div style={{ fontSize: 13, color: C.onSurface, fontWeight: 500, marginBottom: 8 }}>Amount (UGX)</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                      {AMOUNT_PRESETS.map((amt) => {
                        const selected = parseNum(amountInput) === amt;
                        return (
                          <button key={amt} onClick={() => setAmountInput(String(amt))} style={{
                            background: selected ? C.primary : C.surface,
                            color: selected ? C.onPrimary : C.onSurface,
                            border: `1px solid ${selected ? C.primary : C.outline}`,
                            borderRadius: R.xl, padding: "8px 14px", fontSize: 13, fontWeight: 500,
                            fontFamily: font, cursor: "pointer", fontVariantNumeric: "tabular-nums",
                          }}>
                            {amt.toLocaleString("en-US")}
                          </button>
                        );
                      })}
                    </div>
                    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                      <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: C.onSurface, fontWeight: 500 }}>Custom amount</span>
                        <input
                          inputMode="numeric"
                          value={amountInput}
                          onChange={(e) => setAmountInput(e.target.value.replace(/[^\d]/g, ""))}
                          placeholder="50000"
                          style={{
                            border: `1px solid ${C.outline}`, borderRadius: R.sm, padding: "12px 14px",
                            fontSize: 14, fontFamily: font, color: C.onSurface, background: C.surface,
                            outline: "none", fontVariantNumeric: "tabular-nums", boxSizing: "border-box", width: "100%",
                          }}
                        />
                      </label>
                      <label style={{ flex: "1 1 220px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                        <span style={{ fontSize: 13, color: C.onSurface, fontWeight: 500 }}>Your MTN phone number</span>
                        <input
                          inputMode="tel"
                          value={phoneInput}
                          onChange={(e) => setPhoneInput(e.target.value)}
                          placeholder="e.g. 0772 123 456"
                          style={{
                            border: `1px solid ${C.outline}`, borderRadius: R.sm, padding: "12px 14px",
                            fontSize: 14, fontFamily: font, color: C.onSurface, background: C.surface,
                            outline: "none", boxSizing: "border-box", width: "100%",
                          }}
                        />
                      </label>
                    </div>
                    {formError && (
                      <div style={{ marginTop: 12, padding: "10px 14px", borderRadius: R.sm, background: C.redBg, color: C.red, fontSize: 13 }}>
                        {formError}
                      </div>
                    )}
                    <button
                      onClick={submitTopup}
                      disabled={submitting}
                      style={{
                        marginTop: 16, width: "100%", background: submitting ? C.secondaryContainer : C.primary,
                        color: submitting ? C.onSurfaceVariant : C.onPrimary, border: "none", borderRadius: R.xl,
                        padding: "14px 20px", fontSize: 15, fontWeight: 500, fontFamily: font, cursor: submitting ? "default" : "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}
                    >
                      {Ic.phone(18)} {submitting ? "Sending the prompt…" : `Load ${formatUgx(parseNum(amountInput))} with MTN MoMo`}
                    </button>
                    <div style={{ fontSize: 12, color: C.onSurfaceVariant, marginTop: 10, lineHeight: 1.5 }}>
                      You will get a prompt on the phone — enter your MoMo PIN to approve. Minimum UGX 1,000 per load.
                    </div>
                  </>
                )}

                {stage === "awaitingApproval" && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ width: 64, height: 64, margin: "0 auto", borderRadius: "50%", background: C.blueBg, color: C.primary, display: "flex", alignItems: "center", justifyContent: "center", animation: "momoPulse 1.6s ease-in-out infinite" }}>
                      {Ic.phone(28)}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.onSurface, marginTop: 14 }}>
                      Approve {formatUgx(approvalAmount)} on your phone
                    </div>
                    <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4 }}>Prompt sent to {approvalPhone || "your phone"}</div>
                    <div style={{ textAlign: "left", maxWidth: 420, margin: "18px auto 0", display: "flex", flexDirection: "column", gap: 10 }}>
                      {[
                        "Check your phone for the MTN MoMo approval prompt.",
                        "Enter your MoMo PIN to approve the payment.",
                        "This screen updates automatically once approved.",
                      ].map((step, i) => (
                        <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                          <div style={{ width: 22, height: 22, borderRadius: "50%", background: C.blueBg, color: C.primary, fontSize: 12, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i + 1}</div>
                          <div style={{ fontSize: 13.5, color: C.onSurface, lineHeight: 1.45 }}>{step}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 18, color: C.primary, fontSize: 13, fontWeight: 500 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.primary, animation: "shimmer 1.2s ease-in-out infinite" }} />
                      Waiting for your approval…
                    </div>
                    <button onClick={resetTopup} style={{
                      marginTop: 16, background: "none", border: "none", color: C.onSurfaceVariant,
                      fontSize: 13, fontWeight: 500, fontFamily: font, cursor: "pointer",
                      display: "inline-flex", alignItems: "center", gap: 6,
                    }}>
                      {Ic.x(16)} Cancel (you can still approve later — see Transactions)
                    </button>
                  </div>
                )}

                {stage === "success" && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ width: 64, height: 64, margin: "0 auto", borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {Ic.check(28)}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.onSurface, marginTop: 14 }}>
                      {formatUgx(approvalAmount)} loaded
                    </div>
                    <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4 }}>
                      New balance: <b style={{ color: C.green, fontWeight: 500 }}>{formatUgx(successBalance || balance)}</b>
                    </div>
                    <button onClick={resetTopup} style={{
                      marginTop: 16, background: C.primary, color: C.onPrimary, border: "none",
                      borderRadius: R.xl, padding: "10px 24px", fontSize: 14, fontWeight: 500,
                      fontFamily: font, cursor: "pointer",
                    }}>Done</button>
                  </div>
                )}

                {stage === "failed" && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ width: 64, height: 64, margin: "0 auto", borderRadius: "50%", background: C.redBg, color: C.red, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {Ic.alert(28)}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.onSurface, marginTop: 14 }}>Top-up failed</div>
                    <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4, maxWidth: 420, margin: "4px auto 0" }}>{statusReason || "The payment was not completed."}</div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                      <button onClick={() => setStage("form")} style={{
                        background: C.primary, color: C.onPrimary, border: "none", borderRadius: R.xl,
                        padding: "10px 24px", fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer",
                      }}>Try again</button>
                    </div>
                  </div>
                )}

                {stage === "timeout" && (
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ width: 64, height: 64, margin: "0 auto", borderRadius: "50%", background: C.orangeBg, color: C.orange, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {Ic.clock(28)}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 500, color: C.onSurface, marginTop: 14 }}>Still waiting for approval</div>
                    <div style={{ fontSize: 13, color: C.onSurfaceVariant, marginTop: 4, maxWidth: 440, margin: "4px auto 0" }}>
                      If you already entered your PIN, the top-up will still land — check Transactions in a moment, or check again now.
                    </div>
                    <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
                      <button onClick={repollNow} style={{
                        background: C.primary, color: C.onPrimary, border: "none", borderRadius: R.xl,
                        padding: "10px 24px", fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer",
                        display: "inline-flex", alignItems: "center", gap: 8,
                      }}>{Ic.refresh(16)} Check again</button>
                      <button onClick={resetTopup} style={{
                        background: C.surface, color: C.onSurface, border: `1px solid ${C.outline}`, borderRadius: R.xl,
                        padding: "10px 24px", fontSize: 14, fontWeight: 500, fontFamily: font, cursor: "pointer",
                      }}>New top-up</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* ===== CHARTS ===== */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
              gap: 16, paddingTop: 20, width: "100%", boxSizing: "border-box",
            }}>
              {isLoading ? (
                <><SkeletonChart /><SkeletonChart /><SkeletonChart /></>
              ) : (
                <>
                  <ChartCard title="This Month's Float">
                    <DonutChart
                      data={[
                        { label: "Remaining", value: Math.max(0, balance) },
                        { label: "Spent", value: spentThisMonth },
                      ]}
                      colors={[C.tertiary, C.orange]}
                      centerLabel="Balance"
                      centerValue={formatUgxCompact(balance).replace("UGX ", "")}
                    />
                  </ChartCard>
                  <ChartCard title="Balance — Last 7 Days" chip={formatUgxCompact(balance)} chipColor={zeroBalance ? C.red : C.green}>
                    <TrendChart data={balanceHistory7} color={C.primary} gradientId="gradWalletBalance" emptyText="No wallet activity yet" />
                  </ChartCard>
                  <ChartCard title="Daily Usage Burn — Last 7 Days" chip={formatUgxCompact(Math.round(avgDailyBurn)) + "/day"} chipColor={C.orange}>
                    <TrendChart data={burn7} color={C.orange} gradientId="gradWalletBurn" emptyText="No usage charges this week" />
                  </ChartCard>
                </>
              )}
            </div>

            {/* ===== RECENT USAGE — the charges that walk the balance to zero ===== */}
            <SectionHeader title="Recent Usage" subtitle="Every line is a charge against the prepaid balance" />
            {isLoading ? (
              <SkeletonList rows={4} />
            ) : usage.length === 0 ? (
              <EmptyState text="No usage yet — charges appear here as services bill the wallet" />
            ) : (
              <div style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
                {usage.map((u, index) => {
                  const runningBalance = u.wallet_transaction_id ? balanceByTxId.get(u.wallet_transaction_id) : undefined;
                  return (
                    <div key={u.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, borderBottom: index < usage.length - 1 ? `1px solid ${C.outline}` : "none", minWidth: 0 }}>
                      <div style={{ width: 40, height: 40, borderRadius: R.sm, background: C.orangeBg, color: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {Ic.receipt(20)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {u.service?.name || "Usage"}
                          </span>
                          {u.service?.unit_label && (
                            <span style={{ fontSize: 11, color: C.onSurfaceVariant, background: C.surfaceVariant, borderRadius: R.xl, padding: "1px 8px", flexShrink: 0 }}>{u.service.unit_label}</span>
                          )}
                        </div>
                        <div style={{ fontSize: 12.5, color: C.onSurfaceVariant, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {formatDateTime(u.created_at)}{u.description ? ` · ${u.description}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: C.red, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          −{formatUgx(u.total_amount_ugx)}
                        </div>
                        <div style={{ fontSize: 11.5, color: C.onSurfaceVariant, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {runningBalance != null ? `Balance after: ${formatUgx(runningBalance)}` : `${u.quantity} × ${formatUgx(u.unit_price_ugx)}`}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ===== WALLET TRANSACTIONS ===== */}
            <SectionHeader title="Wallet Transactions" subtitle="Top-ups in, usage charges out — the full ledger" />
            {isLoading ? (
              <SkeletonList rows={4} />
            ) : transactions.length === 0 ? (
              <EmptyState text="No transactions yet — load money to get started" />
            ) : (
              <div style={{ backgroundColor: C.surface, borderRadius: R.lg, overflow: "hidden", boxShadow: S.level1, border: `1px solid ${C.outline}`, boxSizing: "border-box" }}>
                {transactions.slice(0, 15).map((t, index) => {
                  const isCredit = t.direction === "credit";
                  const title = t.tx_type === "topup"
                    ? `MTN MoMo top-up${t.payer_msisdn ? ` · +${t.payer_msisdn}` : ""}`
                    : t.tx_type === "usage" ? "Usage charge" : t.tx_type === "refund" ? "Refund" : "Adjustment";
                  return (
                    <div key={t.id} style={{ display: "flex", alignItems: "center", padding: "12px 16px", gap: 12, borderBottom: index < Math.min(transactions.length, 15) - 1 ? `1px solid ${C.outline}` : "none", minWidth: 0 }}>
                      <div style={{
                        width: 40, height: 40, borderRadius: "50%",
                        background: isCredit ? C.greenBg : C.redBg, color: isCredit ? C.green : C.red,
                        display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {isCredit ? Ic.plus(18) : Ic.minus(18)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                          <span style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{title}</span>
                          <StatusPill status={t.status} />
                        </div>
                        <div style={{ fontSize: 12.5, color: C.onSurfaceVariant, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {formatDateTime(t.created_at)}{t.description && t.tx_type !== "topup" ? ` · ${t.description}` : ""}
                          {t.provider_tx_id ? ` · MTN ref ${t.provider_tx_id}` : ""}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: isCredit ? C.green : C.red, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {isCredit ? "+" : "−"}{formatUgx(t.amount_ugx)}
                        </div>
                        {t.balance_after_ugx != null && (
                          <div style={{ fontSize: 11.5, color: C.onSurfaceVariant, marginTop: 2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                            Balance: {formatUgx(t.balance_after_ugx)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ===== BILLING SERVICES & RATES ===== */}
            <SectionHeader title="Billing Services & Rates" subtitle="What consumes the wallet, and at what price" />
            {isLoading ? (
              <SkeletonList rows={2} />
            ) : services.length === 0 ? (
              <EmptyState text="No billing services configured — add them in billing_services" />
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 12, width: "100%", boxSizing: "border-box" }}>
                {services.map((s) => {
                  const rate = activeRate(s);
                  return (
                    <div key={s.id} style={{ ...cardBase, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
                      <div style={{ width: 40, height: 40, borderRadius: R.sm, background: C.purpleBg, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        {Ic.tag(20)}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 14, fontWeight: 500, color: C.onSurface, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: C.onSurfaceVariant, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {s.description || s.code}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0 }}>
                        <div style={{ fontSize: 13.5, fontWeight: 500, color: C.onSurface, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                          {rate != null ? formatUgx(rate) : "Free"}
                        </div>
                        <div style={{ fontSize: 11, color: C.onSurfaceVariant, whiteSpace: "nowrap" }}>per {s.unit_label}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
