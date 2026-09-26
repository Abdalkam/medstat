// src/trainer/UploadMaterials.tsx
import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { getCourseById } from "../database/courseDB";
import { getCourseMaterials, addMaterial, deleteMaterial, updateMaterial } from "../database/materialDB";
import { startLiveSession } from "../database/liveSessionDB";
import { startPresentation } from "../database/livePresentationDB";
import type { Course, CourseMaterial } from "../types";
import { db } from "../database/db";
import { supabase } from "../auth/supabase";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  medBlue: "#007AFF", medBlueBg: "#E8F2FF", separator: "#E5E5EA", red: "#FF3B30", redBg: "#FFEFEE",
  green: "#34C759", greenBg: "#EAF9EE", orange: "#FF9F0A", orangeBg: "#FFF6EB", purple: "#AF52DE",
  purpleBg: "#F5F0FF", separatorLight: "#F0F0F2",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const TS = {
  h1: { fontSize: 28, fontWeight: 800, letterSpacing: "-0.03em", lineHeight: 1.15, color: C.textPrimary, fontFamily: FONT },
  h2: { fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.25, color: C.textPrimary, fontFamily: FONT },
  h3: { fontSize: 17, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.3, color: C.textPrimary, fontFamily: FONT },
  body: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.75, color: C.textPrimary, fontFamily: FONT },
  bodySm: { fontSize: 14, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, color: C.textTertiary, fontFamily: FONT },
  label: { fontSize: 13, fontWeight: 500, letterSpacing: "-0.005em", lineHeight: 1.4, fontFamily: FONT },
  caption: { fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", lineHeight: 1.2, textTransform: "uppercase" as const, fontFamily: FONT },
  input: { fontSize: 16, fontWeight: 400, letterSpacing: "-0.005em", lineHeight: 1.5, fontFamily: FONT, color: C.textPrimary },
};

const MAX_FILE_SIZE = 100 * 1024 * 1024;
const IMAGE_MAX_DIMENSION = 1920;
const IMAGE_QUALITY = 0.85;

function getFileMeta(fileType: string) {
  if (fileType.includes("pdf")) return { icon: "📄", color: C.red, bg: C.redBg, label: "PDF" };
  if (fileType.includes("video")) return { icon: "🎬", color: C.purple, bg: C.purpleBg, label: "Video" };
  if (fileType.includes("audio")) return { icon: "🎵", color: C.purple, bg: C.purpleBg, label: "Audio" };
  if (fileType.includes("image")) return { icon: "🖼️", color: C.green, bg: C.greenBg, label: "Image" };
  if (fileType.includes("presentation") || fileType.includes("ppt")) return { icon: "📊", color: C.orange, bg: C.orangeBg, label: "Slides" };
  if (fileType.includes("word") || fileType.includes("document")) return { icon: "📝", color: C.medBlue, bg: C.medBlueBg, label: "Document" };
  return { icon: "📁", color: C.textTertiary, bg: C.bg, label: "File" };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > IMAGE_MAX_DIMENSION || height > IMAGE_MAX_DIMENSION) {
          const ratio = Math.min(IMAGE_MAX_DIMENSION / width, IMAGE_MAX_DIMENSION / height);
          width = Math.round(width * ratio); height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas not supported"));
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", IMAGE_QUALITY));
      };
      img.onerror = () => reject(new Error("Failed to load image"));
      img.src = reader.result as string;
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function readFileWithProgress(file: File, onProgress: (p: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export default function UploadMaterials() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");

  const [course, setCourse] = useState<Course | null>(null);
  const [materials, setMaterials] = useState<CourseMaterial[]>([]);
  const [title, setTitle] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [startingLive, setStartingLive] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dragOverItemId, setDragOverItemId] = useState<string | null>(null);
  const [business, setBusiness] = useState<{ business_name: string | null; phone: string | null; logo: string | null } | null>(null);

  function handleLogout() {
    localStorage.removeItem("currentUser"); localStorage.removeItem("authToken"); localStorage.removeItem("adminDeviceId"); localStorage.removeItem("activeAttendanceCourseId");
    window.dispatchEvent(new Event("authStateChanged")); navigate("/");
  }

  useEffect(() => {
    if (!currentUser?.tenantId) return;
    let cancelled = false;
    const fetchBusiness = async () => {
      try {
        // 1. Load from Local Storage INSTANTLY (with mapping fix)
        const localSettings = localStorage.getItem("localBusinessSettings");
        if (localSettings) {
          const parsed = JSON.parse(localSettings);
          setBusiness({ business_name: parsed.businessName || null, phone: parsed.phone || null, logo: parsed.logo || null });
        }

        // 2. Try Supabase
        const { data } = await supabase.from("business_settings").select("business_name, phone, logo").eq("tenant_id", currentUser.tenantId).maybeSingle();
        if (!cancelled && data) setBusiness(data as any);
      } catch (err: unknown) { console.error("Business fetch failed:", err); }
    };
    fetchBusiness();
    return () => { cancelled = true; };
  }, [currentUser?.tenantId]);

  useEffect(() => { loadData(); }, [courseId]);

  async function loadData() {
    if (!courseId) return;
    const loggedInUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = loggedInUser.tenantId;

    // 1. Load Local Data INSTANTLY
    try {
      const c = await getCourseById(courseId);
      if (c) setCourse(c);
      const localMats = await getCourseMaterials(courseId);
      localMats.sort((a, b) => (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0));
      setMaterials(localMats);
    } catch (e) { console.error("Local load failed", e); }

    // 2. Try Supabase to update
    if (tenantId) {
      try {
        const { data, error } = await supabase.from('course_materials').select('*').eq('tenant_id', tenantId).eq('course_id', courseId).order('presentation_order', { ascending: true });
        if (!error && data && data.length > 0) {
          const supabaseMaterials: CourseMaterial[] = data.map(m => ({ id: m.id, courseId: m.course_id, title: m.title, description: "", fileUrl: m.file_data || "", fileName: m.file_name, fileType: m.file_type, allowDownload: true, uploadedBy: m.uploaded_by || loggedInUser.id, uploadedAt: m.uploaded_at || m.created_at || "", presentationOrder: m.presentation_order ?? 0 }));
          for (const mat of supabaseMaterials) await db.materials.put(mat);
          const localMaterials = await getCourseMaterials(courseId);
          const supabaseIds = new Set(data.map(m => m.id));
          for (const local of localMaterials) { if (!supabaseIds.has(local.id)) await db.materials.delete(local.id); }
          supabaseMaterials.sort((a, b) => (a.presentationOrder ?? 0) - (b.presentationOrder ?? 0));
          setMaterials(supabaseMaterials);
          
          const { data: cData } = await supabase.from("courses").select("*").eq("id", courseId).maybeSingle();
          if (cData) { setCourse({ id: cData.id, name: cData.name, description: cData.description || "", logo: cData.logo || "", tenantId: cData.tenant_id, trainerId: cData.trainer_id, createdAt: cData.created_at, tuitionType: cData.tuition_type || "free", amount: cData.amount || 0, startDate: cData.start_date || "", period: cData.period || "", mediaUrl: cData.logo || "", mediaType: "image", mediaName: "course-logo" }); }
        }
      } catch (err) { console.warn("Offline: Using local materials", err); }
    }
  }

  async function syncMaterialToSupabase(material: CourseMaterial, tenantId: string) {
    try {
      const payload = { id: material.id, tenant_id: tenantId, course_id: material.courseId, title: material.title, description: material.description || "", file_data: material.fileUrl, file_name: material.fileName, file_type: material.fileType, uploaded_by: material.uploadedBy, uploaded_at: material.uploadedAt, presentation_order: material.presentationOrder ?? 0, synced: true };
      const { error } = await supabase.from('course_materials').upsert(payload);
      if (error) throw error;
    } catch (error: any) { console.warn("Material saved locally, but failed to sync to Supabase.", error.message); }
  }

  async function syncMultipleMaterialsToSupabase(materialsList: CourseMaterial[], tenantId: string) {
    try {
      const payloads = materialsList.map(material => ({ id: material.id, tenant_id: tenantId, course_id: material.courseId, title: material.title, description: material.description || "", file_data: material.fileUrl, file_name: material.fileName, file_type: material.fileType, uploaded_by: material.uploadedBy, uploaded_at: material.uploadedAt, presentation_order: material.presentationOrder ?? 0, synced: true }));
      const { error } = await supabase.from('course_materials').upsert(payloads);
      if (error) throw error;
    } catch (error: any) { console.warn("Materials saved locally, but failed to sync to Supabase.", error.message); }
  }

  async function deleteMaterialFromSupabase(materialId: string) {
    try { const { error } = await supabase.from('course_materials').delete().eq('id', materialId); if (error) throw error; } catch (error: any) { console.warn("Material deleted locally, but failed to sync deletion to Supabase.", error.message); }
  }

  function handleFileSelect(selectedFile: File | null) {
    if (!selectedFile) return; setError("");
    
    // ✅ REMOVED: The block that blocked .ppt and .pptx files so trainers can upload them
    
    if (selectedFile.size > MAX_FILE_SIZE) { setError(`File is too large (${formatBytes(selectedFile.size)}). Maximum allowed is ${formatBytes(MAX_FILE_SIZE)}.`); return; }
    setFile(selectedFile);
    if (selectedFile.type.startsWith("image/")) setImagePreview(URL.createObjectURL(selectedFile)); else setImagePreview(null);
  }

  function handleFileInputChange(e: React.ChangeEvent<HTMLInputElement>) { handleFileSelect(e.target.files?.[0] ?? null); e.target.value = ""; }
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files?.[0] ?? null); }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); setDragOver(false); }, []);

  async function handleUpload() {
    if (!courseId) return;
    if (!title.trim()) return setError("Please enter a page title.");
    if (!file) return setError("Please select a file to upload.");
    const loggedInUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = loggedInUser.tenantId;
    if (!tenantId) { setError("Critical error: Session is missing business data. Please log out and log back in."); return; }
    setUploading(true); setUploadProgress(0); setError("");
    try {
      let fileUrl: string; let storedFileType = file.type || "application/octet-stream";
      if (file.type.startsWith("image/")) { setUploadProgress(10); fileUrl = await compressImage(file); storedFileType = "image/jpeg"; setUploadProgress(100); }
      else { fileUrl = await readFileWithProgress(file, (p) => setUploadProgress(p)); }
      
      // Ensure PPT files retain their specific type for rendering logic
      if (file.name.endsWith(".ppt") || file.name.endsWith(".pptx")) {
        storedFileType = "application/vnd.ms-powerpoint";
      }

      const material: CourseMaterial = { id: crypto.randomUUID(), courseId, title: title.trim(), description: "", fileUrl, fileName: file.name, fileType: storedFileType, allowDownload: true, uploadedBy: currentUser.id, uploadedAt: new Date().toISOString(), presentationOrder: materials.length };
      await addMaterial(material);
      setTitle(""); setFile(null); setImagePreview(null); setUploadProgress(0); await loadData();
      syncMaterialToSupabase(material, tenantId);
    } catch (err) { console.error("Upload error:", err); setError(err instanceof Error ? err.message : "Upload failed."); } finally { setUploading(false); }
  }

  function handleItemDragStart(e: React.DragEvent, id: string) { setDraggedItemId(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id); }
  function handleItemDragOver(e: React.DragEvent, id: string) { e.preventDefault(); if (draggedItemId && draggedItemId !== id) setDragOverItemId(id); }
  function handleItemDrop(e: React.DragEvent, targetId: string) {
    e.preventDefault();
    if (!draggedItemId || draggedItemId === targetId) { resetDragState(); return; }
    const newMaterials = [...materials];
    const draggedIndex = newMaterials.findIndex(m => m.id === draggedItemId);
    const targetIndex = newMaterials.findIndex(m => m.id === targetId);
    if (draggedIndex === -1 || targetIndex === -1) { resetDragState(); return; }
    const [reorderedItem] = newMaterials.splice(draggedIndex, 1);
    newMaterials.splice(targetIndex, 0, reorderedItem);
    const loggedInUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = loggedInUser.tenantId;
    const updatedMaterials = newMaterials.map((m, idx) => ({ ...m, presentationOrder: idx }));
    setMaterials(updatedMaterials);
    updatedMaterials.forEach(m => updateMaterial(m));
    if (tenantId) syncMultipleMaterialsToSupabase(updatedMaterials, tenantId);
    resetDragState();
  }
  function resetDragState() { setDraggedItemId(null); setDragOverItemId(null); }

  async function startLesson() {
    if (materials.length === 0) return alert("Please add at least one file to start the lesson.");
    if (!courseId) return;
    const loggedInUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const tenantId = loggedInUser.tenantId;
    if (!tenantId) { alert("Session error. Please log out and log back in."); return; }
    setStartingLive(true);
    try {
      const firstMaterial = materials[0];
      await startLiveSession(courseId, currentUser.id);
      await startPresentation(courseId, firstMaterial.id, currentUser.id);
      await supabase.from('live_session').delete().eq('course_id', courseId);
      const { error: sessionError } = await supabase.from('live_session').insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, trainer_id: currentUser.id, active: true, started_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
      if (sessionError) throw sessionError;
      await supabase.from('live_presentations').delete().eq('course_id', courseId);
      const { error: presError } = await supabase.from('live_presentations').insert({ id: crypto.randomUUID(), tenant_id: tenantId, course_id: courseId, started_by: currentUser.id, material_id: firstMaterial.id, current_page: 1, is_blackboard: false, blackboard_strokes: [], blackboard_lines: [], blackboard_labels: [], updated_at: new Date().toISOString() });
      if (presError) throw presError;
      navigate(`/trainer/live/${courseId}`);
    } catch (err: any) { console.error("Failed to start lesson:", err); alert("Something went wrong while trying to start the live session: " + (err.message || "Unknown error")); } finally { setStartingLive(false); }
  }

  async function removeMaterial(id: string) {
    if (!confirm("Remove this page from the lesson?")) return;
    await deleteMaterial(id); loadData(); deleteMaterialFromSupabase(id);
  }

  useEffect(() => { return () => { if (imagePreview) URL.revokeObjectURL(imagePreview); }; }, [imagePreview]);

  const canUpload = !uploading && file !== null && title.trim() !== "";

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: FONT, WebkitFontSmoothing: "antialiased", MozOsxFontSmoothing: "grayscale" }}>
      {/* SINGLE APP BAR */}
      <div style={{ borderBottom: `1px solid ${C.separator}`, padding: "12px 24px", position: "sticky", top: 0, zIndex: 10, width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.85)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%" }}>
          <button onClick={() => navigate("/trainer")} style={{ background: C.card, border: `1px solid ${C.separator}`, borderRadius: 10, color: C.medBlue, cursor: "pointer", width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 1px 2px rgba(0,0,0,0.04)" }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg></button>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 0 }}>
            {business?.logo ? (<img src={business.logo} alt={business.business_name || "Business"} style={{ width: 36, height: 36, borderRadius: 8, objectFit: "cover", flexShrink: 0 }} />) : (<div style={{ ...TS.h3, width: 36, height: 36, borderRadius: 8, background: C.medBlueBg, color: C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>{(business?.business_name || "B").charAt(0).toUpperCase()}</div>)}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...TS.h3, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{business?.business_name || "Business"}</div>
              {business?.phone && (<a href={`tel:${business.phone}`} style={{ ...TS.label, color: C.medBlue, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 2 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>{business.phone}</a>)}
            </div>
          </div>
          <button onClick={handleLogout} title="Logout" style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: 9, background: C.redBg, border: "none", cursor: "pointer", color: C.red, flexShrink: 0 }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg></button>
        </div>
      </div>

      {/* BODY */}
      <div style={{ padding: "40px 48px 120px", width: "100%", maxWidth: "900px", margin: "0 auto", boxSizing: "border-box" }}>
        <h1 style={{ ...TS.h1, margin: "0 0 32px" }}>{course?.name || "Lesson Builder"}</h1>
        
        <div style={{ ...TS.caption, margin: "0 0 12px 0", color: C.textTertiary }}>ADD NEW PAGE</div>
        <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.separator}`, width: "100%", boxSizing: "border-box", marginBottom: 32, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${C.separatorLight}`, gap: 14 }}>
            <input style={{ ...TS.input, flex: 1, border: "none", outline: "none", background: "transparent" }} placeholder="Page Title (e.g. Introduction Video)" value={title} onChange={e => setTitle(e.target.value)} disabled={uploading} />
          </div>
          <div onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onClick={() => !uploading && fileInputRef.current?.click()} style={{ display: "flex", padding: 24, gap: 14, cursor: uploading ? "not-allowed" : "pointer", background: dragOver ? C.medBlueBg : "transparent", transition: "background 0.2s", flexDirection: "column", alignItems: "stretch" }}>
            {/* ✅ UPDATED: Added .ppt and .pptx to the accept attribute */}
            <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileInputChange} accept=".pdf,.mp4,.mov,.webm,.mp3,.wav,.png,.jpg,.jpeg,.gif,.webp,.ppt,.pptx" disabled={uploading} />
            {file ? (
              <div style={{ display: "flex", alignItems: "center", gap: 14, width: "100%" }}>
                {imagePreview ? (<img src={imagePreview} alt="Preview" style={{ width: 48, height: 48, borderRadius: 10, objectFit: "cover" }} />) : (<div style={{ width: 48, height: 48, borderRadius: 10, background: getFileMeta(file.type).bg, color: getFileMeta(file.type).color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>{getFileMeta(file.type).icon}</div>)}
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...TS.input, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div><div style={{ ...TS.label, fontSize: 12, marginTop: 2, color: C.textTertiary }}>{formatBytes(file.size)} • {getFileMeta(file.type).label}</div></div>
                {!uploading && (<button onClick={(e) => { e.stopPropagation(); setFile(null); setImagePreview(null); }} style={{ width: 32, height: 32, background: "transparent", border: "none", color: C.red, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>)}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 16, textAlign: "center" }}>
                <div style={{ width: 48, height: 48, borderRadius: 12, background: dragOver ? C.medBlue : C.medBlueBg, color: dragOver ? "#fff" : C.medBlue, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12, transition: "background 0.2s" }}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div>
                <div style={{ ...TS.body, fontWeight: 600, color: dragOver ? C.medBlue : C.textPrimary }}>{dragOver ? "Drop file here" : "Tap to browse or drag a file"}</div>
                {/* ✅ UPDATED: Helper text to include PPT */}
                <div style={{ ...TS.label, fontSize: 12, marginTop: 4, color: C.textTertiary }}>PDF, Video, Audio, Image, or PPT • Max {formatBytes(MAX_FILE_SIZE)}</div>
              </div>
            )}
          </div>
          {uploading && (<div style={{ padding: "0 20px 16px 20px" }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, ...TS.label, fontSize: 12, color: C.textTertiary }}><span>{file?.type.startsWith("image/") ? "Compressing image..." : "Uploading..."}</span><span>{uploadProgress}%</span></div><div style={{ height: 6, background: C.separator, borderRadius: 3, overflow: "hidden" }}><div style={{ height: "100%", background: C.medBlue, borderRadius: 3, width: `${uploadProgress}%`, transition: "width 0.2s" }} /></div></div>)}
        </div>

        {error && (<div style={{ margin: "0 0 24px 0", padding: "14px 18px", background: C.redBg, borderRadius: 12, ...TS.body, fontSize: 14, color: C.red, display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.red}22` }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>{error}</div>)}

        <div style={{ padding: "0 0 40px 0" }}>
          <button onClick={handleUpload} disabled={!canUpload} style={{ ...TS.input, width: "100%", padding: 16, background: canUpload ? C.medBlue : "#D1D1D6", color: "#fff", border: "none", borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: canUpload ? "pointer" : "not-allowed", transition: "background 0.2s", boxShadow: canUpload ? `0 4px 12px ${C.medBlue}33` : "none" }}>{uploading ? "Processing..." : "+ Add to Lesson"}</button>
        </div>

        <div style={{ ...TS.caption, margin: "0 0 12px 0", color: C.textTertiary }}>LESSON PAGES ({materials.length}) - DRAG TO REORDER</div>
        {materials.length === 0 ? (
          <div style={{ background: C.card, borderRadius: 16, padding: 48, textAlign: "center", ...TS.bodySm, fontSize: 15, color: C.textTertiary, border: `1px solid ${C.separatorLight}`, boxShadow: "0 4px 24px rgba(0,0,0,0.04)" }}>No files added yet. Add your first page above.</div>
        ) : (
          <div style={{ background: C.card, borderRadius: 16, overflow: "hidden", border: `1px solid ${C.separator}`, boxShadow: "0 4px 24px rgba(0,0,0,0.06)" }}>
            {materials.map((mat, index) => {
              const meta = getFileMeta(mat.fileType);
              const isDragging = draggedItemId === mat.id;
              const isDragOver = dragOverItemId === mat.id;
              return (
                <div key={mat.id} draggable onDragStart={(e) => handleItemDragStart(e, mat.id)} onDragOver={(e) => handleItemDragOver(e, mat.id)} onDrop={(e) => handleItemDrop(e, mat.id)} onDragEnd={resetDragState} style={{ display: "flex", alignItems: "center", padding: "16px 20px", borderBottom: index === materials.length - 1 ? "none" : `1px solid ${C.separatorLight}`, opacity: isDragging ? 0.4 : 1, background: isDragOver ? C.medBlueBg : "transparent", transition: "background 0.15s, opacity 0.15s" }}>
                  <div style={{ cursor: "grab", display: "flex", alignItems: "center", marginRight: 16, color: C.textTertiary }}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 14, flex: 1, minWidth: 0 }}>
                    <span style={{ ...TS.label, fontSize: 12, fontWeight: 600, width: 20, textAlign: "center", color: C.textTertiary }}>{index + 1}</span>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: meta.bg, color: meta.color, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, flexShrink: 0 }}>{meta.icon}</div>
                    <div style={{ flex: 1, minWidth: 0 }}><div style={{ ...TS.input, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{mat.title}</div><div style={{ ...TS.label, fontSize: 12, marginTop: 2, color: C.textTertiary }}>{meta.label} • {mat.fileName}</div></div>
                  </div>
                  <button onClick={() => removeMaterial(mat.id)} style={{ width: 32, height: 32, background: "transparent", border: "none", color: C.red, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.7, transition: "opacity 0.2s" }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
                </div>
              );
            })}
          </div>
        )}
        
        {materials.length > 0 && (
          <div style={{ padding: "40px 0 0 0" }}>
            <button onClick={startLesson} disabled={startingLive} style={{ ...TS.input, width: "100%", padding: 16, background: startingLive ? "#D1D1D6" : C.green, color: "#fff", border: "none", borderRadius: 12, fontSize: 17, fontWeight: 600, cursor: startingLive ? "wait" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, opacity: startingLive ? 0.7 : 1, transition: "all 0.2s", boxShadow: startingLive ? "none" : `0 4px 12px ${C.green}33` }}>
              {startingLive ? (
                <><span style={{ display: "inline-block", width: 20, height: 20, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />Starting Live Session...</>
              ) : (
                <><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start Live Session</>
              )}
            </button>
            <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
          </div>
        )}
      </div>
    </div>
  );
}