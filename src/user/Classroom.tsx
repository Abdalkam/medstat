// src/user/Classroom.tsx
import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import AppBar from "../components/AppBar";
import { useDaily, useDailyEvent, DailyAudio } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getMaterialById } from "../database/materialDB";
import { getLivePresentation, updatePresentation } from "../database/livePresentationDB";
import { getLiveSession } from "../database/liveSessionDB";

const C = { bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", medBlue: "#030303", medBlueBg: "#E8F2FF", red: "#FF3B30", redBg: "#FFEFEE", orange: "#FF9F0A", orangeBg: "#FFF6EB", green: "#34C759" };

export default function Classroom() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  
  const [presentation, setPresentation] = useState<CourseMaterial | null>(null);
  const [liveState, setLiveState] = useState<LivePresentation | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isBlackboardMode, setIsBlackboardMode] = useState(false);
  const [dbUser, setDbUser] = useState<any>(null);
  
  const daily = useDaily();
  const [isMicOn, setIsMicOn] = useState(false);
  const [isVoiceJoined, setIsVoiceJoined] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  const [audioError, setAudioError] = useState(false);
  const [trainerVideoTrack, setTrainerVideoTrack] = useState<MediaStreamTrack | null>(null);

  useDailyEvent("track-started", (event: any) => { if (!event.participant?.local && event.track?.kind === "video") setTrainerVideoTrack(event.track as MediaStreamTrack); });
  useDailyEvent("track-stopped", (event: any) => { if (!event.participant?.local && event.track?.kind === "video") setTrainerVideoTrack(null); });

  useEffect(() => {
    const localUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (!localUser.id || localUser.role !== 'trainee') { return; }
    setDbUser(localUser);

    const handleAttendance = async () => {
      if (courseId) {
        // 1. Check Local DB
        const existing = await db.activeAttendances.where({ userId: localUser.id, courseId }).first();
        if (!existing) {
          // Cast to any to bypass strict ActiveAttendance interface properties
          await db.activeAttendances.put({ userId: localUser.id, courseId, tenantId: localUser.tenantId, id: crypto.randomUUID() } as any);
          // 2. Sync Supabase
          await supabase.from("active_attendances").insert({ id: crypto.randomUUID(), user_id: localUser.id, course_id: courseId, tenant_id: localUser.tenantId });
        }
      }
    };
    handleAttendance();

    const handleBeforeUnload = () => {
      // userId is the primary key in Dexie schema, so pass it directly
      db.activeAttendances.delete(localUser.id);
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      db.activeAttendances.delete(localUser.id);
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
    };
  }, [courseId]);

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

  async function joinAudio() {
    if (!daily) return;
    const roomUrl = await getDailyRoomUrl();
    if (!roomUrl) return;
    try { await daily.join({ url: roomUrl, startVideoOff: true }); await daily.setLocalAudio(false); setIsVoiceJoined(true); setAudioError(false); } 
    catch (e) { setAudioError(true); }
  }

  useEffect(() => {
    if (isLive && daily && !isVoiceJoined && !audioError) {
      const autoJoinRoom = async () => {
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        try { await daily.join({ url: roomUrl, startVideoOff: true }); await daily.setLocalAudio(false); setIsVoiceJoined(true); } 
        catch (e) { setAudioError(true); }
      };
      autoJoinRoom();
    }
  }, [isLive, daily, isVoiceJoined, audioError]);

  useEffect(() => {
    if (!courseId) return;
    const fetchLiveData = async () => {
      // 1. Load from Local DB instantly
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

      // 2. Fetch from Supabase
      try {
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
          await updatePresentation(mappedPres); // Save to local DB

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
        if (payload.eventType === 'DELETE') { setLiveState(null); setPresentation(null); setIsBlackboardMode(false); await db.livePresentations.delete(payload.old.id); return; }
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
        if (payload.new?.user_id === dbUser?.id) setHasMicPermission(true);
        if (payload.old?.user_id === dbUser?.id) { setHasMicPermission(false); setHasRaisedHand(false); if (daily && isVoiceJoined) { try { daily.setLocalAudio(false); setIsMicOn(false); } catch (e) {} } }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseId, dbUser?.id]);

  async function toggleMic() {
    if (!daily || !isVoiceJoined) { await joinAudio(); return; }
    if (!hasMicPermission && !isMicOn) { alert("Please raise your hand 🖐️ and wait for the trainer to allow you to speak."); return; }
    try { const n = !isMicOn; await daily.setLocalAudio(n); setIsMicOn(n); } catch (e) {}
  }

  async function toggleRaiseHand() {
    if (!dbUser?.id || !courseId) return;
    if (hasRaisedHand) { await supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId); setHasRaisedHand(false); }
    else { await supabase.from("raised_hands").insert({ id: crypto.randomUUID(), user_id: dbUser.id, course_id: courseId, tenant_id: dbUser.tenantId, created_at: new Date().toISOString() }); setHasRaisedHand(true); }
  }

  async function exitClassroom() {
    if (daily && isVoiceJoined) { try { await daily.leave(); } catch (e) {} }
    if (dbUser?.id && courseId) {
      // Pass primary key (userId) directly
      await db.activeAttendances.delete(dbUser.id);
      await supabase.from("active_attendances").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
      await supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
    }
    navigate("/user");
  }

  const btnStyle: React.CSSProperties = { width: "48px", height: "48px", borderRadius: "50%", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 4px 12px rgba(0,0,0,0.15)", transition: "transform 0.1s ease" };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      <AppBar />
      <DailyAudio />
      <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden", margin: "16px", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease", transform: isBlackboardMode ? "translateX(-100%)" : "translateX(0%)", background: C.card, display: "flex" }}>
          {presentation ? <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} /> : (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
               <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></div>
               <p style={{ fontSize: "20px", fontWeight: "600" }}>{isLive ? "Waiting for Trainer" : "Class is not live"}</p>
               <p style={{ color: "#8E8E93" }}>{isLive ? "The presentation will appear here once it starts." : "Please wait for the trainer to start the session."}</p>
            </div>
          )}
        </div>
        <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease", transform: isBlackboardMode ? "translateX(0%)" : "translateX(100%)", display: "flex", background: "#1A1A1A" }}>
          <DrawingBlackboard isTrainer={false} strokes={liveState?.blackboardStrokes || []} courseId={`${courseId}-learner`} />
        </div>
      </div>

      <div style={{ position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "16px", padding: "10px", background: "rgba(28, 28, 30, 0.8)", backdropFilter: "blur(20px)", borderRadius: "32px", border: "1px solid rgba(255,255,255,0.1)", zIndex: 10 }}>
        <button onClick={exitClassroom} style={{ ...btnStyle, background: "#E5E5EA", color: "#1C1C1E" }} title="Exit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg></button>
        <button onClick={toggleMic} style={{ ...btnStyle, background: isMicOn ? C.green : "#E5E5EA", color: isMicOn ? "#fff" : "#1C1C1E" }} title="Mic">
          {isMicOn ? <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
        </button>
        <button onClick={toggleRaiseHand} style={{ ...btnStyle, background: hasRaisedHand ? C.orange : "#E5E5EA", color: hasRaisedHand ? "#fff" : "#1C1C1E" }} title="Raise Hand"><span style={{ fontSize: "24px" }}>✋</span></button>
      </div>

      <ClassChat courseId={courseId || ""} videoTrack={trainerVideoTrack} isMicOn={isMicOn} toggleMic={toggleMic} hasMicPermission={hasMicPermission} />
    </div>
  );
}