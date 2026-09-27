// src/trainer/TrainerLiveClassroom.tsx
import React, { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import type { CourseMaterial, LivePresentation, User, BusinessSettings, Stroke } from "../types";
import LiveClassView from "../components/LiveClassView";
import DrawingBlackboard, { type ToolType, type FontOptions } from "../components/DrawingBlackboard";
import ClassChat from "../components/ClassChat";
import { useDaily, useDailyEvent, DailyAudio } from "@daily-co/daily-react";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { getCourseMaterials } from "../database/materialDB";
import { startLiveSession, endLiveSession, getLiveSession } from "../database/liveSessionDB";
import { startPresentation, getLivePresentation, updatePresentation, clearPresentation } from "../database/livePresentationDB";

const C = { textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", medBlue: "#007AFF", medBlueBg: "#E8F2FF", red: "#FF3B30", redBg: "#FFEFEE", purple: "#AF52DE", purpleBg: "#F5F0FF", orange: "#FF9F0A", orangeBg: "#FFF6EB", green: "#34C759", greenBg: "#EAF9EE", iosBtnBg: "#E5E5EA", panelBg: "#F8F9FA" };

function getFileMeta(fileType: string) {
  if (fileType.includes("pdf")) return { icon: "📄", color: C.red, bg: C.redBg, label: "PDF" };
  if (fileType.includes("video")) return { icon: "🎬", color: C.purple, bg: C.purpleBg, label: "Video" };
  if (fileType.includes("audio")) return { icon: "🎵", color: C.purple, bg: C.purpleBg, label: "Audio" };
  if (fileType.includes("image")) return { icon: "🖼️", color: C.green, bg: C.greenBg, label: "Image" };
  return { icon: "📁", color: C.textTertiary, bg: C.bg, label: "File" };
}

declare global { interface Window { activeTrainerCourse: string | undefined; } }
window.activeTrainerCourse = window.activeTrainerCourse || undefined;

function mapMaterial(m: Record<string, unknown>): CourseMaterial {
  return { id: m.id as string, courseId: m.course_id as string, tenantId: m.tenant_id as string, title: (m.title as string) || "Untitled", description: (m.description as string) || "", fileUrl: (m.file_data as string) || (m.file_url as string) || "", fileName: (m.file_name as string) || (m.title as string) || "Untitled", fileType: (m.file_type as string) || "application/octet-stream", allowDownload: (m.allow_download as boolean) ?? true, uploadedBy: (m.uploaded_by as string) || "", uploadedAt: (m.uploaded_at as string) || (m.created_at as string) || "", isPresentation: (m.is_presentation as boolean) ?? false, presentationOrder: (m.presentation_order as number) ?? 0 };
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
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
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

  useDailyEvent("track-started", (event) => { if (event.participant?.local && event.track?.kind === "video") setVideoTrack(event.track as unknown as MediaStreamTrack); });
  useDailyEvent("track-stopped", (event) => { if (event.participant?.local && event.track?.kind === "video") setVideoTrack(null); });

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
    if (window.activeTrainerCourse && window.activeTrainerCourse !== courseId) { alert("You can only host one live lesson at a time."); navigate("/trainer"); return; }
    window.activeTrainerCourse = courseId;
    return () => { window.activeTrainerCourse = undefined; };
  }, [courseId, navigate]);

  const fetchLiveData = useCallback(async () => {
    if (!courseId || !tenantId || !currentUser.id) return;

    // 1. Load from Local DB Instantly
    const localSess = await getLiveSession(courseId);
    if (localSess) setSessionActive(localSess.active);

    const localPres = await getLivePresentation(courseId);
    if (localPres) {
      setLiveState(localPres);
      setIsBlackboardMode(localPres.isBlackboard ?? false);
      if (localPres.materialId) {
        const localMat = await db.materials.get(localPres.materialId);
        if (localMat) setPresentation(localMat);
      }
    }

    const localMats = await getCourseMaterials(courseId);
    if (localMats.length > 0) setMaterials(localMats.sort((a, b) => (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0)));

    // 2. Fetch from Supabase
    try {
      const { data: liveSess } = await supabase.from("live_session").select("*").eq("course_id", courseId).maybeSingle();
      if (liveSess) {
        setSessionActive(liveSess.active);
        await db.liveSessions.put({ id: liveSess.id, courseId, active: liveSess.active, trainerId: liveSess.trainer_id, startedAt: liveSess.started_at, updatedAt: liveSess.updated_at, createdAt: liveSess.created_at, tenantId: liveSess.tenant_id });
      }

      const { data: livePres } = await supabase.from("live_presentations").select("*").eq("course_id", courseId).maybeSingle();
      if (livePres) {
        const mappedPres = { id: livePres.id, courseId: livePres.course_id, materialId: livePres.material_id || "", isBlackboard: livePres.is_blackboard ?? false, blackboardStrokes: (livePres.blackboard_strokes as Stroke[]) || [], blackboardLines: (livePres.blackboard_lines as string[]) || [], blackboardLabels: (livePres.blackboard_labels as any[]) || [], startedBy: livePres.started_by, updatedAt: livePres.updated_at, currentPage: livePres.current_page ?? 1, tenantId: livePres.tenant_id };
        setLiveState(mappedPres);
        setIsBlackboardMode(mappedPres.isBlackboard);
        await updatePresentation(mappedPres);

        if (mappedPres.materialId) {
          const { data: mat } = await supabase.from("course_materials").select("*").eq("id", mappedPres.materialId).maybeSingle();
          if (mat) {
            const mappedMat = mapMaterial(mat);
            setPresentation(mappedMat);
            await db.materials.put(mappedMat);
          }
        } else setPresentation(null);
      } else { setLiveState(null); setIsBlackboardMode(false); setPresentation(null); }

      const { data: mats } = await supabase.from("course_materials").select("*").eq("course_id", courseId).order("presentation_order", { ascending: true });
      if (mats && mats.length > 0) {
        const mappedMats = mats.map(mapMaterial);
        setMaterials(mappedMats);
        await db.materials.bulkPut(mappedMats);
      }

      const { data: hands } = await supabase.from("raised_hands").select("*").eq("course_id", courseId);
      if (hands && hands.length > 0) {
        const userIds = hands.map((h: any) => h.user_id as string);
        const { data: handUsers } = await supabase.from("users").select("id, username").in("id", userIds);
        const userMap = new Map((handUsers || []).map((u: any) => [u.id as string, u.username as string]));
        
        // ✅ FIX: Use `any` explicitly to resolve TS property inference issues
        const mappedHands = hands
          .filter((h: any) => userMap.has(h.user_id as string))
          .map((h: any) => ({ ...h, username: userMap.get(h.user_id as string)! }))
          .sort((a: any, b: any) => new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime());
        
        setRaisedHands(mappedHands);
      } else setRaisedHands([]);

      const { data: atts } = await supabase.from("active_attendances").select("user_id").eq("course_id", courseId);
      if (atts && atts.length > 0) {
        const attUserIds = atts.map((a: Record<string, unknown>) => a.user_id as string).filter((id: string) => id !== currentUser.id);
        const { data: attUsers } = await supabase.from("users").select("*").in("id", attUserIds).eq("role", "trainee");
        setActiveLearners(attUsers ? attUsers.map((u: Record<string, unknown>) => ({ id: u.id as string, username: u.username as string, email: (u.email as string) || "", password: (u.password as string) || "", role: (u.role as "trainer" | "trainee" | "admin"), profilePic: (u.profile_pic as string) || "", phone: (u.phone as string) || "", assignedCourses: (u.assigned_courses as string[]) || [], tenantId: u.tenant_id as string, createdAt: u.created_at as string })) : []);
      } else setActiveLearners([]);

      const { data: speakers } = await supabase.from("allowed_speakers").select("user_id").eq("course_id", courseId);
      setActiveSpeakerIds(speakers ? speakers.map((s: Record<string, unknown>) => s.user_id as string) : []);
    } catch (err) { console.warn("Offline: Using local data for classroom"); }
  }, [courseId, tenantId, currentUser.id]);

  useEffect(() => { fetchLiveData(); }, [fetchLiveData]);

  useEffect(() => {
    if (!courseId) return;
    const handleDebouncedFetch = () => { if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); fetchTimerRef.current = setTimeout(() => fetchLiveData(), 300); };
    const channel = supabase.channel(`live-classroom-${courseId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_session", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "live_presentations", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "course_materials", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "raised_hands", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "active_attendances", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "allowed_speakers", filter: `course_id=eq.${courseId}` }, handleDebouncedFetch)
      .subscribe();
    return () => { supabase.removeChannel(channel); if (fetchTimerRef.current) clearTimeout(fetchTimerRef.current); };
  }, [courseId, fetchLiveData]);

  async function getDailyRoomUrl() { if (!courseId) return null; const API_BASE = import.meta.env.VITE_API_URL || "https://medstat-3rxl.onrender.com"; try { const response = await fetch(`${API_BASE}/api/create-daily-room`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ courseId }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); return data.url; } catch (error) { return null; } }

  async function toggleMic() {
    if (!daily) return;
    if (!isVoiceJoined) { try { setIsConnecting(true); const roomUrl = await getDailyRoomUrl(); if (!roomUrl) return; await daily.join({ url: roomUrl, startVideoOff: true }); setIsVoiceJoined(true); setIsMicOn(true); } catch (e) {} finally { setIsConnecting(false); } return; }
    try { const n = !isMicOn; await daily.setLocalAudio(n); setIsMicOn(n); } catch (e) {}
  }

  async function toggleCam() {
    if (!daily) return;
    if (!isVoiceJoined) { try { setIsConnecting(true); const roomUrl = await getDailyRoomUrl(); if (!roomUrl) return; await daily.join({ url: roomUrl }); await daily.setLocalVideo(true); setIsVoiceJoined(true); setIsMicOn(true); setIsCamOn(true); } catch (e) {} finally { setIsConnecting(false); } return; }
    try { const n = !isCamOn; await daily.setLocalVideo(n); setIsCamOn(n); if (n && !isMicOn) { await daily.setLocalAudio(true); setIsMicOn(true); } } catch (e) {}
  }

  async function toggleBlackboard() {
    if (!courseId || !tenantId) return; setActiveTool("pen"); const newMode = !isBlackboardMode; setIsBlackboardMode(newMode);
    if (newMode) setPresentation(null); else if (materials.length > 0) { const currentMatId = liveState?.materialId || materials[0].id; setPresentation(materials.find(m => m.id === currentMatId) || materials[0]); }

    if (liveState?.id) {
      const updated = { ...liveState, isBlackboard: newMode, updatedAt: new Date().toISOString() };
      setLiveState(updated);
      await updatePresentation(updated); // Local Save
      await supabase.from("live_presentations").update({ is_blackboard: newMode, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      const newPres = { id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id, material_id: "", current_page: 1, is_blackboard: newMode, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString() };
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert(newPres);
      await startPresentation(courseId, "", currentUser.id); // Local Save
      fetchLiveData();
    }
  }

  async function handleStrokeEnd(points: { x: number; y: number }[], tool: ToolType, color?: string, width?: number) {
    if (!liveState?.id) return; const newStroke = { id: crypto.randomUUID(), points, color: color || "#FFFFFF", width: width || 4, tool: tool || "pen" };
    setLiveState(prev => {
      if (!prev) return prev;
      const updatedStrokes = [...(prev.blackboardStrokes || []), newStroke];
      const updatedPres = { ...prev, blackboardStrokes: updatedStrokes };
      updatePresentation(updatedPres); // Local Save
      supabase.from("live_presentations").update({ blackboard_strokes: updatedStrokes }).eq("id", prev.id).then(() => {});
      return updatedPres;
    });
  }

  async function handleErase(eraserPos: { x: number; y: number }, radius: number) {
    if (!liveState?.id) return; const currentStrokes = liveState.blackboardStrokes || []; const newStrokes: Stroke[] = [];
    for (const stroke of currentStrokes) { const segments: { x: number; y: number }[][] = []; let currentSegment: { x: number; y: number }[] = []; for (const p of stroke.points) { if (Math.hypot(p.x - eraserPos.x, p.y - eraserPos.y) < radius) { if (currentSegment.length > 0) { segments.push(currentSegment); currentSegment = []; } } else currentSegment.push(p); } if (currentSegment.length > 0) segments.push(currentSegment); for (const seg of segments) newStrokes.push({ id: crypto.randomUUID(), points: seg, color: stroke.color, width: stroke.width, tool: stroke.tool }); }
    setLiveState(prev => { if (!prev) return prev; const updatedPres = { ...prev, blackboardStrokes: newStrokes }; updatePresentation(updatedPres); supabase.from("live_presentations").update({ blackboard_strokes: newStrokes }).eq("id", prev.id).then(() => {}); return updatedPres; });
  }

  async function clearBlackboard() {
    if (!liveState?.id) return;
    setLiveState(prev => prev ? { ...prev, blackboardStrokes: [], blackboardLines: [], blackboardLabels: [] } : null);
    await updatePresentation({ ...liveState, blackboardStrokes: [], blackboardLines: [], blackboardLabels: [] }); // Local Save
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
    await updatePresentation(updatedPres); // Local Save
    await supabase.from("live_presentations").update({ material_id: nextMat.id, current_page: 1, updated_at: new Date().toISOString() }).eq("id", liveState.id);
  }

  async function allowStudentToSpeak(userId: string) {
    if (!courseId || !tenantId) return; try { await supabase.from("raised_hands").delete().eq("user_id", userId).eq("course_id", courseId); await supabase.from("allowed_speakers").upsert({ user_id: userId, course_id: courseId, tenant_id: tenantId, allowed: true }, { onConflict: 'user_id' }); } catch (error) { alert("Could not grant mic permission."); }
  }

  async function muteStudent(userId: string) {
    if (!daily || !courseId) return; try { if (daily.participants()[userId]) await daily.updateParticipant(userId, { setAudio: false }); await supabase.from("allowed_speakers").delete().eq("user_id", userId).eq("course_id", courseId); } catch (error) {}
  }

  async function startSession() {
    if (!courseId || !tenantId) return;
    await startLiveSession(courseId, currentUser.id); // Local Save
    const { data: existing } = await supabase.from("live_session").select("id").eq("course_id", courseId).maybeSingle();
    if (existing) { await supabase.from("live_session").update({ active: true, updated_at: new Date().toISOString() }).eq("id", existing.id); } 
    else { await supabase.from("live_session").insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, trainer_id: currentUser.id, active: true, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), created_at: new Date().toISOString() }); }
    setSessionActive(true);

    if (materials.length > 0 && !presentation) {
      const firstMat = materials[0]; setPresentation(firstMat); setIsBlackboardMode(false);
      await startPresentation(courseId, firstMat.id, currentUser.id); // Local Save
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id, material_id: firstMat.id, current_page: 1, is_blackboard: false, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString() });
    }

    if (daily && !isVoiceJoined) { try { setIsConnecting(true); const roomUrl = await getDailyRoomUrl(); if (!roomUrl) return; await daily.join({ url: roomUrl, startVideoOff: true }); setIsVoiceJoined(true); setIsMicOn(true); } catch (e) {} finally { setIsConnecting(false); } }
  }

  async function stopSession() {
    if (!courseId) return;
    await endLiveSession(courseId); // Local Save
    await clearPresentation(courseId); // Local Save
    await supabase.from("live_session").update({ active: false, updated_at: new Date().toISOString() }).eq("course_id", courseId);
    await supabase.from("live_presentations").delete().eq("course_id", courseId);
    if (daily && isVoiceJoined) { daily.leave(); setIsVoiceJoined(false); setIsMicOn(false); setIsCamOn(false); setVideoTrack(null); } navigate("/trainer");
  }

  async function selectPage(materialId: string) {
    if (!courseId || !tenantId) return; setActiveTool("pen"); const selectedMat = materials.find(m => m.id === materialId); if (selectedMat) { setPresentation(selectedMat); setIsBlackboardMode(false); }
    if (liveState?.id) {
      const updatedPres = { ...liveState, materialId, isBlackboard: false, currentPage: 1, updatedAt: new Date().toISOString() };
      setLiveState(updatedPres);
      await updatePresentation(updatedPres); // Local Save
      await supabase.from("live_presentations").update({ material_id: materialId, is_blackboard: false, current_page: 1, updated_at: new Date().toISOString() }).eq("id", liveState.id);
    } else {
      await startPresentation(courseId, materialId, currentUser.id); // Local Save
      await supabase.from("live_presentations").delete().eq("course_id", courseId);
      await supabase.from("live_presentations").insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id, material_id: materialId, current_page: 1, is_blackboard: false, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString() });
    }
  }

  function handleLogout() {
    if (sessionActive && courseId) { supabase.from("live_session").update({ active: false }).eq("course_id", courseId); supabase.from("live_presentations").delete().eq("course_id", courseId); if (daily && isVoiceJoined) daily.leave(); }
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId"); window.dispatchEvent(new Event("authStateChanged")); navigate("/login");
  }

  const iosBtnStyle: React.CSSProperties = { display: "flex", alignItems: "center", justifyContent: "center", padding: "10px", border: "none", borderRadius: "10px", flex: 1, cursor: "pointer", transition: "transform 0.1s ease, opacity 0.2s ease", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", WebkitTapHighlightColor: "transparent" };
  const toolBtnStyle = (isActive: boolean): React.CSSProperties => ({ width: "44px", height: "44px", borderRadius: "12px", border: "none", background: isActive ? "rgba(0, 165, 244, 0.2)" : "transparent", color: isActive ? "#00A5F4" : "#8E8E93", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s ease", flexShrink: 0 });
  const drawingActiveTool = activeTool === "label" ? "pen" as ToolType : activeTool;

  return (
    <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column", background: C.bg, overflow: "hidden" }}>
      <DailyAudio />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 16px", background: "rgba(249, 249, 249, 0.8)", backdropFilter: "blur(20px)", borderBottom: `0.33px solid ${C.separator}`, flexShrink: 0, zIndex: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flex: 1, minWidth: "200px" }}>
          {settings?.logo && <img src={settings.logo} alt="Logo" style={{ width: "32px", height: "32px", borderRadius: "8px", objectFit: "cover" }} />}
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{settings?.businessName || "SmartPages"}</h1>
            {settings?.phone && <a href={`tel:${settings.phone}`} style={{ fontSize: "12px", color: C.textTertiary, textDecoration: "none", whiteSpace: "nowrap" }}>{settings.phone}</a>}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* Restored Trainer UI Block */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", background: C.purpleBg, padding: "4px 12px 4px 4px", borderRadius: "20px" }}>
            <div style={{ width: "28px", height: "28px", borderRadius: "50%", background: C.card, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: "700" }}>{(trainer?.username as string)?.charAt(0).toUpperCase()}</div>
            <span style={{ fontSize: "13px", fontWeight: "600", color: C.purple }}>{(trainer?.username as string) || "Trainer"}</span>
          </div>
          <button onClick={() => setIsLeftCollapsed(!isLeftCollapsed)} style={{ width: "36px", height: "36px", borderRadius: "9px", background: "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer" }} title="Toggle Controls"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg></button>
          <button onClick={handleLogout} style={{ width: "36px", height: "36px", borderRadius: "9px", background: C.redBg, border: "none", cursor: "pointer", color: C.red }} title="Logout"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg></button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: isLeftCollapsed ? "0 0 0px" : "0 0 240px", minWidth: isLeftCollapsed ? "0" : "200px", overflow: "hidden", transition: "flex 0.3s ease", background: C.panelBg, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px", margin: "12px", background: C.card, borderRadius: "14px", boxShadow: "0 4px 12px rgba(0,0,0,0.03)", display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <button onClick={() => navigate("/trainer")} style={{ background: "none", border: "none", color: C.medBlue, cursor: "pointer", display: "flex", alignItems: "center", padding: 0, gap: "4px", fontSize: "14px", fontWeight: "600" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>Exit</button>
              {sessionActive ? <button onClick={stopSession} style={{ padding: "6px 12px", background: C.redBg, color: C.red, border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer", fontSize: "12px" }}>End</button> : <button onClick={startSession} disabled={isConnecting} style={{ padding: "6px 12px", background: C.medBlue, color: "#fff", border: "none", borderRadius: "8px", fontWeight: "600", cursor: "pointer", fontSize: "12px", opacity: isConnecting ? 0.6 : 1 }}>Start</button>}
            </div>
            {presentation && !isBlackboardMode && (<div style={{ display: "flex", background: C.bg, borderRadius: "10px", padding: "4px" }}><button onClick={() => changePage(-1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>‹ Prev</button><button onClick={() => changePage(1)} style={{ flex: 1, padding: "8px", border: "none", background: "transparent", cursor: "pointer", color: C.medBlue, fontWeight: "600", borderRadius: "8px" }}>Next ›</button></div>)}
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              <button onClick={toggleMic} disabled={isConnecting} style={{ ...iosBtnStyle, background: isMicOn ? C.green : C.iosBtnBg, color: isMicOn ? "#FFFFFF" : C.textPrimary, opacity: isConnecting ? 0.7 : 1 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg></button>
              <button onClick={toggleCam} disabled={isConnecting} style={{ ...iosBtnStyle, background: isCamOn ? C.medBlue : C.iosBtnBg, color: isCamOn ? "#FFFFFF" : C.textPrimary, opacity: isConnecting ? 0.7 : 1 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg></button>
              <button onClick={toggleBlackboard} style={{ ...iosBtnStyle, background: isBlackboardMode ? C.purple : C.iosBtnBg, color: isBlackboardMode ? "#FFFFFF" : C.textPrimary }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><rect x="2" y="4" width="20" height="16" rx="2" ry="2"/><line x1="6" y1="20" x2="18" y2="20"/></svg></button>
            </div>
            <div style={{ marginTop: "12px", borderTop: `1px solid ${C.separator}`, paddingTop: "12px" }}>
              <div style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", margin: "0 0 8px 0" }}>✋ Raised Hands ({raisedHands.length})</div>
              {raisedHands.length === 0 ? <p style={{ fontSize: "12px", color: C.textTertiary }}>No hands raised.</p> : <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>{raisedHands.map((hand) => (<div key={hand.user_id as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px", background: C.orangeBg, borderRadius: "8px" }}><span style={{ fontSize: "13px", fontWeight: "600" }}>{hand.username || "Unknown"}</span><button onClick={() => allowStudentToSpeak(hand.user_id as string)} style={{ background: C.green, color: "#fff", border: "none", padding: "6px 10px", borderRadius: "6px", fontSize: "12px", fontWeight: "600", cursor: "pointer" }}>Allow</button></div>))}</div>}
            </div>
          </div>

          {/* Restored Active Learners UI Block */}
          <div style={{ padding: "0 12px 12px 12px" }}>
            <p style={{ fontSize: "13px", color: C.textTertiary, textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.5px", margin: "0 0 8px 0" }}>Attending Now ({activeLearners.length})</p>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "20px" }}>
              {activeLearners.length === 0 && <p style={{ fontSize: "12px", color: C.textTertiary }}>No learners active.</p>}
              {activeLearners.map(learner => (
                <div key={learner.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", background: C.card, borderRadius: "8px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <div style={{ width: "24px", height: "24px", borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: "600" }}>{learner.username?.charAt(0).toUpperCase()}</div>
                    <span style={{ fontSize: "12px", fontWeight: "500", color: C.textPrimary }}>{learner.username}</span>
                  </div>
                  {activeSpeakerIds.includes(learner.id) && <button onClick={() => muteStudent(learner.id)} style={{ background: C.redBg, color: C.red, border: "none", padding: "4px 10px", borderRadius: "6px", fontSize: "11px", fontWeight: "600", cursor: "pointer" }}>Mute</button>}
                </div>
              ))}
            </div>

            <p style={{ fontSize: "13px", color: C.textTertiary, fontWeight: "600", margin: "0 0 8px 0" }}>Lesson Pages</p>
            {materials.map((mat) => { const meta = getFileMeta(mat.fileType); const isActive = liveState?.materialId === mat.id && !isBlackboardMode; return (<div key={mat.id} onClick={() => selectPage(mat.id)} style={{ display: "flex", alignItems: "center", padding: "12px", gap: "10px", cursor: "pointer", background: isActive ? C.medBlueBg : C.card, borderRadius: "10px", marginBottom: "6px" }}><div style={{ width: "32px", height: "32px", borderRadius: "8px", background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>{meta.icon}</div><div style={{ fontSize: "14px", color: isActive ? C.medBlue : C.textPrimary, fontWeight: isActive ? "600" : "500" }}>{mat.title}</div></div>); })}
          </div>
        </div>

        <div style={{ flex: "1 1 auto", minWidth: 0, background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
          <div style={{ flex: 1, display: "flex", width: "200%", height: "100%", transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)", transform: isBlackboardMode ? "translateX(-50%)" : "translateX(0%)" }}>
            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", background: C.card, overflow: "hidden", position: "relative" }}>
              {presentation ? <LiveClassView material={presentation} page={liveState?.currentPage ?? 1} /> : <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}><p style={{ color: C.textTertiary, fontSize: "15px" }}>{materials.length > 0 ? "Select a page from the sidebar." : "Upload pages first."}</p></div>}
            </div>
            <div style={{ width: "50%", height: "100%", flexShrink: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#1A1A1A" }}>
              <div style={{ flex: 1, position: "relative", overflow: "hidden", cursor: activeTool === "label" ? "crosshair" : undefined }} onClick={activeTool === "label" ? handleCanvasClick : undefined}>
                <DrawingBlackboard isTrainer={true} strokes={liveState?.blackboardStrokes || []} onStrokeEnd={handleStrokeEnd} onErase={handleErase} activeTool={drawingActiveTool} penColor={penColor} penWidth={penWidth} eraserSize={eraserSize} fontFamily={fontOptions.fontFamily} fontSize={fontOptions.fontSize} fontColor={fontOptions.fontColor} fontWeight={fontOptions.fontWeight} fontStyle={fontOptions.fontStyle} courseId={courseId!} />
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", background: "#111", padding: "8px 12px", overflowX: "auto" }}>
                <button onClick={() => selectTool("pen")} title="Pen" style={toolBtnStyle(activeTool === "pen")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/></svg></button>
                <button onClick={() => selectTool("eraser")} title="Eraser" style={toolBtnStyle(activeTool === "eraser")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 20H7L3 16C2.5 15.5 2.5 14.5 3 14L13 4L20 11L11 20"/></svg></button>
                {activeTool === "pen" && <label style={{ ...toolBtnStyle(false), width: "auto", padding: "0 8px", gap: "6px" }}><input type="color" value={penColor} onChange={e => setPenColor(e.target.value)} style={{ width: "22px", height: "22px", border: "none", background: "none", cursor: "pointer", padding: 0 }} /></label>}
                {activeTool === "pen" && <input type="range" min="1" max="20" value={penWidth} onChange={e => setPenWidth(Number(e.target.value))} style={{ width: "60px", accentColor: "#00A5F4" }} />}
                {activeTool === "eraser" && <input type="range" min="10" max="100" value={eraserSize} onChange={e => setEraserSize(Number(e.target.value))} style={{ width: "80px", accentColor: "#00A5F4" }} />}
                <input type="text" placeholder={activeTool === "label" ? "Click board to pin..." : "Type to write..."} value={bbInput} onChange={(e) => setBbInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && activeTool !== "label") sendBlackboardLine(); }} style={{ flex: 1, minWidth: "100px", background: "transparent", border: "none", outline: "none", color: "#FFF", fontSize: "15px" }} />
                <button onClick={() => bbInput.trim() && selectTool("label")} title="Pin Label" style={toolBtnStyle(activeTool === "label")}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/></svg></button>
                <button onClick={sendBlackboardLine} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: bbInput.trim() && activeTool !== "label" ? "#00A5F4" : "rgba(255,255,255,0.1)", color: bbInput.trim() && activeTool !== "label" ? "#fff" : "#666", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>
                <button onClick={clearBlackboard} title="Clear Board" style={{ width: "44px", height: "44px", borderRadius: "12px", border: "none", background: "transparent", color: "#FF3B30", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              </div>
            </div>
          </div>
        </div>

        <ClassChat courseId={courseId || ""} videoTrack={videoTrack} isMicOn={isMicOn} toggleMic={toggleMic} isCamOn={isCamOn} toggleCam={toggleCam} />
      </div>
    </div>
  );
}