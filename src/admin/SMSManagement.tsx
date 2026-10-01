// src/admin/SMSmanagement.tsx
import { useState, useEffect } from "react";
import type { CSSProperties, ReactNode } from "react";
import { getUsers } from "../database/userDB";
import { db } from "../database/db";
import { sendSms } from "../api/smsApi";
import { recordSmsLogs, syncUnsyncedSmsLogs, pullRemoteSmsLogs } from "../database/smsLogDB";

const C = {
  bg: "#F2F2F7", card: "#FFFFFF", separator: "#E5E5EA", separatorLight: "#F0F0F2",
  textPrimary: "#1C1C1E", textSecondary: "#3C3C43", textTertiary: "#8E8E93",
  blue: "#007AFF", blueBg: "#EBF2FF", green: "#34C759", greenBg: "#EAF9EE",
  red: "#FF3B30", redBg: "#FFEFEE", medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  purple: "#AF52DE", purpleBg: "#F5F0FF",
};

const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";
const gutter = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

const panel: CSSProperties = {
  background: C.card, borderRadius: 16, boxShadow: "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)",
  border: "1px solid rgba(17,24,39,0.05)", boxSizing: "border-box", minWidth: 0, overflow: "hidden",
};

function Stat({ icon, bg, fg, label, value }: { icon: ReactNode; bg: string; fg: string; label: string; value: string | number }) {
  return (
    <div style={{ ...panel, padding: 16, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ width: 40, height: 40, borderRadius: 10, background: bg, color: fg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{icon}</div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: C.textTertiary, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</div>
        <div style={{ fontSize: 22, color: C.textPrimary, fontWeight: 700, lineHeight: 1.2 }}>{value}</div>
      </div>
    </div>
  );
}

export default function SMSmanagement() {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [manualPhone, setManualPhone] = useState("");
  const [sentLogs, setSentLogs] = useState<any[]>([]);

  const loadSentLogs = async () => {
    try {
      const logs = await db.smsLogs.toArray();
      logs.sort((a: any, b: any) => new Date(b.sentAt || b.sent_at).getTime() - new Date(a.sentAt || a.sent_at).getTime());
      setSentLogs(logs);
    } catch (e) {
      console.error("Failed to load SMS logs", e);
    }
  };

  // Background merge: push unsynced local logs, pull cloud logs, refresh view.
  // Runs on mount and whenever the device reconnects.
  const refreshFromCloud = async () => {
    const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    if (!currentUser?.tenantId || !navigator.onLine) return;
    try {
      await syncUnsyncedSmsLogs();
      await pullRemoteSmsLogs(currentUser.tenantId);
      await loadSentLogs();
    } catch (e) { console.warn("SMS cloud refresh failed:", e); }
  };

  useEffect(() => {
    async function loadInitialData() {
      try {
        const localUsers = await getUsers();
        setUsers(localUsers.filter((u: any) => u.phone));
        await loadSentLogs();
        await refreshFromCloud(); // silent background sync — history survives updates
      } catch (e) {
        console.error("Failed to load initial data", e);
      }
    }
    loadInitialData();

    const onOnline = () => { refreshFromCloud(); };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  const toggleSelect = (phone: string) => {
    setSelectedPhones(prev =>
      prev.includes(phone) ? prev.filter(p => p !== phone) : [...prev, phone]
    );
  };

  const selectAll = () => {
    if (selectedPhones.length === users.length) {
      setSelectedPhones([]);
    } else {
      setSelectedPhones(users.map((u: any) => u.phone));
    }
  };

  const addManualPhone = () => {
    const cleanManual = manualPhone.replace(/\s/g, "").trim();
    if (!cleanManual) return;

    if (selectedPhones.includes(cleanManual)) {
      setError("This number is already in the recipient list.");
      return;
    }

    setSelectedPhones(prev => [...prev, cleanManual]);
    setManualPhone("");
    setError("");
  };

  const handleSendSms = async () => {
    if (selectedPhones.length === 0) {
      setError("Please select at least one recipient.");
      return;
    }
    if (!message.trim()) {
      setError("Message cannot be empty.");
      return;
    }
    if (!navigator.onLine) {
      setError("You're offline — sending SMS requires an internet connection.");
      return;
    }

    setSending(true);
    setError("");
    setSuccess(false);

    const currentUser: any = JSON.parse(localStorage.getItem("currentUser") || "{}");
    const sentAt = new Date().toISOString();

    try {
      const cleanRecipients = selectedPhones.map(p => p.replace(/\s/g, "").trim());
      const data = await sendSms(cleanRecipients, message.trim());

      // Prefer the server's authoritative logs; fall back to client-built ones so
      // persistence NEVER depends on the API response shape.
      const logs = (data?.logs && data.logs.length > 0)
        ? data.logs.map((log: any) => ({
            id: log.id || crypto.randomUUID(),
            tenant_id: log.tenant_id || currentUser?.tenantId || null,
            phone: log.phone,
            message: log.message || message.trim(),
            status: log.status || "Success",
            sent_by: log.sent_by || currentUser?.id || null,
            sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : sentAt,
          }))
        : cleanRecipients.map((phone) => ({
            id: crypto.randomUUID(),
            tenant_id: currentUser?.tenantId || null,
            phone,
            message: message.trim(),
            status: "Success",
            sent_by: currentUser?.id || null,
            sentAt,
          }));

      await recordSmsLogs(logs);

      setSuccess(true);
      setMessage("");
      setSelectedPhones([]);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error("Send SMS error:", err);
      setError(err.message || "Failed to send SMS. Check your network.");

      // If some SMS succeeded but others failed, save the successful ones
      if (err.logs && err.logs.length > 0) {
        await recordSmsLogs(err.logs.map((log: any) => ({
          id: log.id || crypto.randomUUID(),
          tenant_id: log.tenant_id || currentUser?.tenantId || null,
          phone: log.phone,
          message: log.message || message.trim(),
          status: log.status || "Success",
          sent_by: log.sent_by || currentUser?.id || null,
          sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : sentAt,
        })));
      }
    } finally {
      setSending(false);
      await loadSentLogs();
    }
  };

  const selectedCount = selectedPhones.length;
  const successCount = sentLogs.filter((l: any) => (l.status || "Success") === "Success").length;

  return (
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: iosFont, boxSizing: "border-box", overflowX: "hidden" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        button:focus-visible { outline: 2px solid ${C.blue}; outline-offset: 1px; }
      `}</style>

      <div style={{ width: "100%", maxWidth: PAGE_MAX, margin: "0 auto", padding: `20px ${gutter} 48px`, boxSizing: "border-box" }}>

        {/* PAGE HEADER — title truncates, Select All pinned right */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", marginBottom: 16, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 800, letterSpacing: "-0.5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Send SMS
            </h1>
            <p style={{ margin: "2px 0 0 0", color: C.textTertiary, fontSize: 15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              Reach trainers and trainees instantly
            </p>
          </div>
          <button
            onClick={selectAll}
            style={{ background: C.blueBg, border: `1px solid ${C.blue}22`, color: C.blue, fontSize: 14, fontWeight: 600, cursor: "pointer", padding: "9px 16px", borderRadius: 10, flexShrink: 0, fontFamily: iosFont }}
          >
            {selectedCount === users.length && users.length > 0 ? "Deselect All" : "Select All"}
          </button>
        </div>

        {error && (
          <div style={{ background: C.redBg, color: C.red, padding: "14px 16px", borderRadius: "14px", fontSize: "14px", fontWeight: "500", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ background: C.greenBg, color: C.green, padding: "14px 16px", borderRadius: "14px", fontSize: "14px", fontWeight: "600", marginBottom: "16px" }}>
            SMS Sent Successfully!
          </div>
        )}

        {/* ===== STAT CARDS — fluid row, like the dashboard ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(170px, 100%), 1fr))", gap: 12, marginBottom: 20 }}>
          <Stat
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>}
            bg={C.medBlueBg} fg={C.medBlue} label="Recipients Selected" value={selectedCount}
          />
          <Stat
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8.5L4 21v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" /></svg>}
            bg={C.greenBg} fg={C.green} label="SMS Sent (all time)" value={sentLogs.length}
          />
          <Stat
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>}
            bg={C.purpleBg} fg={C.purple} label="Successful" value={successCount}
          />
          <Stat
            icon={<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>}
            bg={C.blueBg} fg={C.blue} label="Registered Contacts" value={users.length}
          />
        </div>

        {/* ===== COMPOSE WORKSPACE — 2 columns on wide, stacks on narrow ===== */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(380px, 100%), 1fr))", gap: 16, alignItems: "start", width: "100%", boxSizing: "border-box", marginBottom: 24 }}>

          {/* LEFT COLUMN — recipients */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>

            {/* Custom Number Card */}
            <div style={{ ...panel, padding: 16 }}>
              <p style={{ margin: "0 0 10px 4px", fontSize: 13, color: C.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Add Custom Number</p>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="tel"
                  placeholder="+256712345678"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualPhone(); } }}
                  style={{
                    flex: 1, minWidth: 0, height: 46, padding: "0 12px", borderRadius: 10,
                    border: `1px solid ${C.separator}`, fontSize: 15, outline: "none",
                    boxSizing: "border-box", color: C.textPrimary, fontFamily: iosFont,
                    background: C.bg
                  }}
                />
                <button
                  onClick={addManualPhone}
                  style={{ background: C.blue, color: "white", border: "none", borderRadius: 10, padding: "0 18px", fontWeight: 600, cursor: "pointer", fontSize: 15, flexShrink: 0, fontFamily: iosFont }}
                >
                  Add
                </button>
              </div>

              {selectedPhones.filter(p => !users.some(u => u.phone === p)).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                  {selectedPhones.filter(p => !users.some(u => u.phone === p)).map(phone => (
                    <div key={phone} style={{ display: "flex", alignItems: "center", background: `${C.blue}20`, color: C.blue, padding: "4px 8px 4px 12px", borderRadius: 20, fontSize: 13, fontWeight: 600 }}>
                      {phone}
                      <button onClick={() => toggleSelect(phone)} style={{ background: "transparent", border: "none", color: C.blue, cursor: "pointer", marginLeft: 6, padding: 0, display: "flex", alignItems: "center" }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recipient List Card */}
            <div style={{ ...panel }}>
              <div style={{ padding: "12px 16px 10px", fontSize: 13, color: C.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px", borderBottom: `0.5px solid ${C.separator}`, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <span>Registered Users ({users.length})</span>
                {selectedCount > 0 && <span style={{ color: C.green, fontSize: 12, flexShrink: 0 }}>✓ {selectedCount} selected</span>}
              </div>
              {users.length === 0 ? (
                <div style={{ padding: "32px 20px", textAlign: "center", color: C.textTertiary, fontSize: 15 }}>
                  No registered users found.
                </div>
              ) : (
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  {users.map((user, index) => (
                    <div
                      key={user.id}
                      onClick={() => toggleSelect(user.phone)}
                      onMouseEnter={(e) => { e.currentTarget.style.background = C.bg; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        padding: "12px 16px",
                        borderBottom: index < users.length - 1 ? `0.5px solid ${C.separator}` : "none",
                        cursor: "pointer",
                        transition: "background 0.15s",
                        minWidth: 0
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.username}</div>
                        <div style={{ fontSize: 13, color: C.textTertiary, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{user.phone}</div>
                      </div>
                      <div style={{
                        width: 26,
                        height: 26,
                        borderRadius: "50%",
                        border: `2px solid ${selectedPhones.includes(user.phone) ? C.green : C.separator}`,
                        background: selectedPhones.includes(user.phone) ? C.green : "transparent",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        marginLeft: 12,
                        transition: "all 0.2s ease"
                      }}>
                        {selectedPhones.includes(user.phone) && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN — message + send */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
            {/* Message Card */}
            <div style={{ ...panel, padding: 16, display: "flex", flexDirection: "column" }}>
              <p style={{ margin: "0 0 10px 4px", fontSize: 13, color: C.textTertiary, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>Message</p>
              <textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 220,
                  border: "none",
                  outline: "none",
                  padding: 12,
                  fontSize: 16,
                  fontFamily: iosFont,
                  color: C.textPrimary,
                  background: C.bg,
                  borderRadius: 10,
                  resize: "vertical",
                  boxSizing: "border-box"
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
                <span style={{ fontSize: 12, color: C.textTertiary }}>{message.length} characters</span>
              </div>
            </div>

            {/* Send button */}
            <button
              onClick={handleSendSms}
              disabled={sending}
              style={{
                width: "100%",
                height: 54,
                background: sending ? "#A0A0A0" : C.blue,
                color: "white",
                border: "none",
                borderRadius: 14,
                fontSize: 17,
                fontWeight: 600,
                fontFamily: iosFont,
                cursor: sending ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(0,122,255,0.3)"
              }}
            >
              {sending ? "Sending..." : `Send SMS${selectedCount > 0 ? ` to ${selectedCount}` : ""}`}
            </button>
          </div>
        </div>

        {/* ===== SENT HISTORY — full width ===== */}
        <h2 style={{ fontSize: 20, fontWeight: 700, color: C.textPrimary, margin: "0 0 16px" }}>Sent History</h2>
        <div style={{ ...panel, marginBottom: 8 }}>
          {sentLogs.length === 0 ? (
            <div style={{ padding: "48px 24px", textAlign: "center", color: C.textTertiary, fontSize: 15 }}>
              No sent messages found.
            </div>
          ) : (
            sentLogs.map((log, index) => (
              <div
                key={log.id}
                style={{
                  padding: "16px",
                  borderBottom: index < sentLogs.length - 1 ? `0.5px solid ${C.separator}` : "none",
                  minWidth: 0
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 8 }}>
                  <span style={{ fontSize: 15, fontWeight: 600, color: C.textPrimary, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{log.phone}</span>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: log.status === "Success" ? C.green : C.red,
                    background: log.status === "Success" ? C.greenBg : C.redBg,
                    padding: "4px 8px",
                    borderRadius: 6,
                    textTransform: "uppercase",
                    flexShrink: 0
                  }}>
                    {log.status || "Unknown"}
                  </span>
                </div>
                <p style={{ margin: "0 0 6px 0", fontSize: 14, color: C.textSecondary, wordBreak: "break-word" }}>{log.message}</p>
                <span style={{ fontSize: 12, color: C.textTertiary }}>
                  {new Date(log.sentAt || log.sent_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}