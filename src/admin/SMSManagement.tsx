// src/components/SMSManagement.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { User } from "../types";
import { getUsers } from "../database/userDB";
import { db } from "../database/db";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://medstat-3rxl.onrender.com";

const PRIMARY = "#007AFF";
const IOS_BG = "#F2F2F7";
const SEPARATOR = "#E5E5EA";
const GREEN = "#34C759";
const RED = "#FF3B30";
const LABEL_COLOR = "#8E8E93";

export default function SMSManagement() {
  const navigate = useNavigate();
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [customPhone, setCustomPhone] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [status, setStatus] = useState<{ type: "idle" | "success" | "error" | "loading"; text: string }>({ type: "idle", text: "" });

  useEffect(() => {
    async function loadUsers() {
      const userData = await getUsers();
      setUsers(userData.filter((u) => u.role !== "admin" && u.phone));
    }
    loadUsers();
  }, []);

  const formatToE164 = (phone: string) => {
    if (!phone) return "";
    let cleaned = phone.replace(/\s+/g, "").replace(/[()-]/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    if (cleaned.startsWith("0")) return "+" + cleaned.substring(1);
    return "+" + cleaned;
  };

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    const user = users.find((u) => u.id === userId);
    if (user?.phone) {
      setCustomPhone(formatToE164(user.phone));
    } else {
      setCustomPhone("");
    }
  };

  const handlePhoneChange = (val: string) => {
    setCustomPhone(val);
    setSelectedUserId("");
  };

  const handleSend = async () => {
    const phone = customPhone.trim();

    if (!phone) {
      setStatus({ type: "error", text: "Please select a user or enter a phone number." });
      return;
    }

    if (phone === "+0" || phone.length < 6) {
      setStatus({ type: "error", text: "Please enter a valid phone number with country code (e.g., +254...)." });
      return;
    }

    if (!message.trim()) {
      setStatus({ type: "error", text: "Message body cannot be empty." });
      return;
    }

    setStatus({ type: "loading", text: "Sending message..." });

    try {
      const response = await fetch(`${API_BASE_URL}/api/send-sms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message: message.trim() }),
      });

      if (!response.ok) {
        let errorMessage = `Server responded with status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.error || errorMessage;
        } catch (e) { }
        throw new Error(errorMessage);
      }

      const data = await response.json();

      if (data.success) {
        await db.smsLogs.add({
          to: phone,
          message: message.trim(),
          sentAt: new Date()
        });

        setStatus({ type: "success", text: "SMS sent successfully!" });
        setMessage("");
        setCustomPhone("");
        setSelectedUserId("");
      } else {
        throw new Error(data.error || "Failed to send SMS.");
      }
    } catch (error: any) {
      console.error("SMS Send Error:", error);
      let displayError = error.message || "Network error occurred.";
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        displayError = "Cannot connect to the server. It may be sleeping or waking up. Please try again in 30 seconds.";
      }
      setStatus({ type: "error", text: displayError });
    }
  };

  const iosFont = "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', sans-serif";

  const iosInput: React.CSSProperties = {
    width: "100%", padding: "14px 16px", backgroundColor: "transparent",
    border: "none", fontSize: "16px", color: "#1C1C1E", outline: "none",
    fontFamily: iosFont, boxSizing: "border-box" as const
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: "#FFFFFF", borderRadius: "14px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)", border: "1px solid rgba(0,0,0,0.03)",
    overflow: "hidden", width: "100%", boxSizing: "border-box"
  };

  const labelStyle: React.CSSProperties = {
    fontSize: "13px", color: LABEL_COLOR, fontWeight: "600",
    textTransform: "uppercase" as const, letterSpacing: "0.5px",
    marginBottom: "8px", paddingLeft: "4px"
  };

  return (
    <div style={{ width: "100%", minHeight: "100%", background: IOS_BG, fontFamily: iosFont, display: "flex", flexDirection: "column", boxSizing: "border-box", padding: "0 16px 80px 16px" }}>

      {/* Back button header */}
      <div style={{ display: "flex", alignItems: "center", padding: "12px 0 16px 0", gap: "10px" }}>
        <button onClick={() => navigate(-1)} style={{ background: "none", border: "none", color: PRIMARY, cursor: "pointer", display: "flex", alignItems: "center", padding: 0, flexShrink: 0 }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <h1 style={{ margin: 0, color: "#1C1C1E", fontSize: "28px", fontWeight: "700", letterSpacing: "-0.5px", lineHeight: 1.1 }}>Send SMS</h1>
      </div>

      <div style={{ width: "100%", maxWidth: "600px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "24px" }}>

        <p style={{ margin: 0, color: LABEL_COLOR, fontSize: "14px", fontWeight: "400" }}>Notify users via text message</p>

        {status.type !== "idle" && (
          <div style={{
            padding: "14px 16px",
            background: status.type === "success" ? GREEN : status.type === "error" ? RED : PRIMARY,
            color: "#FFFFFF", borderRadius: "14px", fontSize: "14px", fontWeight: "600", textAlign: "center",
            display: "flex", alignItems: "center", justifyContent: "center", gap: "10px",
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)"
          }}>
            {status.type === "loading" && (
              <svg width={16} height={16} viewBox="0 0 50 50" style={{ animation: "spin 1s linear infinite" }}>
                <circle cx="25" cy="25" r="20" fill="none" stroke="#ffffff" strokeWidth="4" strokeLinecap="round" strokeDasharray="90 150" strokeDashoffset="0" />
              </svg>
            )}
            {status.text}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column" }}>
          <label style={labelStyle}>Recipient</label>
          <div style={cardStyle}>
            <div style={{ borderBottom: `0.5px solid ${SEPARATOR}`, position: "relative" }}>
              <select
                style={{ ...iosInput, appearance: "none", cursor: "pointer", paddingRight: "36px" }}
                value={selectedUserId} onChange={(e) => handleSelectUser(e.target.value)}
              >
                <option value="">Select a user...</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.username} ({user.phone})
                  </option>
                ))}
              </select>
              <div style={{ position: "absolute", right: "16px", top: "50%", transform: "translateY(-50%) rotate(90deg)", pointerEvents: "none", color: "#C7C7CC", fontSize: "14px", fontWeight: "600" }}>
                &#10095;
              </div>
            </div>
            <div>
              <input
                style={iosInput}
                placeholder="Enter number (+CountryCode...)"
                type="tel"
                value={customPhone}
                onChange={(e) => handlePhoneChange(e.target.value)}
              />
            </div>
          </div>
          <span style={{ fontSize: "12px", color: LABEL_COLOR, marginTop: "8px", paddingLeft: "4px" }}>Must include country code (e.g., +254, +234, +1)</span>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <label style={labelStyle}>Message</label>
          <div style={cardStyle}>
            <textarea
              style={{ ...iosInput, minHeight: "160px", resize: "none", padding: "16px", lineHeight: "1.5" }}
              placeholder="Type your message here..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px", paddingLeft: "4px" }}>
            <span style={{ fontSize: "12px", color: message.length > 160 ? RED : LABEL_COLOR, fontWeight: message.length > 160 ? "600" : "500" }}>
              {message.length} / 160 characters
            </span>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "center", paddingTop: "8px" }}>
          <button
            type="button"
            onClick={handleSend}
            disabled={status.type === "loading"}
            style={{
              width: "100%", background: "transparent", color: PRIMARY, border: "none",
              padding: "14px", borderRadius: "14px", fontSize: "17px", fontWeight: "600",
              cursor: status.type === "loading" ? "not-allowed" : "pointer",
              opacity: status.type === "loading" ? 0.4 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: "8px",
              transition: "background 0.2s ease, opacity 0.2s ease"
            }}
            onMouseEnter={e => e.currentTarget.style.background = "rgba(0, 122, 255, 0.06)"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="0.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"></path>
            </svg>
            {status.type === "loading" ? "Sending..." : "Send Message"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}