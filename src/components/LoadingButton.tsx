// src/components/LoadingButton.tsx
// Shared auth button with a progressive loading bar rendered UNDER the
// button (not overlaid inside it), so the label is never overlapped.
import type React from "react";

const BLUE = "#007AFF";

export default function LoadingButton({
  loading,
  children,
  loadingLabel = "Please wait…",
  onClick,
  disabled,
  type = "button",
  style,
}: {
  loading?: boolean;
  children: React.ReactNode;
  loadingLabel?: string;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  style?: React.CSSProperties;
}) {
  const btn: React.CSSProperties = {
    width: "100%", padding: "16px", borderRadius: 14, border: "none",
    background: loading ? "#EAF3FF" : BLUE,
    color: loading ? BLUE : "#fff",
    fontSize: 17, fontWeight: 600,
    cursor: loading ? "default" : "pointer",
    transition: "background 0.2s ease, color 0.2s ease",
    display: "block",
  };
  return (
    <div style={{ width: "100%" }}>
      <style>{`@keyframes authSlide { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
      <button type={type} onClick={onClick} disabled={loading || disabled} style={{ ...btn, ...(style || {}) }}>
        {loading ? loadingLabel : children}
      </button>
      {loading && (
        <div style={{ width: "100%", height: 3, background: "rgba(0,122,255,0.15)", borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
          <div style={{ height: "100%", width: "40%", background: BLUE, borderRadius: 2, animation: "authSlide 1.2s ease-in-out infinite" }} />
        </div>
      )}
    </div>
  );
}