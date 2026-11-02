import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Course, User } from "../types";
import { supabase } from "../auth/supabase";

const TABLE = "messages";
const BUCKET = "chat-uploads";

const C = {
  textPrimary: "#111B21",
  textSecondary: "#667781",
  textInverse: "#FFF",
  bg: "#ECE5DD",
  headerBg: "#008069",
  headerText: "#FFF",
  ownBubble: "#D9FDD3",
  otherBubble: "#FFFFFF",
  inputBg: "#FFFFFF",
  inputBarBg: "#F0F2F5",
  separator: "#E9EDEF",
  green: "#00A884",
  greenBg: "#D9FDD3",
  red: "#EA4335",
  redBg: "#FDE8E4",
  blue: "#53BDEB",
  blueBg: "#D6EFFA",
  purple: "#7C3AED",
  purpleBg: "#EDE9FE",
  orange: "#F59E0B",
  shadow: "0 1px 0.5px rgba(11,20,26,.13)",
  shadowMenu: "0 6px 24px rgba(0,0,0,.18)",
};

type FileType = "image" | "video" | "audio" | "file";

interface ChatMessage {
  id: string;
  courseId: string;
  senderId: string;
  senderName: string;
  content: string;
  fileUrl: string | null;
  fileName: string | null;
  fileType: FileType | null;
  createdAt: string;
}

export interface ClassChatProps {
  courseId?: string;
  isChatOpen?: boolean;
  toggleChatOpen?: () => void;
  isCamOn?: boolean;
  onToggleCam?: () => void;
}

function mapMessage(r: Record<string, unknown>): ChatMessage {
  return {
    id: r.id as string,
    courseId: (r.course_id as string) || "",
    senderId: (r.sender_id as string) || (r.user_id as string) || "",
    senderName: (r.sender_name as string) || (r.username as string) || "Member",
    content: (r.content as string) || "",
    fileUrl: (r.file_url as string) || null,
    fileName: (r.file_name as string) || null,
    fileType: ((r.file_type as string) as FileType) || null,
    createdAt: r.created_at as string,
  };
}

function detectType(file: File): FileType {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (msgDay.getTime() === today.getTime()) return "Today";
  if (msgDay.getTime() === yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" });
}

async function uploadChatFile(file: File, tenantId: string, courseId: string) {
  const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
  const path = `${tenantId}/${courseId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) throw error;
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function extractStoragePath(url: string): string | null {
  const marker = `/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

function downloadFile(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// Shared styling for dropdown menu rows (used by both the file-card menu and the message menu)
const menuItemStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "10px 14px", background: "none", border: "none", cursor: "pointer", fontSize: 14, color: C.textPrimary, textAlign: "left" };

function FileIcon({ fileType }: { fileType: FileType | null }) {
  if (fileType === "image")
    return (
      <div style={{ width: 40, height: 40, borderRadius: 10, background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
      </div>
    );
  if (fileType === "video")
    return (
      <div style={{ width: 40, height: 40, borderRadius: 10, background: C.purpleBg, color: C.purple, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
      </div>
    );
  if (fileType === "audio")
    return (
      <div style={{ width: 40, height: 40, borderRadius: 10, background: "#FFF6EB", color: C.orange, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
      </div>
    );
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: C.blueBg, color: C.blue, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    </div>
  );
}

function FileAttachment({ m, canDelete, onDelete }: { m: ChatMessage; canDelete: boolean; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(0,0,0,0.04)", borderRadius: 8, padding: "10px 12px", position: "relative", width: "100%", minWidth: 200 }}>
      <FileIcon fileType={m.fileType} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.fileName || "Attachment"}</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>
          {m.fileType === "audio" ? "Audio" : m.fileType === "video" ? "Video" : m.fileType === "image" ? "Image" : "Document"}
        </div>
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        aria-label="File options"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: C.textSecondary, borderRadius: "50%", flexShrink: 0, opacity: 0.6, lineHeight: 0, transition: "opacity 0.15s, background 0.15s" }}
        onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.background = "rgba(0,0,0,0.07)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.6"; e.currentTarget.style.background = "none"; }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setOpen(false)} />
          <div className="chat-menu" style={{ position: "absolute", top: "100%", right: 0, zIndex: 999, width: 190, background: "#FFF", borderRadius: 10, boxShadow: C.shadowMenu, overflow: "hidden", padding: "4px 0", marginTop: 4, border: "1px solid rgba(0,0,0,0.06)" }}>
            <button className="menu-btn" style={menuItemStyle} onClick={() => { window.open(m.fileUrl!, "_blank"); setOpen(false); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
              Open file
            </button>
            <button className="menu-btn" style={{ ...menuItemStyle, borderTop: `1px solid ${C.separator}` }} onClick={() => { downloadFile(m.fileUrl!, m.fileName || "download"); setOpen(false); }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
              Download file
            </button>
            {m.content ? (
              <button className="menu-btn" style={{ ...menuItemStyle, borderTop: `1px solid ${C.separator}` }} onClick={async () => { try { await navigator.clipboard.writeText(m.content); } catch {} setOpen(false); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                Copy caption
              </button>
            ) : null}
            {canDelete && (
              <button className="menu-btn" style={{ ...menuItemStyle, color: C.red, borderTop: `1px solid ${C.separator}` }} onClick={() => { onDelete(); setOpen(false); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                Delete file
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BubbleBody({ m, canDelete, onDelete }: { m: ChatMessage; canDelete: boolean; onDelete: () => void }) {
  if (m.fileType === "image" && m.fileUrl)
    return (
      <div>
        <img src={m.fileUrl} alt={m.fileName || "image"} onClick={() => window.open(m.fileUrl!, "_blank")} style={{ display: "block", width: "100%", objectFit: "cover", borderRadius: 8, cursor: "pointer" }} />
        {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
      </div>
    );
  if (m.fileType === "video" && m.fileUrl)
    return (
      <div>
        <video src={m.fileUrl} controls preload="metadata" playsInline style={{ display: "block", width: "100%", borderRadius: 8, background: "#000" }} />
        {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
      </div>
    );
  if (m.fileType === "audio" && m.fileUrl)
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0" }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: C.greenBg, color: C.green, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
          </div>
          <audio src={m.fileUrl} controls preload="metadata" style={{ flex: 1, height: 36, minWidth: 0 }} />
        </div>
        {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
      </div>
    );
  if (m.fileType === "file" && m.fileUrl)
    return (
      <div>
        <FileAttachment m={m} canDelete={canDelete} onDelete={onDelete} />
        {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
      </div>
    );
  return <p style={{ margin: 0, fontSize: 14.5, color: C.textPrimary, lineHeight: 1.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.content}</p>;
}

function AudioWave({ active }: { active: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3, height: 32 }}>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className={active ? "audio-bar" : ""} style={{ width: 4, borderRadius: 2, background: active ? C.green : C.textSecondary, height: active ? undefined : 8, transition: active ? undefined : "none" }} />
      ))}
    </div>
  );
}

function AudioPlayer({ src, own }: { src: string; own: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const rafRef = useRef<number>(0);

  function fmtDur(s: number) { const m = Math.floor(s / 60); const sec = Math.floor(s % 60); return `${m}:${sec.toString().padStart(2, "0")}`; }

  const seek = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ref.current || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    ref.current.currentTime = (x / rect.width) * ref.current.duration;
    setProgress(ref.current.currentTime / ref.current.duration);
  }, []);

  useEffect(() => {
    if (!ref.current) return;
    ref.current.addEventListener("loadedmetadata", () => {
      setDuration(ref.current!.duration);
      setPlaying(!ref.current!.paused);
      setProgress(ref.current!.currentTime / ref.current!.duration);
    });
  }, []);

  useEffect(() => {
    if (playing) {
      const tick = () => {
        if (!ref.current) return;
        setProgress(ref.current.currentTime / ref.current.duration);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  useEffect(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;
    const w = canvasRef.current.width;
    const h = canvasRef.current.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = own ? "#25D366" : "#00A884";
    ctx.fillRect(0, 0, w * progress, h);
  }, [progress, own]);

  const accent = own ? "#25D366" : "#00A884";
  const curTime = ref.current?.currentTime || 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", minWidth: 220 }}>
      <button onClick={() => { if (ref.current) { playing ? ref.current.pause() : ref.current.play(); setPlaying(!playing); } }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: accent, flexShrink: 0 }}>
        {playing ? <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg> : <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3" /></svg>}
      </button>
      <canvas ref={canvasRef} onClick={seek} width={160} height={36} style={{ flex: 1, height: 36, borderRadius: 4, cursor: "pointer", background: "rgba(0,0,0,0.06)" }} />
      <span style={{ fontSize: 11, color: C.textSecondary, fontVariantNumeric: "tabular-nums", minWidth: 36, textAlign: "right" }}>{fmtDur(curTime)} / {fmtDur(duration)}</span>
      <audio ref={ref} src={src} preload="metadata" />
    </div>
  );
}

export default function ClassChat({ courseId: courseIdProp, isChatOpen = true, toggleChatOpen }: ClassChatProps) {
  const navigate = useNavigate();
  const params = useParams<{ courseId: string }>();
  const courseId = courseIdProp ?? params.courseId;
  const embedded = courseIdProp !== undefined;

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState<{ msg: ChatMessage; x: number; y: number } | null>(null);

  const [isRecordingAudio, setIsRecordingAudio] = useState(false);
  const [audioSeconds, setAudioSeconds] = useState(0);
  const audioRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoSeconds, setVideoSeconds] = useState(0);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const videoRecorderRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

  // ── Custom SHORT overlay scrollbar (thumb is a small pill, not full-length) ──
  const scrollRef = useRef<HTMLDivElement>(null);
  const sbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sb, setSb] = useState({ trackH: 0, thumbH: 0, top: 0 });
  const [sbHover, setSbHover] = useState(false);
  const [sbScrolling, setSbScrolling] = useState(false);
  const [sbDragging, setSbDragging] = useState(false);
  const [sbThumbHover, setSbThumbHover] = useState(false);

  const updateScrollbar = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const { clientHeight, scrollHeight, scrollTop } = el;
    if (scrollHeight <= clientHeight + 1) { setSb((s) => (s.thumbH === 0 ? s : { ...s, thumbH: 0 })); return; }
    const natural = (clientHeight / scrollHeight) * clientHeight;
    const thumbH = Math.max(28, Math.min(72, natural)); // SHORT pill — tweak 28 / 72 to taste
    const top = (scrollTop / (scrollHeight - clientHeight)) * (clientHeight - thumbH);
    setSb({ trackH: clientHeight, thumbH, top });
    setSbScrolling(true);
    if (sbTimerRef.current) clearTimeout(sbTimerRef.current);
    sbTimerRef.current = setTimeout(() => setSbScrolling(false), 900);
  }, []);

  // Re-sync the thumb when content or viewport size changes (new messages, images loading, resize)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onMediaLoad = () => updateScrollbar();
    el.addEventListener("load", onMediaLoad, true);
    const ro = new ResizeObserver(updateScrollbar);
    ro.observe(el);
    return () => { el.removeEventListener("load", onMediaLoad, true); ro.disconnect(); };
  }, [updateScrollbar]);

  useEffect(() => { updateScrollbar(); }, [messages, loading, updateScrollbar]);

  useEffect(() => () => { if (sbTimerRef.current) clearTimeout(sbTimerRef.current); }, []);

  function startScrollbarDrag(e: React.PointerEvent<HTMLDivElement>) {
    const el = scrollRef.current;
    if (!el || sb.thumbH <= 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const { trackH, thumbH } = sb;
    const maxTop = Math.max(0, trackH - thumbH);
    const onThumb = (e.target as HTMLElement).dataset?.thumb === "1";
    const startTop = onThumb ? Math.min(sb.top, maxTop) : Math.max(0, Math.min(maxTop, e.clientY - rect.top - thumbH / 2));
    const startY = e.clientY;
    const applyTop = (top: number) => {
      const t = Math.max(0, Math.min(maxTop, top));
      el.scrollTop = (t / (maxTop || 1)) * (el.scrollHeight - el.clientHeight);
    };
    if (!onThumb) applyTop(startTop); // clicking the track jumps, then keeps dragging
    setSbDragging(true);
    const onMove = (ev: PointerEvent) => applyTop(startTop + (ev.clientY - startY));
    const onUp = () => { setSbDragging(false); window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  useEffect(() => {
    const saved = localStorage.getItem("currentUser");
    if (!saved) { navigate("/"); return; }
    const u = JSON.parse(saved);
    if (!u.id || !u.tenantId) { navigate("/"); return; }
    setCurrentUser(u);
  }, [navigate]);

  useEffect(() => {
    if (!currentUser || !courseId) return;
    (async () => {
      setLoading(true);
      try {
        const { data: c } = await supabase.from("courses").select("*").eq("id", courseId).maybeSingle();
        if (c) setCourse({ id: c.id, name: c.name || "Class Chat", description: c.description || "", logo: c.logo || "", tenantId: c.tenant_id, trainerId: c.trainer_id, createdAt: c.created_at, tuitionType: c.tuition_type || "free", amount: c.amount || 0, startDate: c.start_date || "", period: c.period || "", mediaUrl: c.logo || "", mediaType: "image", mediaName: "course-logo" });
        const { data } = await supabase.from(TABLE).select("*").eq("course_id", courseId).order("created_at", { ascending: true }).limit(200);
        setMessages((data || []).map(mapMessage));
      } catch (e) { console.error("Chat load failed", e); } finally { setLoading(false); }
    })();
  }, [currentUser, courseId]);

  useEffect(() => {
    if (!courseId) return;
    const channel = supabase.channel(`class-chat-${courseId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: TABLE, filter: `course_id=eq.${courseId}` }, (payload) => { const m = mapMessage(payload.new as Record<string, unknown>); setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: TABLE, filter: `course_id=eq.${courseId}` }, (payload) => { const id = (payload.old as { id?: string }).id; if (id) setMessages((prev) => prev.filter((m) => m.id !== id)); })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: firstLoad.current ? "auto" : "smooth" }); firstLoad.current = false; }, [messages, loading]);

  useEffect(() => {
    if (cameraOpen && cameraStreamRef.current) {
      requestAnimationFrame(() => { if (cameraVideoRef.current && cameraStreamRef.current) cameraVideoRef.current.srcObject = cameraStreamRef.current; });
    }
  }, [cameraOpen]);

  useEffect(() => {
    return () => {
      if (audioTimerRef.current) clearInterval(audioTimerRef.current);
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
      if (audioRecorderRef.current && audioRecorderRef.current.state !== "inactive") { try { audioRecorderRef.current.stop(); } catch {} }
      if (videoRecorderRef.current && videoRecorderRef.current.state !== "inactive") { try { videoRecorderRef.current.stop(); } catch {} }
      audioStreamRef.current?.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const canDelete = useCallback((m: ChatMessage) => m.senderId === currentUser?.id || currentUser?.role === "admin" || currentUser?.role === "trainer", [currentUser]);

  function openMenu(msg: ChatMessage, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ msg, x: window.innerWidth - rect.right, y: Math.min(rect.bottom + 4, window.innerHeight - 220) });
  }

  // Close the message menu with the Escape key for a keyboard-friendly feel
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu]);

  async function sendMessage(content: string, fileToSend: File | null) {
    if (!currentUser || (!content.trim() && !fileToSend) || sending) return;
    const tenantId = currentUser.tenantId; const cid = courseId; if (!tenantId || !cid) return;
    setSending(true);
    try {
      let fileUrl: string | null = null;
      if (fileToSend) fileUrl = await uploadChatFile(fileToSend, tenantId, cid);
      const row = { id: crypto.randomUUID(), tenant_id: tenantId, course_id: cid, sender_id: currentUser.id, sender_name: currentUser.username, content: content.trim(), file_url: fileUrl, file_name: fileToSend ? fileToSend.name : null, file_type: fileToSend ? detectType(fileToSend) : null };
      const { error } = await supabase.from(TABLE).insert(row);
      if (error) throw error;
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, mapMessage(row as Record<string, unknown>)]));
      setText(""); setFile(null); if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) { console.error("Send failed", e); alert("Could not send message."); } finally { setSending(false); }
  }

  async function handleSend() { await sendMessage(text, file); }

  async function startAudioRecording() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { alert("Microphone is not supported."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      let mimeType = "audio/webm";
      if (typeof MediaRecorder.isTypeSupported === "function") { mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "audio/webm"; }
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => { stream.getTracks().forEach((t) => t.stop()); audioStreamRef.current = null; if (audioChunksRef.current.length === 0) return; const blob = new Blob(audioChunksRef.current, { type: mimeType }); const ext = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"; const audioFile = new File([blob], `voice-message-${Date.now()}.${ext}`, { type: mimeType }); try { await sendMessage("", audioFile); } catch (e) { console.error("Voice send failed", e); } };
      audioRecorderRef.current = recorder; recorder.start(1000); setIsRecordingAudio(true); setAudioSeconds(0); audioTimerRef.current = setInterval(() => setAudioSeconds((prev) => prev + 1), 1000);
    } catch (e: any) { console.error("Mic error:", e); if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") alert("Microphone permission denied."); else alert("Could not open microphone: " + (e?.message || "Unknown error")); }
  }

  function stopAudioRecording(send: boolean) {
    if (audioTimerRef.current) { clearInterval(audioTimerRef.current); audioTimerRef.current = null; }
    const recorder = audioRecorderRef.current;
    if (recorder && recorder.state === "recording") { if (!send) { recorder.onstop = null; recorder.stop(); audioStreamRef.current?.getTracks().forEach((t) => t.stop()); audioStreamRef.current = null; } else { recorder.stop(); } }
    setIsRecordingAudio(false); setAudioSeconds(0); audioChunksRef.current = [];
  }

  async function openCamera() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) { alert("Camera is not supported."); return; }
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true });
      cameraStreamRef.current = stream; setCameraOpen(true);
    } catch (e: any) { console.error("Camera error:", e); if (e?.name === "NotAllowedError" || e?.name === "PermissionDeniedError") alert("Camera permission denied."); else alert("Could not open camera: " + (e?.message || "Unknown error")); }
  }

  function closeCamera() {
    if (videoRecorderRef.current && videoRecorderRef.current.state === "recording") { videoRecorderRef.current.onstop = null; try { videoRecorderRef.current.stop(); } catch {} }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop()); cameraStreamRef.current = null;
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    setIsRecordingVideo(false); setVideoSeconds(0); setCameraOpen(false);
  }

  function takePhoto() {
    const video = cameraVideoRef.current; if (!video || !cameraStreamRef.current) return;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth || 640; canvas.height = video.videoHeight || 480;
    const ctx = canvas.getContext("2d"); if (!ctx) return; ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(async (blob) => { if (!blob) return; const photoFile = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }); closeCamera(); await sendMessage("", photoFile); }, "image/jpeg", 0.92);
  }

  function startVideoRecording() {
    const stream = cameraStreamRef.current; if (!stream) return;
    let mimeType = "video/webm";
    if (typeof MediaRecorder.isTypeSupported === "function") { mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm"; }
    try {
      const recorder = new MediaRecorder(stream, { mimeType }); videoChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) videoChunksRef.current.push(e.data); };
      recorder.onstop = async () => { if (videoChunksRef.current.length === 0) return; const blob = new Blob(videoChunksRef.current, { type: mimeType }); const ext = mimeType.includes("mp4") ? "mp4" : "webm"; const videoFile = new File([blob], `video-${Date.now()}.${ext}`, { type: mimeType }); closeCamera(); await sendMessage("", videoFile); };
      videoRecorderRef.current = recorder; recorder.start(1000); setIsRecordingVideo(true); setVideoSeconds(0); videoTimerRef.current = setInterval(() => setVideoSeconds((prev) => prev + 1), 1000);
    } catch (e: any) { alert("Could not start video recording: " + (e?.message || "Unknown error")); }
  }

  function stopVideoRecording() { if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; } if (videoRecorderRef.current && videoRecorderRef.current.state === "recording") { videoRecorderRef.current.stop(); } setIsRecordingVideo(false); setVideoSeconds(0); }

  async function handleDelete(m: ChatMessage) {
    if (!window.confirm("Delete this message?")) return; setMenu(null);
    try { if (m.fileUrl) { const path = extractStoragePath(m.fileUrl); if (path) await supabase.storage.from(BUCKET).remove([path]); } const { error } = await supabase.from(TABLE).delete().eq("id", m.id); if (error) throw error; setMessages((prev) => prev.filter((x) => x.id !== m.id)); } catch (e) { console.error("Delete failed", e); alert("Could not delete message."); }
  }

  async function handleCopy(m: ChatMessage) { setMenu(null); try { await navigator.clipboard.writeText(m.content); } catch {} }

  function fmtTimer(s: number) { return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`; }

  if (!isChatOpen) return null;

  function renderMessages() {
    let prevSenderId = ""; let prevDate = "";
    return messages.map((m, i) => {
      const own = m.senderId === currentUser?.id; const msgDate = formatDate(m.createdAt); const showDate = msgDate !== prevDate; prevDate = msgDate;
      const showSender = !own && m.senderId !== prevSenderId; const isLastInGroup = i === messages.length - 1 || messages[i + 1]?.senderId !== m.senderId; prevSenderId = m.senderId;
      const msgCanDelete = canDelete(m); const isFile = m.fileType != null;
      return (
        <div key={m.id}>
          {showDate && <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}><span style={{ background: "#FFF", color: C.textSecondary, fontSize: 12.5, fontWeight: 500, padding: "5px 12px", borderRadius: 8, boxShadow: C.shadow }}>{msgDate}</span></div>}
          <div style={{ display: "flex", flexDirection: own ? "row-reverse" : "row", alignItems: "flex-end", gap: 0, marginBottom: isLastInGroup ? 10 : 2 }}>
            <div style={{ maxWidth: isFile ? "min(90%, 520px)" : "min(75%, 420px)", minWidth: 80, padding: isFile ? "4px 6px 5px" : "6px 10px 4px", borderRadius: 8, borderTopLeftRadius: showSender || !own ? 8 : 2, borderTopRightRadius: showSender || own ? 8 : 2, borderBottomRightRadius: own && isLastInGroup ? 2 : 8, borderBottomLeftRadius: !own && isLastInGroup ? 2 : 8, background: own ? C.ownBubble : C.otherBubble, boxShadow: C.shadow, position: "relative" }}>
              {showSender && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.purple, marginBottom: 2, marginTop: 2 }}>{m.senderName}</div>}
              {m.fileType === "audio" && m.fileUrl ? <AudioPlayer src={m.fileUrl} own={own} /> : <BubbleBody m={m} canDelete={msgCanDelete} onDelete={() => handleDelete(m)} />}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1 }}>{formatTime(m.createdAt)}</span>
                {own && <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3L11 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M5 5l3 3L15 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>}
              </div>
            </div>
            {/* Document cards render their own complete kebab menu (Open / Download / Delete),
                so the row-level kebab is hidden here to avoid TWO menus on one message. */}
            {!(m.fileType === "file" && m.fileUrl) && (
              <button onClick={(e) => openMenu(m, e)} aria-label="Message options" style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 2px", color: C.textSecondary, borderRadius: "50%", flexShrink: 0, opacity: 0.55, lineHeight: 0, touchAction: "manipulation", transition: "opacity 0.15s" }} onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }} onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
              </button>
            )}
          </div>
        </div>
      );
    });
  }

  const menuBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 16px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 14, fontWeight: 400, color: C.textPrimary, transition: "background 0.1s" };
  const menuDiv: React.CSSProperties = { borderTop: `1px solid ${C.separator}` };

  return (
    <div className={embedded ? "chat-root chat-root--embedded" : "chat-root"} style={{ display: "flex", flexDirection: "column", width: "100%", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", boxSizing: "border-box", position: "relative" }}>
      <style>{`
        .chat-root { height: 100vh; }
        @supports (height: 100dvh) { .chat-root { height: 100dvh; } }
        .chat-root--embedded { height: 100%; min-height: 0; }
        .chat-scroll {
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          overflow-y: scroll !important;
          background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c8c8' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
        }
        /* Native scrollbar fully hidden — replaced by the custom SHORT overlay thumb (see JSX) */
        .chat-scroll { scrollbar-width: none; -ms-overflow-style: none; }
        .chat-scroll::-webkit-scrollbar { width: 0; height: 0; }
        .chat-composer { padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
        .menu-btn:hover { background: #F5F6F6; }
        @keyframes chatMenuIn { from { opacity: 0; transform: translateY(-4px) scale(0.97); } to { opacity: 1; transform: translateY(0) scale(1); } }
        .chat-menu { animation: chatMenuIn 0.13s ease; transform-origin: top right; }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        .rec-dot { animation: pulse 1.2s ease-in-out infinite; }
        @keyframes audioBar { 0%, 100% { height: 6px; } 50% { height: 24px; } }
        .audio-bar { animation: audioBar 0.8s ease-in-out infinite; }
        .audio-bar:nth-child(2) { animation-delay: 0.1s; }
        .audio-bar:nth-child(3) { animation-delay: 0.2s; }
        .audio-bar:nth-child(4) { animation-delay: 0.3s; }
        .audio-bar:nth-child(5) { animation-delay: 0.15s; }
      `}</style>

      <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", background: C.headerBg, color: C.headerText, flexShrink: 0, gap: 12, zIndex: 2 }}>
        <div style={{ fontSize: 17, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{course?.name || "Class Chat"}</div>
        <div style={{ display: "flex", gap: 6 }}>
          {embedded && toggleChatOpen && (
            <button onClick={toggleChatOpen} style={{ background: "none", border: "none", cursor: "pointer", color: "#FFF", padding: 0, lineHeight: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          )}
        </div>
      </div>

      <div className="chat-scroll-wrap" style={{ position: "relative", flex: 1, minHeight: 0, display: "flex" }} onMouseEnter={() => setSbHover(true)} onMouseLeave={() => setSbHover(false)}>
        <div ref={scrollRef} className="chat-scroll" onScroll={updateScrollbar} style={{ flex: 1, overflowY: "auto", padding: "12px 16px", minHeight: 0 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: C.textSecondary, fontSize: 14 }}>Loading...</div>
          ) : messages.length === 0 ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%", color: C.textSecondary, fontSize: 14 }}>No messages yet. Say hi! 👋</div>
          ) : renderMessages()}
          <div ref={endRef} />
        </div>
        {/* SHORT custom scrollbar pill — fades in on hover / while scrolling */}
        <div
          onPointerDown={startScrollbarDrag}
          style={{ position: "absolute", top: 0, right: 2, bottom: 0, width: 12, zIndex: 6, opacity: sb.thumbH > 0 && (sbHover || sbScrolling || sbDragging) ? 1 : 0, transition: "opacity 0.25s ease", pointerEvents: sb.thumbH > 0 && (sbHover || sbScrolling || sbDragging) ? "auto" : "none", touchAction: "none", userSelect: "none" }}
        >
          <div
            data-thumb="1"
            onPointerEnter={() => setSbThumbHover(true)}
            onPointerLeave={() => setSbThumbHover(false)}
            style={{ position: "absolute", top: sb.top, left: 3, width: 6, height: sb.thumbH, borderRadius: 999, background: sbDragging || sbThumbHover ? "rgba(17,27,33,0.5)" : "rgba(17,27,33,0.3)", cursor: sbDragging ? "grabbing" : "grab", transition: sbDragging ? "none" : "background 0.2s ease, top 0.08s linear" }}
          />
        </div>
      </div>

      {cameraOpen && (
        <div style={{ position: "absolute", bottom: 70, left: 16, right: 16, zIndex: 200, background: "#000", borderRadius: 16, overflow: "hidden", boxShadow: C.shadowMenu, display: "flex", flexDirection: "column" }}>
          <video ref={(el) => { cameraVideoRef.current = el; }} autoPlay playsInline muted style={{ width: "100%", maxHeight: 260, objectFit: "cover", transform: "scaleX(-1)" }} />
          <div style={{ display: "flex", justifyContent: "center", gap: 16, padding: 12, background: "rgba(0,0,0,0.75)" }}>
            {isRecordingVideo ? (
              <>
                <div className="rec-dot" style={{ width: 12, height: 12, borderRadius: "50%", background: C.red, alignSelf: "center" }} />
                <span style={{ color: "#FFF", fontSize: 14, fontWeight: 600, alignSelf: "center" }}>{fmtTimer(videoSeconds)}</span>
                <button onClick={stopVideoRecording} style={{ background: C.red, border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFF"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                </button>
              </>
            ) : (
              <>
                <button onClick={takePhoto} style={{ background: "none", border: "2px solid #FFF", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "#FFF" }} />
                </button>
                <button onClick={startVideoRecording} style={{ background: C.red, border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="#FFF"><circle cx="12" cy="12" r="8" /></svg>
                </button>
              </>
            )}
            <button onClick={closeCamera} style={{ background: "rgba(255,255,255,0.2)", border: "none", borderRadius: "50%", width: 44, height: 44, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "#FFF" }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>
      )}

      <div className="chat-composer" style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: C.inputBarBg, borderTop: `1px solid ${C.separator}`, flexShrink: 0, zIndex: 2 }}>
        {isRecordingAudio ? (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, padding: "6px 12px", background: C.inputBg, borderRadius: 24, border: `1px solid ${C.separator}` }}>
            <div className="rec-dot" style={{ width: 10, height: 10, borderRadius: "50%", background: C.red, flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: C.textSecondary, fontWeight: 500 }}>{fmtTimer(audioSeconds)}</span>
            <AudioWave active />
            <div style={{ flex: 1 }} />
            <button onClick={() => stopAudioRecording(true)} style={{ background: C.green, border: "none", borderRadius: "50%", width: 36, height: 36, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
            </button>
            <button onClick={() => stopAudioRecording(false)} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        ) : (
          <>
            <button onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.textSecondary, flexShrink: 0 }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
            </button>
            <input ref={fileInputRef} type="file" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip,.rar" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); }} />
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} style={{ flex: 1, border: "none", outline: "none", background: C.inputBg, padding: "10px 14px", borderRadius: 24, fontSize: 15, color: C.textPrimary, lineHeight: 1.35 }} />
            <button onClick={startAudioRecording} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.textSecondary, flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
            </button>
            <button onClick={openCamera} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.textSecondary, flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" /></svg>
            </button>
            {(text.trim() || file) && (
              <button onClick={handleSend} disabled={sending} style={{ background: C.green, border: "none", borderRadius: "50%", width: 36, height: 36, cursor: sending ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: sending ? 0.5 : 1 }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
              </button>
            )}
          </>
        )}
      </div>

      {file && !isRecordingAudio && (
        <div style={{ position: "absolute", bottom: 70, left: 16, right: 16, background: C.inputBg, borderRadius: 12, padding: "10px 14px", boxShadow: C.shadowMenu, display: "flex", alignItems: "center", gap: 10, zIndex: 10 }}>
          <FileIcon fileType={detectType(file)} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 13, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
            <div style={{ fontSize: 11, color: C.textSecondary, marginTop: 2 }}>{(file.size / 1024).toFixed(1)} KB</div>
          </div>
          <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: C.textSecondary }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      {menu && (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setMenu(null)} />
          <div className="chat-menu" style={{ position: "absolute", right: menu.x, top: menu.y, zIndex: 999, width: 190, background: "#FFF", borderRadius: 10, boxShadow: C.shadowMenu, overflow: "hidden", padding: "4px 0", border: "1px solid rgba(0,0,0,0.06)" }}>
            {menu.msg.fileUrl && (
              <button className="menu-btn" style={menuBtn} onClick={() => { window.open(menu.msg.fileUrl!, "_blank"); setMenu(null); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                Open file
              </button>
            )}
            {menu.msg.fileUrl && (
              <button className="menu-btn" style={{ ...menuBtn, ...menuDiv }} onClick={() => { downloadFile(menu.msg.fileUrl!, menu.msg.fileName || "download"); setMenu(null); }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Download file
              </button>
            )}
            {menu.msg.content ? (
              <button className="menu-btn" style={{ ...menuBtn, ...(menu.msg.fileUrl ? menuDiv : {}) }} onClick={() => handleCopy(menu.msg)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                Copy text
              </button>
            ) : null}
            {canDelete(menu.msg) && (
              <button className="menu-btn" style={{ ...menuBtn, ...((menu.msg.fileUrl || menu.msg.content) ? menuDiv : {}), color: C.red }} onClick={() => handleDelete(menu.msg)}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}