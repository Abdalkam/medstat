// src/components/ClassChat.tsx
import { useEffect, useState, useRef } from "react";
import type { ChatMessage } from "../types";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { sendChatMessage, getChatMessages } from "../database/chatDB";

const C = {
  bg: "rgba(28, 28, 30, 0.85)",
  card: "rgba(44, 44, 46, 0.8)",
  textPrimary: "#FFFFFF",
  textSecondary: "#AEAEB2",
  separator: "rgba(255,255,255,0.08)",
  accent: "#0A84FF",
  green: "#34C759",
  red: "#FF3B30",
  orange: "#FF9F0A",
  bubbleOut: "#0A84FF",
  bubbleIn: "rgba(255,255,255,0.1)",
};

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

interface Props {
  courseId: string;
  videoTrack?: MediaStreamTrack | null;
  isMicOn?: boolean;
  toggleMic?: () => void;
  isCamOn?: boolean;
  toggleCam?: () => void;
  hasMicPermission?: boolean;
}

export default function ClassChat({ courseId, videoTrack, isMicOn, toggleMic, isCamOn, toggleCam }: Props) {
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  
  const [isMinimized, setIsMinimized] = useState(false);
  const [pos, setPos] = useState({ x: 20, y: 20 });
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedAvatars = useRef<Set<string>>(new Set());

  // Drag logic
  const handleStart = (clientX: number, clientY: number) => {
    if (isMinimized) return;
    dragRef.current = { startX: clientX, startY: clientY, origX: pos.x, origY: pos.y };
  };

  const handleMove = (clientX: number, clientY: number) => {
    if (!dragRef.current) return;
    const dx = clientX - dragRef.current.startX;
    const dy = clientY - dragRef.current.startY;
    setPos({
      x: Math.max(10, Math.min(window.innerWidth - 360, dragRef.current.origX + dx)),
      y: Math.max(10, Math.min(window.innerHeight - 100, dragRef.current.origY + dy))
    });
  };

  useEffect(() => {
    const mouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const mouseUp = () => { dragRef.current = null; };
    const touchMove = (e: TouchEvent) => { if(e.touches[0]) handleMove(e.touches[0].clientX, e.touches[0].clientY); };
    const touchEnd = () => { dragRef.current = null; };
    
    window.addEventListener("mousemove", mouseMove);
    window.addEventListener("mouseup", mouseUp);
    window.addEventListener("touchmove", touchMove);
    window.addEventListener("touchend", touchEnd);
    return () => {
      window.removeEventListener("mousemove", mouseMove);
      window.removeEventListener("mouseup", mouseUp);
      window.removeEventListener("touchmove", touchMove);
      window.removeEventListener("touchend", touchEnd);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => handleStart(e.clientX, e.clientY);
  const handleTouchStart = (e: React.TouchEvent) => { if(e.touches[0]) handleStart(e.touches[0].clientX, e.touches[0].clientY); };

  function normalize(raw: any): ChatMessage {
    return {
      id: raw.id,
      courseId: raw.course_id ?? raw.courseId ?? courseId,
      userId: raw.user_id ?? raw.userId ?? "",
      username: raw.username ?? "",
      message: raw.message ?? "",
      createdAt: raw.created_at ?? raw.createdAt ?? "",
      imageUrl: raw.image_url ?? raw.imageUrl ?? null,
    };
  }

  useEffect(() => {
    const userIds = [...new Set(messages.map((m) => m.userId).filter(Boolean))];
    const missingIds = userIds.filter(id => !fetchedAvatars.current.has(id));
    if (missingIds.length === 0) return;
    missingIds.forEach(id => fetchedAvatars.current.add(id));

    const fetchAvatars = async () => {
      try {
        const { data } = await supabase.from("profile_settings").select("user_id, avatar_url").in("user_id", missingIds);
        if (data) {
          const map: Record<string, string> = {};
          for (const u of data) { if (u.avatar_url) map[u.user_id] = u.avatar_url; }
          setAvatarMap((prev) => ({ ...prev, ...map }));
        }
      } catch (err) { console.error("❌ Avatar fetch exception:", err); }
    };
    fetchAvatars();
  }, [messages]);

  useEffect(() => {
    if (!courseId) return;
    const fetchMessages = async () => {
      // 1. Load from Local DB instantly
      const localMsgs = await getChatMessages(courseId);
      if (localMsgs.length > 0) setMessages(localMsgs);

      // 2. Fetch from Supabase
      try {
        const { data } = await supabase.from("chat_messages").select("*").eq("course_id", courseId).order("created_at", { ascending: true });
        if (data) {
          const mapped = data.map(normalize);
          setMessages(mapped);
          // Sync to local DB
          await db.chatMessages.bulkPut(mapped);
        }
      } catch (err) { console.warn("Offline: Using local chat messages"); }
    };
    fetchMessages();

    const channel = supabase.channel(`chat-${courseId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `course_id=eq.${courseId}` }, (payload) => {
        const normalized = normalize(payload.new);
        setMessages((prev) => prev.some((m) => m.id === normalized.id) ? prev : [...prev, normalized]);
        db.chatMessages.put(normalized);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "chat_messages", filter: `course_id=eq.${courseId}` }, (payload) => {
        const deletedId = payload.old.id;
        // 1. Remove from UI instantly
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        // 2. Remove from local IndexedDB
        db.chatMessages.delete(deletedId);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [courseId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");
    if (!isImg && !isVid) return alert("Please select an image or video file.");
    if (file.size > (isImg ? 5 : 15) * 1024 * 1024) return alert("File too large!");
    
    const reader = new FileReader();
    reader.onload = () => { setMediaPreview(reader.result as string); setMediaBase64(reader.result as string); setIsVideo(isVid); };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const clearMediaPreview = () => { setMediaPreview(null); setMediaBase64(null); setIsVideo(false); };

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!message.trim() && !mediaBase64) || !courseId || sending) return;
    const tempId = crypto.randomUUID();
    const optimistic: ChatMessage = { id: tempId, courseId, userId: currentUser.id, username: currentUser.username || "You", message: message.trim(), createdAt: new Date().toISOString(), imageUrl: mediaBase64 };
    
    setMessages((prev) => [...prev, optimistic]);
    setMessage(""); inputRef.current?.focus(); setSending(true);

    // 1. Save to Local DB
    await sendChatMessage(optimistic);

    // 2. Push to Supabase
    try {
      const { error } = await supabase.from("chat_messages").insert({ id: tempId, course_id: courseId, user_id: currentUser.id, username: currentUser.username || "You", message: message.trim(), image_url: mediaBase64 });
      if (error) throw error;
      clearMediaPreview();
    } catch (error) { 
      console.warn("Message saved locally, but failed to sync to cloud."); 
      clearMediaPreview(); 
    } finally { setSending(false); }
  }

  async function handleDeleteMessage(msgId: string) {
    const originalMessages = [...messages];
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setDeletingId(msgId);
    
    // 1. Delete from Local DB
    await db.chatMessages.delete(msgId);

    // 2. Delete from Supabase
    try {
      const { error } = await supabase.from("chat_messages").delete().eq("id", msgId).eq("user_id", currentUser.id);
      if (error) throw error;
    } catch (error) { 
      console.warn("Failed to delete from cloud, but deleted locally.");
      setMessages(originalMessages); 
    } finally { setDeletingId(null); }
  }

  function formatTime(iso: string) {
    if (!iso) return "";
    const date = new Date(iso);
    const h = date.getHours() % 12 || 12;
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m} ${date.getHours() >= 12 ? "PM" : "AM"}`;
  }

  function getMsgGroups() {
    const groups: { userId: string; username: string; avatarUrl: string; msgs: ChatMessage[] }[] = [];
    for (const msg of messages) {
      const last = groups[groups.length - 1];
      if (last && last.userId === msg.userId) last.msgs.push(msg);
      else groups.push({ userId: msg.userId, username: msg.username, avatarUrl: avatarMap[msg.userId] || "", msgs: [msg] });
    }
    return groups;
  }

  const msgGroups = getMsgGroups();

  if (isMinimized) {
    return (
      <button onClick={() => setIsMinimized(false)} style={{ position: "fixed", bottom: "24px", right: "24px", width: "56px", height: "56px", borderRadius: "50%", background: C.accent, color: "#fff", border: "none", cursor: "pointer", boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        {messages.length > 0 && <span style={{ position: "absolute", top: "-4px", right: "-4px", width: "22px", height: "22px", borderRadius: "50%", background: C.red, color: "#fff", fontSize: "11px", fontWeight: "bold", display: "flex", alignItems: "center", justifyContent: "center" }}>{messages.length}</span>}
      </button>
    );
  }

  return (
    <div style={{ position: "fixed", top: `${pos.y}px`, left: `${pos.x}px`, width: "340px", height: "500px", background: C.bg, borderRadius: "20px", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)", border: `1px solid ${C.separator}`, boxShadow: "0 24px 48px rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", flexDirection: "column", overflow: "hidden", color: C.textPrimary, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div onMouseDown={handleMouseDown} onTouchStart={handleTouchStart} style={{ padding: "12px 16px", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "move", borderBottom: `1px solid ${C.separator}` }}>
        <span style={{ color: C.textPrimary, fontWeight: "600", fontSize: "14px" }}>Live Chat & Call</span>
        <button onClick={() => setIsMinimized(true)} style={{ background: "none", border: "none", color: C.textSecondary, cursor: "pointer", padding: "4px", borderRadius: "6px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>

      <div style={{ padding: "12px", borderBottom: `1px solid ${C.separator}` }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ width: "100px", height: "70px", borderRadius: "12px", overflow: "hidden", background: "#000", flexShrink: 0, position: "relative" }}>
            {videoTrack ? <VideoTile videoTrack={videoTrack} /> : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSecondary, fontSize: "24px" }}>🦗</div>}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
            {toggleMic && (
              <button onClick={toggleMic} style={{ padding: "10px", borderRadius: "10px", border: "none", background: isMicOn ? C.green : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isMicOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
              </button>
            )}
            {toggleCam && (
              <button onClick={toggleCam} style={{ padding: "10px", borderRadius: "10px", border: "none", background: isCamOn ? C.accent : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isCamOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "6px", background: "rgba(0,0,0,0.1)" }}>
        {messages.length === 0 && <div style={{ textAlign: "center", color: C.textSecondary, fontSize: "13px", marginTop: "20px" }}>No messages yet. Say hello! 👋</div>}
        {msgGroups.map((group, gi) => {
          const isOwn = group.userId === currentUser.id;
          return (
            <div key={`${group.userId}-${gi}`} style={{ display: "flex", justifyContent: isOwn ? "flex-end" : "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", maxWidth: "85%", gap: "2px", alignItems: isOwn ? "flex-end" : "flex-start" }}>
                {!isOwn && <span style={{ fontSize: "11px", color: C.accent, fontWeight: "600", marginLeft: "8px" }}>{group.username}</span>}
                {group.msgs.map((msg, idx) => {
                  const isLast = idx === group.msgs.length - 1;
                  return (
                    <div key={msg.id} style={{ display: "flex", alignItems: "center", gap: "4px", flexDirection: isOwn ? "row-reverse" : "row" }}>
                      <div style={{ background: isOwn ? C.bubbleOut : C.bubbleIn, color: "#fff", padding: msg.imageUrl ? "4px" : "8px 12px", borderRadius: isOwn ? "16px 16px 4px 16px" : "16px 16px 16px 4px", marginBottom: isLast ? "4px" : "0px", maxWidth: "100%", boxShadow: "0 1px 2px rgba(0,0,0,0.2)" }}>
                        {msg.imageUrl ? (
                          <div style={{ position: "relative" }}>
                            {msg.imageUrl.startsWith("data:video") ? <video src={msg.imageUrl} controls style={{ width: "100%", maxWidth: "200px", borderRadius: "12px", display: "block" }} /> : <img src={msg.imageUrl} alt="Uploaded" style={{ width: "100%", maxWidth: "200px", borderRadius: "12px", display: "block" }} />}
                            <span style={{ position: "absolute", bottom: "4px", right: "4px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" }}>{formatTime(msg.createdAt)}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: "14px", lineHeight: "1.4", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {msg.message}
                            <span style={{ fontSize: "10px", color: isOwn ? "rgba(255,255,255,0.7)" : C.textSecondary, marginLeft: "8px", float: "right", marginTop: "4px" }}>{formatTime(msg.createdAt)}</span>
                          </div>
                        )}
                      </div>
                      {isOwn && <button onClick={() => handleDeleteMessage(msg.id)} disabled={deletingId === msg.id} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", padding: "4px", opacity: deletingId === msg.id ? 0.5 : 1 }}><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ padding: "8px", display: "flex", gap: "6px", alignItems: "center", borderTop: `1px solid ${C.separator}`, background: "rgba(0,0,0,0.2)" }}>
        <button onClick={() => fileInputRef.current?.click()} style={{ background: "none", border: "none", color: C.textSecondary, cursor: "pointer", padding: "8px" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
        </button>
        <input ref={fileInputRef} type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={handleMediaUpload} />
        
        {mediaPreview && (
          <div style={{ position: "relative", width: "40px", height: "40px", borderRadius: "8px", overflow: "hidden" }}>
            {isVideo ? <video src={mediaPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <img src={mediaPreview} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
            <button onClick={clearMediaPreview} style={{ position: "absolute", top: "0", right: "0", background: "rgba(0,0,0,0.5)", color: "#fff", border: "none", cursor: "pointer" }}>X</button>
          </div>
        )}

        <input ref={inputRef} type="text" placeholder="Type a message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={sending} style={{ flex: 1, background: "rgba(255,255,255,0.1)", border: "none", outline: "none", color: "#fff", padding: "10px 14px", borderRadius: "20px", fontSize: "14px" }} />
        <button onClick={handleSend} disabled={(!message.trim() && !mediaBase64) || sending} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: (message.trim() || mediaBase64) ? C.accent : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
        </button>
      </div>
    </div>
  );
}