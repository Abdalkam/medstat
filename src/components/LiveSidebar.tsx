/**
 * LiveSidebar.tsx  -  ALL-IN-ONE, SUPABASE-FREE (icons + sidebar in one file)
 * ---------------------------------------------------------------------------
 * This single file REPLACES your old LiveSidebar.tsx (and LiveIcons.tsx).
 *
 * Part 1 - LiveIcons: 16 Teams-style inline SVG icon components, exported so
 *          any other file can reuse them:
 *              import { IconMic } from "./LiveSidebar";
 *
 * Part 2 - LiveSidebar: fixed right-hand sidebar holding ALL live-class
 *          controls:
 *            - Presentation card (trainer): Prev / Next material buttons.
 *            - People tab: speaking indicator, host badge, joined time,
 *              participant search; trainer can mute speakers.
 *            - Hands tab: raised-hand queue; trainer can "Allow to speak";
 *              trainees see their own hand status card.
 *
 * ZERO supabase imports - the page that renders this component owns all
 * database work. Paging arrives as callbacks, so this file can never break
 * on a missing client path:
 *
 *      <LiveSidebar
 *        participants={...} role="trainer"
 *        allowAudio={...} muteUser={...} timeAgo={...}
 *        presentation={{ title, position, total }}
 *        onPrevPage={...} onNextPage={...} busy={...}
 *      />
 *
 * RESPONSIVE - fits any device screen size:
 *   - <768px (phones, portrait or landscape): the sidebar is a slide-over
 *     overlay with a dimmed backdrop; tapping the backdrop closes it. While
 *     closed, a floating people button (bottom-right, clear of the app bar)
 *     reopens it - with an amber raised-hands badge when hands are up.
 *   - >=768px (tablet / desktop): the sidebar is docked on the right and
 *     open by default. Give the main content matching right padding:
 *         className="... md:pr-[356px]"
 *   - Pass `open` + `onOpenChange` to control it from the parent. In
 *     controlled mode the built-in floating reopen button is suppressed.
 * ---------------------------------------------------------------------------
 */

import { useMemo, useState } from "react";
import type { ReactNode } from "react";

/* ========================================================================== */
/* PART 1 - LIVEICONS (Teams-style inline SVG icon set)                       */
/* ========================================================================== */

export type IconProps = {
  /** Icon size in px (width and height). Default 20. */
  size?: number;
  /** Extra class names (e.g. Tailwind colour / hover classes). */
  className?: string;
  /** Accessible title. Omit for decorative icons. */
  title?: string;
};

function Svg({
  size,
  className,
  title,
  strokeWidth = 1.8,
  children,
}: IconProps & { strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      width={size ?? 20}
      height={size ?? 20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ---------------------------------------------------------------- people -- */

/** Two people - the Teams "Participants" icon. */
export const IconPeople = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M3 19.5c.5-3.2 2.9-4.9 6-4.9s5.5 1.7 6 4.9" />
    <path d="M15.2 5.2a3.25 3.25 0 0 1 0 5.7" />
    <path d="M17.1 14.9c2.1.7 3.5 2.3 3.9 4.6" />
  </Svg>
);

/** One person. */
export const IconPerson = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M4.6 19.6c.7-3.5 3.6-5.2 7.4-5.2s6.7 1.7 7.4 5.2" />
  </Svg>
);

/** Host / presenter badge. */
export const IconCrown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.8 15.5 3.5 6.9l4.7 3.2L12 3.9l3.8 6.2 4.7-3.2L19.2 15.5H4.8Z" />
    <path d="M5.5 19h13" />
  </Svg>
);

/* ----------------------------------------------------------------- hands -- */

/** Raised hand - the Teams "Raise hand" icon. */
export const IconRaiseHand = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 12.5V5.7a1.5 1.5 0 0 1 3 0v6" />
    <path d="M11 11.7V4.3a1.5 1.5 0 0 1 3 0v7.2" />
    <path d="M14 11.5V5.7a1.5 1.5 0 0 1 3 0v6.8" />
    <path d="M17 13V9.2a1.5 1.5 0 0 1 3 0v3.6A7.7 7.7 0 0 1 12.3 20.5h-.8a7.2 7.2 0 0 1-5.1-2.1l-2.5-2.6a1.6 1.6 0 0 1 2.3-2.2l1.8 1.8" />
  </Svg>
);

/* ----------------------------------------------------------------- audio -- */

/** Microphone. */
export const IconMic = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.8" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.2" />
  </Svg>
);

/** Microphone muted (mic + slash). */
export const IconMicOff = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="2.8" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
    <path d="M12 18v3.2" />
    <path d="M4 4l16 16" />
  </Svg>
);

/** Speaker on. */
export const IconVolume = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4Z" />
    <path d="M15.5 9.2a4.2 4.2 0 0 1 0 5.6" />
    <path d="M18.2 6.8a7.9 7.9 0 0 1 0 10.4" />
  </Svg>
);

/** Speaker muted. */
export const IconVolumeOff = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 9.5v5h3.2L12 18.5v-13L7.2 9.5H4Z" />
    <path d="m15.5 9.5 5 5" />
    <path d="m20.5 9.5-5 5" />
  </Svg>
);

/* -------------------------------------------------------------- controls -- */

export const IconChevronLeft = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </Svg>
);

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M9.5 5.5 16 12l-6.5 6.5" />
  </Svg>
);

export const IconCheck = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M5 12.5 10 17.5 19 7.5" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p} strokeWidth={2.2}>
    <path d="M6 6l12 12" />
    <path d="M18 6 6 18" />
  </Svg>
);

/* --------------------------------------------------------------- content -- */

/** Document / material. */
export const IconDoc = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
    <path d="M14 3v5h5" />
    <path d="M9 13.5h6" />
    <path d="M9 16.5h6" />
  </Svg>
);

/** Chat bubble. */
export const IconChat = (p: IconProps) => (
  <Svg {...p}>
    <path d="M21 11.5a8.5 8.5 0 0 1-12.4 7.6L3 21l1.9-5.6A8.5 8.5 0 1 1 21 11.5Z" />
  </Svg>
);

/** Clock (joined time, elapsed time). */
export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
);

/** Screen / presentation. */
export const IconScreen = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4.5" width="18" height="12.5" rx="2" />
    <path d="M9 21h6" />
    <path d="M12 17.5V21" />
  </Svg>
);

/* ========================================================================== */
/* PART 2 - LIVE SIDEBAR                                                      */
/* ========================================================================== */

/* ------------------------------------------------------------------ types */

export type LiveRole = "trainer" | "trainee";

/** What the trainer's presentation card shows. */
export type PresentationInfo = {
  title: string;
  /** 1-based position in the material list. */
  position: number;
  total: number;
};

/**
 * Participant shape - tolerant on purpose: every known field is optional and
 * common naming variants (name / full_name / username, hand_raised /
 * handRaised, isSpeaking / is_speaking) are normalised below.
 */
export type SidebarParticipant = {
  id?: string | number;
  user_id?: string | number;
  name?: string;
  full_name?: string;
  username?: string;
  email?: string;
  role?: string;
  hand_raised?: boolean;
  handRaised?: boolean;
  isSpeaking?: boolean;
  is_speaking?: boolean;
  joined_at?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

export type SidebarMaterial = {
  id: string | number;
  title?: string;
  file_name?: string;
  name?: string;
  [key: string]: unknown;
};

type Props = {
  /* ---- same props as your old LiveSidebar ---- */
  participants: SidebarParticipant[];
  role: LiveRole;
  allowAudio?: (userId: any) => void | Promise<void>;
  muteUser?: (userId: any) => void | Promise<void>;
  timeAgo?: (d: any) => string;

  /* ---- presentation controls (parent owns the database work) ---- */
  /** Info for the trainer's presentation card; omit to hide the card. */
  presentation?: PresentationInfo | null;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  /** True while the parent persists a page change. */
  busy?: boolean;

  /* ---- optional extras ---- */
  /** Trainee's own user id - enables the "your hand is raised" card. */
  currentUserId?: string | number | null;
  /** Parent-controlled open state (defaults to internal state). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
};

/* ------------------------------------------------------------- normalisers */

const uid = (u: SidebarParticipant): string => String(u.id ?? u.user_id ?? "");

const displayName = (u: SidebarParticipant): string =>
  (u.name || u.full_name || u.username || u.email || "").trim() ||
  `User ${uid(u).slice(0, 6)}`;

const isHost = (u: SidebarParticipant): boolean =>
  String(u.role ?? "").toLowerCase().startsWith("trainer");

const hasHand = (u: SidebarParticipant): boolean =>
  Boolean(u.hand_raised ?? u.handRaised ?? false);

const isSpeakingNow = (u: SidebarParticipant): boolean =>
  Boolean(u.isSpeaking ?? u.is_speaking ?? false);

/* ------------------------------------------------------------ small pieces */

function Avatar({ name, active = false }: { name: string; active?: boolean }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .map((w) => w.charAt(0))
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      className={`relative inline-flex h-9 w-9 shrink-0 select-none items-center justify-center rounded-full text-[11px] font-bold ${
        active
          ? "bg-emerald-50 text-emerald-600 ring-2 ring-emerald-400"
          : "bg-[#eef0fb] text-[#5b5fc7]"
      }`}
    >
      {initials}
      {active && (
        <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" />
      )}
    </span>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  icon,
  alert = false,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: ReactNode;
  alert?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition ${
        active
          ? "bg-white text-[#5b5fc7] shadow-sm"
          : "text-slate-500 hover:text-slate-700"
      }`}
    >
      {icon}
      {label}
      {count > 0 && (
        <span
          className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
            alert && !active
              ? "bg-amber-400 text-white"
              : active
                ? "bg-[#5b5fc7] text-white"
                : "bg-slate-200 text-slate-600"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

function SectionLabel({
  children,
  badge,
  tone = "slate",
}: {
  children: ReactNode;
  badge?: number;
  tone?: "slate" | "amber" | "emerald";
}) {
  const toneCls =
    tone === "amber"
      ? "bg-amber-100 text-amber-700"
      : tone === "emerald"
        ? "bg-emerald-100 text-emerald-700"
        : "bg-slate-200 text-slate-600";
  return (
    <div className="flex items-center justify-between px-4 pb-1 pt-3">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {children}
      </span>
      {typeof badge === "number" && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${toneCls}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon}
      </span>
      <p className="text-sm font-medium text-slate-600">{title}</p>
      {hint ? <p className="text-xs leading-5 text-slate-400">{hint}</p> : null}
    </div>
  );
}

function PersonRow({
  user,
  host,
  speakingNow,
  raised,
  whenLabel,
  showMute = false,
  showVolume = false,
  onMute,
}: {
  user: SidebarParticipant;
  host: boolean;
  speakingNow: boolean;
  raised: boolean;
  whenLabel: string;
  showMute?: boolean;
  showVolume?: boolean;
  onMute?: () => void;
}) {
  return (
    <div className="group flex items-center gap-3 rounded-xl px-3 py-2 transition hover:bg-slate-50">
      <Avatar name={displayName(user)} active={speakingNow} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-sm font-medium text-slate-800">
            {displayName(user)}
          </p>
          {host && <IconCrown size={14} className="shrink-0 text-amber-500" title="Host" />}
        </div>
        <p className="truncate text-xs text-slate-400">
          {speakingNow ? "Speaking now" : whenLabel}
        </p>
      </div>
      {raised && !speakingNow && (
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-500"
          title="Hand raised"
        >
          <IconRaiseHand size={15} />
        </span>
      )}
      {showMute && speakingNow && (
        <button
          onClick={onMute}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-red-100 bg-red-50 px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-100"
          title="Mute participant"
        >
          <IconMicOff size={14} />
          Mute
        </button>
      )}
      {showVolume && speakingNow && (
        <IconVolume size={16} className="shrink-0 text-emerald-500" title="Speaking" />
      )}
    </div>
  );
}

function HandRow({
  name,
  onAllow,
  showMute = false,
  onMute,
}: {
  name: string;
  onAllow: () => void;
  showMute?: boolean;
  onMute?: () => void;
}) {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50/70 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-600">
          <IconRaiseHand size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{name}</p>
          <p className="truncate text-xs text-amber-600">Wants to speak</p>
        </div>
      </div>
      <div className="mt-2 flex gap-2">
        <button
          onClick={onAllow}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#5b5fc7] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#464fab]"
        >
          <IconMic size={14} />
          Allow to speak
        </button>
        {showMute && (
          <button
            onClick={onMute}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            <IconMicOff size={14} />
            Mute
          </button>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- component */

export default function LiveSidebar({
  participants,
  role,
  allowAudio,
  muteUser,
  timeAgo,
  presentation,
  onPrevPage,
  onNextPage,
  busy = false,
  currentUserId = null,
  open,
  onOpenChange,
  className = "",
}: Props) {
  const [tab, setTab] = useState<"people" | "hands">("people");
  const [query, setQuery] = useState("");
  const [openInternal, setOpenInternal] = useState<boolean>(
    () => (typeof window === "undefined" ? true : window.innerWidth >= 768)
  );

  /* Controlled mode: the parent owns open/close and renders its own toggle,
     so the built-in floating reopen button must stay out of the way. */
  const isControlled = open !== undefined;
  const isOpen = open ?? openInternal;
  const setOpen = (v: boolean) => {
    setOpenInternal(v);
    onOpenChange?.(v);
  };

  const trainer = role === "trainer";

  const hands = useMemo(() => participants.filter(hasHand), [participants]);
  const speakers = useMemo(
    () => participants.filter(isSpeakingNow),
    [participants]
  );
  const rest = useMemo(
    () => participants.filter((u) => !isSpeakingNow(u)),
    [participants]
  );

  const q = query.trim().toLowerCase();
  const visibleRest = q
    ? rest.filter((u) => displayName(u).toLowerCase().includes(q))
    : rest;

  const meRaised =
    currentUserId != null &&
    hands.some((u) => uid(u) === String(currentUserId));

  const handleAllow = async (u: SidebarParticipant) => {
    try {
      await allowAudio?.(uid(u));
    } catch (err) {
      console.error("[LiveSidebar] allowAudio failed:", err);
    }
  };

  const handleMute = async (u: SidebarParticipant) => {
    try {
      await muteUser?.(uid(u));
    } catch (err) {
      console.error("[LiveSidebar] muteUser failed:", err);
    }
  };

  const whenLabel = (u: SidebarParticipant): string => {
    if (!timeAgo) return "";
    const d = u.joined_at ?? u.created_at ?? null;
    if (!d) return "";
    try {
      return `Joined ${timeAgo(d)}`;
    } catch {
      return "";
    }
  };

  /* ---- collapsed ---- */
  if (!isOpen) {
    /* Controlled: the parent shows its own toggle -> render nothing. */
    if (isControlled) return null;

    /* Uncontrolled: floating reopen button (bottom-right, clear of the app
       bar) with a raised-hands badge. */
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Open live class panel"
        className={`fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[#5b5fc7] text-white shadow-lg transition hover:bg-[#464fab] ${className}`}
        title="Open live class panel"
      >
        <IconPeople size={22} />
        {hands.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-400 px-1 text-[10px] font-bold text-white ring-2 ring-white">
            {hands.length}
          </span>
        )}
      </button>
    );
  }

  /* ---- open: fixed sidebar ---- */
  return (
    <>
      {/* mobile backdrop */}
      <div
        className="fixed inset-0 z-30 bg-slate-900/30 backdrop-blur-[2px] md:hidden"
        onClick={() => setOpen(false)}
      />

      <aside
        aria-label="Live class panel"
        className={`fixed inset-y-0 right-0 z-40 flex w-[340px] max-w-[92vw] flex-col border-l border-slate-200 bg-white shadow-2xl ${className}`}
      >
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-slate-200 px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5b5fc7]/10 text-[#5b5fc7]">
            <IconPeople size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-800">Live class</p>
            <p className="truncate text-xs text-slate-500">
              {participants.length} participant
              {participants.length === 1 ? "" : "s"}
              {trainer ? " - you are presenting" : ""}
            </p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="-mr-1 rounded-lg p-2.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 md:hidden"
            title="Close panel"
            aria-label="Close panel"
          >
            <IconClose size={18} />
          </button>
        </div>

        {/* Presentation controls (trainer only; parent persists the change) */}
        {trainer && presentation && (
          <div className="border-b border-slate-200 bg-gradient-to-br from-[#eef0fb] via-white to-white px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#5b5fc7]">
                Presentation control
              </span>
              {presentation.total > 0 && (
                <span className="text-[11px] font-medium text-slate-500">
                  {presentation.position} of {presentation.total}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => onPrevPage?.()}
                disabled={busy || !onPrevPage}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-[#5b5fc7] disabled:cursor-not-allowed disabled:opacity-50"
                title="Previous material"
              >
                <IconChevronLeft size={18} />
              </button>
              <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <IconDoc size={16} className="shrink-0 text-[#5b5fc7]" />
                <span className="truncate text-sm font-medium text-slate-700">
                  {presentation.title}
                </span>
              </div>
              <button
                onClick={() => onNextPage?.()}
                disabled={busy || !onNextPage}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-[#5b5fc7] disabled:cursor-not-allowed disabled:opacity-50"
                title="Next material"
              >
                <IconChevronRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="border-b border-slate-200 px-3 py-2">
          <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
            <TabButton
              active={tab === "people"}
              onClick={() => setTab("people")}
              label="People"
              count={participants.length}
              icon={<IconPeople size={15} />}
            />
            <TabButton
              active={tab === "hands"}
              onClick={() => setTab("hands")}
              label="Hands"
              count={hands.length}
              icon={<IconRaiseHand size={15} />}
              alert={hands.length > 0}
            />
          </div>
        </div>

        {/* Content (overscroll-contain: no scroll chaining on mobile) */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {tab === "people" ? (
            <>
              <div className="px-3 pt-3">
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search participants"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-[#5b5fc7] focus:outline-none focus:ring-2 focus:ring-[#5b5fc7]/20"
                />
              </div>

              {speakers.length > 0 && (
                <>
                  <SectionLabel badge={speakers.length} tone="emerald">
                    Speaking now
                  </SectionLabel>
                  <div className="px-1.5">
                    {speakers.map((u, i) => (
                      <PersonRow
                        key={uid(u) || `sp-${i}`}
                        user={u}
                        host={isHost(u)}
                        speakingNow
                        raised={hasHand(u)}
                        whenLabel={whenLabel(u)}
                        showMute={trainer}
                        showVolume={!trainer}
                        onMute={() => void handleMute(u)}
                      />
                    ))}
                  </div>
                </>
              )}

              <SectionLabel badge={visibleRest.length}>In this class</SectionLabel>
              <div className="px-1.5 pb-8">
                {visibleRest.length === 0 ? (
                  <EmptyState
                    icon={<IconPerson size={22} />}
                    title={
                      q ? "No participants match your search" : "No participants yet"
                    }
                  />
                ) : (
                  visibleRest.map((u, i) => (
                    <PersonRow
                      key={uid(u) || `p-${i}`}
                      user={u}
                      host={isHost(u)}
                      speakingNow={false}
                      raised={hasHand(u)}
                      whenLabel={whenLabel(u)}
                    />
                  ))
                )}
              </div>
            </>
          ) : trainer ? (
            hands.length === 0 ? (
              <EmptyState
                icon={<IconRaiseHand size={22} />}
                title="No raised hands"
                hint="When trainees raise their hands they will queue up here."
              />
            ) : (
              <div className="space-y-2 px-3 pb-8 pt-3">
                {hands.map((u, i) => (
                  <HandRow
                    key={uid(u) || `h-${i}`}
                    name={displayName(u)}
                    onAllow={() => void handleAllow(u)}
                    showMute={isSpeakingNow(u)}
                    onMute={() => void handleMute(u)}
                  />
                ))}
              </div>
            )
          ) : meRaised ? (
            <div className="mx-3 mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                <IconRaiseHand size={22} />
              </span>
              <p className="mt-2 text-sm font-semibold text-amber-700">
                Your hand is raised
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-600">
                The trainer has been notified and will invite you to speak soon.
              </p>
            </div>
          ) : (
            <EmptyState
              icon={<IconRaiseHand size={22} />}
              title="No hand raised"
              hint="Raise your hand from the control bar and the trainer will let you speak."
            />
          )}
        </div>
      </aside>
    </>
  );
}
