// src/user/Classroom.tsx
import { useEffect, useState, useRef, type CSSProperties } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import AppBar from "../components/AppBar";
import { useDaily, useDailyEvent } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#2b2b38", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#030303", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", orange: "#FF9F0A", orangeBg: "#FFF6EB",
  green: "#34C759", greenBg: "#EAF9EE", panelBg: "#F8F9FA", purple: "#AF52DE", purpleBg: "#F5F0FF"
};

export default function Classroom() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  
  const [presentation, setPresentation] = useState<CourseMaterial | null>(null);
  const [liveState, setLiveState] = useState<LivePresentation | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [hasRaisedHand, setHasRaisedHand] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [isBlackboardMode, setIsBlackboardMode] = useState(false);

  const [dbUser, setDbUser] = useState<any>(null);
  
  const daily = useDaily();
  const [isMicOn, setIsMicOn] = useState(false);
  const [isVoiceJoined, setIsVoiceJoined] = useState(false);
  const [hasMicPermission, setHasMicPermission] = useState(false);
  
  const [trainerVideoTrack, setTrainerVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);

  useDailyEvent("track-started", (event: any) => {
    if (!event.participant?.local && event.track?.kind === "video") {
      setTrainerVideoTrack(event.track as MediaStreamTrack);
    }
  });

  useDailyEvent("track-stopped", (event: any) => {
    if (!event.participant?.local && event.track?.kind === "video") {
      setTrainerVideoTrack(null);
    }
  });

  useDailyEvent("local-audio-level", () => {});

  useEffect(() => {
    const localUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    
    // ✅ FIX: Do NOT call navigate("/") here. App.tsx handles redirects.
    if (!localUser.id || localUser.role !== 'trainee') { return; }
    setDbUser(localUser);

    if (courseId) {
      supabase.from("active_attendances").upsert({
        user_id: localUser.id, course_id: courseId, tenant_id: localUser.tenantId
      }).then(() => {});
    }

    const handleBeforeUnload = () => {
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      supabase.from("active_attendances").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      supabase.from("raised_hands").delete().eq("user_id", localUser.id).eq("course_id", courseId || "").then(() => {});
      localStorage.removeItem("activeAttendanceCourseId");
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
    } catch (error) {
      console.error("Failed to create Daily room:", error);
      return null;
    }
  }

  useEffect(() => {
    if (isLive && daily && !isVoiceJoined) {
      const autoJoinRoom = async () => {
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        try {
          await daily.join({ url: roomUrl, audioSource: true, videoSource: false });
          await daily.setLocalAudio(false); 
          setIsVoiceJoined(true);
        } catch (e) {
          console.error("Auto-join error:", e);
        }
      };
      autoJoinRoom();
    }
  }, [isLive, daily, isVoiceJoined]);

  useEffect(() => {
    if (!courseId) return;

    const fetchLiveData = async () => {
      const { data: liveSess, error: lsErr } = await supabase.from("live_session").select("*").eq("course_id", courseId).limit(1).maybeSingle();
      if (lsErr) console.error("Live session error:", lsErr.message);
      setIsLive(liveSess?.active ?? false);

      const { data: livePres, error: lpErr } = await supabase.from("live_presentations").select("*").eq("course_id", courseId).limit(1).maybeSingle();
      if (lpErr) console.error("Live presentation error:", lpErr.message);

      if (livePres) {
        setLiveState({
          id: livePres.id, courseId: livePres.course_id, materialId: livePres.material_id || "",
          isBlackboard: livePres.is_blackboard ?? false,
          blackboardStrokes: (livePres.blackboard_strokes as Stroke[]) || [],
          blackboardLines: (livePres.blackboard_lines as string[]) || [],
          blackboardLabels: (livePres.blackboard_labels as Array<{ text: string; x: number; y: number }>) || [],
          currentPage: livePres.current_page ?? 1, tenantId: livePres.tenant_id,
        });
        setIsBlackboardMode(livePres.is_blackboard ?? false);

        if (livePres.material_id) {
          const { data: mat, error: mErr } = await supabase.from("course_materials").select("id, course_id, tenant_id, title, description, file_data, file_name, file_type, allow_download, uploaded_by, uploaded_at, created_at, is_presentation, presentation_order").eq("id", livePres.material_id).limit(1).maybeSingle();
          if (mErr) console.error("Material error:", mErr.message);
          if (mat) {
            setPresentation({
              id: mat.id, courseId: mat.course_id, tenantId: mat.tenant_id, title: mat.title || "Untitled", description: mat.description || "",
              fileUrl: mat.file_data || "", fileName: mat.file_name || mat.title || "Untitled", fileType: mat.file_type || "application/octet-stream",
              allowDownload: mat.allow_download ?? true, uploadedBy: mat.uploaded_by || "", uploadedAt: mat.uploaded_at || mat.created_at || "",
              isPresentation: mat.is_presentation ?? false, presentationOrder: mat.presentation_order ?? 0
            });
          } else setPresentation(null);
        } else setPresentation(null);
      } else { setLiveState(null); setIsBlackboardMode(false); setPresentation(null); }
    };

    fetchLiveData();

    const channel = supabase.channel(`learner-classroom-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presentations", filter: `course_id=eq.${courseId}` }, async (payload: any) => {
        if (payload.eventType === 'DELETE') { setLiveState(null); setPresentation(null); setIsBlackboardMode(false); return; }
        
        const newPres = payload.new;
        setLiveState({
          id: newPres.id, courseId: newPres.course_id, materialId: newPres.material_id || "", isBlackboard: newPres.is_blackboard ?? false,
          blackboardStrokes: (newPres.blackboard_strokes as Stroke[]) || [], blackboardLines: (newPres.blackboard_lines as string[]) || [],
          blackboardLabels: (newPres.blackboard_labels as Array<{ text: string; x: number; y: number }>) || [], currentPage: newPres.current_page ?? 1,
          tenantId: newPres.tenant_id,
        });
        setIsBlackboardMode(newPres.is_blackboard ?? false);

        if (newPres.material_id) {
          const { data: mat, error: mErr } = await supabase.from("course_materials").select("id, course_id, tenant_id, title, description, file_data, file_name, file_type, allow_download, uploaded_by, uploaded_at, created_at, is_presentation, presentation_order").eq("id", newPres.material_id).limit(1).maybeSingle();
          if (mErr) console.error("Material fetch error:", mErr.message);
          if (mat) {
            setPresentation({
              id: mat.id, courseId: mat.course_id, tenantId: mat.tenant_id, title: mat.title || "Untitled", description: mat.description || "",
              fileUrl: mat.file_data || "", fileName: mat.file_name || mat.title || "Untitled", fileType: mat.file_type || "application/octet-stream",
              allowDownload: mat.allow_download ?? true, uploadedBy: mat.uploaded_by || "", uploadedAt: mat.uploaded_at || mat.created_at || "",
              isPresentation: mat.is_presentation ?? false, presentationOrder: mat.presentation_order ?? 0
            });
          } else setPresentation(null);
        } else setPresentation(null);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "live_session", filter: `course_id=eq.${courseId}` }, fetchLiveData)
      .on("postgres_changes", { event: "*", schema: "public", table: "raised_hands", filter: `course_id=eq.${courseId}` }, async (payload: any) => {
        if (payload.new?.user_id === dbUser?.id) setHasRaisedHand(true);
        if (payload.old?.user_id === dbUser?.id) setHasRaisedHand(false);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "allowed_speakers", filter: `course_id=eq.${courseId}` }, async (payload: any) => {
        if (payload.new?.user_id === dbUser?.id) {
          setHasMicPermission(true);
        } else if (payload.old?.user_id === dbUser?.id) {
          setHasMicPermission(false);
          setHasRaisedHand(false); 
          if (daily && isVoiceJoined) {
            try { await daily.setLocalAudio(false); setIsMicOn(false); } catch (e) {}
          }
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, dbUser?.id]);

  async function toggleMic() {
    if (!daily || !isVoiceJoined) return;
    
    if (!hasMicPermission && !isMicOn) {
      alert("Please raise your hand 🖐️ and wait for the trainer to allow you to speak.");
      return;
    }
    
    try { 
      const n = !isMicOn; 
      await daily.setLocalAudio(n); 
      setIsMicOn(n); 
    } catch (e) { 
      console.error("Daily.co Mic Toggle Error:", e); 
    }
  }

  async function toggleRaiseHand() {
    if (!dbUser?.id || !courseId) return;
    if (hasRaisedHand) {
      await supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
      setHasRaisedHand(false);
    } else {
      await supabase.from("raised_hands").insert({
        id: crypto.randomUUID(),
        user_id: dbUser.id, course_id: courseId, tenant_id: dbUser.tenantId, created_at: new Date().toISOString()
      });
      setHasRaisedHand(true);
    }
  }

  async function exitClassroom() {
    if (daily && isVoiceJoined) {
      try { await daily.leave(); } catch (e) {}
    }
    if (dbUser?.id && courseId) {
      await supabase.from("active_attendances").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
      await supabase.from("raised_hands").delete().eq("user_id", dbUser.id).eq("course_id", courseId);
    }
    localStorage.removeItem("activeAttendanceCourseId");
    navigate("/user");
  }

  const videoTileContainerStyle: CSSProperties = isVideoExpanded ? {
    position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", borderRadius: 0, overflow: "hidden", border: "none", zIndex: 1000, background: "#000"
  } : {
    position: "absolute", bottom: "32px", right: "32px", width: "200px", height: "130px", borderRadius: "16px", overflow: "hidden", border: "3px solid #FFFFFF", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 10, background: "#000",
  };

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", overflow: "hidden" }}>
      <AppBar />
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0, width: "100%", boxSizing: "border-box", position: "relative" }}>
        <div style={{ flex: "1 1 auto", minWidth: 0, background: C.bg, padding: "16px", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", position: "relative", overflow: "hidden", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.04)" }}>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease-in-out, opacity 0.2s ease-in-out", transform: isBlackboardMode ? "translateX(-100%)" : "translateX(0%)", opacity: isBlackboardMode ? 0 : 1, pointerEvents: isBlackboardMode ? "none" : "auto", zIndex: isBlackboardMode ? 1 : 2, display: "flex", background: C.card, overflow: "hidden" }}>
              {presentation ? (
                <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} />
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  </div>
                  <p style={{ color: C.textPrimary, fontSize: "20px", fontWeight: "600", margin: "0 0 6px 0" }}>{isLive ? "Waiting for Trainer" : "Class is not live"}</p>
                  <p style={{ color: C.textTertiary, fontSize: "15px", margin: 0 }}>{isLive ? "The presentation will appear here once it starts." : "Please wait for the trainer to start the session."}</p>
                </div>
              )}
            </div>

            <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, right: 0, transition: "transform 0.2s ease-in-out, opacity 0.2s ease-in-out", transform: isBlackboardMode ? "translateX(0%)" : "translateX(100%)", opacity: isBlackboardMode ? 1 : 0, pointerEvents: isBlackboardMode ? "auto" : "none", zIndex: isBlackboardMode ? 2 : 1, display: "flex", overflow: "hidden" }}>
              <div style={{ flex: 1, position: "relative", background: "#1A1A1A" }}>
                <DrawingBlackboard isTrainer={false} strokes={liveState?.blackboardStrokes || []} courseId={`${courseId}-learner`} />
                <div style={{ position: "absolute", top: 24, left: 24, right: 24, bottom: 24, pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 12 }}>
                  {(liveState?.blackboardLines || []).map((line, i) => (
                    <p key={i} style={{ color: "#FFFFFF", fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif", fontSize: "28px", margin: 0, lineHeight: "1.4", textShadow: "0 0 2px rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.1)", padding: "8px 16px", borderRadius: "12px", maxWidth: "80%" }}>{line}</p>
                  ))}
                </div>
                <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                  {(liveState?.blackboardLabels || []).map((label, i) => (
                    <span key={i} style={{ position: "absolute", left: `${label.x}%`, top: `${label.y}%`, transform: "translate(-50%, -50%)", color: "#FFFFFF", fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif", fontSize: "24px", fontWeight: "bold", textShadow: "0 0 3px rgba(0,0,0,0.8)" }}>{label.text}</span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{ width: isChatOpen ? "360px" : "64px", minWidth: 0, background: C.panelBg, display: "flex", flexDirection: "column", overflow: "hidden", transition: "width 0.3s ease", borderLeft: `1px solid ${C.separator}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px", borderBottom: `1px solid ${C.separator}`, background: C.card, flexShrink: 0 }}>
            {isChatOpen && <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", color: C.textPrimary }}>Chat & Actions</h3>}
            <button onClick={() => setIsChatOpen(!isChatOpen)} style={{ background: "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", borderRadius: "8px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", color: C.textPrimary, marginLeft: "auto" }}>
              {isChatOpen ? <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg> : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>}
            </button>
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", opacity: isChatOpen ? 1 : 0, transition: "opacity 0.2s ease" }}>
            {courseId && <ClassChat courseId={courseId} />}
          </div>
          
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "12px", padding: "16px", borderTop: `1px solid ${C.separator}`, background: C.card, flexDirection: isChatOpen ? "row" : "column", flexShrink: 0 }}>
            <button onClick={exitClassroom} style={{ width: "48px", height: "48px", borderRadius: "50%", border: "none", cursor: "pointer", background: C.bg, color: C.textPrimary, boxShadow: "0 2px 8px rgba(0,0,0,0.05)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }} title="Exit Classroom">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            
            <button 
              onClick={() => toggleMic()} 
              style={{ 
                width: "48px", height: "48px", borderRadius: "50%", border: "none", cursor: hasMicPermission || isMicOn ? "pointer" : "not-allowed", 
                background: isMicOn ? C.green : C.card, color: isMicOn ? "#fff" : C.textPrimary, 
                boxShadow: hasMicPermission && !isMicOn ? `0 0 0 4px ${C.greenBg}, 0 2px 8px rgba(0,0,0,0.1)` : "0 2px 8px rgba(0,0,0,0.1)", 
                display: "flex", alignItems: "center", justifyContent: "center", 
                opacity: !hasMicPermission && !isMicOn ? 0.5 : 1,
                transition: "box-shadow 0.3s ease, background 0.2s ease"
              }} 
              title={hasMicPermission ? (isMicOn ? "Mute Self" : "Unmute Self") : "Raise hand to request mic"}
            >
              {isMicOn ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
              )}
            </button>

            <button onClick={toggleRaiseHand} style={{ width: "48px", height: "48px", borderRadius: "50%", border: "none", cursor: "pointer", background: hasRaisedHand ? C.orange : C.card, color: hasRaisedHand ? "#fff" : C.textPrimary, boxShadow: "0 2px 8px rgba(0,0,0,0.1)", display: "flex", alignItems: "center", justifyContent: "center" }} title={hasRaisedHand ? "Lower Hand" : "Raise Hand"}>
              <span style={{ fontSize: "24px" }}>✋</span>
            </button>
          </div>
        </div>

        {trainerVideoTrack && (
          <div style={videoTileContainerStyle}>
            <VideoTile videoTrack={trainerVideoTrack} />
            <button 
              onClick={() => setIsVideoExpanded(!isVideoExpanded)} 
              style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
            >
              {isVideoExpanded ? "Collapse" : "Expand"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function VideoTile({ videoTrack }: { videoTrack: MediaStreamTrack | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!videoRef.current || !videoTrack) return;
    const stream = new MediaStream([videoTrack]);
    videoRef.current.srcObject = stream;
    return () => { if (videoRef.current) videoRef.current.srcObject = null; };
  }, [videoTrack]);
  return <video ref={videoRef} autoPlay muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" }} />;
}