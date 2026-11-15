/**
 * LiveControls.tsx  -  OPTIONAL bottom control bar (trainer only)
 * ---------------------------------------------------------------------------
 * The fixed LiveSidebar now contains ALL live-class controls, so this bar is
 * OPTIONAL and the classroom page does NOT render it by default. The file is
 * kept clean and compiling in case you prefer a bottom bar as well - just
 * render <LiveControls ... /> and pass it the same callbacks the sidebar
 * gets (onPrevPage / onNextPage / busy / presentation).
 *
 * Zero supabase imports and zero "./LiveIcons" imports: icons come from
 * ./LiveSidebar (same folder, exported there), actions arrive as callbacks.
 * ---------------------------------------------------------------------------
 */

import {
  IconChevronLeft,
  IconChevronRight,
  IconDoc,
  IconRaiseHand,
} from "./LiveSidebar";
import type { LiveRole, PresentationInfo } from "./LiveSidebar";

type Props = {
  /** Only trainers see the bar; trainees get null. */
  role?: LiveRole;
  /** Current material info (title + "position of total"). */
  presentation?: PresentationInfo | null;
  /** True while the parent persists a page change. */
  busy?: boolean;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  /** Raised-hands count badge. */
  handsCount?: number;
  className?: string;
};

export default function LiveControls({
  role,
  presentation,
  busy = false,
  onPrevPage,
  onNextPage,
  handsCount = 0,
  className = "",
}: Props) {
  if (role !== "trainer") return null;

  return (
    <div
      className={`sticky bottom-0 z-20 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur ${className}`}
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
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
            {presentation?.title ?? "No material selected"}
          </span>
          {presentation && presentation.total > 0 && (
            <span className="ml-auto shrink-0 text-xs text-slate-400">
              {presentation.position} of {presentation.total}
            </span>
          )}
        </div>

        <button
          onClick={() => onNextPage?.()}
          disabled={busy || !onNextPage}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:bg-slate-50 hover:text-[#5b5fc7] disabled:cursor-not-allowed disabled:opacity-50"
          title="Next material"
        >
          <IconChevronRight size={18} />
        </button>

        {handsCount > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">
            <IconRaiseHand size={14} />
            {handsCount}
          </span>
        )}
      </div>
    </div>
  );
}
