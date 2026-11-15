/**
 * TrainerLiveClassroom.tsx  -  FULL REPLACEMENT (trainer live class page)
 * ---------------------------------------------------------------------------
 * Wires together the redesigned LiveSidebar (fixed, all controls) and the
 * material viewer for the TRAINER view.
 *
 * Error-free by construction:
 *   - no "./LiveIcons" import anywhere (all icons live inside LiveSidebar.tsx)
 *   - no "../lib/supabase" import (the client is created in the ADJUST-HERE
 *     block below - the ONLY section tied to your project specifics)
 *
 * What it does:
 *   - loads the course, its materials and the live participants
 *   - streams roster changes live (Supabase realtime; harmless if realtime
 *     is not enabled on the table)
 *   - Prev / Next material writes to live_session exactly like your old
 *     LiveControls.changePage did (upsert with onConflict "course_id")
 *   - "Allow to speak" / "Mute" update the participant row + local state
 *   - built-in material viewer (PDF with page anchor, video, audio, image)
 *     - swap in your own <LiveClassView /> at the marked spot if you prefer
 *
 * Open the page with  ?course=<courseId>  or pass courseId as a prop.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import LiveSidebar, { IconPeople } from "../components/LiveSidebar";
import type {
  PresentationInfo,
  SidebarMaterial,
  SidebarParticipant,
} from "../components/LiveSidebar";

/* ==========================================================================
 * ADJUST-HERE  -  the ONLY section tied to your project specifics.
 * Everything below this block works as-is.
 *
 * 1) SUPABASE CLIENT
 *    The client below is created from the standard Vite env names
 *    (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). If your .env uses other
 *    names, fix them here. Even better: if your project already has a
 *    supabase client file (e.g. src/supabaseClient.ts), delete the three
 *    const lines + the createClient import at the top and import yours:
 *        import { supabase } from "../supabaseClient";
 *
 *    NOTE: if VSCode ever says "Property 'env' does not exist on type
 *    'ImportMeta'", your project is missing src/vite-env.d.ts - add a file
 *    with one line:  /// <reference types="vite/client" />
 *
 * 2) TABLE / COLUMN NAMES - change any constant that differs in your DB.
 * ========================================================================== */

const supabaseUrl =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const supabaseKey =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  "";
const supabase = createClient(supabaseUrl, supabaseKey);

const COURSES_TABLE = "courses"; // course title lookup
const MATERIALS_TABLE = "materials"; // materials of the course
const PARTICIPANTS_TABLE = "live_participants"; // live roster (hands/speaking)

const PARTICIPANT_KEY_COLUMN = "id"; // "user_id" if your rows key on it
const COL_HAND_RAISED = "hand_raised";
const COL_IS_SPEAKING = "is_speaking";

/* ======================= end of ADJUST-HERE block ======================== */

/* ---------------------------------------------------------------- helpers */

function courseIdFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const p = new URLSearchParams(window.location.search);
  return p.get("course") ?? p.get("courseId") ?? p.get("course_id");
}

function uidOf(u: SidebarParticipant): string {
  return String(u.id ?? u.user_id ?? "");
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function timeAgo(d: any): string {
  if (!d) return "";
  const t = new Date(d).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/* ---------------------------------------------------------------- viewer -- */

type ViewerKind = "pdf" | "video" | "audio" | "image" | "other";

function fileExt(name: unknown): string {
  const s = String(name ?? "").toLowerCase();
  const i = s.lastIndexOf(".");
  return i >= 0 ? s.slice(i + 1) : "";
}

function detectKind(m: SidebarMaterial | undefined | null): ViewerKind {
  const ext = fileExt(m?.file_name ?? m?.title ?? m?.name);
  const mime = String(
    (m as any)?.mime_type ?? (m as any)?.file_type ?? (m as any)?.type ?? ""
  );
  const hay = `${ext} ${mime}`;
  if (hay.includes("pdf")) return "pdf";
  if (/(mp4|webm|mov|m4v|video)/.test(hay)) return "video";
  if (/(mp3|wav|ogg|m4a|audio)/.test(hay)) return "audio";
  if (/(png|jpe?g|gif|webp|svg|image)/.test(hay)) return "image";
  return "other";
}

/** Resolves the playable URL (http, data URI, or raw base64 file_data). */
function materialUrl(m: SidebarMaterial | undefined | null): string {
  if (!m) return "";
  const raw =
    ((m as any).file_data as string | undefined) ||
    ((m as any).fileUrl as string | undefined) ||
    ((m as any).file_url as string | undefined) ||
    "";
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/.test(raw)) return raw;
  const kind = detectKind(m);
  const mime =
    kind === "pdf"
      ? "application/pdf"
      : kind === "video"
        ? "video/mp4"
        : kind === "audio"
          ? "audio/mpeg"
          : "image/png";
  return `data:${mime};base64,${raw}`;
}

/**
 * Built-in material viewer (PDF with page anchor, video, audio, image,
 * graceful download fallback). Understands http(s) URLs, data: URIs and raw
 * base64 file_data - the same three states your LiveClassView handles.
 *
 * TO USE YOUR EXISTING LiveClassView INSTEAD: import it at the top of this
 * file and replace <MaterialPanel ... /> further down with e.g.
 *     <LiveClassView material={currentMaterial} currentPage={page} />
 * (adjust the prop names to what your component actually declares).
 */
function MaterialPanel({
  material,
  page,
}: {
  material: SidebarMaterial;
  page: number;
}) {
  const kind = detectKind(material);
  const url = materialUrl(material);
  const title =
    material.title || material.file_name || material.name || "Material";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-2.5">
        <span className="truncate text-sm font-semibold text-slate-700">{title}</span>
        {kind === "pdf" && (
          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            Page {page}
          </span>
        )}
      </div>

      {!url ? (
        <div className="flex h-[60vh] items-center justify-center text-sm text-slate-400">
          This material has no downloadable file.
        </div>
      ) : kind === "pdf" ? (
        <iframe
          key={`${String(material.id)}-${page}`}
          title={title}
          src={`${url}#page=${page}&zoom=page-width&view=FitH`}
          className="h-[70vh] w-full bg-slate-100"
        />
      ) : kind === "video" ? (
        <video
          key={String(material.id)}
          src={url}
          controls
          className="h-[70vh] w-full bg-black"
        />
      ) : kind === "audio" ? (
        <div className="flex h-[70vh] items-center justify-center px-6">
          <audio key={String(material.id)} src={url} controls className="w-full max-w-md" />
        </div>
      ) : kind === "image" ? (
        <div className="flex h-[70vh] items-center justify-center bg-slate-100 p-4">
          <img
            key={String(material.id)}
            src={url}
            alt={title}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <p className="text-sm text-slate-500">
            This file type cannot be previewed inline.
          </p>
          <a
            href={url}
            download
            className="rounded-lg bg-[#5b5fc7] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#464fab]"
          >
            Download file
          </a>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- component */

type Props = {
  /** Pass the course id directly; falls back to ?course=... in the URL. */
  courseId?: string;
  /** Pass the trainer id directly; falls back to the signed-in user. */
  trainerId?: string;
};

export default function TrainerLiveClassroom({
  courseId: courseIdProp,
  trainerId: trainerIdProp,
}: Props) {
  const courseId = courseIdProp ?? courseIdFromUrl();

  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [courseTitle, setCourseTitle] = useState<string>("");
  const [materials, setMaterials] = useState<SidebarMaterial[]>([]);
  const [participants, setParticipants] = useState<SidebarParticipant[]>([]);
  const [activeId, setActiveId] = useState<string | number | null>(null);
  const [page, setPage] = useState<number>(1);
  const [busy, setBusy] = useState<boolean>(false);

  const trainerId = trainerIdProp ?? authUserId;

  /* Sign-in (only needed when no trainerId prop was passed). */
  useEffect(() => {
    if (trainerIdProp) return;
    let cancelled = false;
    const run = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setAuthUserId(data.user?.id ?? null);
      } catch {
        /* ignore */
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [trainerIdProp]);

  /* Load course + materials + participants (+ restore last live position). */
  const loadAll = useCallback(async () => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [courseRes, materialsRes, participantsRes, sessionRes] =
        await Promise.all([
          supabase
            .from(COURSES_TABLE)
            .select("id, title, name")
            .eq("id", courseId)
            .maybeSingle(),
          // Tip: add .order("created_at", { ascending: true }) if you want
          // materials sorted by upload time and your table has that column.
          supabase.from(MATERIALS_TABLE).select("*").eq("course_id", courseId),
          supabase
            .from(PARTICIPANTS_TABLE)
            .select("*")
            .eq("course_id", courseId),
          supabase
            .from("live_session")
            .select("material_id, current_page")
            .eq("course_id", courseId)
            .maybeSingle(),
        ]);

      const firstError =
        courseRes.error ??
        materialsRes.error ??
        participantsRes.error ??
        sessionRes.error;
      if (firstError) {
        setError(
          `${firstError.message} - check the table names in the ADJUST-HERE block.`
        );
      } else {
        setError(null);
      }

      const course = courseRes.data as Record<string, unknown> | null;
      setCourseTitle(String(course?.title ?? course?.name ?? ""));

      const mats = (materialsRes.data ?? []) as unknown as SidebarMaterial[];
      setMaterials(mats);

      setParticipants(
        (participantsRes.data ?? []) as unknown as SidebarParticipant[]
      );

      const session = sessionRes.data as Record<string, unknown> | null;
      if (session?.material_id != null) {
        setActiveId(session.material_id as string | number);
        setPage(Number(session.current_page ?? 1) || 1);
      } else if (mats.length > 0) {
        setActiveId(mats[0].id);
        setPage(1);
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* Refresh only the roster (used by the realtime listener below). */
  const reloadRoster = useCallback(async () => {
    if (!courseId) return;
    try {
      const { data, error } = await supabase
        .from(PARTICIPANTS_TABLE)
        .select("*")
        .eq("course_id", courseId);
      if (!error) {
        setParticipants((data ?? []) as unknown as SidebarParticipant[]);
      }
    } catch {
      /* ignore */
    }
  }, [courseId]);

  /* Live roster updates (harmless if realtime is off for the table). */
  useEffect(() => {
    if (!courseId) return;
    const channel = supabase
      .channel(`trainer-live-${courseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: PARTICIPANTS_TABLE,
          filter: `course_id=eq.${courseId}`,
        },
        () => {
          void reloadRoster();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [courseId, reloadRoster]);

  /* ------------------------------------------------------------ derived -- */

  const currentIdx = useMemo(() => {
    if (materials.length === 0) return -1;
    const i = materials.findIndex((m) => String(m.id) === String(activeId));
    return i >= 0 ? i : 0;
  }, [materials, activeId]);

  const currentMaterial =
    currentIdx >= 0 && currentIdx < materials.length
      ? materials[currentIdx]
      : undefined;

  const presentation: PresentationInfo | null =
    materials.length > 0 && currentMaterial
      ? {
          title:
            currentMaterial.title ||
            currentMaterial.file_name ||
            currentMaterial.name ||
            `Material ${currentIdx + 1}`,
          position: currentIdx + 1,
          total: materials.length,
        }
      : null;

  /* ------------------------------------------------------------- actions -- */

  /** Prev / Next material - same live_session write as your old
   *  LiveControls.changePage (upsert, onConflict "course_id"). */
  const changePage = useCallback(
    async (dir: "next" | "prev") => {
      if (busy) return;
      if (!courseId || !trainerId || !currentMaterial) return;
      setBusy(true);
      try {
        const len = materials.length;
        const nextIdx =
          dir === "next"
            ? (currentIdx + 1) % len
            : (currentIdx - 1 + len) % len;
        const nextMaterial = materials[nextIdx];
        if (!nextMaterial) return;

        const { error: upsertErr } = await supabase
          .from("live_session")
          .upsert(
            {
              course_id: courseId,
              material_id: nextMaterial.id,
              trainer_id: trainerId,
              current_page: 1,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "course_id" }
          );
        if (upsertErr) throw upsertErr;

        setActiveId(nextMaterial.id);
        setPage(1);
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [busy, courseId, trainerId, currentMaterial, currentIdx, materials]
  );

  const allowAudio = useCallback(async (userId: string) => {
    setParticipants((ps) =>
      ps.map((p) =>
        uidOf(p) === String(userId)
          ? { ...p, isSpeaking: true, hand_raised: false }
          : p
      )
    );
    const { error: updErr } = await supabase
      .from(PARTICIPANTS_TABLE)
      .update({ [COL_IS_SPEAKING]: true, [COL_HAND_RAISED]: false })
      .eq(PARTICIPANT_KEY_COLUMN, userId);
    if (updErr) setError(`Allow to speak failed: ${updErr.message}`);
  }, []);

  const muteUser = useCallback(async (userId: string) => {
    setParticipants((ps) =>
      ps.map((p) =>
        uidOf(p) === String(userId) ? { ...p, isSpeaking: false } : p
      )
    );
    const { error: updErr } = await supabase
      .from(PARTICIPANTS_TABLE)
      .update({ [COL_IS_SPEAKING]: false })
      .eq(PARTICIPANT_KEY_COLUMN, userId);
    if (updErr) setError(`Mute failed: ${updErr.message}`);
  }, []);

  /* -------------------------------------------------------------- render -- */

  if (!courseId) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <p className="text-sm font-semibold text-slate-800">No course selected</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Open this page with ?course=&lt;courseId&gt; or pass courseId as a
            prop.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Fixed right sidebar: people, hands, presentation controls */}
      <LiveSidebar
        participants={participants}
        role="trainer"
        allowAudio={(userId) => allowAudio(String(userId))}
        muteUser={(userId) => muteUser(String(userId))}
        timeAgo={(d) => timeAgo(d)}
        presentation={presentation}
        onPrevPage={() => void changePage("prev")}
        onNextPage={() => void changePage("next")}
        busy={busy}
        currentUserId={trainerId}
      />

      <div className="lg:pr-[356px]">
        {/* Header */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5b5fc7]/10 text-[#5b5fc7]">
            <IconPeople size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">
              {courseTitle || "Live classroom"}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
              Live · {participants.length} participant
              {participants.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={() => window.history.back()}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Leave
          </button>
        </header>

        {error && (
          <div className="mx-4 mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 lg:mx-6">
            {error}
          </div>
        )}

        <main className="px-4 py-4 lg:px-6">
          {loading ? (
            <div className="flex h-[60vh] items-center justify-center text-sm text-slate-400">
              Loading classroom…
            </div>
          ) : !currentMaterial ? (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <IconPeople size={22} />
              </span>
              <p className="text-sm font-medium text-slate-600">No materials yet</p>
              <p className="text-xs leading-5 text-slate-400">
                Upload materials for this course and they will appear here.
              </p>
            </div>
          ) : (
            /* Swap in your own <LiveClassView ... /> here if you prefer
               (see the note above the MaterialPanel component). */
            <MaterialPanel material={currentMaterial} page={page} />
          )}
        </main>
      </div>
    </div>
  );
}
