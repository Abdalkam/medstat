/**
 * TrainerLiveClassroom.tsx  -  FULL REPLACEMENT (trainer live class page)
 * ---------------------------------------------------------------------------
 * Wires together the redesigned LiveSidebar (docked/overlay, all controls) and
 * the material viewer for the TRAINER view, against YOUR REAL SCHEMA.
 *
 * Single Supabase client:
 *   - the client is IMPORTED from "../../auth/supabase" - the same one your
 *     ClassChat uses. The previous self-contained version created its own
 *     client, which produced the "Multiple GoTrueClient instances detected"
 *     warning and could clobber the shared session (the sms_logs 401).
 *
 * Real tables (matching your original page's queries):
 *   - Materials:   course_materials, ordered by presentation_order,
 *                  scoped to the trainer's tenant (users.tenant_id)
 *   - Roster:      active_attendances -> users (username, role)
 *   - Hands:       raised_hands      (one row per raised hand)
 *   - Speaking:    allowed_speakers  (can_audio / can_video / allowed)
 *   - Position:    live_presentations (trainer's material + page; learners
 *                  follow it), with live_session kept in sync best-effort
 *
 * Actions (same DB effect as your original page):
 *   - "Allow to speak" = upsert allowed_speakers { can_audio: true,
 *     allowed: true } + delete the raised_hands row (grantPermission).
 *   - "Mute"           = can_audio:false / allowed:false; row deleted when
 *     the speaker has neither audio nor video.
 *   - Prev / Next      = update (or create) the course's live_presentations
 *     row with material_id + current_page 1, like your original changePage().
 *
 * Roster freshness: Supabase realtime on raised_hands / active_attendances /
 * allowed_speakers (harmless if realtime is off) PLUS a 10s polling fallback,
 * so the panel stays current even in "Polling mode".
 *
 * RESPONSIVE - fits any device screen size:
 *   - app-shell layout: fills the viewport (100dvh with h-screen fallback);
 *     nothing scrolls at page level - the viewer and sidebar scroll
 *     internally, so no double scrollbars on any device.
 *   - <768px (phones): the sidebar becomes a slide-over overlay with a
 *     backdrop; while it is closed a floating people button (bottom-right,
 *     clear of the app bar) reopens it, with a raised-hands badge. The app
 *     bar itself stays clean: course title and Leave only - no open/close
 *     icon button there.
 *   - >=768px (tablet / desktop): the sidebar docks on the right and stays
 *     open; the content column shifts with md:pr-[356px].
 *   - the viewer uses fluid flex heights instead of fixed vh, so PDFs,
 *     videos and images fit short landscape phones just as well as
 *     large desktop monitors.
 *
 * Open the page with  ?course=<courseId>  or pass courseId as a prop.
 * ---------------------------------------------------------------------------
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../auth/supabase";
import LiveSidebar, { IconPeople } from "../components/LiveSidebar";
import type {
  PresentationInfo,
  SidebarMaterial,
  SidebarParticipant,
} from "../components/LiveSidebar";

/* ==========================================================================
 * TABLE NAMES - taken from your live schema (the same tables your original
 * page queried). If you ever rename a table, change the constant here only.
 * The Supabase client itself is imported above from ../../auth/supabase so
 * the whole app shares ONE GoTrueClient / session store.
 * ========================================================================== */

const COURSES_TABLE = "courses"; // course title lookup
const USERS_TABLE = "users"; // id, username, email, role per attendee
const MATERIALS_TABLE = "course_materials"; // ordered by presentation_order
const PRESENTATIONS_TABLE = "live_presentations"; // trainer's live position
const SESSION_TABLE = "live_session"; // start/stop + position (best-effort)
const ATTENDANCE_TABLE = "active_attendances"; // who is in class right now
const HANDS_TABLE = "raised_hands"; // raised-hand queue
const SPEAKERS_TABLE = "allowed_speakers"; // can_audio / can_video / allowed

/* Roster polling fallback (ms) - realtime is used when available. */
const ROSTER_POLL_MS = 10_000;

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
    <section className="flex h-full min-h-[260px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Viewer title bar - never grows, always truncates on small screens */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-3 py-2 sm:px-4 sm:py-2.5">
        <span className="truncate text-sm font-semibold text-slate-700 sm:text-base">
          {title}
        </span>
        {kind === "pdf" && (
          <span className="ml-auto shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
            Page {page}
          </span>
        )}
      </div>

      {/* Viewer body - fills the remaining height fluidly on any screen */}
      {!url ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-slate-400">
          This material has no downloadable file.
        </div>
      ) : kind === "pdf" ? (
        <iframe
          key={`${String(material.id)}-${page}`}
          title={title}
          src={`${url}#page=${page}&zoom=page-width&view=FitH`}
          className="h-full w-full min-h-0 flex-1 bg-slate-100"
        />
      ) : kind === "video" ? (
        <video
          key={String(material.id)}
          src={url}
          controls
          playsInline
          className="h-full w-full min-h-0 flex-1 bg-black"
        />
      ) : kind === "audio" ? (
        <div className="flex flex-1 items-center justify-center px-4 sm:px-6">
          <audio
            key={String(material.id)}
            src={url}
            controls
            className="w-full max-w-md"
          />
        </div>
      ) : kind === "image" ? (
        <div className="flex flex-1 items-center justify-center overflow-hidden bg-slate-100 p-3 sm:p-4">
          <img
            key={String(material.id)}
            src={url}
            alt={title}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
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
  /* The course's live_presentations row id - Prev/Next update this row. */
  const [presRowId, setPresRowId] = useState<string | null>(null);
  /* Tenant scope (users.tenant_id of the signed-in trainer). */
  const tenantRef = useRef<string | null>(null);

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

  /* Rebuild the roster from the real tables: who is in class
     (active_attendances) x users (names/roles) x raised_hands x
     allowed_speakers (speaking state). Used on mount, by realtime events
     and by the polling fallback. */
  const reloadRoster = useCallback(async () => {
    if (!courseId) return;
    try {
      const [attsRes, handsRes, speakersRes] = await Promise.all([
        supabase
          .from(ATTENDANCE_TABLE)
          .select("user_id")
          .eq("course_id", courseId),
        supabase
          .from(HANDS_TABLE)
          .select("user_id")
          .eq("course_id", courseId),
        supabase
          .from(SPEAKERS_TABLE)
          .select("user_id, can_audio, can_video, allowed")
          .eq("course_id", courseId),
      ]);
      if (attsRes.error || handsRes.error || speakersRes.error) return;

      const ids = Array.from(
        new Set(
          ((attsRes.data ?? []) as Array<Record<string, unknown>>)
            .map((r) => String(r.user_id ?? ""))
            .filter(Boolean)
        )
      );

      let userRows: Array<Record<string, unknown>> = [];
      if (ids.length > 0) {
        const { data } = await supabase
          .from(USERS_TABLE)
          .select("id, username, email, role")
          .in("id", ids);
        userRows = (data ?? []) as Array<Record<string, unknown>>;
      }

      const handSet = new Set(
        ((handsRes.data ?? []) as Array<Record<string, unknown>>).map(
          (r) => String(r.user_id ?? "")
        )
      );
      const speakerOn = new Map<string, boolean>();
      ((speakersRes.data ?? []) as Array<Record<string, unknown>>).forEach(
        (s) => {
          const uid = String(s.user_id ?? "");
          if (!uid) return;
          speakerOn.set(uid, Boolean(s.can_audio ?? s.allowed ?? false));
        }
      );

      setParticipants(
        userRows.map((u) => {
          const id = String(u.id ?? "");
          return {
            id,
            name: String(u.username ?? u.email ?? ""),
            email: String(u.email ?? ""),
            role: String(u.role ?? ""),
            handRaised: handSet.has(id),
            isSpeaking: speakerOn.get(id) ?? false,
          };
        })
      );
    } catch {
      /* ignore */
    }
  }, [courseId]);

  /* Resolve the signed-in trainer's tenant scope (users.tenant_id). */
  const resolveTenant = useCallback(async (): Promise<string | null> => {
    if (tenantRef.current) return tenantRef.current;
    let uid = trainerId;
    if (!uid) {
      try {
        const { data } = await supabase.auth.getUser();
        uid = data.user?.id ?? null;
        if (uid && !trainerIdProp) setAuthUserId(uid);
      } catch {
        /* ignore */
      }
    }
    if (!uid) return null;
    try {
      const { data } = await supabase
        .from(USERS_TABLE)
        .select("tenant_id")
        .eq("id", uid)
        .maybeSingle();
      const t = (data as Record<string, unknown> | null)?.tenant_id;
      if (typeof t === "string" && t) {
        tenantRef.current = t;
        return t;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [trainerId, trainerIdProp]);

  /* Load course + materials + presentation state (+ restore last position). */
  const loadAll = useCallback(async () => {
    if (!courseId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const tenant = await resolveTenant();

      let matsQuery = supabase
        .from(MATERIALS_TABLE)
        .select("*")
        .eq("course_id", courseId);
      if (tenant) matsQuery = matsQuery.eq("tenant_id", tenant);

      const [courseRes, materialsRes, presRes, sessionRes] = await Promise.all([
        supabase
          .from(COURSES_TABLE)
          .select("id, title, name")
          .eq("id", courseId)
          .maybeSingle(),
        matsQuery.order("presentation_order", { ascending: true }),
        supabase
          .from(PRESENTATIONS_TABLE)
          .select("id, material_id, current_page")
          .eq("course_id", courseId)
          .maybeSingle(),
        supabase
          .from(SESSION_TABLE)
          .select("id, material_id, current_page")
          .eq("course_id", courseId)
          .maybeSingle(),
      ]);

      const firstError =
        courseRes.error ??
        materialsRes.error ??
        presRes.error ??
        sessionRes.error;
      if (firstError) {
        setError(firstError.message);
      } else {
        setError(null);
      }

      const course = courseRes.data as Record<string, unknown> | null;
      setCourseTitle(String(course?.title ?? course?.name ?? ""));

      const mats = (materialsRes.data ?? []) as unknown as SidebarMaterial[];
      setMaterials(mats);

      const pres = presRes.data as Record<string, unknown> | null;
      setPresRowId(pres?.id != null ? String(pres.id) : null);

      const session = sessionRes.data as Record<string, unknown> | null;
      const restoreId =
        (pres?.material_id as string | number | undefined) ??
        (session?.material_id as string | number | undefined);
      if (restoreId != null) {
        setActiveId(restoreId);
        setPage(Number(pres?.current_page ?? session?.current_page ?? 1) || 1);
      } else if (mats.length > 0) {
        setActiveId(mats[0].id);
        setPage(1);
      }

      await reloadRoster();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setLoading(false);
    }
  }, [courseId, resolveTenant, reloadRoster]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  /* Live roster updates: realtime on the three roster tables (harmless if
     realtime is off) PLUS a polling fallback so the panel stays fresh even
     when the socket is down ("Polling mode"). */
  useEffect(() => {
    if (!courseId) return;
    const channel = supabase
      .channel(`trainer-live-${courseId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: HANDS_TABLE,
          filter: `course_id=eq.${courseId}`,
        },
        () => {
          void reloadRoster();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: ATTENDANCE_TABLE,
          filter: `course_id=eq.${courseId}`,
        },
        () => {
          void reloadRoster();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: SPEAKERS_TABLE,
          filter: `course_id=eq.${courseId}`,
        },
        () => {
          void reloadRoster();
        }
      )
      .subscribe();

    const timer = window.setInterval(() => void reloadRoster(), ROSTER_POLL_MS);
    return () => {
      void supabase.removeChannel(channel);
      window.clearInterval(timer);
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

  /** Prev / Next material - mirrors your original changePage(): update (or
   *  create) the course's live_presentations row (what learners follow) and
   *  keep live_session aligned best-effort. */
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

        const stamp = new Date().toISOString();

        /* live_presentations: the row learners follow. */
        if (presRowId) {
          const { error: updErr } = await supabase
            .from(PRESENTATIONS_TABLE)
            .update({
              material_id: nextMaterial.id,
              current_page: 1,
              updated_at: stamp,
            })
            .eq("id", presRowId);
          if (updErr) throw updErr;
        } else {
          const row: Record<string, unknown> = {
            id: crypto.randomUUID(),
            course_id: courseId,
            started_by: trainerId,
            material_id: nextMaterial.id,
            current_page: 1,
            is_blackboard: false,
            updated_at: stamp,
          };
          if (tenantRef.current) row.tenant_id = tenantRef.current;
          const { error: insErr } = await supabase
            .from(PRESENTATIONS_TABLE)
            .insert(row);
          if (insErr) throw insErr;
          const { data: fresh } = await supabase
            .from(PRESENTATIONS_TABLE)
            .select("id")
            .eq("course_id", courseId)
            .maybeSingle();
          const freshId = (fresh as Record<string, unknown> | null)?.id;
          setPresRowId(freshId != null ? String(freshId) : null);
        }

        /* live_session: keep aligned, best-effort - never blocks the class. */
        try {
          const { data: sess } = await supabase
            .from(SESSION_TABLE)
            .select("id")
            .eq("course_id", courseId)
            .maybeSingle();
          const sessId = (sess as Record<string, unknown> | null)?.id;
          if (sessId != null) {
            await supabase
              .from(SESSION_TABLE)
              .update({
                material_id: nextMaterial.id,
                current_page: 1,
                updated_at: stamp,
              })
              .eq("id", String(sessId));
          } else {
            const row: Record<string, unknown> = {
              id: crypto.randomUUID(),
              course_id: courseId,
              trainer_id: trainerId,
              material_id: nextMaterial.id,
              current_page: 1,
              active: true,
              started_at: stamp,
              updated_at: stamp,
              created_at: stamp,
            };
            if (tenantRef.current) row.tenant_id = tenantRef.current;
            await supabase.from(SESSION_TABLE).insert(row);
          }
        } catch {
          /* session drift must not break the presentation change */
        }

        setActiveId(nextMaterial.id);
        setPage(1);
      } catch (e) {
        setError(errMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [
      busy,
      courseId,
      trainerId,
      currentMaterial,
      currentIdx,
      materials,
      presRowId,
    ]
  );

  /** "Allow to speak" - grant audio in allowed_speakers and clear the raised
   *  hand, exactly like the original grantPermission(userId, "audio"). */
  const allowAudio = useCallback(
    async (userId: string) => {
      setParticipants((ps) =>
        ps.map((p) =>
          uidOf(p) === String(userId)
            ? { ...p, isSpeaking: true, handRaised: false, hand_raised: false }
            : p
        )
      );
      try {
        const { data: existing } = await supabase
          .from(SPEAKERS_TABLE)
          .select("can_audio, can_video")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .maybeSingle();
        const canVideo = Boolean(
          (existing as Record<string, unknown> | null)?.can_video ?? false
        );
        const row: Record<string, unknown> = {
          user_id: userId,
          course_id: courseId,
          allowed: true,
          can_audio: true,
          can_video: canVideo,
        };
        if (tenantRef.current) row.tenant_id = tenantRef.current;
        const { error: upErr } = await supabase
          .from(SPEAKERS_TABLE)
          .upsert(row, { onConflict: "user_id" });
        if (upErr) throw upErr;
        await supabase
          .from(HANDS_TABLE)
          .delete()
          .eq("user_id", userId)
          .eq("course_id", courseId);
        void reloadRoster();
      } catch (e) {
        setError(`Allow to speak failed: ${errMessage(e)}`);
      }
    },
    [courseId, reloadRoster]
  );

  /** "Mute" - revoke audio; the allowed_speakers row is deleted when the
   *  speaker has neither audio nor video (same rule as the original page). */
  const muteUser = useCallback(
    async (userId: string) => {
      setParticipants((ps) =>
        ps.map((p) =>
          uidOf(p) === String(userId) ? { ...p, isSpeaking: false } : p
        )
      );
      try {
        const { data: existing } = await supabase
          .from(SPEAKERS_TABLE)
          .select("can_audio, can_video")
          .eq("user_id", userId)
          .eq("course_id", courseId)
          .maybeSingle();
        const prev = (existing ?? {}) as Record<string, unknown>;
        const canVideo = Boolean(prev.can_video ?? false);
        if (!canVideo) {
          await supabase
            .from(SPEAKERS_TABLE)
            .delete()
            .eq("user_id", userId)
            .eq("course_id", courseId);
        } else {
          await supabase
            .from(SPEAKERS_TABLE)
            .update({ can_audio: false, can_video: true, allowed: false })
            .eq("user_id", userId)
            .eq("course_id", courseId);
        }
        void reloadRoster();
      } catch (e) {
        setError(`Mute failed: ${errMessage(e)}`);
      }
    },
    [courseId, reloadRoster]
  );

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
    /* App shell - fills the viewport on every device. 100dvh tracks the
       mobile browser's collapsing address bar; browsers without dvh support
       fall back to the h-screen class. Nothing scrolls at page level. */
    <div
      className="flex h-screen flex-col overflow-hidden bg-slate-50"
      style={{ height: "100dvh" }}
    >
      {/* Right panel: docked on md+, slide-over overlay with backdrop below md.
          The app bar has no open/close button - when the panel is closed on a
          phone, LiveSidebar shows its own floating reopen button instead. */}
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

      {/* Content column: clears the docked panel on tablet/desktop */}
      <div className="flex min-h-0 flex-1 flex-col md:pr-[356px]">
        {/* Header - course title + Leave only, no open/close icon button */}
        <header className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2.5 backdrop-blur sm:gap-3 sm:px-4 sm:py-3 lg:px-6">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#5b5fc7]/10 text-[#5b5fc7]">
            <IconPeople size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800 sm:text-base">
              {courseTitle || "Live classroom"}
            </p>
            <p className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
              Live · {participants.length} participant
              {participants.length === 1 ? "" : "s"}
            </p>
          </div>
          <button
            onClick={() => window.history.back()}
            className="shrink-0 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
          >
            Leave
          </button>
        </header>

        {error && (
          <div className="mx-3 mt-3 shrink-0 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 sm:mx-4 sm:px-4 sm:py-3 sm:text-sm lg:mx-6">
            {error}
          </div>
        )}

        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6">
          {loading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
              Loading classroom…
            </div>
          ) : !currentMaterial ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
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
