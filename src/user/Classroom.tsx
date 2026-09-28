// src/user/Classroom.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import DownloadCenter, { type DownloadFileMeta, type ResolvedMaterial } from "../components/DownloadCenter";
import { useDaily, useDailyEvent, DailyAudio } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getMaterialById } from "../database/materialDB";
import { getLivePresentation, updatePresentation } from "../database/livePresentationDB";
import { getLiveSession } from "../database/liveSessionDB";

const C = { bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", medBlue: "#030303", medBlueBg: "#E8F2FF", red: "#FF3B30", redBg: "#FFEFEE", orange: "#FF9F0A", orangeBg: "#FFF6EB", green: "#34C759", purple: "#AF52DE", purpleBg: "#F5F0FF" };

interface MaterialFile { id: string; fileName: string; fileType: string; }

export default function Classroom() {
  const { courseId } = useParams();
  const navigate = useNavigate();

  const [presentation, setPresentation] = useState<CourseMaterial | null>(null);
  const [liveState, setLiveState] = useState<LivePresentation | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isBlackboardMode, setIsBlackboardMode] = useState(false);
  const [dbUser, setDbUser] = useState<any>(null);
  const [dbUserAvatar, setDbUserAvatar] = useState<string | null>(null);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [courseFiles, setCourseFiles] = useState<MaterialFile[]>([]);

  const daily = useDaily();
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isVoiceJoined, setIsVoiceJoined] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [hasCamPermission, setHasCamPermission] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [trainerVideoTrack, setTrainerVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [localVideoTrack, setLocalVideoTrack] = useState<MediaStreamTrack | null>(null);

  const [downloadOpen, setDownloadOpen] = useState(false);
  const [autoDownloadId, setAutoDownloadId] = useState<string | null>(null);

  useDailyEvent("track-started", (event: any) => {
    if (event.participant?.local && event.track?.kind === "video") setLocalVideoTrack(event.track as MediaStreamTrack);
    if (!event.participant?.local && event.track?.kind === "video") setTrainerVideoTrack(event.track as MediaStreamTrack);
  });
  useDailyEvent("track-stopped", (event: any) => {
    if (event.participant?.local && event.track?.kind === "video") setLocalVideoTrack(null);
    if (!event.participant?.local && event.track?.kind === "video") setTrainerVideoTrack(null);
  });

  useEffect(() => {
    const localUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (!localUser.id || localUser.role !== "trainee") { return; }
    setDbUser(localUser);

    const fetchUserAvatar = async () => {
      const { data } = await supabase.from("profile_settings").select("avatar_url").eq("user_id", localUser.id).maybeSingle();
      if (data?.avatar_url) setDbUserAvatar(data.avatar_url);
      else if (localUser.profilePic) setDbUserAvatar(localUser.profilePic);
    };
    fetchUserAvatar();

    const handleAttendance = async () => {
      if (courseId) {
        const existing = await db.activeAttendances.where({ userId: localUser.id, courseId }).first();
        if (!existing) {
          await db.activeAttendances.put({ userId: localUser.id, courseId, tenantId: localUser.tenantId, id: crypto.randomUUID() } as any);
          await supabase.from("active_attendances").insert({ id: crypto.randomUUID(), user_id: localUser.id, course_id: courseId, tenant_id: localUser.tenantId });
        }
      }
    };
    handleAttendance();

    const handleBeforeUnload = () => {
      localStorage.removeItem("activeAttendanceCourseId");
      db.activeAttendances.delete(localUser.id);
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      db.activeAttendances.delete(localUser.id);
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
    };
  }, [courseId]);

  // Course material file names for the chat panel / Download Center (offline-first)
  useEffect(() => {
    if (!courseId) return;
    let cancelled = false;
    const fetchCourseFiles = async () => {
      try {
        const cached = JSON.parse(localStorage.getItem(`localClassroomFiles_${courseId}`) || "[]");
        if (!cancelled && Array.isArray(cached) && cached.length > 0) setCourseFiles(cached);
      } catch {}
      try {
        const { data } = await supabase
          .from("course_materials")
          .select("id, file_name, file_type")
          .eq("course_id", courseId)
          .order("presentation_order", { ascending: true });
        if (!cancelled && data) {
          const files: MaterialFile[] = data.map((m: any) => ({ id: m.id, fileName: m.file_name || "File", fileType: m.file_type || "" }));
          setCourseFiles(files);
          localStorage.setItem(`localClassroomFiles_${courseId}`, JSON.stringify(files));
        }
      } catch (e) { /* offline — cached list already applied */ }
    };
    fetchCourseFiles();
    return () => { cancelled = true; };
  }, [courseId]);

  // Resolve a full material for download (offline-first: IndexedDB -> Supabase)
  async function resolveMaterial(file: DownloadFileMeta): Promise<ResolvedMaterial | null> {
    let mat: any = null;
    try { mat = await db.materials.get(file.id); } catch {}
    if (!mat || !mat.fileUrl) {
      try {
        const { data } = await supabase.from("course_materials").select("*").eq("id", file.id).maybeSingle();
        if (data) {
          mat = { id: data.id, courseId: data.course_id, tenantId: data.tenant_id, title: data.title || "Untitled", description: data.description || "", fileUrl: data.file_data || data.file_url || "", fileName: data.file_name || "Untitled", fileType: data.file_type || "application/octet-stream", allowDownload: data.allow_download ?? true, uploadedBy: data.uploaded_by || "", uploadedAt: data.uploaded_at || data.created_at || "", isPresentation: data.is_presentation ?? false, presentationOrder: data.presentation_order ?? 0 };
          await db.materials.put(mat);
        }
      } catch { /* offline */ }
    }
    if (!mat) return null;
    return { fileName: mat.fileName || mat.title || "download", fileType: mat.fileType || "application/octet-stream", fileUrl: mat.fileUrl || "", allowDownload: mat.allowDownload ?? true };
  }

  async function getDailyRoomUrl() {
    if (!courseId) return null;
    const API_BASE = import.meta.env.VITE_API_URL || "https://medstat-3rxl.onrender.com";
    try {
      const response = await fetch(`${API_BASE}/api/create-daily-room`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      return data.url;
    } catch (error) { return null; }
  }

  // Joins the Daily room silently — audio and video always start OFF
  async function joinAudio() {
    if (!daily) return;
    const roomUrl = await getDailyRoomUrl();
    if (!roomUrl) return;
    try {
      await daily.join({ url: roomUrl, startVideoOff: true });
      await daily.setLocalAudio(false);
      await daily.setLocalVideo(false);
      setIsVoiceJoined(true);
      setAudioError(false);
    } catch (e) { setAudioError(true); }
  }

  useEffect(() => {
    if (isLive && daily && !isVoiceJoined && !audioError) {
      const autoJoinRoom = async () => {
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        try {
          await daily.join({ url: roomUrl, startVideoOff: true });
          await daily.setLocalAudio(false);
          await daily.setLocalVideo(false);
          setIsVoiceJoined(true);
        } catch (e) { setAudioError(true); }
      };
      autoJoinRoom();
    }
  }, [isLive, daily, isVoiceJoined, audioError]);

  useEffect(() => {
    if (!courseId) return;
    const fetchLiveData = async () => {
      const localSess = await getLiveSession(courseId);
      if (localSess) setIsLive(localSess.active);

      const localPres = await getLivePresentation(courseId);
      if (localPres) {
        setLiveState(localPres);
        setIsBlackboardMode(localPres.isBlackboard ?? false);
        if (localPres.materialId) {
          const localMat = await getMaterialById(localPres.materialId);
          if (localMat) setPresentation(localMat);
        }
      }

      try {
        // My current classroom mic/cam permissions for this course
        const me = dbUser || JSON.parse(localStorage.getItem("currentUser") || "{}");
        if (me?.id) {
          try {
            const { data: perm } = await supabase.from("allowed_speakers").select("can_audio, can_video, allowed").eq("user_id", me.id).eq("course_id", courseId).maybeSingle();
            setHasMicPermission(perm ? ((perm as any).can_audio ?? (perm as any).allowed ?? false) : false);
            setHasCamPermission(perm ? ((perm as any).can_video ?? false) : false);
          } catch {}
        }

        const { data: liveSess } = await supabase.from("live_session").select("*").eq("course_id", courseId).maybeSingle();
        if (liveSess) {
          setIsLive(liveSess.active);
          await db.liveSessions.put({ id: liveSess.id, courseId, active: liveSess.active, trainerId: liveSess.trainer_id, startedAt: liveSess.started_at, updatedAt: liveSess.updated_at, createdAt: liveSess.created_at, tenantId: liveSess.tenant_id });
        }

        const { data: livePres } = await supabase.from("live_presentations").select("*").eq("course_id", courseId).maybeSingle();
        if (livePres) {
          const mappedPres = { id: livePres.id, courseId: livePres.course_id, materialId: livePres.material_id || "", isBlackboard: livePres.is_blackboard ?? false, blackboardStrokes: (livePres.blackboard_strokes as Stroke[]) || [], blackboardLines: (livePres.blackboard_lines as string[]) || [], blackboardLabels: (livePres.blackboard_labels as any[]) || [], currentPage: livePres.current_page ?? 1, tenantId: livePres.tenant_id, startedBy: livePres.started_by, updatedAt: livePres.updated_at };
          setLiveState(mappedPres);
          setIsBlackboardMode(mappedPres.isBlackboard);
          await updatePresentation(mappedPres);

          if (mappedPres.materialId) {
            const { data: mat } = await supabase.from("course_materials").select("*").eq("id", mappedPres.materialId).maybeSingle();
            if (mat) {
              const mappedMat = { id: mat.id, courseId: mat.course_id, tenantId: mat.tenant_id, title: mat.title || "Untitled", description: mat.description || "", fileUrl: mat.file_data || "", fileName: mat.file_name || "Untitled", fileType: mat.file_type || "application/octet-stream", allowDownload: mat.allow_download ?? true, uploadedBy: mat.uploaded_by || "", uploadedAt: mat.uploaded_at || mat.created_at || "", isPresentation: mat.is_presentation ?? false, presentationOrder: mat.presentation_order ?? 0 };
              setPresentation(mappedMat);
              await db.materials.put(mappedMat);
            }
          } else setPresentation(null);
        } else { setLiveState(null); setIsBlackboardMode(false); setPresentation(null); }
      } catch (err) { console.warn("Offline: Using local live data"); }
    };
    fetchLiveData();

    const channel = supabase.channel(`learner-classroom-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presentations", filter: `course_id=eq.${courseId}` }, async (payload: any) => {
        if (payload.eventType === "DELETE") { setLiveState(null); setPresentation(null); setIsBlackboardMode(false); await db.livePresentations.delete(payload.old.id); return; }
        const newPres = payload.new;
        const mappedPres = { id: newPres.id, courseId: newPres.course_id, materialId: newPres.material_id || "", isBlackboard: newPres.is_blackboard ?? false, blackboardStrokes: (newPres.blackboard_strokes as Stroke[]) || [], blackboardLines: (newPres.blackboard_lines as string[]) || [], blackboardLabels: (newPres.blackboard_labels as any[]) || [], currentPage: newPres.current_page ?? 1, tenantId: newPres.tenant_id, startedBy: newPres.started_by, updatedAt: newPres.updated_at };
        setLiveState(mappedPres);
        setIsBlackboardMode(mappedPres.isBlackboard);
        await updatePresentation(mappedPres);

        if (mappedPres.materialId) {
          const { data: mat } = await supabase.from("course_materials").select("*").eq("id", mappedPres.materialId).maybeSingle();
          if (mat) {
            const mappedMat = { id: mat.id, courseId: mat.course_id, tenantId: mat.tenant_id, title: mat.title || "Untitled", description: mat.description || "", fileUrl: mat.file_data || "", fileName: mat.file_name || "Untitled", fileType: mat.file_type || "application/octet-stream", allowDownload: mat.allow_download ?? true, uploadedBy: mat.uploaded_by || "", uploadedAt: mat.uploaded_at || mat.created_at || "", isPresentation: mat.is_presentation ?? false, presentationOrder: mat.presentation_order ?? 0 };
            setPresentation(mappedMat);
            await db.materials.put(mappedMat);
          }
        } else setPresentation(null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_session", filter: `course_id=eq.${courseId}` }, fetchLiveData)
      .on("postgres_changes", { event: "*", schema: "public", table: "raised_hands", filter: `course_id=eq.${courseId}` }, (payload: any) => {
        if (payload.new?.user_id === dbUser?.id) setHasRaisedHand(true);
        if (payload.old?.user_id === dbUser?.id) setHasRaisedHand(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "allowed_speakers", filter: `course_id=eq.${courseId}` }, (payload: any) => {
        const mine = payload.new?.user_id === dbUser?.id || payload.old?.user_id === dbUser?.id;
        if (!mine) return;
        const deleted = payload.eventType === "DELETE" || !payload.new;
        const canAudio = deleted ? false : (payload.new.can_audio ?? payload.new.allowed ?? false);
        const canVideo = deleted ? false : (payload.new.can_video ?? false);
        setHasMicPermission(canAudio);
        setHasCamPermission(canVideo);
        if (!canAudio) setHasRaisedHand(false);
        if (!canAudio && daily && isVoiceJoined) { try { daily.setLocalAudio(false); } catch (e) {} setIsMicOn(false); }
        if (!canVideo && daily && isVoiceJoined) { try { daily.setLocalVideo(false); } catch (e) {} setIsCamOn(false); }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseId, dbUser?.id]);

  // Classroom AV (learner) — locked until the trainer activates
  async function toggleMic() {
    if (!daily) return;
    if (!isVoiceJoined) {
      await joinAudio();
      if (!hasMicPermission) { alert("🔒 Your mic is locked. Raise your hand 🖐️ and wait for the trainer to allow speaking."); return; }
      try { await daily.setLocalAudio(true); setIsMicOn(true); } catch (e) {}
      return;
    }
    if (!hasMicPermission && !isMicOn) { alert("🔒 Your mic is locked. Raise your hand 🖐️ and wait for the trainer to allow speaking."); return; }
    try { const n = !isMicOn; await daily.setLocalAudio(n); setIsMicOn(n); } catch (e) {}
  }

  async function toggleCam() {
    if (!daily) return;
    if (!isVoiceJoined) {
      await joinAudio();
      if (!hasCamPermission) { alert("🔒 Your camera is locked. Raise your hand 🖐️ and wait for the trainer to allow video."); return; }
      try { await daily.setLocalVideo(true); setIsCamOn(true); } catch (e) {}
      return;
    }
    if (!hasCamPermission && !isCamOn) { alert("🔒 Your camera is locked. Raise your hand 🖐️ and wait for the trainer to allow video."); return; }
    try { const n = !isCamOn; await daily.setLocalVideo(n); setIsCamOn(n); } catch (e) {}
  }

  async function toggleRaiseHand() {
    if (!dbUser?.id || !courseId) return;
    if (hasRaisedHand) {
      await supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
      setHasRaisedHand(false);
    } else {
      await supabase.from("raised_hands").insert({ id: crypto.randomUUID(), user_id: dbUser.id, course_id: courseId, tenant_id: dbUser.tenantId, created_at: new Date().toISOString() });
      setHasRaisedHand(true);
    }
  }

  async function exitClassroom() {
    if (daily && isVoiceJoined) { try { await daily.leave(); } catch (e) {} }
    localStorage.removeItem("activeAttendanceCourseId");
    if (dbUser?.id && courseId) {
      db.activeAttendances.delete(dbUser.id).catch(() => {});
      supabase.from("active_attendances").delete().eq("user_id", dbUser.id).eq("course_id", courseId).then(() => {}, () => {});
      supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId).then(() => {}, () => {});
    }
    navigate("/user");
  }

  const btnStyle: React.CSSProperties = { width: "48px", height: "48px", borderRadius: "50%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", transition: "transform 0.1s ease" };
  const lockBadgeStyle: React.CSSProperties = { position: "absolute", bottom: -3, right: -3, width: 18, height: 18, borderRadius: "50%", background: "#1C1C1E", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, border: "1.5px solid #fff" };

  const videoTileContainerStyle: React.CSSProperties = isVideoExpanded ? {
    position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", borderRadius: 0, overflow: "hidden", border: "none", zIndex: 1000, background: "#000"
  } : {
    position: "absolute", bottom: "32px", left: "32px", width: "200px", height: "130px", borderRadius: "16px", overflow: "hidden", border: "3px solid #FFFFFF", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 10, background: "#000",
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(249, 249, 249, 0.8)", backdropFilter: "blur(20px)", borderBottom: `0.33px solid ${C.separator}`, flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1 }}>
          <button onClick={exitClassroom} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", color: C.medBlue, padding: 0 }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "#1C1C1E" }}>Classroom</h1>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button onClick={() => { setAutoDownloadId(null); setDownloadOpen(true); }} title="Download course files" style={{ width: 36, height: 36, borderRadius: 9, background: C.medBlueBg, border: "none", cursor: "pointer", color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: "20px" }}>
            {dbUserAvatar ? (
              <img src={dbUserAvatar} alt="Profile" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} />
            ) : (
              <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>
                {dbUser?.username?.charAt(0).toUpperCase()}
              </div>
            )}
            <span style={{ fontSize: "13px", fontWeight: "600", color: C.purple }}>{dbUser?.username || "Learner"}</span>
          </div>
        </div>
      </div>

      <DailyAudio />

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden", margin: "16px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease", transform: isBlackboardMode ? "translateX(-100%)" : "translateX(0%)", background: C.card, display: "flex" }}>
            {presentation ? <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} /> : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <p style={{ fontSize: "20px", fontWeight: "600" }}>{isLive ? "Waiting for Trainer" : "Class is not live"}</p>
                <p style={{ color: "#8E8E93" }}>{isLive ? "The presentation will appear here once it starts." : "Please wait for the trainer to start the session."}</p>
              </div>
            )}
          </div>
          <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease", transform: isBlackboardMode ? "translateX(0%)" : "translateX(100%)", display: "flex", background: "#1A1A1A" }}>
            <DrawingBlackboard isTrainer={false} strokes={liveState?.blackboardStrokes || []} courseId={`${courseId}-learner`} />
          </div>

          {hasRaisedHand && !hasMicPermission && !hasCamPermission && (
            <div style={{ position: "absolute", bottom: "96px", left: "50%", transform: "translateX(-50%)", background: C.orangeBg, color: "#B96A00", padding: "6px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, zIndex: 11, whiteSpace: "nowrap", boxShadow: "0 4px 12px rgba(0,0,0,0.1)" }}>
              🖐️ Hand raised — waiting for trainer activation…
            </div>
          )}

          <div style={{ position: "absolute", bottom: "24px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "16px", padding: "10px", background: "rgba(28, 28, 30, 0.8)", backdropFilter: "blur(20px)", borderRadius: "32px", border: "1px solid rgba(255,255,255,0.1)", zIndex: 10 }}>
            <button onClick={exitClassroom} style={{ ...btnStyle, background: "#E5E5EA", color: "#1C1C1E" }} title="Exit">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M13 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8z"/><path d="M19 12l-4 4-4-4-4 4V3h12v9z" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
            </button>

            <button onClick={toggleMic} style={{ ...btnStyle, position: "relative", background: isMicOn ? C.green : "#E5E5EA", color: isMicOn ? "#fff" : "#1C1C1E", opacity: !hasMicPermission && !isMicOn ? 0.65 : 1 }} title={hasMicPermission ? "Mic" : "Mic locked — raise your hand"}>
              {isMicOn ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3z"/><path d="M19 11c0 3.86-3.14 7-7 7s-7-3.14-7-7" fill="none" stroke="currentColor" strokeWidth="2"/><line x1="12" y1="19" x2="12" y2="22" stroke="currentColor" strokeWidth="2"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2"/><path d="M9 5a3 3 0 0 1 5.94-.6" fill="none" stroke="currentColor" strokeWidth="2"/><path d="M15 9v2c0 .3-.03.59-.08.87L9.41 6.36C9.76 6.13 10 5.79 10 5v4.59l2.7 2.7H15z" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
              )}
              {!hasMicPermission && !isMicOn && <span style={lockBadgeStyle}>🔒</span>}
            </button>

            <button onClick={toggleCam} style={{ ...btnStyle, position: "relative", background: isCamOn ? C.medBlue : "#E5E5EA", color: isCamOn ? "#fff" : "#1C1C1E", opacity: !hasCamPermission && !isCamOn ? 0.65 : 1 }} title={hasCamPermission ? "Camera" : "Camera locked — raise your hand"}>
              {isCamOn ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2"/><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z" fill="none" stroke="currentColor" strokeWidth="2"/></svg>
              )}
              {!hasCamPermission && !isCamOn && <span style={lockBadgeStyle}>🔒</span>}
            </button>

            <button onClick={toggleRaiseHand} style={{ ...btnStyle, background: hasRaisedHand ? C.orange : "#E5E5EA", color: hasRaisedHand ? "#fff" : "#1C1C1E" }} title="Raise Hand">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V11h1V3.5a1.5 1.5 0 0 1 3 0V11h1V5.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-14 0V8.5a1.5 1.5 0 0 1 3 0V11h1z"/></svg>
            </button>
          </div>

          {isCamOn && localVideoTrack && (
            <div style={{ position: "absolute", bottom: "32px", right: "32px", width: "160px", height: "110px", borderRadius: "16px", overflow: "hidden", border: `3px solid ${C.green}`, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 10, background: "#000" }}>
              <video autoPlay muted playsInline ref={(el) => { if (el && localVideoTrack) { const stream = new MediaStream([localVideoTrack]); if (el.srcObject !== stream) el.srcObject = stream; } }} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
            </div>
          )}

          {trainerVideoTrack && (
            <div style={videoTileContainerStyle}>
              <video autoPlay muted playsInline ref={(el) => { if (el && trainerVideoTrack) { const stream = new MediaStream([trainerVideoTrack]); if (el.srcObject !== stream) el.srcObject = stream; } }} style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />
              <button onClick={() => setIsVideoExpanded(!isVideoExpanded)} style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>
                {isVideoExpanded ? "Collapse" : "Expand"}
              </button>
            </div>
          )}
        </div>

        <div style={{ width: isChatOpen ? "360px" : "64px", minWidth: 0, transition: "width 0.3s ease", flexShrink: 0, borderLeft: "1px solid #E5E5EA", background: "#1C1C1E" }}>
          <ClassChat
            courseId={courseId || ""}
            isChatOpen={isChatOpen}
            toggleChatOpen={() => setIsChatOpen(!isChatOpen)}
            files={courseFiles}
          />
        </div>
      </div>

      <DownloadCenter
        open={downloadOpen}
        files={courseFiles}
        resolveMaterial={resolveMaterial}
        autoStartId={autoDownloadId}
        onClose={() => { setDownloadOpen(false); setAutoDownloadId(null); }}
      />
    </div>
  );
}