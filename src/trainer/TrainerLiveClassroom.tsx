// src/trainer/TrainerLiveClassroom.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, User, BusinessSettings, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard, { type ToolType, type FontOptions } from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import { useDaily, useDailyEvent } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF",
  red: "#FF3B30", redBg: "#FFEFEE", purple: "#AF52DE", purpleBg: "#F5F0FF",
  orange: "#FF9F0A", orangeBg: "#FFF6EB", green: "#34C759", greenBg: "#EAF9EE",
  iosBtnBg: "#E5E5EA", panelBg: "#F8F9FA"
};

function getFileMeta(fileType: string) {
  if (fileType.includes("pdf")) return { icon: "📄", color: C.red, bg: C.redBg, label: "PDF" };
  if (fileType.includes("video")) return { icon: "🎬", color: C.purple, bg: C.purpleBg, label: "Video" };
  if (fileType.includes("audio")) return { icon: "🎵", color: C.purple, bg: C.purpleBg, label: "Audio" };
  if (fileType.includes("image")) return { icon: "🖼️", color: C.green, bg: C.greenBg, label: "Image" };
  if (fileType.includes("presentation") || fileType.includes("ppt")) return { icon: "📊", color: C.orange, bg: C.orangeBg, label: "Slides" };
  if (fileType.includes("word") || fileType.includes("document")) return { icon: "📝", color: C.medBlue, bg: C.medBlueBg, label: "Document" };
  return { icon: "📁", color: C.textTertiary, bg: C.bg, label: "File" };
}

declare global { interface Window { activeTrainerCourse: string | undefined; } }
window.activeTrainerCourse = window.activeTrainerCourse || undefined;

function mapMaterial(m: Record<string, unknown>): CourseMaterial {
  return {
    id: m.id as string,
    courseId: m.course_id as string,
    tenantId: m.tenant_id as string,
    title: (m.title as string) || "Untitled",
    description: (m.description as string) || "",
    fileUrl: (m.file_data as string) || (m.file_url as string) || "",
    fileName: (m.file_name as string) || (m.title as string) || "Untitled",
    fileType: (m.file_type as string) || "application/octet-stream",
    allowDownload: (m.allow_download as boolean) ?? true,
    uploadedBy: (m.uploaded_by as string) || "",
    uploadedAt: (m.uploaded_at as string) || (m.created_at as string) || "",
    isPresentation: (m.is_presentation as boolean) ?? false,
    presentationOrder: (m.presentation_order as number) ?? 0
  };
}

export default function TrainerLiveClassroom() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const tenantId = currentUser.tenantId;

  const [sessionActive, setSessionActive] = useState(false);
  const [presentation, setPresentation] = useState<CourseMaterial | null>(null);
  const [liveState, setLiveState] = useState<LivePresentation | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [raisedHands, setRaisedHands] = useState<Array<Record<string, unknown> & { username?: string }>>([]);
  const [activeLearners, setActiveLearners] = useState<User[]>([]);
  const [settings, setSettings] = useState<BusinessSettings | null>(null);
  const [trainer, setTrainer] = useState<Record<string, unknown> | null>(null);
  const [activeSpeakerIds, setActiveSpeakerIds] = useState<string[]>([]);

  const [isBlackboardMode, setIsBlackboardMode] = useState(false);
  const [isVideoExpanded, setIsVideoExpanded] = useState(false);
  const [bbInput, setBbInput] = useState("");
  const [activeTool, setActiveTool] = useState<ToolType | "label">("pen");
  const [penColor, setPenColor] = useState("#FFFFFF");
  const [penWidth, setPenWidth] = useState(4);
  const [eraserSize, setEraserSize] = useState(30);
  const [fontOptions] = useState<FontOptions>({ fontFamily: "Arial", fontSize: 24, fontColor: "#FFFFFF", fontWeight: "normal", fontStyle: "normal" });

  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const daily = useDaily();
  const [isMicOn, setIsMicOn] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVoiceJoined, setIsVoiceJoined] = useState(false);
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);

  useDailyEvent("track-started", (event) => {
    if (event.participant?.local && event.track?.kind === "video") setVideoTrack(event.track as unknown as MediaStreamTrack);
  });

  useDailyEvent("track-stopped", (event) => {
    if (event.participant?.local && event.track?.kind === "video") setVideoTrack(null);
  });

  useEffect(() => {
    const fetchInitial = async () => {
      if (!tenantId) return;
      const { data: s } = await supabase.from("business_settings").select("*").eq("tenant_id", tenantId).maybeSingle();
      if (s) setSettings({
        id: s.id, businessName: s.business_name || "", address: s.address || "", phone: s.phone || "",
        email: s.email || "", website: s.website || "", logo: s.logo || "", header: s.header || "",
        adminProfile: s.admin_profile || "", loginBackground: s.login_background || "", themeColor: s.theme_color || "",
        appBarItems: s.app_bar_items || [], tenantId: s.tenant_id, createdAt: s.created_at,
      });

      const { data: u } = await supabase.from("profile_settings").select("*").eq("user_id", currentUser.id).maybeSingle();
      if (u) setTrainer(u);
      else setTrainer(currentUser);
    };
    fetchInitial();
  }, [currentUser.id, tenantId]);

  useEffect(() => {
    if (window.activeTrainerCourse && window.activeTrainerCourse !== courseId) {
      alert("You can only host one live lesson at a time.");
      navigate("/trainer");
      return;
    }
    window.activeTrainerCourse = courseId;
    return () => { window.activeTrainerCourse = undefined; };
  }, [courseId, navigate]);

  const fetchLiveData = useCallback(async () => {
    if (!courseId || !tenantId || !currentUser.id) return;

    const { data: liveSess } = await supabase.from("live_session").select("*").eq("course_id", courseId).maybeSingle();
    setSessionActive(liveSess?.active ?? false);

    const { data: livePres } = await supabase.from("live_presentations").select("*").eq("course_id", courseId).maybeSingle();

    if (livePres) {
      setLiveState({
        id: livePres.id, courseId: livePres.course_id, materialId: livePres.material_id || "",
        isBlackboard: livePres.is_blackboard ?? false,
        blackboardStrokes: (livePres.blackboard_strokes as Stroke[]) || [],
        blackboardLines: (livePres.blackboard_lines as string[]) || [],
        blackboardLabels: (livePres.blackboard_labels as Array<{ text: string; x: number; y: number }>) || [],
        startedBy: livePres.started_by, updatedAt: livePres.updated_at, currentPage: livePres.current_page ?? 1,
        tenantId: livePres.tenant_id,
      });
      setIsBlackboardMode(livePres.is_blackboard ?? false);

      if (livePres.material_id) {
        const { data: mat } = await supabase.from("course_materials").select("*").eq("id", livePres.material_id).maybeSingle();
        setPresentation(mat ? mapMaterial(mat) : null);
      } else setPresentation(null);
    } else {
      setLiveState(null); setIsBlackboardMode(false); setPresentation(null);
    }

    const { data: mats } = await supabase.from("course_materials").select("*").eq("course_id", courseId).order("presentation_order", { ascending: true });
    setMaterials(mats && mats.length > 0 ? mats.map(mapMaterial) : []);

    const { data: hands } = await supabase.from("raised_hands").select("*").eq("course_id", courseId);
    if (hands && hands.length > 0) {
      const userIds = hands.map((h: Record<string, unknown>) => h.user_id as string);
      const { data: handUsers } = await supabase.from("users").select("id, username").in("id", userIds);
      const userMap = new Map((handUsers || []).map((u: Record<string, unknown>) => [u.id as string, u.username as string]));
      setRaisedHands(hands.filter((h: Record<string, unknown>) => userMap.has(h.user_id as string)).map((h: Record<string, unknown>) => ({ ...h, username: userMap.get(h.user_id as string)! })).sort((a: Record<string, unknown>, b: Record<string, unknown>) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime()));
    } else setRaisedHands([]);

    const { data: atts } = await supabase.from("active_attendances").select("user_id").eq("course_id", courseId);
    if (atts && atts.length > 0) {
      const attUserIds = atts.map((a: Record<string, unknown>) => a.user_id as string).filter((id: string) => id !== currentUser.id);
      const { data: attUsers } = await supabase.from("users").select("*").in("id", attUserIds).eq("role", "trainee");
      setActiveLearners(attUsers ? attUsers.map((u: Record<string, unknown>) => ({
        id: u.id as string, username: u.username as string, email: (u.email as string) || "", password: (u.password as string) || "",
        role: (u.role as "trainer" | "trainee" | "admin"), profilePic: (u.profile_pic as string) || "", phone: (u.phone as string) || "",
        assignedCourses: (u.assigned_courses as string[]) || [], tenantId: u.tenant_id as string, createdAt: u.created_at as string,
      })) : []);
    } else setActiveLearners([]);

    const { data: speakers } = await supabase.from("allowed_speakers").select("user_id").eq("course_id", courseId);
    setActiveSpeakerIds(speakers ? speakers.map((s: Record<string, unknown>) => s.user_id as string) : []);
  }, [courseId, tenantId, currentUser.id]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (!courseId) return;
    const handleDebouncedFetch = () => {
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
      fetchTimerRef.current = setTimeout(() => fetchLiveData(), 300);
    };

    const channel = supabase.channel(`live-classroom-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_session", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presentations", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "course_materials", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "raised_hands", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_attendances", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "allowed_speakers", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current);
    };
  }, [courseId, fetchLiveData]);

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
      alert("Could not connect to the live room server.");
      return null;
    }
  }

  async function toggleMic() {
    if (!daily) return alert("Audio room is not connected yet.");
    if (!isVoiceJoined) {
      try {
        setIsConnecting(true);
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        await daily.join({ url: roomUrl, audioSource: true, videoSource: false });
        setIsVoiceJoined(true); setIsMicOn(true);
      } catch (e: unknown) {
        const err = e as { errorMsg?: string; message?: string };
        console.error("Daily.co Mic Error:", e);
        alert(`Failed to connect to audio room: ${err?.errorMsg || err?.message || String(e)}`);
      } finally { setIsConnecting(false); }
      return;
    }
    try { const n = !isMicOn; await daily.setLocalAudio(n); setIsMicOn(n); } catch (e) { console.error(e); }
  }

  async function toggleCam() {
    if (!daily) return alert("Audio room is not connected yet.");
    if (!isVoiceJoined) {
      try {
        setIsConnecting(true);
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        await daily.join({ url: roomUrl, audioSource: true, videoSource: true });
        await daily.setLocalVideo(true);
        setIsVoiceJoined(true); setIsMicOn(true); setIsCamOn(true);
      } catch (e: unknown) {
        const err = e as { errorMsg?: string; message?: string };
        console.error("Daily.co Cam Error:", e);
        alert(`Failed to connect to video room: ${err?.errorMsg || err?.message || String(e)}`);
      } finally { setIsConnecting(false); }
      return;
    }
    try {
      const n = !isCamOn; await daily.setLocalVideo(n); setIsCamOn(n);
      if (n && !isMicOn) { await daily.setLocalAudio(true); setIsMicOn(true); }
    } catch (e) { console.error(e); }
  }

  async function toggleBlackboard() {
    if (!courseId || !tenantId) return;
    setActiveTool("pen");
    const newMode = !isBlackboardMode;
    setIsBlackboardMode(newMode);
    if (newMode) setPresentation(null);
    else if (materials.length > 0) {
      const currentMatId = liveState?.materialId || materials[0].id;
      setPresentation(materials.find(m => m.id === currentMatId) || materials[0]);
    }

    if (liveState?.id) {
      await supabase.from("live_presentations").update({ is_blackboard: newMode, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert({
        id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id,
        material_id: "", current_page: 1, is_blackboard: newMode, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString(),
      });
    }
  }

  async function handleStrokeEnd(points: { x: number; y: number }[], tool: ToolType, color?: string, width?: number) {
    if (!liveState?.id) return;
    const newStroke = { id: crypto.randomUUID(), points, color: color || "#FFFFFF", width: width || 4, tool: tool || "pen" };
    setLiveState(prev => {
      if (!prev) return prev;
      const updatedStrokes = [...(prev.blackboardStrokes || []), newStroke];
      supabase.from("live_presentations").update({ blackboard_strokes: updatedStrokes }).eq("id", prev.id).then(() => {});
      return { ...prev, blackboardStrokes: updatedStrokes };
    });
  }

  async function handleErase(eraserPos: { x: number; y: number }, radius: number) {
    if (!liveState?.id) return;
    const currentStrokes = liveState.blackboardStrokes || [];
    const newStrokes: Stroke[] = [];
    for (const stroke of currentStrokes) {
      const segments: { x: number; y: number }[][] = [];
      let currentSegment: { x: number; y: number }[] = [];
      for (const p of stroke.points) {
        if (Math.hypot(p.x - eraserPos.x, p.y - eraserPos.y) < radius) {
          if (currentSegment.length > 0) { segments.push(currentSegment); currentSegment = []; }
        } else currentSegment.push(p);
      }
      if (currentSegment.length > 0) segments.push(currentSegment);
      for (const seg of segments) newStrokes.push({ id: crypto.randomUUID(), points: seg, color: stroke.color, width: stroke.width, tool: stroke.tool });
    }
    setLiveState(prev => {
      if (!prev) return prev;
      supabase.from("live_presentations").update({ blackboard_strokes: newStrokes }).eq("id", prev.id).then(() => {});
      return { ...prev, blackboardStrokes: newStrokes };
    });
  }

  async function clearBlackboard() {
    if (!liveState?.id) return;
    setLiveState(prev => prev ? { ...prev, blackboardStrokes: [], blackboardLines: [], blackboardLabels: [] } : null);
    await supabase.from("live_presentations").update({ blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [] }).eq("id", liveState.id);
  }

  async function sendBlackboardLine() {
    if (!bbInput.trim() || !liveState?.id) return;
    const newLine = bbInput.trim();
    setBbInput("");
    setLiveState(prev => {
      if (!prev) return prev;
      const updatedLines = [...(prev.blackboardLines || []), newLine];
      supabase.from("live_presentations").update({ blackboard_lines: updatedLines }).eq("id", prev.id).then(() => {});
      return { ...prev, blackboardLines: updatedLines };
    });
  }

  async function handleCanvasClick(e: React.MouseEvent) {
    if (activeTool !== "label" || !bbInput.trim() || !liveState?.id) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const newLabel = { text: bbInput.trim(), x, y };
    setBbInput(""); setActiveTool("pen");
    setLiveState(prev => {
      if (!prev) return prev;
      const updatedLabels = [...(prev.blackboardLabels || []), newLabel];
      supabase.from("live_presentations").update({ blackboard_labels: updatedLabels }).eq("id", prev.id).then(() => {});
      return { ...prev, blackboardLabels: updatedLabels };
    });
  }

  function selectTool(tool: ToolType | "label") { setActiveTool(tool); }

  async function changePage(delta: number) {
    if (!liveState?.id || !courseId || materials.length === 0) return;
    
    const currentMatId = liveState.materialId;
    const currentIndex = materials.findIndex(m => m.id === currentMatId);
    const safeIndex = currentIndex === -1 ? 0 : currentIndex;
    
    let nextIndex = safeIndex + delta;
    if (nextIndex < 0) nextIndex = 0;
    if (nextIndex >= materials.length) nextIndex = materials.length - 1;
    
    if (nextIndex === safeIndex && delta !== 0) return;

    const nextMat = materials[nextIndex];
    if (!nextMat) return;

    await supabase.from("live_presentations").update({
      material_id: nextMat.id,
      current_page: 1, 
      updated_at: new Date().toISOString()
    }).eq("id", liveState.id);

    setPresentation(nextMat);
    setLiveState(prev => prev ? { ...prev, materialId: nextMat.id, currentPage: 1 } : prev);
  }

  async function allowStudentToSpeak(userId: string) {
    if (!courseId || !tenantId) return;
    try {
      await supabase.from("raised_hands").delete().eq("user_id", userId).eq("course_id", courseId);
      await supabase.from("allowed_speakers").insert({ id: crypto.randomUUID(), user_id: userId, course_id: courseId, tenant_id: tenantId });
    } catch (error) {
      console.error("Failed to allow student:", error);
      alert("Could not grant mic permission to student.");
    }
  }

  async function muteStudent(userId: string) {
    if (!daily || !courseId) return;
    try {
      if (daily.participants()[userId]) await daily.updateParticipant(userId, { setAudio: false });
      await supabase.from("allowed_speakers").delete().eq("user_id", userId).eq("course_id", courseId);
    } catch (error) { console.error("Failed to mute student:", error); }
  }

  async function startSession() {
    if (!courseId || !tenantId) return;
    const { data: existing } = await supabase.from("live_session").select("id").eq("course_id", courseId).maybeSingle();
    if (existing) {
      await supabase.from("live_session").update({ active: true, updated_at: new Date().toISOString() }).eq("id", existing.id);
    } else {
      await supabase.from("live_session").insert({
        id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, trainer_id: currentUser.id, active: true,
        started_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_at: new Date().toISOString(),
      });
    }
    setSessionActive(true);

    if (materials.length > 0 && !presentation) {
      const firstMat = materials[0];
      setPresentation(firstMat); setIsBlackboardMode(false);
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert({
        id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id,
        material_id: firstMat.id, current_page: 1, is_blackboard: false, blackboard_strokes: [], blackboard_lines: [],
        blackboard_labels: [], updated_at: new Date().toISOString(),
      });
    }

    if (daily && !isVoiceJoined) {
      try {
        setIsConnecting(true);
        const roomUrl = await getDailyRoomUrl();
        if (!roomUrl) return;
        await daily.join({ url: roomUrl, audioSource: true, videoSource: false });
        setIsVoiceJoined(true); setIsMicOn(true);
      } catch (e: unknown) {
        const err = e as { errorMsg?: string; message?: string };
        console.error("Daily.co Join Error:", e);
        alert(`Failed to connect to the Daily.co audio room: ${err?.errorMsg || err?.message || String(e)}`);
      } finally { setIsConnecting(false); }
    }
  }

  async function stopSession() {
    if (!courseId) return;
    await supabase.from("live_session").update({ active: false, updated_at: new Date().toISOString() }).eq("course_id", courseId);
    await supabase.from("live_presentations").delete().eq("course_id", courseId);
    if (daily && isVoiceJoined) {
      daily.leave(); setIsVoiceJoined(false); setIsMicOn(false); setIsCamOn(false); setVideoTrack(null);
    }
    navigate("/trainer");
  }

  async function selectPage(materialId: string) {
    if (!courseId || !tenantId) return;
    setActiveTool("pen");
    const selectedMat = materials.find(m => m.id === materialId);
    if (selectedMat) { setPresentation(selectedMat); setIsBlackboardMode(false); }

    if (liveState?.id) {
      await supabase.from("live_presentations").update({ material_id: materialId, is_blackboard: false, current_page: 1, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert({
        id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id, material_id: materialId,
        current_page: 1, is_blackboard: false, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString(),
      });
    }
  }

  function handleLogout() {
    if (sessionActive && courseId) {
      supabase.from("live_session").update({ active: false }).eq("course_id", courseId);
      supabase.from("live_presentations").delete().eq("course_id", courseId);
      if (daily && isVoiceJoined) daily.leave();
    }
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId");
    window.dispatchEvent(new Event("authStateChanged"));
    navigate("/login");
  }

  const iosBtnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "10px", border: "none", borderRadius: "10px",
    flex: 1, cursor: "pointer", transition: "transform 0.1s ease, opacity 0.2s ease", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", WebkitTapHighlightColor: "transparent",
  };

  const toolBtnStyle = (isActive: boolean): React.CSSProperties => ({
    width: "44px", height: "44px", borderRadius: "12px", border: "none",
    background: isActive ? "rgba(0, 165, 244, 0.2)" : "transparent", color: isActive ? "#00A5F4" : "#8E8E93",
    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease", flexShrink: 0,
  });

  const businessName = settings?.businessName || "";
  const businessLogo = settings?.logo;
  const phone = settings?.phone || "";

  const videoTileContainerStyle: React.CSSProperties = isVideoExpanded ? {
    position: "fixed", top: 0, left: 0, width: "100vw", height: "100vh", borderRadius: 0, overflow: "hidden", border: "none", zIndex: 1000, background: "#000"
  } : {
    position: "absolute", bottom: "32px", right: "32px", width: "200px", height: "130px", borderRadius: "16px", overflow: "hidden", border: "3px solid #FFFFFF", boxShadow: "0 8px 24px rgba(0,0,0,0.15)", zIndex: 10, background: "#000",
  };

  const drawingActiveTool = activeTool === "label" ? "pen" as ToolType : activeTool;

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(249, 249, 249, 0.8)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", borderBottom: "0.33px solid " + C.separator, flexShrink: 0, zIndex: 10, width: "100%", boxSizing: "border-box", flexWrap: "wrap", gap: "8px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "200px" }}>
          {businessLogo && <img src={businessLogo} alt="Logo" style={{ width: "32px", height: "32px", borderRadius: "8px", objectFit: "cover", flexShrink: 0 }} />}
          {(businessName || phone) && (
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0, justifyContent: "center" }}>
              {businessName && <h1 style={{ margin: 0, fontSize: "clamp(14px, 4vw, 16px)", fontWeight: "700", color: C.textPrimary, letterSpacing: "-0.2px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{businessName}</h1>}
              {phone && <a href={"tel:" + phone} style={{ fontSize: "12px", color: C.textTertiary, textDecoration: "none", display: "flex", alignItems: "center", gap: "4px", whiteSpace: "nowrap" }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>{phone}</a>}
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: "20px" }}>
            {(trainer as Record<string, unknown>)?.avatar_url ? <img src={(trainer as Record<string, unknown>).avatar_url as string} alt="Trainer" style={{ width: "28px", height: "28px", borderRadius: "50%", objectFit: "cover" }} /> : <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>{(trainer?.username as string)?.charAt(0).toUpperCase()}</div>}
            <span style={{ fontSize: "13px", fontWeight: "600", color: C.purple }}>{(trainer?.username as string) || ""}</span>
          </div>
          <button onClick={() => navigate("/trainer/settings")} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "9px", background: "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", color: C.textPrimary }} title="Settings">⚙️</button>
          <button onClick={handleLogout} style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "36px", height: "36px", borderRadius: "9px", background: C.redBg, border: "none", cursor: "pointer", color: C.red }} title="Logout"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0, width: "100%", boxSizing: "border-box" }}>
        <div style={{ flex: "0 0 220px", minWidth: "180px", overflowY: "auto", overflowX: "hidden", background: C.panelBg, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px", margin: "12px", background: C.card, borderRadius: "14px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)", flexShrink: 0, display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => navigate("/trainer")} style={{ background: "none", border: "none", color: C.medBlue, cursor: "pointer", display: "flex", alignItems: "center", padding: 0, gap: "4px", fontSize: "14px", fontWeight: "600" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Exit</button>
              {sessionActive ? <button onClick={stopSession} style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer", fontSize: "12px" }}>End Session</button> : <button onClick={startSession} disabled={isConnecting} style={{ padding: "6px 12px", background: C.medBlue, color: "#fff", border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer", fontSize: "12px", opacity: isConnecting ? 0.6 : 1 }}>{isConnecting ? "..." : "Start"}</button>}
            </div>

            {presentation && !isBlackboardMode && (
              <div style={{ display: "flex", alignItems: "center", background: C.bg, borderRadius: "10px", padding: "4px", marginTop: "4px" }}>
                <button onClick={() => changePage(-1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>‹ Prev</button>
                <button onClick={() => changePage(1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>Next ›</button>
              </div>
            )}

            <div style={{ display: "flex", gap: "8px", marginTop: presentation ? "4px" : "0", flexWrap: "wrap" }}>
              <button onClick={toggleMic} disabled={isConnecting} style={{ ...iosBtnStyle, background: isConnecting ? C.iosBtnBg : (isMicOn ? C.green : C.iosBtnBg), color: isConnecting ? C.textTertiary : (isMicOn ? "#FFFFFF" : C.textPrimary), opacity: isConnecting ? 0.7 : 1 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg></button>
              <button onClick={toggleCam} disabled={isConnecting} style={{ ...iosBtnStyle, background: isConnecting ? C.iosBtnBg : (isCamOn ? C.medBlue : C.iosBtnBg), color: isConnecting ? C.textTertiary : (isCamOn ? "#FFFFFF" : C.textPrimary), opacity: isConnecting ? 0.7 : 1 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></button>
              <button onClick={toggleBlackboard} style={{ ...iosBtnStyle, background: isBlackboardMode ? C.purple : C.iosBtnBg, color: isBlackboardMode ? "#FFFFFF" : C.textPrimary }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="20" x2="18" y2="20"/></svg></button>
            </div>

            <div style={{ marginTop: "12px", borderTop: "1px solid " + C.separator, paddingTop: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 0" }}>✋ Raised Hands ({raisedHands.length})</div>
              {raisedHands.length === 0 ? <p style={{ fontSize: "12px", color: C.textTertiary, margin: 0 }}>No hands raised.</p> : <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{raisedHands.map((hand) => (<div key={hand.user_id as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", background: C.orangeBg, borderRadius: "8px" }}><div style={{ display: "flex", flexDirection: "column" }}><span style={{ fontSize: "13px", fontWeight: "600", color: C.textPrimary }}>{(hand.username as string) || "Unknown Student"}</span><span style={{ fontSize: "10px", color: C.textTertiary }}>{Math.floor((Date.now() - new Date(hand.created_at as string).getTime()) / 60000)} min ago</span></div><button onClick={() => allowStudentToSpeak(hand.user_id as string)} style={{ background: C.green, color: "#fff", border: "none", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Allow</button></div>))}</div>}
            </div>
          </div>

          <div style={{ padding: "0 12px 12px 12px" }}>
            <p style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 0" }}>Attending Now ({activeLearners.length})</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
              {activeLearners.length === 0 && <p style={{ fontSize: "12px", color: C.textTertiary }}>No learners active.</p>}
              {activeLearners.map(learner => (<div key={learner.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", background: C.card, borderRadius: "8px" }}><div style={{ display: "flex", alignItems: "center", gap: "8px" }}><div style={{ width: "24px", height: "24px", borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "600" }}>{learner.username?.charAt(0).toUpperCase()}</div><span style={{ fontSize: "12px", fontWeight: "500", color: C.textPrimary }}>{learner.username}</span></div>{activeSpeakerIds.includes(learner.id) && <button onClick={() => muteStudent(learner.id)} style={{ background: C.redBg, color: C.red, border: "none", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>Mute</button>}</div>))}
            </div>

            <p style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 0" }}>Lesson Pages</p>
            {materials.length === 0 ? <div style={{ textAlign: "center" }}><p style={{ fontSize: "14px", color: C.textTertiary, margin: "0 0 12px 0" }}>No pages added yet.</p><button onClick={() => navigate("/trainer/upload/" + courseId)} style={{ width: "100%", padding: "10px", background: C.medBlue, color: "#fff", border: "none", borderRadius: "10px", fontSize: "14px", fontWeight: "600", cursor: "pointer" }}>Upload Pages</button></div> : materials.map((mat) => { const meta = getFileMeta(mat.fileType); const isActive = liveState?.materialId === mat.id && !isBlackboardMode; return (<div key={mat.id} onClick={() => selectPage(mat.id)} style={{ display: "flex", alignItems: "center", padding: "12px", gap: "10px", cursor: "pointer", background: isActive ? C.medBlueBg : C.card, borderRadius: "10px", marginBottom: "6px", boxShadow: isActive ? "none" : "0 1px 2px rgba(0,0,0,0.03)" }}><div style={{ width: "32px", height: "32px", borderRadius: "8px", background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", flexShrink: 0 }}>{meta.icon}</div><div style={{ flex: 1, minWidth: 0, overflow: "hidden" }}><div style={{ fontSize: "14px", color: isActive ? C.medBlue : C.textPrimary, fontWeight: isActive ? "600" : "500", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mat.title}</div><div style={{ fontSize: "11px", color: C.textTertiary, marginTop: "2px" }}>{meta.label}</div></div></div>); })}
          </div>
        </div>

        <div style={{ flex: "1 1 auto", minWidth: 0, background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", width: "200%", height: "100%", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)", transform: isBlackboardMode ? "translateX(-50%)" : "translateX(0%)" }}>
            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", background: C.card, overflow: "hidden", position: "relative" }}>
              {presentation ? (
                <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} />
              ) : (
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" }}>
                  <div style={{ width: "80px", height: "80px", borderRadius: "50%", background: C.medBlueBg, margin: "0 auto 20px", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke={C.medBlue} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
                  <p style={{ color: C.textPrimary, fontSize: "20px", fontWeight: "600", margin: "0 0 6px 0" }}>No Content Presenting</p>
                  <p style={{ color: C.textTertiary, fontSize: "15px", margin: "0 0 24px 0" }}>{materials.length > 0 ? "Click Start, then select a page from the sidebar." : "Upload pages first, then start the session."}</p>
                </div>
              )}
              
              {isCamOn && videoTrack && (
                <div style={videoTileContainerStyle}>
                  <VideoTile videoTrack={videoTrack} />
                  <button onClick={() => setIsVideoExpanded(!isVideoExpanded)} style={{ position: "absolute", top: "8px", right: "8px", background: "rgba(0,0,0,0.5)", border: "none", color: "#fff", borderRadius: "8px", padding: "6px 10px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}>{isVideoExpanded ? "Collapse" : "Expand"}</button>
                </div>
              )}
            </div>

            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#1A1A1A" }}>
              <div style={{ flex: 1, position: "relative", overflow: "hidden", cursor: activeTool === "label" ? "crosshair" : undefined }} onClick={activeTool === "label" ? handleCanvasClick : undefined} onMouseMove={activeTool === "label" ? (e) => { const rect = e.currentTarget.getBoundingClientRect(); const labelPreview = document.getElementById("label-preview"); if (labelPreview) { labelPreview.style.left = (e.clientX - rect.left + 10) + "px"; labelPreview.style.top = (e.clientY - rect.top) + "px"; } } : undefined}>
                <DrawingBlackboard isTrainer={true} strokes={liveState?.blackboardStrokes || []} onStrokeEnd={handleStrokeEnd} onErase={handleErase} activeTool={drawingActiveTool} penColor={penColor} penWidth={penWidth} eraserSize={eraserSize} fontFamily={fontOptions.fontFamily} fontSize={fontOptions.fontSize} fontColor={fontOptions.fontColor} fontWeight={fontOptions.fontWeight} fontStyle={fontOptions.fontStyle} courseId={courseId!} />
                <div style={{ position: "absolute", top: 24, left: 24, right: 24, display: "flex", flexDirection: "column", gap: 8, pointerEvents: "none" }}>{(liveState?.blackboardLines || []).map((line, i) => <div key={i} style={{ background: "rgba(217, 253, 211, 0.95)", color: "#111B21", padding: "10px 14px", borderRadius: "12px 12px 4px 12px", maxWidth: "60%", alignSelf: "flex-end", boxShadow: "0 2px 8px rgba(0,0,0,0.3)", fontSize: "16px", fontWeight: 500 }}>{line}</div>)}</div>
                <div style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none" }}>{(liveState?.blackboardLabels || []).map((label, i) => <span key={i} style={{ position: "absolute", left: label.x + "%", top: label.y + "%", transform: "translate(-50%, -50%)", color: "#FFFFFF", fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif", fontSize: "26px", fontWeight: "bold", textShadow: "0px 2px 4px rgba(0,0,0,0.8)" }}>{label.text}</span>)}</div>
                {activeTool === "label" && bbInput.trim() && <span id="label-preview" style={{ position: "absolute", left: 0, top: 0, transform: "translate(10px, -50%)", color: "rgba(255, 255, 255, 0.7)", fontFamily: "'Comic Sans MS', 'Chalkboard SE', sans-serif", fontSize: "26px", fontWeight: "bold", pointerEvents: "none" }}>{bbInput}</span>}
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#111", padding: "8px 12px", flexShrink: 0, boxSizing: "border-box", overflowX: "auto" }}>
                <button onClick={() => selectTool("pen")} title="Pen" style={toolBtnStyle(activeTool === "pen")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg></button>
                <button onClick={() => selectTool("eraser")} title="Eraser" style={toolBtnStyle(activeTool === "eraser")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4L20 11L11 20"/></svg></button>
                <button onClick={() => selectTool("text")} title="Text" style={toolBtnStyle(activeTool === "text")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/></svg></button>
                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.2)", margin: "0 4px", flexShrink: 0 }} />
                {activeTool === "pen" && <label style={{ ...toolBtnStyle(false), width: "auto", padding: "0 8px", gap: "6px", fontSize: "12px", color: penColor }}><input type="color" value={penColor} onChange={e => setPenColor(e.target.value)} style={{ width: "22px", height: "22px", border: "none", background: "none", cursor: "pointer", padding: 0 }} /></label>}
                {activeTool === "pen" && <input type="range" min="1" max="20" value={penWidth} onChange={e => setPenWidth(Number(e.target.value))} style={{ width: "60px", accentColor: "#00A5F4" }} title={`Pen Size: ${penWidth}px`} />}
                {activeTool === "eraser" && <input type="range" min="10" max="100" value={eraserSize} onChange={e => setEraserSize(Number(e.target.value))} style={{ width: "80px", accentColor: "#00A5F4" }} title={`Eraser Size: ${eraserSize}px`} />}
                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.2)", margin: "0 4px", flexShrink: 0 }} />
                <input type="text" placeholder={activeTool === "label" ? "Click board to pin..." : "Type to write..."} value={bbInput} onChange={(e) => setBbInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && activeTool !== "label") sendBlackboardLine(); }} style={{ flex: 1, minWidth: "100px", background: "transparent", border: "none", outline: "none", color: "#FFF", fontSize: "15px" }} />
                <button onClick={() => bbInput.trim() && selectTool("label")} title="Pin Label" style={toolBtnStyle(activeTool === "label")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg></button>
                <button onClick={sendBlackboardLine} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: bbInput.trim() && activeTool !== "label" ? "#00A5F4" : "rgba(255,255,255,0.1)", color: bbInput.trim() && activeTool !== "label" ? "#fff" : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.2)", margin: "0 4px", flexShrink: 0 }} />
                <button onClick={clearBlackboard} title="Clear Board" style={{ width: "44px", height: "44px", borderRadius: "12px", border: "none", background: "transparent", color: "#FF3B30", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              </div>
            </div>
          </div>
        </div>

        <div style={{ flex: "0 0 300px", minWidth: "240px", background: C.panelBg, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {courseId && <ClassChat courseId={courseId} />}
        </div>
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