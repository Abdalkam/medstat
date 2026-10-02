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

type FileType = "image" | "video" | "file";

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

/* ── File type icon ── */
function FileIcon({ fileType }: { fileType: FileType | null }) {
  const color = fileType === "image" ? C.green : fileType === "video" ? C.purple : C.blue;
  const bgColor = fileType === "image" ? C.greenBg : fileType === "video" ? C.purpleBg : C.blueBg;
  if (fileType === "image") return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: bgColor, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
    </div>
  );
  if (fileType === "video") return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: bgColor, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>
    </div>
  );
  return (
    <div style={{ width: 40, height: 40, borderRadius: 10, background: bgColor, color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
    </div>
  );
}

/* ── Bubble body (media + text) ── */
function BubbleBody({ m }: { m: ChatMessage }) {
  if (m.fileType === "image" && m.fileUrl) return (
    <div>
      <img src={m.fileUrl} alt={m.fileName || "image"} onClick={() => window.open(m.fileUrl!, "_blank")}
        style={{ display: "block", width: "100%", maxWidth: 300, maxHeight: 320, objectFit: "cover", borderRadius: 8, cursor: "pointer" }} />
      {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
    </div>
  );
  if (m.fileType === "video" && m.fileUrl) return (
    <div>
      <video src={m.fileUrl} controls preload="metadata" playsInline
        style={{ display: "block", width: "100%", maxWidth: 300, maxHeight: 320, borderRadius: 8, background: "#000" }} />
      {m.content && <p style={{ margin: "6px 0 0", fontSize: 14.5, color: C.textPrimary, lineHeight: 1.4, overflowWrap: "anywhere" }}>{m.content}</p>}
    </div>
  );
  if (m.fileType === "file" && m.fileUrl) return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(0,0,0,0.04)", borderRadius: 8, padding: "10px 12px" }}>
      <FileIcon fileType={m.fileType} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.fileName || "Attachment"}</div>
        <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 2 }}>Document</div>
      </div>
    </div>
  );
  return <p style={{ margin: 0, fontSize: 14.5, color: C.textPrimary, lineHeight: 1.35, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{m.content}</p>;
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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const firstLoad = useRef(true);

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
        if (c) setCourse({
          id: c.id, name: c.name || "Class Chat", description: c.description || "", logo: c.logo || "",
          tenantId: c.tenant_id, trainerId: c.trainer_id, createdAt: c.created_at,
          tuitionType: c.tuition_type || "free", amount: c.amount || 0, startDate: c.start_date || "",
          period: c.period || "", mediaUrl: c.logo || "", mediaType: "image", mediaName: "course-logo",
        });
        const { data } = await supabase
          .from(TABLE).select("*").eq("course_id", courseId)
          .order("created_at", { ascending: true }).limit(200);
        setMessages((data || []).map(mapMessage));
      } catch (e) { console.error("Chat load failed", e); }
      finally { setLoading(false); }
    })();
  }, [currentUser, courseId]);

  useEffect(() => {
    if (!courseId) return;
    const channel = supabase
      .channel(`class-chat-${courseId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: TABLE, filter: `course_id=eq.${courseId}` },
        (payload) => {
          const m = mapMessage(payload.new as Record<string, unknown>);
          setMessages(prev => (prev.some(x => x.id === m.id) ? prev : [...prev, m]));
        })
      .on("postgres_changes",
        { event: "DELETE", schema: "public", table: TABLE, filter: `course_id=eq.${courseId}` },
        (payload) => {
          const id = (payload.old as { id?: string }).id;
          if (id) setMessages(prev => prev.filter(m => m.id !== id));
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [courseId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: firstLoad.current ? "auto" : "smooth" });
    firstLoad.current = false;
  }, [messages, loading]);

  const canDelete = useCallback(
    (m: ChatMessage) =>
      m.senderId === currentUser?.id ||
      currentUser?.role === "admin" ||
      currentUser?.role === "trainer",
    [currentUser]
  );

  function openMenu(msg: ChatMessage, e: React.MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const fromRight = window.innerWidth - r.right;
    setMenu({
      msg,
      x: fromRight,
      y: Math.min(r.bottom + 4, window.innerHeight - 220),
    });
  }

  async function handleSend() {
    if (!currentUser || (!text.trim() && !file) || sending) return;
    const tenantId = currentUser.tenantId;
    const cid = courseId;
    if (!tenantId || !cid) return;
    setSending(true);
    try {
      let fileUrl: string | null = null;
      if (file) fileUrl = await uploadChatFile(file, tenantId, cid);
      const row = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        course_id: cid,
        sender_id: currentUser.id,
        sender_name: currentUser.username,
        content: text.trim(),
        file_url: fileUrl,
        file_name: file ? file.name : null,
        file_type: file ? detectType(file) : null,
      };
      const { error } = await supabase.from(TABLE).insert(row);
      if (error) throw error;
      setMessages(prev => (prev.some(m => m.id === row.id) ? prev : [...prev, mapMessage(row as Record<string, unknown>)]));
      setText(""); setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      console.error("Send failed", e);
      alert("Could not send message.");
    } finally { setSending(false); }
  }

  async function handleDelete(m: ChatMessage) {
    if (!window.confirm("Delete this message?")) return;
    setMenu(null);
    try {
      if (m.fileUrl) {
        const path = extractStoragePath(m.fileUrl);
        if (path) await supabase.storage.from(BUCKET).remove([path]);
      }
      const { error } = await supabase.from(TABLE).delete().eq("id", m.id);
      if (error) throw error;
      setMessages(prev => prev.filter(x => x.id !== m.id));
    } catch (e) {
      console.error("Delete failed", e);
      alert("Could not delete message.");
    }
  }

  async function handleCopy(m: ChatMessage) {
    setMenu(null);
    try { await navigator.clipboard.writeText(m.content); } catch { /* ignore */ }
  }

  if (!isChatOpen) return null;

  /* ── Group messages: date separator + consecutive same-sender grouping ── */
  function renderMessages() {
    let prevSenderId = "";
    let prevDate = "";
    return messages.map((m, i) => {
      const own = m.senderId === currentUser?.id;
      const msgDate = formatDate(m.createdAt);
      const showDate = msgDate !== prevDate;
      prevDate = msgDate;
      const showSender = !own && m.senderId !== prevSenderId;
      const isLastInGroup = i === messages.length - 1 || messages[i + 1]?.senderId !== m.senderId;
      prevSenderId = m.senderId;

      return (
        <div key={m.id}>
          {showDate && (
            <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
              <span style={{ background: "#FFF", color: C.textSecondary, fontSize: 12.5, fontWeight: 500, padding: "5px 12px", borderRadius: 8, boxShadow: C.shadow }}>{msgDate}</span>
            </div>
          )}
          <div style={{ display: "flex", flexDirection: own ? "row-reverse" : "row", alignItems: "flex-end", gap: 0, marginBottom: isLastInGroup ? 10 : 2 }}>
            {/* Bubble */}
            <div style={{
              maxWidth: "min(75%, 420px)", minWidth: 80, padding: m.fileType ? "4px 6px 5px" : "6px 10px 4px",
              borderRadius: 8,
              borderTopLeftRadius: showSender || !own ? 8 : 2,
              borderTopRightRadius: showSender || own ? 8 : 2,
              borderBottomRightRadius: own && isLastInGroup ? 2 : 8,
              borderBottomLeftRadius: !own && isLastInGroup ? 2 : 8,
              background: own ? C.ownBubble : C.otherBubble,
              boxShadow: C.shadow, position: "relative",
            }}>
              {showSender && <div style={{ fontSize: 12.5, fontWeight: 700, color: C.purple, marginBottom: 2, marginTop: 2, paddingLeft: m.fileType ? 0 : 0 }}>{m.senderName}</div>}
              <BubbleBody m={m} />
              {/* Timestamp inside bubble */}
              <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 2 }}>
                <span style={{ fontSize: 11, color: C.textSecondary, lineHeight: 1 }}>{formatTime(m.createdAt)}</span>
                {own && <svg width="16" height="10" viewBox="0 0 16 10" fill="none"><path d="M1 5l3 3L11 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M5 5l3 3L15 1" stroke={C.blue} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>}
              </div>
            </div>

            {/* ⋮ menu button */}
            <button onClick={(e) => openMenu(m, e)}
              style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 2px", color: C.textSecondary, borderRadius: "50%", flexShrink: 0, opacity: 0.55, lineHeight: 0, touchAction: "manipulation", transition: "opacity 0.15s" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></svg>
            </button>
          </div>
        </div>
      );
    });
  }

  const menuBtn: React.CSSProperties = { display: "flex", alignItems: "center", gap: 12, width: "100%", padding: "11px 16px", background: "none", border: "none", textAlign: "left", cursor: "pointer", fontSize: 14, fontWeight: 400, color: C.textPrimary, transition: "background 0.1s" };
  const menuDiv: React.CSSProperties = { borderTop: `1px solid ${C.separator}` };

  return (
    <div className={embedded ? "chat-root chat-root--embedded" : "chat-root"}
      style={{ display: "flex", flexDirection: "column", width: "100%", background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", boxSizing: "border-box" }}>
      <style>{`
        .chat-root { height: 100vh; }
        @supports (height: 100dvh) { .chat-root { height: 100dvh; } }
        .chat-root--embedded { height: 100%; min-height: 0; }
        .chat-scroll { overscroll-behavior: contain; -webkit-overflow-scrolling: touch; background-image: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23c8c8c8' fill-opacity='0.08'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E"); }
        .chat-composer { padding-bottom: calc(8px + env(safe-area-inset-bottom)); }
        .menu-btn:hover { background: #F5F6F6; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 16px", background: C.headerBg, flexShrink: 0 }}>
        <button onClick={() => (toggleChatOpen ? toggleChatOpen() : navigate(-1))} title={toggleChatOpen ? "Close chat" : "Back"}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 36, height: 36, borderRadius: "50%", background: "rgba(255,255,255,0.15)", border: "none", cursor: "pointer", color: C.headerText, flexShrink: 0 }}>
          {toggleChatOpen ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
          )}
        </button>
        {course?.logo
          ? <img src={course.logo} alt="" style={{ width: 40, height: 40, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }} />
          : <div style={{ width: 40, height: 40, borderRadius: "50%", background: "rgba(255,255,255,0.2)", color: C.headerText, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 18, flexShrink: 0 }}>{course?.name?.charAt(0) || "💬"}</div>}
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: C.headerText, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{course?.name || "Class Chat"}</h1>
          <p style={{ margin: 0, fontSize: 12.5, color: "rgba(255,255,255,0.7)" }}>Class chat</p>
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="chat-scroll" style={{ flex: 1, overflowY: "auto", padding: "12px 16px", display: "flex", flexDirection: "column" }}>
        {loading && <div style={{ display: "flex", justifyContent: "center", marginTop: 24 }}><span style={{ background: "#FFF", color: C.textSecondary, fontSize: 13, padding: "6px 16px", borderRadius: 8, boxShadow: C.shadow }}>Loading chat…</span></div>}
        {!loading && messages.length === 0 && (
          <div style={{ margin: "auto", textAlign: "center", color: C.textSecondary }}>
            <div style={{ fontSize: 56, marginBottom: 12, opacity: 0.5 }}>💬</div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 500 }}>No messages yet</p>
            <p style={{ margin: "4px 0 0", fontSize: 13 }}>Send a message to start the conversation</p>
          </div>
        )}
        {renderMessages()}
        <div ref={endRef} />
      </div>

      {/* ── Pending file chip ── */}
      {file && (
        <div style={{ padding: "0 16px 8px", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FFF", border: `1px solid ${C.separator}`, borderRadius: 8, padding: "8px 12px" }}>
            <FileIcon fileType={detectType(file)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.name}</div>
              <div style={{ fontSize: 12, color: C.textSecondary, marginTop: 1 }}>{(file.size / 1024).toFixed(0)} KB</div>
            </div>
            <button onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}
              style={{ background: C.redBg, border: "none", color: C.red, cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "5px 12px", borderRadius: 6, flexShrink: 0 }}>Remove</button>
          </div>
        </div>
      )}

      {/* ── Composer ── */}
      <div className="chat-composer" style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px", background: C.inputBarBg, flexShrink: 0 }}>
        <input ref={fileInputRef} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <button onClick={() => fileInputRef.current?.click()} title="Attach file" disabled={sending}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 40, height: 40, borderRadius: "50%", background: "transparent", border: "none", cursor: "pointer", color: C.textSecondary, flexShrink: 0, transition: "color 0.15s" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = C.green; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = C.textSecondary; }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
        </button>
        <div style={{ flex: 1, position: "relative" }}>
          <input type="text" placeholder="Type a message" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) handleSend(); }}
            style={{ width: "100%", padding: "10px 16px", border: "none", borderRadius: 8, fontSize: 15, fontFamily: "inherit", outline: "none", background: C.inputBg, color: C.textPrimary, boxSizing: "border-box" }} />
        </div>
        <button onClick={handleSend} disabled={sending || (!text.trim() && !file)} title="Send"
          style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 42, height: 42, borderRadius: "50%", background: (text.trim() || file) ? C.green : "rgba(0,0,0,0.08)", border: "none", cursor: sending ? "wait" : "pointer", color: (text.trim() || file) ? "#FFF" : C.textSecondary, flexShrink: 0, transition: "background 0.2s, color 0.2s" }}>
          {(text.trim() || file) ? (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M1.1 21.7L4.9 12 1.1 2.3Q.8 1.7 1.3 1.3T2.3 1.1L22 12 2.3 22.9Q1.7 23.2 1.3 22.7T1.1 21.7Z" /></svg>
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
          )}
        </button>
      </div>

      {/* ── Context Menu ── */}
      {menu && (
        <>
          <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, zIndex: 998 }} onClick={() => setMenu(null)} />
          <div style={{
            position: "fixed", top: menu.y, right: Math.max(12, menu.x), zIndex: 999,
            width: 200, background: "#FFF", borderRadius: 8, boxShadow: C.shadowMenu,
            overflow: "hidden", padding: "4px 0",
          }}>
            {/* Open file */}
            {menu.msg.fileUrl && (
              <button onClick={() => { window.open(menu.msg.fileUrl!, "_blank"); setMenu(null); }}
                className="menu-btn" style={menuBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                <span>Open file</span>
              </button>
            )}
            {/* Download file */}
            {menu.msg.fileUrl && (
              <button onClick={() => { downloadFile(menu.msg.fileUrl!, menu.msg.fileName || "download"); setMenu(null); }}
                className="menu-btn" style={menuBtn}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                <span>Download file</span>
              </button>
            )}
            {/* Copy text */}
            {menu.msg.content && (
              <button onClick={() => handleCopy(menu.msg)}
                className="menu-btn" style={{ ...menuBtn, ...(menu.msg.fileUrl ? menuDiv : {}) }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.textSecondary} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                <span>Copy text</span>
              </button>
            )}
            {/* Delete */}
            {canDelete(menu.msg) && (
              <button onClick={() => handleDelete(menu.msg)}
                className="menu-btn" style={{ ...menuBtn, color: C.red, borderTop: `1px solid ${C.separator}` }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={C.red} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                <span>Delete</span>
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}