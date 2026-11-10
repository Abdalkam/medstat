
import { useState, useEffect, useCallback } from "react";
import type { CSSProperties, ReactNode } from "react";

import { getUsers } from "../database/userDB";
import { db } from "../database/db";
import { sendSms } from "../api/smsApi";
import {
  hasValidAuth,
  tryReauthenticate,
  recordSmsLogs,
  syncUnsyncedSmsLogs,
  pullRemoteSmsLogs,
} from "../auth/supabase";

// ============================================================
// THEME
// ============================================================

const C = {
  bg: "#F2F2F7",
  card: "#FFFFFF",
  separator: "#E5E5EA",
  textPrimary: "#1C1C1E",
  textSecondary: "#3C3C43",
  textTertiary: "#8E8E93",

  blue: "#007AFF",
  blueBg: "#EBF2FF",

  medBlue: "#0A84FF",
  medBlueBg: "#E8F2FF",

  green: "#34C759",
  greenBg: "#EAF9EE",

  red: "#FF3B30",
  redBg: "#FFEFEE",

  purple: "#AF52DE",
  purpleBg: "#F5F0FF",
};

const FONT =
  "-apple-system, BlinkMacSystemFont, 'SF Pro Text', sans-serif";

const GUTTER = "clamp(12px, 3vw, 24px)";
const PAGE_MAX = 1440;

const panel: CSSProperties = {
  background: C.card,
  borderRadius: 16,
  border: "1px solid rgba(17,24,39,0.05)",
  boxShadow:
    "0 1px 2px rgba(16,24,40,0.04), 0 4px 16px rgba(16,24,40,0.05)",
  boxSizing: "border-box",
  minWidth: 0,
  overflow: "hidden",
};

// ============================================================
// TYPES
// ============================================================

interface SmsUser {
  id: string;
  username: string;
  phone: string;
  [key: string]: any;
}

interface SmsLog {
  id: string;
  tenant_id?: string | null;
  phone: string;
  message: string;
  status: string;
  sent_by?: string | null;
  sentAt?: string;
  sent_at?: string;
  [key: string]: any;
}

interface CurrentUser {
  id?: string;
  tenantId?: string;
}

// ============================================================
// HELPERS
// ============================================================

const normalizePhone = (phone: string) =>
  phone.replace(/\s+/g, "").trim();

const getCurrentUser = (): CurrentUser => {
  try {
    return JSON.parse(
      localStorage.getItem("currentUser") || "{}"
    );
  } catch {
    return {};
  }
};

const getLogDate = (log: SmsLog) =>
  new Date(log.sentAt || log.sent_at || 0).getTime();

const sortLogs = (logs: SmsLog[]) =>
  [...logs].sort((a, b) => getLogDate(b) - getLogDate(a));

const createSmsLogs = (
  recipients: string[],
  message: string,
  currentUser: CurrentUser,
  serverLogs?: any[],
  sentAt = new Date().toISOString()
): SmsLog[] => {
  if (serverLogs?.length) {
    return serverLogs.map((log: any) => ({
      id: log.id || crypto.randomUUID(),
      tenant_id: log.tenant_id || currentUser.tenantId || null,
      phone: log.phone,
      message: log.message || message,
      status: log.status || "Success",
      sent_by: log.sent_by || currentUser.id || null,
      sentAt: log.sent_at
        ? new Date(log.sent_at).toISOString()
        : sentAt,
    }));
  }

  return recipients.map((phone) => ({
    id: crypto.randomUUID(),
    tenant_id: currentUser.tenantId || null,
    phone,
    message,
    status: "Success",
    sent_by: currentUser.id || null,
    sentAt,
  }));
};

// ============================================================
// REUSABLE COMPONENTS
// ============================================================

function Stat({
  icon,
  bg,
  fg,
  label,
  value,
}: {
  icon: ReactNode;
  bg: string;
  fg: string;
  label: string;
  value: string | number;
}) {
  return (
    <div
      style={{
        ...panel,
        padding: 16,
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 10,
          background: bg,
          color: fg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {icon}
      </div>

      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            color: C.textTertiary,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {label}
        </div>

        <div
          style={{
            fontSize: 22,
            color: C.textPrimary,
            fontWeight: 700,
            lineHeight: 1.2,
          }}
        >
          {value}
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p
      style={{
        margin: "0 0 10px 4px",
        fontSize: 13,
        color: C.textTertiary,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.5px",
      }}
    >
      {children}
    </p>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: disabled ? "#A0A0A0" : C.blue,
        color: "#FFFFFF",
        border: "none",
        borderRadius: 10,
        padding: "0 18px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 15,
        fontFamily: FONT,
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function SMSmanagement() {
  const [users, setUsers] = useState<SmsUser[]>([]);
  const [selectedPhones, setSelectedPhones] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [manualPhone, setManualPhone] = useState("");

  const [sentLogs, setSentLogs] = useState<SmsLog[]>([]);

  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Session state: null = still checking, true = online session OK,
  // false = offline session (SMS disabled until re-login).
  const [sessionOk, setSessionOk] = useState<boolean>(hasValidAuth());

  // ----------------------------------------------------------
  // LOAD SMS HISTORY
  // ----------------------------------------------------------

  const loadSentLogs = useCallback(async () => {
    try {
      const logs = await db.smsLogs.toArray();
      setSentLogs(sortLogs(logs as SmsLog[]));
    } catch (err) {
      console.error("Failed to load SMS logs:", err);
    }
  }, []);

  // ----------------------------------------------------------
  // CLOUD SYNCHRONIZATION
  // ----------------------------------------------------------

  const refreshFromCloud = useCallback(async () => {
    const currentUser = getCurrentUser();

    if (!currentUser.tenantId || !navigator.onLine) {
      return;
    }

    try {
      // Upload locally stored logs that have not synchronized.
      await syncUnsyncedSmsLogs();

      // Retrieve the tenant's remote SMS history.
      await pullRemoteSmsLogs(currentUser.tenantId);

      // Refresh the local history.
      await loadSentLogs();
    } catch (err) {
      console.warn("SMS cloud synchronization failed:", err);
    }
  }, [loadSentLogs]);

  // ----------------------------------------------------------
  // SESSION SELF-HEAL
  // ----------------------------------------------------------
  // If this device holds an offline session (backend was unreachable at
  // login), SMS is disabled. Try a silent re-login with the cached
  // credentials; on success the cloud history syncs immediately.

  const healSession = useCallback(async () => {
    if (hasValidAuth()) {
      setSessionOk(true);
      return;
    }

    try {
      const token = await tryReauthenticate();
      setSessionOk(Boolean(token));

      if (token) {
        await refreshFromCloud();
      }
    } catch (err) {
      console.warn("Session heal failed:", err);
      setSessionOk(false);
    }
  }, [refreshFromCloud]);

  // ----------------------------------------------------------
  // INITIAL DATA
  // ----------------------------------------------------------

  useEffect(() => {
    let mounted = true;

    const loadInitialData = async () => {
      try {
        const localUsers = await getUsers();

        if (!mounted) return;

        const registeredUsers = localUsers
          .filter((user: any) => user.phone)
          .map((user: any) => ({
            ...user,
            phone: normalizePhone(user.phone),
          }));

        setUsers(registeredUsers);

        await loadSentLogs();

        if (mounted) {
          // Repair an offline session (if any) before syncing.
          await healSession();

          await refreshFromCloud();
        }
      } catch (err) {
        console.error("Failed to load SMS management data:", err);
      }
    };

    const handleOnline = () => {
      healSession();
      refreshFromCloud();
    };

    loadInitialData();

    window.addEventListener("online", handleOnline);

    return () => {
      mounted = false;
      window.removeEventListener("online", handleOnline);
    };
  }, [loadSentLogs, refreshFromCloud, healSession]);

  // ----------------------------------------------------------
  // RECIPIENT SELECTION
  // ----------------------------------------------------------

  const toggleSelect = (phone: string) => {
    const cleanPhone = normalizePhone(phone);

    setSelectedPhones((previous) =>
      previous.includes(cleanPhone)
        ? previous.filter((item) => item !== cleanPhone)
        : [...previous, cleanPhone]
    );

    setError("");
  };

  const selectAll = () => {
    if (selectedPhones.length === users.length && users.length > 0) {
      setSelectedPhones([]);
    } else {
      setSelectedPhones(users.map((user) => user.phone));
    }

    setError("");
  };

  // ----------------------------------------------------------
  // ADD MANUAL RECIPIENT
  // ----------------------------------------------------------

  const addManualPhone = () => {
    const phone = normalizePhone(manualPhone);

    if (!phone) return;

    if (selectedPhones.includes(phone)) {
      setError("This number is already in the recipient list.");
      return;
    }

    setSelectedPhones((previous) => [...previous, phone]);
    setManualPhone("");
    setError("");
  };

  // ----------------------------------------------------------
  // SEND SMS
  // ----------------------------------------------------------

  const handleSendSms = async () => {
    if (sending) return;

    if (!sessionOk) {
      setError(
        "Offline session — log out and sign in online to enable SMS."
      );
      return;
    }

    if (selectedPhones.length === 0) {
      setError("Please select at least one recipient.");
      return;
    }

    const cleanMessage = message.trim();

    if (!cleanMessage) {
      setError("Message cannot be empty.");
      return;
    }

    if (!navigator.onLine) {
      setError(
        "You're offline — sending SMS requires an internet connection."
      );
      return;
    }

    setSending(true);
    setError("");
    setSuccess(false);

    const currentUser = getCurrentUser();
    const sentAt = new Date().toISOString();

    const recipients = [
      ...new Set(selectedPhones.map(normalizePhone)),
    ];

    try {
      const response = await sendSms(recipients, cleanMessage);

      const logs = createSmsLogs(
        recipients,
        cleanMessage,
        currentUser,
        response?.logs,
        sentAt
      );

      // Save SMS history locally first.
      await recordSmsLogs(logs);

      setSuccess(true);
      setMessage("");
      setSelectedPhones([]);

      window.setTimeout(() => setSuccess(false), 3000);

      // Attempt cloud synchronization without blocking the UI.
      void refreshFromCloud();
    } catch (err: any) {
      console.error("SMS sending failed:", err);

      setError(
        err?.message || "Failed to send SMS. Please check your connection."
      );

      // Preserve successful server-side delivery records.
      if (err?.logs?.length) {
        try {
          const successfulLogs = createSmsLogs(
            [],
            cleanMessage,
            currentUser,
            err.logs,
            sentAt
          );

          await recordSmsLogs(successfulLogs);
        } catch (logError) {
          console.error("Failed to save partial SMS logs:", logError);
        }
      }
    } finally {
      setSending(false);
      await loadSentLogs();
    }
  };

  // ----------------------------------------------------------
  // DERIVED STATISTICS
  // ----------------------------------------------------------

  const selectedCount = selectedPhones.length;

  const successCount = sentLogs.filter(
    (log) => (log.status || "").toLowerCase() === "success"
  ).length;

  const customPhones = selectedPhones.filter(
    (phone) => !users.some((user) => user.phone === phone)
  );

  // ----------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------

  return (
    <div
      style={{
        width: "100%",
        minHeight: "100%",
        background: C.bg,
        fontFamily: FONT,
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: none; }
        }

        button:focus-visible {
          outline: 2px solid ${C.blue};
          outline-offset: 2px;
        }

        input:focus, textarea:focus {
          border-color: ${C.medBlue} !important;
        }
      `}</style>

      <div
        style={{
          width: "100%",
          maxWidth: PAGE_MAX,
          margin: "0 auto",
          padding: `20px ${GUTTER} 48px`,
          boxSizing: "border-box",
        }}
      >
        {/* PAGE HEADER */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: 20,
            minWidth: 0,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1
              style={{
                margin: 0,
                color: C.textPrimary,
                fontSize: "clamp(22px, 4vw, 28px)",
                fontWeight: 800,
                letterSpacing: "-0.5px",
              }}
            >
              Send SMS
            </h1>

            <p
              style={{
                margin: "4px 0 0",
                color: C.textTertiary,
                fontSize: 14,
              }}
            >
              Reach trainers and trainees instantly
            </p>
          </div>

          <button
            type="button"
            onClick={selectAll}
            style={{
              background: C.medBlueBg,
              border: `1px solid ${C.medBlue}22`,
              color: C.medBlue,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              padding: "9px 16px",
              borderRadius: 10,
              flexShrink: 0,
              fontFamily: FONT,
            }}
          >
            {selectedCount === users.length && users.length > 0
              ? "Deselect All"
              : "Select All"}
          </button>
        </div>

        {/* ALERTS */}

        {error && (
          <div
            role="alert"
            style={{
              background: C.redBg,
              color: C.red,
              padding: "14px 16px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            {error}
          </div>
        )}

        {success && (
          <div
            role="status"
            style={{
              background: C.greenBg,
              color: C.green,
              padding: "14px 16px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 600,
              marginBottom: 16,
            }}
          >
            SMS Sent Successfully!
          </div>
        )}

        {sessionOk === false && (
          <div
            role="alert"
            style={{
              background: C.redBg,
              color: C.red,
              padding: "14px 16px",
              borderRadius: 12,
              fontSize: 14,
              fontWeight: 500,
              marginBottom: 16,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <span>
              Offline session — SMS sending is disabled. Log out and sign in
              again with internet on this device.
            </span>

            <button
              type="button"
              onClick={healSession}
              style={{
                background: C.red,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                fontFamily: FONT,
                flexShrink: 0,
              }}
            >
              Retry now
            </button>
          </div>
        )}

        {/* STATISTICS */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(170px, 100%), 1fr))",
            gap: 12,
            marginBottom: 20,
          }}
        >
          <Stat
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            }
            bg={C.medBlueBg}
            fg={C.medBlue}
            label="Recipients Selected"
            value={selectedCount}
          />

          <Stat
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8.5L4 21v-4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
              </svg>
            }
            bg={C.greenBg}
            fg={C.green}
            label="SMS Sent (all time)"
            value={sentLogs.length}
          />

          <Stat
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            }
            bg={C.purpleBg}
            fg={C.purple}
            label="Successful"
            value={successCount}
          />

          <Stat
            icon={
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
            }
            bg={C.blueBg}
            fg={C.blue}
            label="Registered Contacts"
            value={users.length}
          />
        </div>

        {/* COMPOSE WORKSPACE */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns:
              "repeat(auto-fit, minmax(min(380px, 100%), 1fr))",
            gap: 16,
            alignItems: "start",
            marginBottom: 28,
          }}
        >
          {/* LEFT: RECIPIENTS */}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            {/* CUSTOM PHONE */}

            <div style={{ ...panel, padding: 16 }}>
              <SectionLabel>Add Custom Number</SectionLabel>

              <div style={{ display: "flex", gap: 8 }}>
                <input
                  type="tel"
                  placeholder="+256712345678"
                  value={manualPhone}
                  onChange={(e) => setManualPhone(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addManualPhone();
                    }
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    height: 46,
                    padding: "0 12px",
                    borderRadius: 10,
                    border: `1px solid ${C.separator}`,
                    fontSize: 15,
                    outline: "none",
                    boxSizing: "border-box",
                    color: C.textPrimary,
                    fontFamily: FONT,
                    background: C.bg,
                  }}
                />

                <PrimaryButton onClick={addManualPhone}>
                  Add
                </PrimaryButton>
              </div>

              {customPhones.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 12,
                  }}
                >
                  {customPhones.map((phone) => (
                    <div
                      key={phone}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        background: C.medBlueBg,
                        color: C.medBlue,
                        padding: "5px 8px 5px 12px",
                        borderRadius: 20,
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      {phone}

                      <button
                        type="button"
                        aria-label={`Remove ${phone}`}
                        onClick={() => toggleSelect(phone)}
                        style={{
                          background: "transparent",
                          border: "none",
                          color: C.medBlue,
                          cursor: "pointer",
                          marginLeft: 8,
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* REGISTERED USERS */}

            <div style={panel}>
              <div
                style={{
                  padding: "13px 16px",
                  fontSize: 13,
                  color: C.textTertiary,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                  borderBottom: `1px solid ${C.separator}`,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span>Registered Users ({users.length})</span>

                {selectedCount > 0 && (
                  <span
                    style={{
                      color: C.medBlue,
                      fontSize: 12,
                      flexShrink: 0,
                    }}
                  >
                    {selectedCount} selected
                  </span>
                )}
              </div>

              {users.length === 0 ? (
                <div
                  style={{
                    padding: 32,
                    textAlign: "center",
                    color: C.textTertiary,
                    fontSize: 15,
                  }}
                >
                  No registered users found.
                </div>
              ) : (
                <div style={{ maxHeight: 380, overflowY: "auto" }}>
                  {users.map((user, index) => {
                    const selected = selectedPhones.includes(user.phone);

                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleSelect(user.phone)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          width: "100%",
                          textAlign: "left",
                          padding: "12px 16px",
                          border: "none",
                          borderBottom:
                            index < users.length - 1
                              ? `1px solid ${C.separator}`
                              : "none",
                          background: selected ? C.medBlueBg : "transparent",
                          cursor: "pointer",
                          fontFamily: FONT,
                          minWidth: 0,
                        }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 15,
                              fontWeight: 600,
                              color: C.textPrimary,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {user.username}
                          </div>

                          <div
                            style={{
                              fontSize: 13,
                              color: C.textTertiary,
                              marginTop: 3,
                            }}
                          >
                            {user.phone}
                          </div>
                        </div>

                        <div
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: "50%",
                            border: `2px solid ${
                              selected ? C.medBlue : C.separator
                            }`,
                            background: selected ? C.medBlue : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                            marginLeft: 12,
                          }}
                        >
                          {selected && (
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="white"
                              strokeWidth="3"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: MESSAGE COMPOSER */}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              minWidth: 0,
            }}
          >
            <div
              style={{
                ...panel,
                padding: 16,
                display: "flex",
                flexDirection: "column",
              }}
            >
              <SectionLabel>Message</SectionLabel>

              <textarea
                placeholder="Type your message here..."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                style={{
                  width: "100%",
                  minHeight: 220,
                  border: `1px solid ${C.separator}`,
                  outline: "none",
                  padding: 12,
                  fontSize: 16,
                  fontFamily: FONT,
                  color: C.textPrimary,
                  background: C.bg,
                  borderRadius: 10,
                  resize: "vertical",
                  boxSizing: "border-box",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginTop: 8,
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, color: C.textTertiary }}>
                  {selectedCount} recipient{selectedCount === 1 ? "" : "s"}
                </span>

                <span style={{ fontSize: 12, color: C.textTertiary }}>
                  {message.length} characters
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleSendSms}
              disabled={sending || sessionOk === false}
              style={{
                width: "100%",
                minHeight: 54,
                background: sending ? "#A0A0A0" : C.medBlue,
                color: "#FFFFFF",
                border: "none",
                borderRadius: 12,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: sending ? "not-allowed" : "pointer",
                boxShadow: "0 3px 10px rgba(10,132,255,0.18)",
              }}
            >
              {sending
                ? "Sending..."
                : `Send SMS${selectedCount > 0 ? ` to ${selectedCount}` : ""}`}
            </button>
          </div>
        </div>

        {/* SENT HISTORY */}

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 14,
          }}
        >
          <h2
            style={{
              fontSize: 20,
              fontWeight: 700,
              color: C.textPrimary,
              margin: 0,
            }}
          >
            Sent History
          </h2>

          <span
            style={{
              fontSize: 13,
              color: C.textTertiary,
            }}
          >
            {sentLogs.length} records
          </span>
        </div>

        <div style={{ ...panel, marginBottom: 8 }}>
          {sentLogs.length === 0 ? (
            <div
              style={{
                padding: "48px 24px",
                textAlign: "center",
                color: C.textTertiary,
                fontSize: 15,
              }}
            >
              No sent messages found.
            </div>
          ) : (
            sentLogs.map((log, index) => {
              const isSuccess =
                (log.status || "").toLowerCase() === "success";

              return (
                <div
                  key={log.id}
                  style={{
                    padding: 16,
                    borderBottom:
                      index < sentLogs.length - 1
                        ? `1px solid ${C.separator}`
                        : "none",
                    minWidth: 0,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 7,
                      gap: 8,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 15,
                        fontWeight: 600,
                        color: C.textPrimary,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {log.phone}
                    </span>

                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: isSuccess ? C.green : C.red,
                        background: isSuccess ? C.greenBg : C.redBg,
                        padding: "4px 8px",
                        borderRadius: 6,
                        textTransform: "uppercase",
                        flexShrink: 0,
                      }}
                    >
                      {log.status || "Unknown"}
                    </span>
                  </div>

                  <p
                    style={{
                      margin: "0 0 7px",
                      fontSize: 14,
                      color: C.textSecondary,
                      wordBreak: "break-word",
                      lineHeight: 1.5,
                    }}
                  >
                    {log.message}
                  </p>

                  <span
                    style={{
                      fontSize: 12,
                      color: C.textTertiary,
                    }}
                  >
                    {Number.isFinite(getLogDate(log))
                      ? new Date(getLogDate(log)).toLocaleString()
                      : "Date unavailable"}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
