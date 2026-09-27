// src/components/ClassChat.tsx
import { useEffect, useState, useRef } from "react";
import type { ChatMessage } from "../types";
import { supabase } from "../auth/supabase";
import { db } from "../database/db";
import { sendChatMessage, getChatMessages } from "../database/chatDB";

const C = {
  bg: "#1C1C1E",
  card: "#2C2C2E",
  textPrimary: "#FFFFFF",
  textSecondary: "#AEAEB2",
  separator: "rgba(255,255,255,0.08)",
  accent: "#0A84FF",
  green: "#34C759",
  red: "#FF3B30",
  orange: "#FF9F0A",
  // WhatsApp Theme Colors
  whatsappGreen: "#00A884",
  whatsappDarkGreen: "#075E54",
  bubbleOut: "#D9FDD3", 
  bubbleIn: "#FFFFFF",  
  whatsappBg: "#0B141A",
  inputBg: "#F0F2F5",
  inputField: "#FFFFFF",
  textDark: "#111B21",
  textGrey: "#667781",
  fileBoxBg: "#E1F2FB",
  fileBoxText: "#0277BD"
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
  isChatOpen: boolean;
  toggleChatOpen: () => void;
  videoTrack?: MediaStreamTrack | null;
  isMicOn?: boolean;
  toggleMic?: () => void;
  isCamOn?: boolean;
  toggleCam?: () => void;
  hasMicPermission?: boolean;
}

export default function ClassChat({ courseId, isChatOpen, toggleChatOpen, videoTrack, isMicOn, toggleMic, isCamOn, toggleCam }: Props) {
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [mediaName, setMediaName] = useState<string>("file");
  
  // Recording State
  const [isRecording, setIsRecording] = useState(false);
  const [recordingType, setRecordingType] = useState<'audio' | 'video'>('audio');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedAvatars = useRef<Set<string>>(new Set());

  function normalize(raw: any): ChatMessage {
    return {
      id: raw.id, courseId: raw.course_id ?? raw.courseId ?? courseId, userId: raw.user_id ?? raw.userId ?? "", username: raw.username ?? "", message: raw.message ?? "", createdAt: raw.created_at ?? raw.createdAt ?? "", imageUrl: raw.image_url ?? raw.imageUrl ?? null,
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
      const localMsgs = await getChatMessages(courseId);
      if (localMsgs.length > 0) setMessages(localMsgs);
      try {
        const { data } = await supabase.from("chat_messages").select("*").eq("course_id", courseId).order("created_at", { ascending: true });
        if (data) {
          const mapped = data.map(normalize);
          setMessages(mapped);
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
        setMessages((prev) => prev.filter((m) => m.id !== deletedId));
        db.chatMessages.delete(deletedId);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) return alert("File too large! Max size is 20MB.");
    
    const reader = new FileReader();
    reader.onload = () => {
      setMediaPreview(reader.result as string);
      setMediaBase64(reader.result as string);
      setMediaName(file.name);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const clearMediaPreview = () => { setMediaPreview(null); setMediaBase64(null); setMediaName("file"); };

  // --- RECORDING LOGIC ---
  const startRecording = async (type: 'audio' | 'video') => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia(
        type === 'video' ? { video: true, audio: true } : { audio: true }
      );
      recordingStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      
      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: type === 'video' ? 'video/webm' : 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          setMediaPreview(reader.result as string);
          setMediaBase64(reader.result as string);
          setMediaName(type === 'video' ? 'video_message.webm' : 'voice_message.webm');
        };
        reader.readAsDataURL(blob);
        // Stop all tracks to turn off camera/mic indicator
        stream.getTracks().forEach(track => track.stop());
      };
      
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingType(type);
      setIsRecording(true);
    } catch (err) {
      alert("Could not access microphone/camera. Please check browser permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!message.trim() && !mediaBase64) || !courseId || sending) return;
    const tempId = crypto.randomUUID();
    const optimistic: ChatMessage = { id: tempId, courseId, userId: currentUser.id, username: currentUser.username || "You", message: message.trim(), createdAt: new Date().toISOString(), imageUrl: mediaBase64 };
    
    setMessages((prev) => [...prev, optimistic]);
    setMessage(""); inputRef.current?.focus(); setSending(true);
    await sendChatMessage(optimistic);

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
    await db.chatMessages.delete(msgId);
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

  const iconBtnStyle: React.CSSProperties = { width: "40px", height: "40px", borderRadius: "50%", border: "none", background: "transparent", color: C.textGrey, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" };

  // Collapsed State
  if (!isChatOpen) {
    return (
      <div style={{ width: "100%", height: "100%", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", padding: "16px 0" }}>
        <button onClick={toggleChatOpen} style={{ background: "rgba(118, 118, 128, 0.12)", border: "none", cursor: "pointer", borderRadius: "8px", width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", color: C.textPrimary }} title="Open Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>
        </button>
        
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {toggleMic && (
            <button onClick={toggleMic} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: isMicOn ? C.green : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Live Mic">
              {isMicOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
            </button>
          )}
          {toggleCam && (
            <button onClick={toggleCam} style={{ width: "36px", height: "36px", borderRadius: "50%", border: "none", background: isCamOn ? C.accent : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Live Cam">
              {isCamOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
            </button>
          )}
        </div>
      </div>
    );
  }

  // Expanded State
  return (
    <div style={{ width: "100%", height: "100%", background: C.bg, display: "flex", flexDirection: "column", overflow: "hidden", color: C.textPrimary, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <div style={{ padding: "12px 16px", background: "rgba(0,0,0,0.3)", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${C.separator}` }}>
        <span style={{ color: C.textPrimary, fontWeight: "600", fontSize: "14px" }}>Live Chat & Call</span>
        <button onClick={toggleChatOpen} style={{ background: "none", border: "none", color: C.textSecondary, cursor: "pointer", padding: "4px", borderRadius: "6px" }} title="Close Chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="13 17 18 12 13 7"/><polyline points="6 17 11 12 6 7"/></svg>
        </button>
      </div>

      <div style={{ padding: "12px", borderBottom: `1px solid ${C.separator}` }}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <div style={{ width: "100px", height: "70px", borderRadius: "12px", overflow: "hidden", background: "#000", flexShrink: 0, position: "relative" }}>
            {videoTrack ? (
              <VideoTile videoTrack={videoTrack} />
            ) : (
              <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: C.textSecondary }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
              </div>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", flex: 1 }}>
            {toggleMic && (
              <button onClick={toggleMic} style={{ padding: "10px", borderRadius: "10px", border: "none", background: isMicOn ? C.green : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Live Mic">
                {isMicOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
              </button>
            )}
            {toggleCam && (
              <button onClick={toggleCam} style={{ padding: "10px", borderRadius: "10px", border: "none", background: isCamOn ? C.accent : "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }} title="Live Cam">
                {isCamOn ? <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg> : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/></svg>}
              </button>
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "6px", background: C.whatsappBg }}>
        {messages.length === 0 && <div style={{ textAlign: "center", color: C.textGrey, fontSize: "13px", marginTop: "20px" }}>No messages yet. Say hello! 👋</div>}
        {msgGroups.map((group, gi) => {
          const isOwn = group.userId === currentUser.id;
          return (
            <div key={`${group.userId}-${gi}`} style={{ display: "flex", justifyContent: isOwn ? "flex-end" : "flex-start" }}>
              <div style={{ display: "flex", flexDirection: "column", maxWidth: "85%", gap: "2px", alignItems: isOwn ? "flex-end" : "flex-start" }}>
                {!isOwn && <span style={{ fontSize: "11px", color: C.whatsappDarkGreen, fontWeight: "600", marginLeft: "8px" }}>{group.username}</span>}
                {group.msgs.map((msg, idx) => {
                  const isLast = idx === group.msgs.length - 1;
                  return (
                    <div key={msg.id} style={{ display: "flex", alignItems: "center", gap: "4px", flexDirection: isOwn ? "row-reverse" : "row" }}>
                      <div style={{ background: isOwn ? C.bubbleOut : C.bubbleIn, color: C.textDark, padding: msg.imageUrl ? "4px" : "6px 8px 6px 10px", borderRadius: isOwn ? "8px 0px 8px 8px" : "0px 8px 8px 8px", marginBottom: isLast ? "4px" : "0px", maxWidth: "100%", boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)" }}>
                        {msg.imageUrl ? (
                          <div style={{ position: "relative", minWidth: "180px" }}>
                            {msg.imageUrl.startsWith("data:video") ? (
                              <video src={msg.imageUrl} controls style={{ width: "100%", maxWidth: "200px", borderRadius: "6px", display: "block" }} />
                            ) : msg.imageUrl.startsWith("data:audio") ? (
                              <audio src={msg.imageUrl} controls style={{ width: "100%", maxWidth: "200px", height: "40px", display: "block" }} />
                            ) : msg.imageUrl.startsWith("data:image") ? (
                              <img src={msg.imageUrl} alt="Uploaded" style={{ width: "100%", maxWidth: "200px", borderRadius: "6px", display: "block" }} />
                            ) : (
                              <a href={msg.imageUrl} download={"file_" + msg.id} style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px", background: C.fileBoxBg, borderRadius: "8px", textDecoration: "none", color: C.fileBoxText, minWidth: "180px" }}>
                                <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "rgba(2, 119, 189, 0.15)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
                                  <span style={{ fontSize: "13px", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Document</span>
                                  <span style={{ fontSize: "11px", color: C.textGrey }}>Click to Download</span>
                                </div>
                              </a>
                            )}
                            <span style={{ position: "absolute", bottom: "4px", right: "4px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: "10px", padding: "2px 6px", borderRadius: "4px" }}>{formatTime(msg.createdAt)}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: "14.2px", lineHeight: "1.35", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                            {msg.message}
                            <span style={{ fontSize: "11px", color: isOwn ? C.textGrey : C.textGrey, textAlign: "right", marginTop: "1px", display: "flex", justifyContent: "flex-end", alignItems: "center", gap: "4px", fontWeight: "500" }}>
                              {formatTime(msg.createdAt)}
                              {isOwn && <svg width="16" height="11" viewBox="0 0 16 11" fill="none"><path d="M11.071 0.929L4.5 7.5L1.929 4.929" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M14.071 0.929L7.5 7.5" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                            </span>
                          </div>
                        )}
                      </div>
                      {isOwn && <button onClick={() => handleDeleteMessage(msg.id)} disabled={deletingId === msg.id} style={{ background: "none", border: "none", color: C.red, cursor: "pointer", padding: "4px", opacity: deletingId === msg.id ? 0.5 : 1 }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg></button>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Media Preview Bar */}
      {mediaPreview && (
        <div style={{ padding: "8px 12px", background: C.inputBg, display: "flex", alignItems: "center", gap: "12px", borderTop: `1px solid #E9EDEF` }}>
          {mediaPreview.startsWith("data:video") ? <video src={mediaPreview} style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }} /> : mediaPreview.startsWith("data:audio") ? <audio src={mediaPreview} controls style={{ height: "40px" }} /> : mediaPreview.startsWith("data:image") ? <img src={mediaPreview} alt="Preview" style={{ width: "40px", height: "40px", borderRadius: "6px", objectFit: "cover" }} /> : <div style={{width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "#e9edef", borderRadius: "6px", color: C.textGrey}}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg></div>}
          <span style={{ fontSize: "14px", color: C.textDark, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{mediaName}</span>
          <button onClick={clearMediaPreview} style={{ background: "transparent", border: "none", cursor: "pointer", color: C.textGrey, padding: "8px" }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      )}

      {/* Recording Bar */}
      {isRecording ? (
        <div style={{ display: "flex", padding: "8px 12px", background: C.inputBg, gap: "8px", alignItems: "center", flexShrink: 0, borderTop: `1px solid #E9EDEF` }}>
          <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: "#FF3B30", animation: "pulse 1s infinite" }} />
          <span style={{ flex: 1, color: C.textDark, fontSize: "15px" }}>Recording {recordingType}...</span>
          <button type="button" onClick={stopRecording} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "none", background: "#FF3B30", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
          </button>
        </div>
      ) : (
        <form onSubmit={handleSend} style={{ display: "flex", padding: "8px 12px", background: C.inputBg, gap: "4px", alignItems: "center", flexShrink: 0, borderTop: mediaPreview ? "none" : `1px solid #E9EDEF` }}>
          <button type="button" onClick={() => fileInputRef.current?.click()} style={iconBtnStyle} title="Attach File">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path></svg>
          </button>
          <input ref={fileInputRef} type="file" style={{ display: "none" }} onChange={handleFileUpload} />
          
          {/* Record Audio Button */}
          <button type="button" onClick={() => startRecording('audio')} style={iconBtnStyle} title="Record Voice Message">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>
          </button>
          
          {/* Record Video Button */}
          <button type="button" onClick={() => startRecording('video')} style={iconBtnStyle} title="Record Video Message">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>
          </button>

          <input ref={inputRef} type="text" placeholder="Type a message" value={message} onChange={(e) => setMessage(e.target.value)} disabled={sending} style={{ flex: 1, border: "none", outline: "none", padding: "10px 16px", borderRadius: "20px", fontSize: "15px", background: C.inputField, fontFamily: "inherit", boxShadow: "0 1px 2px rgba(0,0,0,0.1)", opacity: sending ? 0.7 : 1, color: C.textDark }} />
          
          <button type="submit" disabled={(!message.trim() && !mediaBase64) || sending} style={{ width: "40px", height: "40px", borderRadius: "50%", border: "none", background: (message.trim() || mediaBase64) && !sending ? C.whatsappGreen : "#C7C7CC", color: "#fff", cursor: (message.trim() || mediaBase64) && !sending ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
          </button>
        </form>
      )}

      <style>{`
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}