// src/components/MediaHelpModal.tsx
// In-app replacement for suppressed window.alert() when mic/cam activation fails.
// Covers four failure cases:
//   locked  — app-level lock (allowed_speakers): learner must raise their hand
//   denied  — Windows privacy toggle off (Settings → Privacy & security → Camera/Microphone)
//   busy    — device held by another app (Zoom, Teams…)
//   missing — no device connected
// Prop accepts `MediaProblem | null` because the parent's state starts as null;
// the component renders nothing while null.

export type MediaProblem = {
  kind: "locked" | "denied" | "busy" | "missing";
  device: "mic" | "cam";
};

const C = {
  card: "#FFFFFF",
  bg: "#F2F2F7",
  separator: "#E5E5EA",
  textPrimary: "#1C1C1E",
  medBlue: "#007AFF",
  red: "#FF3B30",
  redBg: "#FFEFEE",
  orange: "#FF9F0A",
  orangeBg: "#FFF6EB",
};

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

export default function MediaHelpModal({
  problem,
  onClose,
}: {
  problem: MediaProblem | null;
  onClose: () => void;
}) {
  if (!problem) return null;

  const devName = problem.device === "mic" ? "microphone" : "camera";

  // Opens the exact Windows Settings page for the failing device.
  // Uses the opener plugin (scoped to ms-settings:* in capabilities/default.json).
  const openSettings = () => {
    import("../utils/mediaPermissions").then((m) =>
      problem.device === "mic" ? m.openWindowsMicSettings() : m.openWindowsCamSettings()
    );
    onClose();
  };

  let icon = "🔒";
  let title = "";
  let body = "";
  let showSettingsBtn = false;

  if (problem.kind === "locked") {
    icon = "✋";
    title = `${problem.device === "mic" ? "Mic" : "Camera"} is locked`;
    body = "Raise your hand and wait for the trainer to allow it.";
  } else if (problem.kind === "denied") {
    icon = "🚫";
    title = `Windows is blocking the ${devName}`;
    body = `Open Windows Settings → Privacy & security → ${
      problem.device === "mic" ? "Microphone" : "Camera"
    }, and turn on "Let desktop apps access your ${devName}".`;
    showSettingsBtn = true;
  } else if (problem.kind === "busy") {
    icon = "📵";
    title = `${devName[0].toUpperCase() + devName.slice(1)} is in use`;
    body = "Another app (Zoom, Teams…) is using it. Close that app and try again.";
  } else {
    icon = "🔌";
    title = `No ${devName} found`;
    body = `Connect a ${devName} and try again.`;
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 2000,
        padding: 16,
        boxSizing: "border-box",
        fontFamily: FONT,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: C.card,
          borderRadius: 16,
          padding: 28,
          maxWidth: 380,
          width: "100%",
          textAlign: "center",
          boxShadow: "0 20px 50px rgba(0,0,0,0.2)",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            margin: "0 auto 14px",
            fontSize: 26,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: problem.kind === "denied" ? C.redBg : C.orangeBg,
          }}
        >
          {icon}
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: 18, fontWeight: 700, color: C.textPrimary }}>
          {title}
        </h3>
        <p style={{ margin: "0 0 20px", fontSize: 14, lineHeight: 1.5, color: "#3C3C43" }}>{body}</p>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: 12,
              background: C.bg,
              border: `1px solid ${C.separator}`,
              borderRadius: 12,
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              color: C.textPrimary,
            }}
          >
            Close
          </button>
          {showSettingsBtn && (
            <button
              onClick={openSettings}
              style={{
                flex: 1,
                padding: 12,
                background: C.medBlue,
                color: "#fff",
                border: "none",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 14,
                cursor: "pointer",
              }}
            >
              Open Settings
            </button>
          )}
        </div>
      </div>
    </div>
  );
}