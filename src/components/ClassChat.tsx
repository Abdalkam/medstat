// src/components/ClassChat.tsx
import { useEffect, useState, useRef } from "react";
import type { ChatMessage } from "../types";
import { supabase } from "../auth/supabase";

const WA = {
  bg: "#EFEAE2",
  bubbleOut: "#D9FDD3",
  bubbleIn: "#FFFFFF",
  textPrimary: "#111B21",
  textSecondary: "#667781",
  inputBg: "#FFFFFF",
  sendBtn: "#00A884",
  accent: "#008069",
  red: "#FF3B30",
  avatarBg: "#DFE5E7",
  pattern: `data:image/svg+xml,%3Csvg width='100' height='100' viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23d4ccc0' fill-opacity='0.4'%3E%3Cpath d='M50 50c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10zM10 10c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10S0 25.523 0 20s4.477-10 10-10zm90 0c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10zM10 90c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10zm90 0c0-5.523 4.477-10 10-10s10 4.477 10 10-4.477 10-10 10c0 5.523-4.477 10-10 10s-10-4.477-10-10 4.477-10 10-10z'/%3E%3C/g%3E%3C/svg%3E`
};

export default function ClassChat({ courseId }: { courseId: string }) {
  const currentUser = JSON.parse(localStorage.getItem("currentUser") || "{}");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [avatarMap, setAvatarMap] = useState<Record<string, string>>({});
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [mediaBase64, setMediaBase64] = useState<string | null>(null);
  const [isVideo, setIsVideo] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fetchedAvatars = useRef<Set<string>>(new Set());

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
        const { data, error } = await supabase
          .from("profile_settings")
          .select("user_id, avatar_url")
          .in("user_id", missingIds);

        if (error) return;

        const map: Record<string, string> = {};
        for (const u of data || []) {
          const url = u.avatar_url || "";
          if (url) map[u.user_id] = url;
        }
        
        setAvatarMap((prev) => ({ ...prev, ...map }));
      } catch (err) {
        console.error("❌ Avatar fetch exception:", err);
      }
    };

    fetchAvatars();
  }, [messages]);

  useEffect(() => {
    if (!courseId) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true });

      if (error) {
        console.error("Error fetching messages:", error);
        return;
      }
      setMessages((data || []).map(normalize));
    };

    fetchMessages();

    const channel = supabase
      .channel(`chat-${courseId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `course_id=eq.${courseId}`,
        },
        (payload) => {
          const normalized = normalize(payload.new);
          setMessages((prev) => {
            if (prev.some((m) => m.id === normalized.id)) return prev;
            return [...prev, normalized];
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [courseId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleMediaUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImg = file.type.startsWith("image/");
    const isVid = file.type.startsWith("video/");

    if (!isImg && !isVid) {
      alert("Please select an image or video file.");
      e.target.value = "";
      return;
    }

    const sizeLimit = isImg ? 5 * 1024 * 1024 : 15 * 1024 * 1024;
    if (file.size > sizeLimit) {
      alert(`${isImg ? "Image" : "Video"} is too large! Max size is ${isImg ? "5MB" : "15MB"}.`);
      e.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      setMediaPreview(result);
      setMediaBase64(result);
      setIsVideo(isVid);
    };
    reader.onerror = () => alert("Failed to process the media file.");
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const clearMediaPreview = () => {
    setMediaPreview(null);
    setMediaBase64(null);
    setIsVideo(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!message.trim() && !mediaBase64) || !courseId || sending) return;

    const tempId = crypto.randomUUID();
    const optimistic: ChatMessage = {
      id: tempId,
      courseId,
      userId: currentUser.id,
      username: currentUser.username || "You",
      message: message.trim(),
      createdAt: new Date().toISOString(),
      imageUrl: mediaBase64,
    };

    setMessages((prev) => [...prev, optimistic]);
    setMessage("");
    inputRef.current?.focus();

    setSending(true);
    try {
      const { error } = await supabase.from("chat_messages").insert({
        id: tempId,
        course_id: courseId,
        user_id: currentUser.id,
        username: currentUser.username || "You",
        message: message.trim(),
        image_url: mediaBase64,
      });

      if (error) throw error;
      
      clearMediaPreview();
    } catch (error) {
      console.error("Failed to send message:", error);
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      alert("Failed to send message. It might be too large for the database.");
    } finally {
      setSending(false);
    }
  }

  async function handleDeleteMessage(msgId: string) {
    const originalMessages = [...messages];
    
    setMessages(prev => prev.filter(m => m.id !== msgId));
    setDeletingId(msgId);

    try {
      const { error } = await supabase
        .from("chat_messages")
        .delete()
        .eq("id", msgId)
        .eq("user_id", currentUser.id);

      if (error) throw error;
    } catch (error) {
      console.error("Failed to delete message:", error);
      setMessages(originalMessages);
      alert("Failed to delete message. Please try again.");
    } finally {
      setDeletingId(null);
    }
  }

  function formatTime(iso: string) {
    if (!iso) return "";
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    
    const hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    const h12 = hours % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
  }

  function getInitial(name: string) {
    return (name || "?").charAt(0).toUpperCase();
  }

  function getMsgGroups() {
    const groups: { userId: string; username: string; avatarUrl: string; msgs: ChatMessage[] }[] = [];
    for (const msg of messages) {
      const last = groups[groups.length - 1];
      if (last && last.userId === msg.userId) {
        last.msgs.push(msg);
      } else {
        groups.push({
          userId: msg.userId,
          username: msg.username,
          avatarUrl: avatarMap[msg.userId] || "",
          msgs: [msg],
        });
      }
    }
    return groups;
  }

  const msgGroups = getMsgGroups();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: WA.bg,
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
        position: "relative",
        overflow: "hidden"
      }}
    >
      {/* Messages Area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          WebkitOverflowScrolling: "touch",
          padding: "16px 12px",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
          backgroundImage: `url("${WA.pattern}")`,
          backgroundRepeat: "repeat",
        }}
      >
        {messages.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: WA.textPrimary,
              fontSize: "14px",
              marginTop: "40px",
              background: "rgba(255,255,255,0.6)",
              padding: "16px 24px",
              borderRadius: "12px",
              fontWeight: "500",
              alignSelf: "center"
            }}
          >
            No messages yet. Say hello! 👋
          </div>
        )}

        {msgGroups.map((group, gi) => {
          const isOwn = group.userId === currentUser.id;

          return (
            <div
              key={`${group.userId}-${gi}`}
              style={{
                display: "flex",
                justifyContent: isOwn ? "flex-end" : "flex-start",
                gap: "8px",
                marginBottom: "12px",
                alignItems: "flex-end",
              }}
            >
              {!isOwn && (
                <div
                  style={{
                    width: "32px",
                    height: "32px",
                    borderRadius: "50%",
                    flexShrink: 0,
                    alignSelf: "flex-end",
                    marginBottom: "2px",
                    overflow: "hidden",
                    background: WA.avatarBg,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "14px",
                    fontWeight: "600",
                    color: WA.accent,
                  }}
                >
                  {group.avatarUrl ? (
                    <img
                      src={group.avatarUrl}
                      alt={group.username}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                      }}
                    />
                  ) : (
                    getInitial(group.username)
                  )}
                </div>
              )}

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  maxWidth: "75%",
                  alignItems: isOwn ? "flex-end" : "flex-start",
                }}
              >
                {!isOwn && (
                  <div
                    style={{
                      fontSize: "12.5px",
                      color: WA.accent,
                      fontWeight: "600",
                      marginBottom: "2px",
                      paddingLeft: "12px",
                      textTransform: "capitalize"
                    }}
                  >
                    {group.username}
                  </div>
                )}

                {group.msgs.map((msg, idx) => {
                  const isFirst = idx === 0;
                  const isLast = idx === group.msgs.length - 1;
                  
                  let borderRadius = isOwn ? "8px 0px 8px 8px" : "0px 8px 8px 8px";
                  if (!isFirst && !isLast) borderRadius = "8px";
                  if (!isFirst && isLast) borderRadius = isOwn ? "8px 0px 8px 8px" : "0px 8px 8px 8px";

                  const msgIsVideo = msg.imageUrl?.startsWith("data:video");

                  return (
                    <div
                      key={msg.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        flexDirection: isOwn ? "row-reverse" : "row"
                      }}
                    >
                      <div
                        style={{
                          background: isOwn ? WA.bubbleOut : WA.bubbleIn,
                          color: WA.textPrimary,
                          padding: msg.imageUrl ? "4px" : "6px 8px 6px 10px",
                          borderRadius: borderRadius,
                          boxShadow: "0 1px 0.5px rgba(11,20,26,0.13)",
                          marginBottom: isLast ? "0px" : "2px",
                          position: "relative",
                        }}
                      >
                        {msg.imageUrl && (
                          <div style={{ position: "relative", maxWidth: "100%" }}>
                            {msgIsVideo ? (
                              <video 
                                src={msg.imageUrl} 
                                controls 
                                style={{
                                  width: "100%",
                                  maxWidth: "240px",
                                  maxHeight: "300px",
                                  borderRadius: "6px",
                                  display: "block",
                                  objectFit: "cover"
                                }}
                              />
                            ) : (
                              <img 
                                src={msg.imageUrl} 
                                alt="Uploaded" 
                                style={{
                                  width: "100%",
                                  maxWidth: "240px",
                                  maxHeight: "300px",
                                  borderRadius: "6px",
                                  display: "block",
                                  objectFit: "cover"
                                }}
                              />
                            )}
                            <div style={{
                              position: "absolute",
                              bottom: "4px",
                              right: "4px",
                              background: "rgba(0,0,0,0.6)",
                              color: "#fff",
                              fontSize: "11px",
                              padding: "2px 6px",
                              borderRadius: "4px",
                              display: "flex",
                              alignItems: "center",
                              gap: "3px",
                              fontWeight: "500"
                            }}>
                              {formatTime(msg.createdAt)}
                              {isOwn && (
                                <svg width="14" height="10" viewBox="0 0 16 11" fill="none">
                                  <path d="M11.071 0.929L4.5 7.5L1.929 4.929" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M14.071 0.929L7.5 7.5" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {!msg.imageUrl && (
                          <>
                            <div
                              style={{
                                fontSize: "14.2px",
                                lineHeight: "1.35",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {msg.message}
                            </div>
                            <div
                              style={{
                                fontSize: "11px",
                                color: isOwn ? "#667781" : WA.textSecondary,
                                textAlign: "right",
                                marginTop: "1px",
                                display: "flex",
                                justifyContent: "flex-end",
                                alignItems: "center",
                                gap: "4px",
                                fontWeight: "500"
                              }}
                            >
                              {formatTime(msg.createdAt)}
                              {isOwn && (
                                <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
                                  <path d="M11.071 0.929L4.5 7.5L1.929 4.929" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M14.071 0.929L7.5 7.5" stroke="#53BDEB" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {isOwn && (
                        <button
                          onClick={() => handleDeleteMessage(msg.id)}
                          disabled={deletingId === msg.id}
                          style={{
                            background: "transparent",
                            border: "none",
                            cursor: deletingId === msg.id ? "wait" : "pointer",
                            padding: "4px",
                            opacity: deletingId === msg.id ? 0.5 : 1,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: WA.red,
                            flexShrink: 0,
                            transition: "opacity 0.2s"
                          }}
                          title="Delete message"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6"></polyline>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                          </svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {isOwn && <div style={{ width: "32px", flexShrink: 0 }} />}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Media Preview Bar */}
      {mediaPreview && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "10px 16px",
          background: "#F0F2F5",
          borderTop: "1px solid #E9EDEF"
        }}>
          {isVideo ? (
            <video src={mediaPreview} style={{ width: "60px", height: "60px", borderRadius: "8px", objectFit: "cover" }} />
          ) : (
            <img src={mediaPreview} alt="Preview" style={{ width: "60px", height: "60px", borderRadius: "8px", objectFit: "cover" }} />
          )}
          <span style={{ fontSize: "14px", color: WA.textPrimary, flex: 1 }}>{isVideo ? "Video attached" : "Image attached"}</span>
          <button onClick={clearMediaPreview} style={{
            background: "transparent",
            border: "none",
            cursor: "pointer",
            color: WA.red,
            padding: "8px"
          }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      )}

      {/* Input Area */}
      <form
        onSubmit={handleSend}
        style={{
          display: "flex",
          padding: "8px 12px",
          background: "#F0F2F5",
          gap: "8px",
          alignItems: "flex-end",
          flexShrink: 0,
          borderTop: mediaPreview ? "none" : "1px solid #E9EDEF",
        }}
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "50%",
            border: "none",
            background: "transparent",
            color: WA.textSecondary,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 0.2s",
            transform: "scale(1)"
          }}
          title="Attach image or video"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
          </svg>
        </button>
        <input 
          ref={fileInputRef}
          type="file" 
          accept="image/*,video/*" 
          style={{ display: "none" }} 
          onChange={handleMediaUpload} 
        />

        <input
          ref={inputRef}
          id="chat-message-input"
          aria-label="Type a message"
          type="text"
          placeholder="Type a message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={sending}
          style={{
            flex: 1,
            border: "none",
            outline: "none",
            padding: "10px 16px",
            borderRadius: "20px",
            fontSize: "15px",
            background: WA.inputBg,
            fontFamily: "inherit",
            boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
            opacity: sending ? 0.7 : 1,
            color: WA.textPrimary
          }}
        />
        <button
          type="submit"
          aria-label="Send message"
          disabled={(!message.trim() && !mediaBase64) || sending}
          style={{
            width: "42px",
            height: "42px",
            borderRadius: "50%",
            border: "none",
            background: (message.trim() || mediaBase64) && !sending ? WA.sendBtn : "#C7C7CC",
            color: "#fff",
            cursor: (message.trim() || mediaBase64) && !sending ? "pointer" : "not-allowed",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "all 0.2s",
            transform: (message.trim() || mediaBase64) ? "scale(1)" : "scale(0.95)",
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}