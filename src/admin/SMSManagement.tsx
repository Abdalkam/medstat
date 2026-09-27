import { useState, useEffect } from "react";
import { getUsers } from "../database/userDB";
import { db } from "../database/db";
import { sendSms } from "../api/smsApi";

const C = {
  bg: "#F2F2F7",
  card: "#FFFFFF",
  separator: "#E5E5EA",
  textPrimary: "#1C1C1E",
  textSecondary: "#3C3C43",
  textTertiary: "#8E8E93",
  blue: "#007AFF",
  green: "#34C759",
  red: "#FF3B30",
};

const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

export default function SMSsettings() {
  const [users, setUsers] = useState<any[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  
  // State for custom phone numbers
  const [manualPhone, setManualPhone] = useState("");

  // State for Sent History
  const [sentLogs, setSentLogs] = useState<any[]>([]);

  // Load users and sent logs on mount
  useEffect(() => {
    async function loadInitialData() {
      try {
        const localUsers = await getUsers();
        setUsers(localUsers.filter((u: any) => u.phone));
        
        // Load sent logs
        await loadSentLogs();
      } catch (e) {
        console.error("Failed to load initial data", e);
      }
    }
    loadInitialData();
  }, []);

  const loadSentLogs = async () => {
    try {
      const logs = await db.smsLogs.toArray();
      // Sort newest first
      logs.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
      setSentLogs(logs);
    } catch (e) {
      console.error("Failed to load SMS logs", e);
    }
  };

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

    setSending(true);
    setError("");
    setSuccess(false);

    try {
      const cleanRecipients = selectedPhones.map(p => p.replace(/\s/g, "").trim());
      const data = await sendSms(cleanRecipients, message.trim());
      
      if (data.logs && data.logs.length > 0) {
        await db.smsLogs.bulkAdd(data.logs.map((log: any) => ({
          id: log.id || crypto.randomUUID(),
          tenant_id: log.tenant_id,
          phone: log.phone,
          message: log.message,
          status: log.status,
          sent_by: log.sent_by,
          sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : new Date().toISOString()
        })));
      }

      setSuccess(true);
      setMessage("");
      setSelectedPhones([]);
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error("Send SMS error:", err);
      setError(err.message || "Failed to send SMS. Check your network.");
      
      // If some SMS succeeded but others failed, save the successful ones to local DB
      if (err.logs && err.logs.length > 0) {
        try {
          await db.smsLogs.bulkAdd(err.logs.map((log: any) => ({
            id: log.id || crypto.randomUUID(),
            tenant_id: log.tenant_id,
            phone: log.phone,
            message: log.message,
            status: log.status,
            sent_by: log.sent_by,
            sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : new Date().toISOString()
          })));
        } catch (dbErr) {
          console.error("Failed to save partial SMS logs:", dbErr);
        }
      }
    } finally {
      setSending(false);
      // Refresh the history list at the bottom regardless of success/fail
      await loadSentLogs();
    }
  };

  return (
    <div style={{ width: "100%", minHeight: "100vh", background: C.bg, fontFamily: iosFont, padding: "24px", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
      <style>{`
        @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>

      <div style={{ width: "100%", maxWidth: "600px", animation: "fadeUp 0.6s ease-out" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h1 style={{ margin: 0, color: C.textPrimary, fontSize: "28px", fontWeight: "800", letterSpacing: "-1px" }}>
            Send SMS
          </h1>
          <button 
            onClick={selectAll}
            style={{ background: "transparent", border: "none", color: C.blue, fontSize: "15px", fontWeight: "600", cursor: "pointer" }}
          >
            {selectedPhones.length === users.length ? "Deselect All" : "Select All"}
          </button>
        </div>

        {error && (
          <div style={{ background: "#FFEFEE", color: C.red, padding: "14px 16px", borderRadius: "14px", fontSize: "14px", fontWeight: "500", marginBottom: "16px" }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ background: "#EAF9EE", color: C.green, padding: "14px 16px", borderRadius: "14px", fontSize: "14px", fontWeight: "600", marginBottom: "16px" }}>
            SMS Sent Successfully!
          </div>
        )}

        {/* Custom Number Input Card */}
        <div style={{ background: C.card, borderRadius: "14px", padding: "16px", marginBottom: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          <p style={{ margin: "0 0 8px 4px", fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>Add Custom Number</p>
          <div style={{ display: "flex", gap: "8px" }}>
            <input 
              type="tel"
              placeholder="+256712345678"
              value={manualPhone}
              onChange={(e) => setManualPhone(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManualPhone(); } }}
              style={{
                flex: 1, height: "46px", padding: "0 12px", borderRadius: "10px", 
                border: `1px solid ${C.separator}`, fontSize: "15px", outline: "none",
                boxSizing: "border-box", color: C.textPrimary
              }}
            />
            <button 
              onClick={addManualPhone} 
              style={{ background: C.blue, color: "white", border: "none", borderRadius: "10px", padding: "0 16px", fontWeight: "600", cursor: "pointer", fontSize: "15px" }}
            >
              Add
            </button>
          </div>
          
          {selectedPhones.filter(p => !users.some(u => u.phone === p)).length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "12px" }}>
              {selectedPhones.filter(p => !users.some(u => u.phone === p)).map(phone => (
                <div key={phone} style={{ display: "flex", alignItems: "center", background: `${C.blue}20`, color: C.blue, padding: "4px 8px 4px 12px", borderRadius: "20px", fontSize: "13px", fontWeight: "600" }}>
                  {phone}
                  <button onClick={() => toggleSelect(phone)} style={{ background: "transparent", border: "none", color: C.blue, cursor: "pointer", marginLeft: "6px", padding: 0, display: "flex", alignItems: "center" }}>✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recipient List Card */}
        <div style={{ background: C.card, borderRadius: "14px", overflow: "hidden", marginBottom: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          <div style={{ padding: "12px 16px 4px 16px", fontSize: "13px", color: C.textTertiary, fontWeight: "600", textTransform: "uppercase", letterSpacing: "0.5px" }}>
            Registered Users
          </div>
          {users.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: C.textTertiary, fontSize: "15px" }}>
              No registered users found.
            </div>
          ) : (
            users.map((user, index) => (
              <div 
                key={user.id} 
                onClick={() => toggleSelect(user.phone)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "16px",
                  borderBottom: index < users.length - 1 ? `0.5px solid ${C.separator}` : "none",
                  cursor: "pointer",
                  transition: "background 0.2s"
                }}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: "16px", fontWeight: "600", color: C.textPrimary }}>{user.username}</div>
                  <div style={{ fontSize: "13px", color: C.textTertiary, marginTop: "2px" }}>{user.phone}</div>
                </div>
                <div style={{
                  width: "26px",
                  height: "26px",
                  borderRadius: "50%",
                  border: `2px solid ${selectedPhones.includes(user.phone) ? C.green : C.separator}`,
                  background: selectedPhones.includes(user.phone) ? C.green : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "all 0.2s ease"
                }}>
                  {selectedPhones.includes(user.phone) && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Message Input Card */}
        <div style={{ background: C.card, borderRadius: "14px", padding: "16px", marginBottom: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          <textarea 
            placeholder="Type your message here..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            style={{
              width: "100%", 
              minHeight: "120px", 
              border: "none", 
              outline: "none", 
              padding: "4px", 
              fontSize: "16px", 
              fontFamily: iosFont, 
              color: C.textPrimary, 
              background: "transparent",
              resize: "vertical"
            }}
          />
        </div>

        <p style={{ color: C.textTertiary, fontSize: "13px", margin: "0 0 16px 4px" }}>
          {selectedPhones.length} recipient(s) selected
        </p>

        <button 
          onClick={handleSendSms} 
          disabled={sending}
          style={{
            width: "100%",
            height: "54px", 
            background: sending ? "#A0A0A0" : C.blue,
            color: "white",
            border: "none",
            borderRadius: "14px", 
            fontSize: "17px",
            fontWeight: "600",
            cursor: sending ? "not-allowed" : "pointer",
            marginBottom: "40px",
            boxShadow: "0 4px 12px rgba(0,122,255,0.3)" 
          }}
        >
          {sending ? "Sending..." : "Send SMS"}
        </button>

        {/* ==========================================
            SENT HISTORY SECTION
        ========================================== */}
        <h2 style={{ fontSize: "20px", fontWeight: "700", color: C.textPrimary, marginBottom: "16px" }}>Sent History</h2>
        <div style={{ background: C.card, borderRadius: "14px", overflow: "hidden", marginBottom: "40px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          {sentLogs.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: C.textTertiary, fontSize: "15px" }}>
              No sent messages found.
            </div>
          ) : (
            sentLogs.map((log, index) => (
              <div 
                key={log.id} 
                style={{ 
                  padding: "16px", 
                  borderBottom: index < sentLogs.length - 1 ? `0.5px solid ${C.separator}` : "none" 
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                  <span style={{ fontSize: "15px", fontWeight: "600", color: C.textPrimary }}>{log.phone}</span>
                  <span style={{ 
                    fontSize: "11px", 
                    fontWeight: "700", 
                    color: log.status === "Success" ? C.green : C.red, 
                    background: log.status === "Success" ? "#EAF9EE" : "#FFEFEE", 
                    padding: "4px 8px", 
                    borderRadius: "6px",
                    textTransform: "uppercase"
                  }}>
                    {log.status || "Unknown"}
                  </span>
                </div>
                <p style={{ margin: "0 0 6px 0", fontSize: "14px", color: C.textSecondary }}>{log.message}</p>
                <span style={{ fontSize: "12px", color: C.textTertiary }}>
                  {new Date(log.sentAt).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}