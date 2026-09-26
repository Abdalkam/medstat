// src/admin/SMSsettings.tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { getUsers } from "../database/userDB";
import { db } from "../database/db";

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
  const navigate = useNavigate();
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
        // Only show users who actually have a phone number
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
      if (!token) {
        navigate("/");
        return;
      }

      // Call the exact backend endpoint we created in index.ts
      const response = await fetch("/api/sms/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          recipients: selectedPhones,
          message: message.trim(),
        }),
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to send SMS");
      }

      const data = await response.json();
      
      // Save logs to local IndexedDB so the Dashboard chart updates instantly
      if (data.logs && data.logs.length > 0) {
        await db.smsLogs.bulkAdd(data.logs.map((log: any) => ({
          ...log,
          sentAt: log.sent_at
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
    <div style={{ width: "100%", minHeight: "100%", background: C.bg, fontFamily: iosFont, padding: "20px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "20px" }}>
      
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
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
        <div style={{ background: "#FFEFEE", color: C.red, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: "500" }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ background: "#EAF9EE", color: C.green, padding: "12px 16px", borderRadius: "10px", fontSize: "14px", fontWeight: "600" }}>
          SMS Sent Successfully!
        </div>
      )}

      {/* Recipients List */}
      <div style={{ background: C.card, borderRadius: "14px", overflow: "hidden" }}>
        {users.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: C.textTertiary, fontSize: "15px" }}>
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
                padding: "14px 16px",
                borderBottom: index < users.length - 1 ? `0.5px solid ${C.separator}` : "none",
                cursor: "pointer"
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "16px", fontWeight: "600", color: C.textPrimary }}>{user.username}</div>
                <div style={{ fontSize: "13px", color: C.textTertiary, marginTop: "2px" }}>{user.phone}</div>
              </div>
              {/* iOS Checkbox */}
              <div style={{
                width: "24px",
                height: "24px",
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

      {/* Message Textarea */}
      <div style={{ background: C.card, borderRadius: "14px", padding: "4px" }}>
        <textarea 
          placeholder="Type your message here..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          style={{
            width: "100%", 
            minHeight: "120px", 
            border: "none", 
            outline: "none", 
            padding: "12px", 
            fontSize: "16px", 
            fontFamily: iosFont, 
            color: C.textPrimary, 
            background: "transparent",
            resize: "vertical"
          }}
        />
      </div>

      <p style={{ color: C.textTertiary, fontSize: "13px", margin: "0", paddingLeft: "4px" }}>
        {selectedPhones.length} recipient(s) selected
      </p>

      {/* Send Button */}
      <button 
        onClick={handleSendSms} 
        disabled={sending}
        style={{
          width: "100%",
          padding: "16px",
          background: sending ? "#A0A0A0" : C.blue,
          color: "white",
          border: "none",
          borderRadius: "14px",
          fontSize: "17px",
          fontWeight: "600",
          cursor: sending ? "not-allowed" : "pointer",
          marginBottom: "40px"
        }}
      >
        {sending ? "Sending..." : "Send SMS"}
      </button>
    </div>
  );
}