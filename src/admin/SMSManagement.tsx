import { useState, useEffect } from "react";
import { getUsers } from "../database/userDB";
import { db } from "../database/db";

const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

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

  useEffect(() => {
    async function loadUsers() {
      try {
        const localUsers = await getUsers();
        setUsers(localUsers.filter((u: any) => u.phone));
      } catch (e) {
        console.error("Failed to load users for SMS", e);
      }
    }
    loadUsers();
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
      const token = localStorage.getItem("authToken");
      
      // Borrowed from Startup.tsx: Prevent action if in offline mode
      if (!token || token === "offline-mode-pending-sync") {
        setError("You must be online and logged in to send SMS.");
        return;
      }

      // Borrowed from PhoneEntry.tsx: Clean phone numbers before sending
      const cleanRecipients = selectedPhones.map(p => p.replace(/\s/g, "").trim());

      const response = await fetch(`${API_BASE_URL}/api/sms/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipients: cleanRecipients,
          message: message.trim(),
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to send SMS");
      }

      const data = await response.json();
      
      if (data.logs && data.logs.length > 0) {
        await db.smsLogs.bulkAdd(data.logs.map((log: any) => ({
          ...log,
          sentAt: log.sent_at ? new Date(log.sent_at).toISOString() : new Date().toISOString()
        })));
      }

      setSuccess(true);
      setMessage("");
      setSelectedPhones([]);
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      console.error("Send SMS error:", err);
      setError(err.message || "An error occurred while sending SMS.");
    } finally {
      setSending(false);
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

        {/* Recipient List Card */}
        <div style={{ background: C.card, borderRadius: "14px", overflow: "hidden", marginBottom: "24px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          {users.length === 0 ? (
            <div style={{ padding: "40px 20px", textAlign: "center", color: C.textTertiary, fontSize: "15px" }}>
              No users with phone numbers found.
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
      </div>
    </div>
  );
}