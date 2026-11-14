// src/trainer/TrainerLiveClassroom.tsx
// TRAINER live classroom: session control, blackboard with drawing tools,
// uploaded-material (lesson pages) controls, per-learner mic/cam permissions,
// raised hands, and the trainer's own AV bar.
import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, User, BusinessSettings, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard, { type ToolType, type FontOptions } from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import MediaHelpModal, { type MediaProblem } from "../components/MediaHelpModal";
import { probeDevice } from "../utils/mediaPermissions";
import { useDaily, useDailyEvent, DailyAudio } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getCourseMaterials } from "../database/materialDB";
import { startLiveSession, endLiveSession, getLiveSession } from "../database/liveSessionDB";
import { startPresentation, getLivePresentation, updatePresentation, clearPresentation } from "../database/livePresentationDB";

const C = { textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", red: "#FF3B30", redBg: "#FFEFEE", purple: "#AF52DE", purpleBg: "#F5F0FF", orange: "#FF9F0A", orangeBg: "#FFF6EB", green: "#34C759", greenBg: "#EAF9EE", iosBtnBg: "#E5E5EA", panelBg: "#F8F9FA" };

// Daily room URLs resolved from Supabase (see getDailyRoomUrl). Kept per
// page load so a URL updated in the DB is picked up on the next reload.
const dailyRoomCache = new Map<string, string>();
let dailyRoomWarned = false;

function getFileMeta(fileType: string) {
  if (fileType.includes("pdf")) return { icon: "📄", color: C.red, bg: C.redBg, label: "PDF" };
  if (fileType.includes("video")) return { icon: "🎬", color: C.purple, bg: C.purpleBg, label: "Video" };
  if (fileType.includes("audio")) return { icon: "🎵", color: C.purple, bg: C.purpleBg, label: "Audio" };
  if (fileType.includes("image")) return { icon: "🖼️", color: C.green, bg: C.greenBg, label: "Image" };
  return { icon: "📁", color: C.textTertiary, bg: C.bg, label: "File" };
}

/* Render only image sources that cannot 404: data URLs, absolute/protocol-
   relative/blob URLs, app-absolute paths. Bare filenames ("loadlogo.png")
   resolve against the app origin and break — drop them so the fallback
   monogram renders instead. */
function normalizeImageSrc(value?: string | null): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("data:")) return raw;
  const compact = raw.replace(/\s+/g, "");
  if (compact.length > 100 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    return `data:image/png;base64,${compact}`;
  }
  if (/^(https?:\/\/|\/\/|blob:)/i.test(raw) || raw.startsWith("/")) return raw;
  return "";
}

declare global { interface Window { activeTrainerCourse: string | undefined; } }
window.activeTrainerCourse = window.activeTrainerCourse || undefined;

function mapMaterial(m: Record<string, unknown>): CourseMaterial {
  return { id: m.id as string, courseId: m.course_id as string, tenantId: m.tenant_id as string, title: (m.title as string) || "Untitled", description: (m.description as string) || "", fileUrl: (m.file_data as string) || (m.file_url as string) || "", fileName: (m.file_name as string) || (m.title as string) || "Untitled", fileType: (m.file_type as string) || "application/octet-stream", allowDownload: (m.allow_download as boolean) ?? true, uploadedBy: (m.uploaded_by as string) || "", uploadedAt: (m.uploaded_at as string) || (m.created_at as string) || "", isPresentation: (m.is_presentation as boolean) ?? false, presentationOrder: (m.presentation_order as number) ?? 0 };
}

/* Static blackboard font settings (no UI to change them yet). */
const FONT_OPTIONS: FontOptions = {
  fontFamily: "Arial",
  fontSize: 24,
  fontColor: "#FFFFFF",
  fontWeight: "normal",
  fontStyle: "normal",
};

/* Quick pen palette for the blackboard, shown in the sidebar "Blackboard
   Tools" card. White first — the board surface is dark. */
const PEN_COLORS: string[] = ["#FFFFFF", "#FFD60A", "#FF3B30", "#FF9F0A", "#34C759", "#00A5F4", "#AF52DE", "#1C1C1E"];

/* ---- re-render guards ------------------------------------------------------ */
/* fetchLiveData() runs every 5s and on every realtime event. These helpers let
   it skip React state updates when the fetched data is identical to what is
   already on screen: replacing state with a fresh-but-equal object used to
   re-render the whole classroom several times a minute, which re-ran inline
   ref callbacks and made the camera tile blink. */

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sameLivePresentation(a: LivePresentation | null, b: LivePresentation | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.materialId === b.materialId &&
    a.isBlackboard === b.isBlackboard &&
    a.currentPage === b.currentPage &&
    sameJson(a.blackboardStrokes, b.blackboardStrokes) &&
    sameJson(a.blackboardLines, b.blackboardLines) &&
    sameJson(a.blackboardLabels, b.blackboardLabels)
  );
}

/* Course materials can carry large inline base64 payloads (file_data), so
   compare a cheap signature instead of deep-equality. */
function sameMaterial(a: CourseMaterial | null, b: CourseMaterial | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.fileType === b.fileType &&
    a.isPresentation === b.isPresentation &&
    a.presentationOrder === b.presentationOrder &&
    (a.fileUrl?.length ?? 0) === (b.fileUrl?.length ?? 0)
  );
}

function sameMaterials(a: CourseMaterial[], b: CourseMaterial[]): boolean {
  return a.length === b.length && a.every((m, i) => sameMaterial(m, b[i]));
}

export default function TrainerLiveClassroom() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  /* Read once per mount and parse defensively — JSON.parse on every render
     was wasteful, and a corrupted localStorage value could throw. */
  const currentUser = useMemo(() => {
    try {
      const raw = localStorage.getItem("currentUser");
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }, []);
  const tenantId = currentUser.tenantId;

  const [sessionActive, setSessionActive] = useState(false);
  const [presentation, setPresentation] = useState<CourseMaterial | null>(null);
  const [liveState, setLiveState] = useState<LivePresentation | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [raisedHands, setRaisedHands] = useState<Array<Record<string, unknown> & { username?: string }>>([]);
  const [activeLearners, setActiveLearners] = useState<User[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [trainer, setTrainer] = useState<Record<string, unknown> | null>(null);
  const [speakerPerms, setSpeakerPerms] = useState<Record<string, { can_audio: boolean; can_video: boolean }>>({});

  const [isBlackboardMode, setIsBlackboardMode] = useState(false);
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);

  const [bbInput, setBbInput] = useState("");
  const [activeTool, setActiveTool] = useState<ToolType | "label">("pen");
  const [penColor, setPenColor] = useState("#FFFFFF");
  const [penWidth, setPenWidth] = useState(4);
  const [eraserSize, setEraserSize] = useState(30);

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const daily = useDaily();
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVoiceJoined, setIsVoiceJoined] = useState(false);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);

  const [mediaProblem, setMediaProblem] = useState<MediaProblem | null>(null);

  /* Responsive layout: ≤760px is "phone" — the side panels become overlay
     drawers so the classroom canvas keeps its full width on any device. */
  const [isMobile, setIsMobile] = useState<boolean>(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches
  );

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 760);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  /* Panel defaults per device class — drawers closed on phones. */
  useEffect(() => {
    setIsLeftCollapsed(isMobile);
    setIsChatOpen(!isMobile);
  }, [isMobile]);

  useDailyEvent("track-started", (event) => { if (event.participant?.local && event.track?.kind === "video") setVideoTrack(event.track as unknown as MediaStreamTrack); });
  useDailyEvent("track-stopped", (event) => { if (event.participant?.local && event.track?.kind === "video") setVideoTrack(null); });

  /* Self-view tile: attach the camera stream once per track. Do NOT build the
     MediaStream inside an inline ref callback — inline refs re-run on every
     re-render, and re-assigning srcObject restarts the video element. That is
     what made the tile blink on every poll / blackboard stroke. */
  const selfViewRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = selfViewRef.current;
    if (!el) return;
    if (videoTrack) {
      el.srcObject = new MediaStream([videoTrack]);
      el.play().catch(() => {});
    }
    return () => { el.srcObject = null; };
  }, [videoTrack, isCamOn]);

  useEffect(() => {
    const fetchInitial = async () => {
      if (!tenantId) return;
      const { data: s } = await supabase.from("business_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (s) setSettings({ id: s.id, businessName: s.business_name || "", address: s.address || "", phone: s.phone || "", email: s.email || "", website: s.website || "", logo: s.logo || "", header: s.header || "", adminProfile: s.admin_profile || "", loginBackground: s.login_background || "", themeColor: s.theme_color || "", appBarItems: s.app_bar_items || [], tenantId: s.tenant_id, createdAt: s.created_at });
      const { data: u } = await supabase.from("profile_settings").select("*").eq("user_id", currentUser.id).maybeSingle();
      if (u) setTrainer(u); else setTrainer(currentUser);
    };
    fetchInitial();
  }, [currentUser.id, tenantId]);

  useEffect(() => {
    if (window.activeTrainerCourse && window.activeTrainerCourse !== courseId) { console.warn("You can only host one live lesson at a time."); navigate("/trainer"); return; }
    window.activeTrainerCourse = courseId;
    return () => { window.activeTrainerCourse = undefined; };
  }, [courseId, navigate]);

  const fetchLiveData = useCallback(async () => {
    if (!courseId || !tenantId || !currentUser.id) return;

    const localSess = await getLiveSession(courseId);
    if (localSess) setSessionActive(localSess.active);

    const localPres = await getLivePresentation(courseId);
    if (localPres) {
      setLiveState((prev) => (sameLivePresentation(prev, localPres) ? prev : localPres));
      setIsBlackboardMode(localPres.isBlackboard ?? false);
      if (localPres.materialId) {
        const localMat = await db.materials.get(localPres.materialId);
        if (localMat) setPresentation((prev) => (sameMaterial(prev, localMat) ? prev : localMat));
      }
    }

    const localMats = await getCourseMaterials(courseId);
    if (localMats.length > 0) {
      const sorted = [...localMats].sort((a, b) => (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0));
      setMaterials((prev) => (sameMaterials(prev, sorted) ? prev : sorted));
    }

    try {
      const { data: liveSess, error: liveSessErr } = await supabase.from("live_session").select("*").eq("course_id", courseId).maybeSingle();
      if (liveSessErr) console.error("[live] live_session fetch failed:", liveSessErr.message);
      if (liveSess) {
        setSessionActive(liveSess.active);
        await db.liveSessions.put({ id: liveSess.id, courseId, active: liveSess.active, trainerId: liveSess.trainer_id, startedAt: liveSess.started_at, updatedAt: liveSess.updated_at, createdAt: liveSess.created_at, tenantId: liveSess.tenant_id });
      }

      const { data: livePres, error: livePresErr } = await supabase.from("live_presentations").select("*").eq("course_id", courseId).maybeSingle();
      if (livePresErr) console.error("[live] live_presentations fetch failed:", livePresErr.message);
      if (livePres) {
        const mappedPres = { id: livePres.id, courseId: livePres.course_id, materialId: livePres.material_id || "", isBlackboard: livePres.is_blackboard ?? false, blackboardStrokes: (livePres.blackboard_strokes as Stroke[]) || [], blackboardLines: (livePres.blackboard_lines as string[]) || [], blackboardLabels: (livePres.blackboard_labels as any[]) || [], startedBy: livePres.started_by, updatedAt: livePres.updated_at, currentPage: livePres.current_page ?? 1, tenantId: livePres.tenant_id };
        setLiveState((prev) => (sameLivePresentation(prev, mappedPres) ? prev : mappedPres));
        setIsBlackboardMode(mappedPres.isBlackboard);
        await updatePresentation(mappedPres);

        if (mappedPres.materialId) {
          const { data: mat, error: matErr } = await supabase.from("course_materials").select("*").eq("id", mappedPres.materialId).maybeSingle();
          if (matErr) console.error("[live] presentation material fetch failed:", matErr.message);
          if (mat) {
            const mappedMat = mapMaterial(mat);
            setPresentation((prev) => (sameMaterial(prev, mappedMat) ? prev : mappedMat));
            await db.materials.put(mappedMat);
          }
        } else setPresentation(null);
      } else if (!localPres) {
        // Cloud has no live_presentations row (offline, RLS, or a failed
        // insert). Only clear the screen when there is no local Dexie copy
        // either; otherwise keep showing it.
        setLiveState(null);
        setIsBlackboardMode(false);
        setPresentation(null);
      }

      const { data: mats, error: matsErr } = await supabase.from("course_materials").select("*").eq("course_id", courseId).eq("tenant_id", tenantId).order("presentation_order", { ascending: true });
      if (matsErr) console.error("[live] course_materials fetch failed:", matsErr.message);
      if (mats && mats.length > 0) {
        const mappedMats = mats.map(mapMaterial);
        setMaterials((prev) => (sameMaterials(prev, mappedMats) ? prev : mappedMats));
        await db.materials.bulkPut(mappedMats);
      }

      const { data: hands } = await supabase.from("raised_hands").select("*").eq("course_id", courseId);
      if (hands && hands.length > 0) {
        const userIds = hands.map((h: any) => h.user_id as string);
        const { data: handUsers } = await supabase.from("users").select("id, username").in("id", userIds);
        const userMap = new Map((handUsers || []).map((u: any) => [u.id as string, u.username as string]));
        const mappedHands = hands
          .filter((h: any) => userMap.has(h.user_id as string))
          .map((h: any) => ({ ...h, username: userMap.get(h.user_id as string)! }))
          .sort((a: any, b: any) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());
        setRaisedHands((prev) => (sameJson(prev, mappedHands) ? prev : mappedHands));
      } else setRaisedHands((prev) => (prev.length === 0 ? prev : []));

      const { data: atts } = await supabase.from("active_attendances").select("user_id").eq("course_id", courseId);
      if (atts && atts.length > 0) {
        const attUserIds = atts.map((a: Record<string, unknown>) => a.user_id as string).filter((id: string) => id !== currentUser.id);
        const { data: attUsers } = await supabase.from("users").select("*").in("id", attUserIds).eq("role", "trainee");
        const mappedAtt = attUsers ? attUsers.map((u: Record<string, unknown>) => ({ id: u.id as string, username: u.username as string, email: (u.email as string) || "", password: (u.password as string) || "", role: (u.role as "trainer" | "trainee" | "admin"), profilePic: (u.profile_pic as string) || "", phone: (u.phone as string) || "", assignedCourses: (u.assigned_courses as string[]) || [], tenantId: u.tenant_id as string, createdAt: u.created_at as string })) : [];
        setActiveLearners((prev) => (sameJson(prev, mappedAtt) ? prev : mappedAtt));
      } else setActiveLearners((prev) => (prev.length === 0 ? prev : []));

      const { data: speakers } = await supabase.from("allowed_speakers").select("user_id, can_audio, can_video, allowed").eq("course_id", courseId);
      const permsMap: Record<string, { can_audio: boolean; can_video: boolean }> = {};
      (speakers || []).forEach((s: Record<string, unknown>) => {
        permsMap[s.user_id as string] = { can_audio: (s.can_audio as boolean) ?? (s.allowed as boolean) ?? false, can_video: (s.can_video as boolean) ?? false };
      });
      setSpeakerPerms((prev) => (sameJson(prev, permsMap) ? prev : permsMap));
    } catch (err) { console.warn("Offline: Using local data for classroom"); }
  }, [courseId, tenantId, currentUser.id]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (!courseId) return;
    // disposed marks an intentional teardown (StrictMode double-mount in dev,
    // or leaving the classroom). The CLOSED status that fires right after our
    // own removeChannel() is expected — not a network failure — so we don't
    // log it as one.
    let disposed = false;
    const handleDebouncedFetch = () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); fetchTimerRef.current = setTimeout(() => fetchLiveData(), 300); };
    const channel = supabase.channel(`live-classroom-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_session", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presentations", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "course_materials", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "raised_hands", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_attendances", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "allowed_speakers", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") { console.log("[Trainer] Realtime connected"); fetchLiveData(); }
        else if (!disposed && (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")) console.warn(`[Trainer] Realtime ${status} — using polling fallback`);
      });
    // Polling fallback — raised hands, attendance and learner joins still
    // arrive even if the realtime socket drops or the classroom tables are
    // not yet in the supabase_realtime publication. Mirrors the trainee side.
    const pollTimer = window.setInterval(() => { if (document.visibilityState === "visible") fetchLiveData(); }, 5000);
    const onVisible = () => { if (document.visibilityState === "visible") fetchLiveData(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => { disposed = true; window.clearInterval(pollTimer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("focus", onVisible); supabase.removeChannel(channel); if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [courseId, fetchLiveData]);

  // Daily room resolution without the legacy Render backend (the Render
  // service is being phased out and its domain no longer resolves).
  // Priority: per-course URL stored in Supabase (courses.daily_room_url),
  // then a global VITE_DAILY_ROOM_URL fallback from .env. Mirrors the
  // trainee side exactly so both ends always land in the same room.
  async function getDailyRoomUrl() {
    if (!courseId) return null;
    const cached = dailyRoomCache.get(courseId);
    if (cached) return cached;
    try {
      const { data } = await supabase.from("courses").select("daily_room_url").eq("id", courseId).maybeSingle();
      const url = ((data as any)?.daily_room_url as string) || "";
      if (url) { dailyRoomCache.set(courseId, url); return url; }
    } catch {}
    const envUrl = (import.meta.env as any).VITE_DAILY_ROOM_URL || "";
    if (envUrl) return envUrl;
    if (!dailyRoomWarned) {
      dailyRoomWarned = true;
      console.warn("[Trainer] No Daily room configured for this course — set courses.daily_room_url (SQL) or VITE_DAILY_ROOM_URL (.env). Voice/video stay off; slides still work.");
    }
    return null;
  }

  async function ensureJoined(): Promise<boolean> {
    if (!daily) return false;
    if (isVoiceJoined) return true;
    let roomUrl: string | null = null; // declared here so the catch block can log it
    try {
      setIsConnecting(true);
      roomUrl = await getDailyRoomUrl();
      if (!roomUrl) return false;
      await daily.join({ url: roomUrl, startVideoOff: true });
      await daily.setLocalAudio(false);
      await daily.setLocalVideo(false);
      setIsVoiceJoined(true);
      return true;
    } catch (e) { console.warn("[Trainer] Daily join failed — check the room exists in your Daily dashboard:", roomUrl, e); return false; }
    finally { setIsConnecting(false); }
  }

  async function toggleMic() {
    const ok = await ensureJoined();
    if (!ok) return;
    if (!isMicOn) {
      const probe = await probeDevice("audio");
      if (probe !== "ok") { setMediaProblem({ kind: probe, device: "mic" }); return; }
    }
    try { const n = !isMicOn; await daily!.setLocalAudio(n); setIsMicOn(n); } catch (e) {}
  }

  async function toggleCam() {
    const ok = await ensureJoined();
    if (!ok) return;
    if (!isCamOn) {
      const probe = await probeDevice("video");
      if (probe !== "ok") { setMediaProblem({ kind: probe, device: "cam" }); return; }
    }
    try { const n = !isCamOn; await daily!.setLocalVideo(n); setIsCamOn(n); } catch (e) {}
  }

  /* Create a fresh live_presentations row for this course (any previous row is
     replaced). Shared by toggleBlackboard / startSession / selectPage, which
     each used to hand-roll the same payload. */
  async function createLivePresentationRow(materialId: string, isBlackboard: boolean) {
    if (!courseId || !tenantId) return;
    await startPresentation(courseId, materialId, currentUser.id);
    await supabase.from("live_presentations").delete().eq("course_id", courseId);
    await supabase.from("live_presentations").insert({
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      course_id: courseId,
      started_by: currentUser.id,
      material_id: materialId,
      current_page: 1,
      is_blackboard: isBlackboard,
      blackboard_strokes: [],
      blackboard_lines: [],
      blackboard_labels: [],
      updated_at: new Date().toISOString(),
    });
  }

  async function toggleBlackboard() {
    if (!courseId || !tenantId) return; setActiveTool("pen"); const newMode = !isBlackboardMode; setIsBlackboardMode(newMode);
    if (newMode) setPresentation(null); else if (materials.length > 0) { const currentMatId = liveState?.materialId || materials[0].id; setPresentation(materials.find(m => m.id === currentMatId) || materials[0]); }
    if (liveState?.id) {
      const updated = { ...liveState, isBlackboard: newMode, updatedAt: new Date().toISOString() };
      setLiveState(updated);
      await updatePresentation(updated);
      await supabase.from("live_presentations").update({ is_blackboard: newMode, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      await createLivePresentationRow("", newMode);
      fetchLiveData();
    }
  }

  async function handleStrokeEnd(points: { x: number; y: number }[], tool: ToolType, color?: string, width?: number) {
    if (!liveState?.id) return; const newStroke = { id: crypto.randomUUID(), points, color: color || "#FFFFFF", width: width || 4, tool: tool || "pen" };
    setLiveState(prev => { if (!prev) return prev; const updatedStrokes = [...(prev.blackboardStrokes || []), newStroke]; const updatedPres = { ...prev, blackboardStrokes: updatedStrokes }; updatePresentation(updatedPres); supabase.from("live_presentations").update({ blackboard_strokes: updatedStrokes }).eq("id", prev.id).then(() => {}); return updatedPres; });
  }

  async function handleErase(eraserPos: { x: number; y: number }, radius: number) {
    if (!liveState?.id) return; const currentStrokes = liveState.blackboardStrokes || []; const newStrokes: Stroke[] = [];
    for (const stroke of currentStrokes) { const segments: { x: number; y: number }[][] = []; let currentSegment: { x: number; y: number }[] = []; for (const p of stroke.points) { if (Math.hypot(p.x - eraserPos.x, p.y - eraserPos.y) < radius) { if (currentSegment.length > 0) { segments.push(currentSegment); currentSegment = []; } } else currentSegment.push(p); } if (currentSegment.length > 0) segments.push(currentSegment); for (const seg of segments) newStrokes.push({ id: crypto.randomUUID(), points: seg, color: stroke.color, width: stroke.width, tool: stroke.tool }); }
    setLiveState(prev => { if (!prev) return prev; const updatedPres = { ...prev, blackboardStrokes: newStrokes }; updatePresentation(updatedPres); supabase.from("live_presentations").update({ blackboard_strokes: newStrokes }).eq("id", prev.id).then(() => {}); return updatedPres; });
  }

  async function clearBlackboard() {
    if (!liveState?.id) return;
    setLiveState(prev => prev ? { ...prev, blackboardStrokes: [], blackboardLines: [], blackboardLabels: [] } : null);
    await updatePresentation({ ...liveState, blackboardStrokes: [], blackboardLines: [], blackboardLabels: [] });
    await supabase.from("live_presentations").update({ blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [] }).eq("id", liveState.id);
  }

  async function sendBlackboardLine() {
    if (!bbInput.trim() || !liveState?.id) return; const newLine = bbInput.trim(); setBbInput("");
    setLiveState(prev => { if (!prev) return prev; const updatedLines = [...(prev.blackboardLines || []), newLine]; const updatedPres = { ...prev, blackboardLines: updatedLines }; updatePresentation(updatedPres); supabase.from("live_presentations").update({ blackboard_lines: updatedLines }).eq("id", prev.id).then(() => {}); return updatedPres; });
  }

  async function handleCanvasClick(e: React.MouseEvent) {
    if (activeTool !== "label" || !bbInput.trim() || !liveState?.id) return;
    const rect = e.currentTarget.getBoundingClientRect(); const x = ((e.clientX - rect.left) / rect.width) * 100; const y = ((e.clientY - rect.top) / rect.height) * 100; const newLabel = { text: bbInput.trim(), x, y }; setBbInput(""); setActiveTool("pen");
    setLiveState(prev => { if (!prev) return prev; const updatedLabels = [...(prev.blackboardLabels || []), newLabel]; const updatedPres = { ...prev, blackboardLabels: updatedLabels }; updatePresentation(updatedPres); supabase.from("live_presentations").update({ blackboard_labels: updatedLabels }).eq("id", prev.id).then(() => {}); return updatedPres; });
  }

  function selectTool(tool: ToolType | "label") { setActiveTool(tool); }

  async function changePage(delta: number) {
    if (!liveState?.id || !courseId || materials.length === 0) return; const currentMatId = liveState.materialId; const currentIndex = materials.findIndex(m => m.id === currentMatId); const safeIndex = currentIndex === -1 ? 0 : currentIndex; let nextIndex = safeIndex + delta; if (nextIndex < 0) nextIndex = 0; if (nextIndex >= materials.length) nextIndex = materials.length - 1; if (nextIndex === safeIndex && delta !== 0) return; const nextMat = materials[nextIndex]; if (!nextMat) return;
    const updatedPres = { ...liveState, materialId: nextMat.id, currentPage: 1, isBlackboard: false, updatedAt: new Date().toISOString() };
    setLiveState(updatedPres); setPresentation(nextMat); setIsBlackboardMode(false);
    await updatePresentation(updatedPres);
    await supabase.from("live_presentations").update({ material_id: nextMat.id, current_page: 1, updated_at: new Date().toISOString() }).eq("id", liveState.id);
  }

  async function grantPermission(userId: string, kind: "audio" | "video") {
    if (!courseId || !tenantId) return;
    try {
      const { data: existing } = await supabase.from("allowed_speakers").select("can_audio, can_video").eq("user_id", userId).eq("course_id", courseId).maybeSingle();
      const can_audio = kind === "audio" ? true : ((existing?.can_audio as boolean) ?? false);
      const can_video = kind === "video" ? true : ((existing?.can_video as boolean) ?? false);
      await supabase.from("allowed_speakers").upsert({ user_id: userId, course_id: courseId, tenant_id: tenantId, allowed: can_audio, can_audio, can_video }, { onConflict: "user_id" });
      await supabase.from("raised_hands").delete().eq("user_id", userId).eq("course_id", courseId);
    } catch (error) { console.warn("Could not grant permission:", error); }
  }

  async function revokePermission(userId: string, kind: "audio" | "video") {
    if (!courseId || !daily) return;
    try {
      if (daily.participants()[userId]) {
        if (kind === "audio") await daily.updateParticipant(userId, { setAudio: false });
        if (kind === "video") await daily.updateParticipant(userId, { setVideo: false });
      }
      const { data: existing } = await supabase.from("allowed_speakers").select("can_audio, can_video").eq("user_id", userId).eq("course_id", courseId).maybeSingle();
      const can_audio = kind === "audio" ? false : ((existing?.can_audio as boolean) ?? false);
      const can_video = kind === "video" ? false : ((existing?.can_video as boolean) ?? false);
      if (!can_audio && !can_video) await supabase.from("allowed_speakers").delete().eq("user_id", userId).eq("course_id", courseId);
      else await supabase.from("allowed_speakers").update({ can_audio, can_video, allowed: can_audio }).eq("user_id", userId).eq("course_id", courseId);
    } catch (error) {}
  }

  async function startSession() {
    if (!courseId || !tenantId) return;
    await startLiveSession(courseId, currentUser.id);
    const { data: existing } = await supabase.from("live_session").select("id").eq("course_id", courseId).maybeSingle();
    if (existing) { await supabase.from("live_session").update({ active: true, updated_at: new Date().toISOString() }).eq("id", existing.id); }
    else { await supabase.from("live_session").insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, trainer_id: currentUser.id, active: true, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() }); }
    setSessionActive(true);
    if (materials.length > 0 && !presentation) {
      const firstMat = materials[0];
      setPresentation(firstMat);
      setIsBlackboardMode(false);
      await createLivePresentationRow(firstMat.id, false);
    }
  }

  async function stopSession() {
    if (!courseId) return;
    await endLiveSession(courseId);
    await clearPresentation(courseId);
    await supabase.from("live_session").update({ active: false, updated_at: new Date().toISOString() }).eq("course_id", courseId);
    await supabase.from("live_presentations").delete().eq("course_id", courseId);
    await supabase.from("allowed_speakers").delete().eq("course_id", courseId);
    await supabase.from("raised_hands").delete().eq("course_id", courseId);
    if (daily && isVoiceJoined) {
      daily.leave();
      setIsVoiceJoined(false);
      setIsMicOn(false);
      setIsCamOn(false);
      setVideoTrack(null);
    }
    navigate("/trainer");
  }

  async function selectPage(materialId: string) {
    if (!courseId || !tenantId) return; setActiveTool("pen"); const selectedMat = materials.find(m => m.id === materialId); if (selectedMat) { setPresentation(selectedMat); setIsBlackboardMode(false); }
    if (liveState?.id) {
      const updatedPres = { ...liveState, materialId, isBlackboard: false, currentPage: 1, updatedAt: new Date().toISOString() };
      setLiveState(updatedPres);
      await updatePresentation(updatedPres);
      await supabase.from("live_presentations").update({ material_id: materialId, is_blackboard: false, current_page: 1, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      await createLivePresentationRow(materialId, false);
    }
  }

  function handleLogout() {
    if (sessionActive && courseId) { supabase.from("live_session").update({ active: false }).eq("course_id", courseId); supabase.from("live_presentations").delete().eq("course_id", courseId); supabase.from("allowed_speakers").delete().eq("course_id", courseId); supabase.from("raised_hands").delete().eq("course_id", courseId); if (daily && isVoiceJoined) daily.leave(); }
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId"); window.dispatchEvent(new Event("authStateChanged")); navigate("/login");
  }

  /* ── Panel toggles ── On phones the chat drawer and the controls drawer
     share the screen edges, so opening the control sidebar closes the chat
     first: the two drawers can never stack on top of each other. On desktop
     all panels are static flex columns and cannot overlap at all. */
  function toggleSidebar() {
    const opening = isLeftCollapsed;
    setIsLeftCollapsed(!isLeftCollapsed);
    if (opening && isMobile && isChatOpen) setIsChatOpen(false);
  }
  function toggleChat() {
    setIsChatOpen(!isChatOpen);
  }

  /* Which lesson page is on screen right now (drives the "2 / 12" pill). */
  const currentPageIndex = useMemo(
    () => materials.findIndex((m) => m.id === (liveState?.materialId || presentation?.id)),
    [materials, liveState?.materialId, presentation?.id]
  );

  /* Sidebar card + section title styles, shared by every control group. */
  const cardStyle: React.CSSProperties = { background: C.card, borderRadius: "14px", padding: "12px", boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid rgba(0,0,0,0.04)", display: "flex", flexDirection: "column", gap: "10px", flexShrink: 0 };
  const sectionTitleStyle: React.CSSProperties = { fontSize: "12px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "700", letterSpacing: "0.6px", margin: 0 };

  const iosBtnStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", padding: "10px", border: "none", borderRadius: "10px", flex: 1, cursor: "pointer", transition: "transform 0.1s ease, opacity 0.2s ease", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", WebkitTapHighlightColor: "transparent" };
  const toolBtnStyle = (isActive: boolean): React.CSSProperties => ({ width: "44px", height: "44px", borderRadius: "12px", border: "none", background: isActive ? "rgba(0, 165, 244, 0.2)" : "transparent", color: isActive ? "#00A5F4" : "#8E8E93", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease", flexShrink: 0 });
  const permBtnStyle = (): React.CSSProperties => ({ border: "none", padding: "4px 8px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer" });
  const avBtnStyle: React.CSSProperties = { width: isMobile ? "44px" : "48px", height: isMobile ? "44px" : "48px", borderRadius: "50%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.1s ease", WebkitTapHighlightColor: "transparent", flexShrink: 0 };
  const drawingActiveTool = activeTool === "label" ? "pen" as ToolType : activeTool;

  /* Broken-image guards: never render a logo/avatar that would 404. */
  const safeLogo = normalizeImageSrc(settings?.logo);
  const safeAvatar = normalizeImageSrc((trainer?.avatar_url as string) || "");

  const videoTileContainerStyle: React.CSSProperties = isVideoExpanded ? {
    position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", borderRadius: 0, overflow: "hidden", border: "none", zIndex: 1000, background: "#000"
  } : {
    position: "absolute", bottom: isMobile ? "calc(78px + env(safe-area-inset-bottom, 0px))" : "32px", left: isMobile ? "10px" : "32px", width: isMobile ? "120px" : "200px", height: isMobile ? "84px" : "130px", borderRadius: isMobile ? 12 : 16, overflow: "hidden", border: "3px solid #FFFFFF", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 10, background: "#000",
  };

  return (
    <div className="tlc-root" style={{ display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      <style>{`@keyframes avspin { to { transform: rotate(360deg); } }
@keyframes pulseDot { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
.tlc-root { height: 100vh; height: 100dvh; width: 100%; }`}</style>
      <DailyAudio />

      {/* App Bar — white, logo + business identity left, trainer + controls right.
          Responsive: phones hide the phone number and trainer name; all
          tap targets stay ≥32px and the row never overflows. */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: isMobile ? "8px 10px" : "10px 16px", background: C.card, borderBottom: `1px solid ${C.separator}`, flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
          {safeLogo ? (
            <img src={safeLogo} alt="Logo" style={{ width: 32, height: 32, borderRadius: 8, objectFit: "contain", background: "#FFFFFF", flexShrink: 0 }} />
          ) : (
            <div style={{ width: 32, height: 32, borderRadius: 8, background: C.medBlue, color: "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>
              {(settings?.businessName || "S").charAt(0).toUpperCase()}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{settings?.businessName || "SmartPages"}</h1>
            {settings?.phone && !isMobile && (
              <a href={`tel:${settings.phone}`} style={{ fontSize: "12px", color: C.textTertiary, textDecoration: "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{settings.phone}</a>
            )}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: isMobile ? 6 : 8, flexShrink: 0 }}>
          {isMobile ? (
            safeAvatar ? (
              <img src={safeAvatar} alt="Trainer" style={{ width: 32, height: 32, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
            ) : (
              <div style={{ width: 32, height: 32, borderRadius: "50%", background: C.purpleBg, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                {(trainer?.username as string)?.charAt(0).toUpperCase() || "T"}
              </div>
            )
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 8, background: C.purpleBg, padding: "4px 12px", borderRadius: "20px", minWidth: 0 }}>
              {safeAvatar ? (
                <img src={safeAvatar} alt="Trainer" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                  {(trainer?.username as string)?.charAt(0).toUpperCase() || "T"}
                </div>
              )}
              <span style={{ fontSize: "13px", fontWeight: "600", color: C.purple, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 140 }}>
                {(trainer?.username as string) || "Trainer"}
              </span>
            </div>
          )}
          <button onClick={toggleSidebar} style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 9, background: isLeftCollapsed ? C.medBlueBg : "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", color: isLeftCollapsed ? C.medBlue : C.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title={isLeftCollapsed ? "Show controls" : "Hide controls"}>
            <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </button>
          <button onClick={toggleChat} style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 9, background: isChatOpen ? C.purpleBg : "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", color: isChatOpen ? C.purple : C.textPrimary, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title={isChatOpen ? "Hide chat" : "Show chat"}>
            <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          </button>
          <button onClick={handleLogout} style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title="Logout">
            <svg width={isMobile ? 18 : 20} height={isMobile ? 18 : 20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative" }}>
        {/* ═══ CONTROL SIDEBAR — a static rail on desktop (always part of the
            layout, never floating above the classroom) and a slide-in drawer
            on phones. ALL classroom controls live here: session, lesson
            pages, blackboard tools, raised hands, participants. */}
        <aside style={isMobile ? {
          position: "fixed", top: 0, bottom: 0, left: 0, width: "min(86vw, 320px)", zIndex: 70,
          background: C.panelBg, display: "flex", flexDirection: "column", gap: 12,
          padding: 12, overflowY: "auto", overflowX: "hidden",
          borderRight: `1px solid ${C.separator}`,
          transform: isLeftCollapsed ? "translateX(-105%)" : "translateX(0)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: isLeftCollapsed ? "none" : "12px 0 32px rgba(0,0,0,0.18)",
        } : {
          flex: isLeftCollapsed ? "0 0 0px" : "0 0 272px", minWidth: 0,
          background: C.panelBg, display: "flex", flexDirection: "column", gap: 12,
          padding: isLeftCollapsed ? 0 : 12, overflowX: "hidden",
          overflowY: isLeftCollapsed ? "hidden" : "auto",
          borderRight: `1px solid ${C.separator}`,
          transition: "flex 0.3s ease, padding 0.3s ease",
        }}>
          {/* ── Session card ── */}
          <div style={cardStyle}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => navigate("/trainer")} style={{ background: "none", border: "none", color: C.medBlue, cursor: "pointer", display: "flex", alignItems: "center", padding: 0, gap: "4px", fontSize: "14px", fontWeight: "600" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>Exit</button>
              <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "4px 10px", borderRadius: "999px", background: sessionActive ? C.greenBg : C.bg, color: sessionActive ? C.green : C.textTertiary, fontSize: "11px", fontWeight: "700", letterSpacing: "0.5px" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: sessionActive ? C.green : C.textTertiary, animation: sessionActive ? "pulseDot 1.6s ease infinite" : undefined }} />
                {sessionActive ? "LIVE" : "OFFLINE"}
              </span>
            </div>
            {sessionActive ? (
              <button onClick={stopSession} style={{ width: "100%", padding: "10px", background: C.redBg, color: C.red, border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer", fontSize: "13px" }}>End Class</button>
            ) : (
              <button onClick={startSession} disabled={isConnecting} style={{ width: "100%", padding: "10px", background: C.medBlue, color: "#FFFFFF", border: "none", borderRadius: "10px", fontWeight: "700", cursor: "pointer", fontSize: "13px", opacity: isConnecting ? 0.6 : 1 }}>{isConnecting ? "Connecting…" : "Start Class"}</button>
            )}
          </div>

          {/* ── Lesson card: current page, prev/next, blackboard toggle ── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>Lesson</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", background: C.bg, borderRadius: "10px", padding: "8px 10px" }}>
              <span style={{ fontSize: "12px", fontWeight: "600", color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                {isBlackboardMode ? "Blackboard" : presentation ? presentation.title : "No page selected"}
              </span>
              {!isBlackboardMode && materials.length > 0 && (
                <span style={{ fontSize: "11px", fontWeight: "700", color: C.medBlue, background: C.medBlueBg, padding: "3px 8px", borderRadius: "999px", flexShrink: 0 }}>
                  {currentPageIndex >= 0 ? `${currentPageIndex + 1} / ${materials.length}` : `– / ${materials.length}`}
                </span>
              )}
            </div>
            {presentation && !isBlackboardMode && (
              <div style={{ display: "flex", background: C.bg, borderRadius: "10px", padding: "4px" }}>
                <button onClick={() => changePage(-1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>‹ Prev</button>
                <button onClick={() => changePage(1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>Next ›</button>
              </div>
            )}
            <button onClick={toggleBlackboard} style={{ ...iosBtnStyle, background: isBlackboardMode ? C.purple : C.iosBtnBg, color: isBlackboardMode ? "#FFFFFF" : C.textPrimary, width: "100%" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: 8 }}><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="20" x2="18" y2="20"/></svg>
              {isBlackboardMode ? "Exit Blackboard" : "Blackboard Mode"}
            </button>
          </div>

          {/* ── Blackboard tools card — only while blackboard mode is on.
              The old tool strip under the canvas moved here so every
              control lives in the sidebar. ── */}
          {isBlackboardMode && (
            <div style={cardStyle}>
              <p style={sectionTitleStyle}>Blackboard Tools</p>
              <div style={{ display: "flex", gap: "8px" }}>
                <button onClick={() => selectTool("pen")} title="Pen" style={{ ...toolBtnStyle(activeTool === "pen"), background: activeTool === "pen" ? "rgba(0, 165, 244, 0.2)" : C.bg }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
                <button onClick={() => selectTool("eraser")} title="Eraser" style={{ ...toolBtnStyle(activeTool === "eraser"), background: activeTool === "eraser" ? "rgba(0, 165, 244, 0.2)" : C.bg }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4L20 11L11 20"/></svg></button>
                <button onClick={() => bbInput.trim() && selectTool("label")} title="Pin Label" style={{ ...toolBtnStyle(activeTool === "label"), background: activeTool === "label" ? "rgba(175, 82, 222, 0.2)" : C.bg }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg></button>
              </div>
              {activeTool === "pen" && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                    {PEN_COLORS.map((col) => (
                      <button key={col} onClick={() => setPenColor(col)} title={col} style={{ width: 22, height: 22, borderRadius: "50%", border: penColor === col ? "2px solid #00A5F4" : "2px solid rgba(0,0,0,0.08)", background: col, cursor: "pointer", padding: 0, flexShrink: 0 }} />
                    ))}
                    <label title="Custom colour" style={{ position: "relative", width: 22, height: 22, borderRadius: "50%", overflow: "hidden", border: "2px solid rgba(0,0,0,0.08)", cursor: "pointer", flexShrink: 0, background: "conic-gradient(#FF3B30, #FF9F0A, #34C759, #00A5F4, #AF52DE, #FF3B30)" }}>
                      <input type="color" value={penColor} onChange={(e) => setPenColor(e.target.value)} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer", width: "100%", height: "100%" }} />
                    </label>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "11px", color: C.textTertiary, fontWeight: "600", width: 44 }}>Width</span>
                    <input type="range" min="1" max="20" value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} style={{ flex: 1, accentColor: "#00A5F4" }} />
                    <span style={{ fontSize: "11px", fontWeight: "700", color: C.textPrimary, width: 20, textAlign: "right" }}>{penWidth}</span>
                  </div>
                </>
              )}
              {activeTool === "eraser" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "11px", color: C.textTertiary, fontWeight: "600", width: 44 }}>Size</span>
                  <input type="range" min="10" max="100" value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} style={{ flex: 1, accentColor: "#00A5F4" }} />
                  <span style={{ fontSize: "11px", fontWeight: "700", color: C.textPrimary, width: 20, textAlign: "right" }}>{eraserSize}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: "6px", alignItems: "center", background: C.bg, borderRadius: "10px", padding: "4px 4px 4px 10px" }}>
                <input
                  type="text"
                  placeholder={activeTool === "label" ? "Type, then tap the board…" : "Type to send to board…"}
                  value={bbInput}
                  onChange={(e) => setBbInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && activeTool !== "label") sendBlackboardLine(); }}
                  style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: C.textPrimary, fontSize: "13px" }}
                />
                {activeTool !== "label" && (
                  <button onClick={sendBlackboardLine} title="Send to board" style={{ width: 32, height: 32, borderRadius: "50%", border: "none", background: bbInput.trim() ? C.medBlue : "rgba(118, 118, 128, 0.12)", color: bbInput.trim() ? "#FFFFFF" : C.textTertiary, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                )}
              </div>
              {activeTool === "label" && (
                <p style={{ fontSize: "11px", color: C.purple, fontWeight: "600", margin: 0 }}>Tap anywhere on the blackboard to pin the label.</p>
              )}
              <button onClick={clearBlackboard} style={{ width: "100%", padding: "9px", background: C.redBg, color: C.red, border: "none", borderRadius: "10px", fontWeight: "700", fontSize: "12px", cursor: "pointer" }}>Clear Board</button>
            </div>
          )}

          {/* ── Raised hands card ── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>Raised Hands ({raisedHands.length})</p>
            {raisedHands.length === 0 ? (
              <p style={{ fontSize: "12px", color: C.textTertiary, margin: 0 }}>No hands raised right now.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {raisedHands.map((hand) => (
                  <div key={hand.user_id as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px", padding: "8px", background: C.orangeBg, borderRadius: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "600", color: C.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{hand.username || "Unknown"}</span>
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      <button onClick={() => grantPermission(hand.user_id as string, "audio")} style={{ background: C.green, color: "#fff", border: "none", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>🎤 Mic</button>
                      <button onClick={() => grantPermission(hand.user_id as string, "video")} style={{ background: C.medBlue, color: "#fff", border: "none", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>📹 Cam</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Participants card: per-learner mic / camera permissions ── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>Participants ({activeLearners.length})</p>
            {activeLearners.length === 0 ? (
              <p style={{ fontSize: "12px", color: C.textTertiary, margin: 0 }}>No learners have joined yet.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                {activeLearners.map(learner => {
                  const perms = speakerPerms[learner.id];
                  return (
                    <div key={learner.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "6px", padding: "8px", background: C.bg, borderRadius: "8px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
                        <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "600", flexShrink: 0 }}>{learner.username?.charAt(0).toUpperCase()}</div>
                        <span style={{ fontSize: "12px", fontWeight: "500", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{learner.username}</span>
                        {perms?.can_audio && <span title="Mic allowed" style={{ fontSize: 11 }}>🎤</span>}
                        {perms?.can_video && <span title="Camera allowed" style={{ fontSize: 11 }}>📹</span>}
                      </div>
                      <div style={{ display: "flex", gap: "4px", flexShrink: 0 }}>
                        {!perms?.can_audio && <button onClick={() => grantPermission(learner.id, "audio")} style={{ ...permBtnStyle(), background: C.greenBg, color: C.green }} title="Allow mic">🎤</button>}
                        {!perms?.can_video && <button onClick={() => grantPermission(learner.id, "video")} style={{ ...permBtnStyle(), background: C.medBlueBg, color: C.medBlue }} title="Allow camera">📹</button>}
                        {perms?.can_audio && <button onClick={() => revokePermission(learner.id, "audio")} style={{ ...permBtnStyle(), background: C.redBg, color: C.red }}>Mute</button>}
                        {perms?.can_video && <button onClick={() => revokePermission(learner.id, "video")} style={{ ...permBtnStyle(), background: C.redBg, color: C.red }}>Cam off</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* ── Lesson pages card ── */}
          <div style={cardStyle}>
            <p style={sectionTitleStyle}>Lesson Pages ({materials.length})</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: 230, overflowY: "auto" }}>
              {materials.length === 0 && <p style={{ fontSize: "12px", color: C.textTertiary, margin: 0 }}>No pages uploaded for this course yet.</p>}
              {/* mat.fileType can be undefined — use ?? "" for safe fallback */}
              {materials.map((mat) => {
                const meta = getFileMeta(mat.fileType ?? "");
                const isActive = liveState?.materialId === mat.id && !isBlackboardMode;
                return (
                  <div key={mat.id} onClick={() => selectPage(mat.id)} style={{ display: "flex", alignItems: "center", padding: "10px", gap: "10px", cursor: "pointer", background: isActive ? C.medBlueBg : C.bg, borderRadius: "10px" }}>
                    <div style={{ width: "30px", height: "30px", borderRadius: "8px", background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "15px", flexShrink: 0 }}>{meta.icon}</div>
                    <div style={{ fontSize: "13px", color: isActive ? C.medBlue : C.textPrimary, fontWeight: isActive ? "600" : "500", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mat.title}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {/* Dim backdrop behind the mobile control drawer (sits above the chat
            drawer and its backdrop, below the sidebar itself) */}
        {isMobile && !isLeftCollapsed && (
          <div onClick={() => setIsLeftCollapsed(true)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 65 }} />
        )}

        {/* Classroom main area */}
        <div style={{ flex: "1 1 auto", minWidth: 0, background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          <div style={{ flex: 1, display: "flex", width: "200%", height: "100%", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)", transform: isBlackboardMode ? "translateX(-50%)" : "translateX(0%)" }}>
            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", background: C.card, overflow: "hidden", position: "relative" }}>
              {presentation ? <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} /> : <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><p style={{ color: C.textTertiary, fontSize: "15px" }}>{materials.length > 0 ? "Select a page from the sidebar." : "Upload pages first."}</p></div>}
            </div>
            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#1A1A1A" }}>
              <div style={{ flex: 1, position: "relative", overflow: "hidden", cursor: activeTool === "label" ? "crosshair" : undefined }} onClick={activeTool === "label" ? handleCanvasClick : undefined}>
                <DrawingBlackboard isTrainer={true} strokes={liveState?.blackboardStrokes || []} onStrokeEnd={handleStrokeEnd} onErase={handleErase} activeTool={drawingActiveTool} penColor={penColor} penWidth={penWidth} eraserSize={eraserSize} fontFamily={FONT_OPTIONS.fontFamily} fontSize={FONT_OPTIONS.fontSize} fontColor={FONT_OPTIONS.fontColor} fontWeight={FONT_OPTIONS.fontWeight} fontStyle={FONT_OPTIONS.fontStyle} courseId={courseId!} />
              </div>
              {/* Blackboard tool strip moved to the control sidebar
                  ("Blackboard Tools" card) so the canvas stays clean and
                  every control lives in one place. */}
            </div>
          </div>

          {/* Floating CLASSROOM AV bar */}
          <div style={{ position: "absolute", bottom: isMobile ? "calc(10px + env(safe-area-inset-bottom, 0px))" : "24px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: isMobile ? "10px" : "16px", padding: isMobile ? "8px" : "10px", background: "rgba(28, 28, 30, 0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderRadius: isMobile ? 28 : 32, border: "1px solid rgba(255,255,255,0.1)", zIndex: 20, maxWidth: "calc(100vw - 16px)" }}>
            <button onClick={() => navigate("/trainer")} style={{ ...avBtnStyle, background: "#E5E5EA", color: "#1C1C1E" }} title="Exit classroom">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <button onClick={toggleMic} style={{ ...avBtnStyle, background: isMicOn ? C.green : "#E5E5EA", color: isMicOn ? "#fff" : "#1C1C1E", opacity: isConnecting ? 0.6 : 1 }} title={isMicOn ? "Classroom mic on" : "Classroom mic off"}>
              {isConnecting ? (
                <span style={{ width: 18, height: 18, border: "2.5px solid rgba(0,0,0,0.2)", borderTopColor: "#1C1C1E", borderRadius: "50%", display: "inline-block", animation: "avspin 0.8s linear infinite" }} />
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11a7 7 0 0 1-14 0" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2"/></svg>
              )}
            </button>
            <button onClick={toggleCam} style={{ ...avBtnStyle, background: isCamOn ? C.medBlue : "#E5E5EA", color: isCamOn ? "#fff" : "#1C1C1E", opacity: isConnecting ? 0.6 : 1 }} title={isCamOn ? "Classroom camera on" : "Classroom camera off"}>
              {isCamOn ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2"/><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
              )}
            </button>
          </div>

          {/* Trainer self-view */}
          {isCamOn && videoTrack && (
            <div style={videoTileContainerStyle}>
              <video autoPlay muted playsInline ref={selfViewRef} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
              <button onClick={() => setIsVideoExpanded(!isVideoExpanded)} style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                {isVideoExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
          )}
        </div>

        {/* ── Chat panel — desktop: a normal flex column AFTER the canvas, so
              it can never overlap the control sidebar (three static columns:
              sidebar | canvas | chat). Phones: a drawer over the canvas only
              (z 50, below the control drawer's z 70), and opening the control
              sidebar closes the chat first. ── */}
        {isMobile && isChatOpen && (
          <div onClick={() => setIsChatOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 45 }} />
        )}
        <div style={isMobile ? {
          position: "fixed", top: 0, bottom: 0, right: 0, width: "min(86vw, 360px)", zIndex: 50,
          background: "#1C1C1E", borderLeft: "1px solid #2C2C2E", overflow: "hidden",
          transform: isChatOpen ? "translateX(0)" : "translateX(105%)",
          transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        } : {
          width: isChatOpen ? "360px" : 0,
          minWidth: 0,
          transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          flexShrink: 0,
          borderLeft: isChatOpen ? "1px solid #E5E5EA" : "none",
          background: "#1C1C1E",
          overflow: "hidden",
        }}>
          <ClassChat
            courseId={courseId || ""}
            isChatOpen={isChatOpen}
            toggleChatOpen={toggleChat}
          />
        </div>

        {/* ── Floating "Open Chat" FAB when chat is collapsed ── */}
        {!isChatOpen && (
          <button
            onClick={() => setIsChatOpen(true)}
            title="Open chat"
            style={{
              position: "absolute",
              right: isMobile ? 16 : 20,
              bottom: isMobile ? 90 : 100,
              width: 52,
              height: 52,
              borderRadius: "50%",
              background: "#AF52DE",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 6px 20px rgba(175, 82, 222, 0.4)",
              zIndex: 20,
              transition: "transform 0.15s ease, box-shadow 0.15s ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = "scale(1.08)"; e.currentTarget.style.boxShadow = "0 8px 28px rgba(175, 82, 222, 0.5)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; e.currentTarget.style.boxShadow = "0 6px 20px rgba(175, 82, 222, 0.4)"; }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
      </div>

      <MediaHelpModal problem={mediaProblem} onClose={() => setMediaProblem(null)} />
    </div>
  );
}
