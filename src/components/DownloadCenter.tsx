// src/components/DownloadCenter.tsx
import { useEffect, useRef, useState } from "react";
import { downloadMaterial, supportsSaveLocationPicker, type DownloadProgress } from "../utils/downloadMaterial";

const C = {
  textPrimary: "#1C1C1E", textTertiary: "#8E8E93", bg: "#F2F2F7", card: "#FFFFFF",
  separator: "#E5E5EA", separatorLight: "#F0F0F2", medBlue: "#0A84FF", medBlueBg: "#E8F2FF",
  green: "#34C759", greenBg: "#EAF9EE", red: "#FF3B30", redBg: "#FFEFEE", orange: "#FF9F0A", orangeBg: "#FFF6EB",
};

export interface DownloadFileMeta { id: string; fileName: string; fileType: string; }
export interface ResolvedMaterial { fileName: string; fileType: string; fileUrl: string; allowDownload?: boolean; }

interface Props {
  open: boolean;
  files: DownloadFileMeta[];
  resolveMaterial: (file: DownloadFileMeta) => Promise<ResolvedMaterial | null>;
  autoStartId?: string | null;
  onClose: () => void;
}

function fileIcon(fileType: string) {
  if (fileType.includes("pdf")) return "📄";
  if (fileType.includes("video")) return "🎬";
  if (fileType.includes("audio")) return "🎵";
  if (fileType.includes("image")) return "🖼️";
  return "📁";
}

export default function DownloadCenter({ open, files, resolveMaterial, autoStartId, onClose }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({});
  const autoStartedRef = useRef<string | null>(null);

  const startDownload = async (file: DownloadFileMeta) => {
    if (activeId) return;
    setActiveId(file.id);
    setProgress((p) => ({ ...p, [file.id]: { stage: "preparing", percent: 0, message: "Preparing…" } }));

    const mat = await resolveMaterial(file);
    if (!mat || !mat.fileUrl) {
      setProgress((p) => ({ ...p, [file.id]: { stage: "error", percent: 0, message: "File isn't available offline yet — reconnect and try again." } }));
      setActiveId(null);
      return;
    }

    await downloadMaterial(mat, (prog) => setProgress((prev) => ({ ...prev, [file.id]: prog })));
    setActiveId(null);
  };

  useEffect(() => {
    if (open && autoStartId && autoStartedRef.current !== autoStartId) {
      autoStartedRef.current = autoStartId;
      const f = files.find((x) => x.id === autoStartId);
      if (f) startDownload(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoStartId, files]);

  if (!open) return null;

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2000, padding: 16, boxSizing: "border-box" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.card, borderRadius: 24, width: "100%", maxWidth: 480, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 50px rgba(0,0,0,0.25)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px 12px", borderBottom: `1px solid ${C.separatorLight}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: C.textPrimary }}>📥 Download Course Files</h2>
            <button onClick={onClose} style={{ background: C.bg, border: "none", width: 32, height: 32, borderRadius: "50%", cursor: "pointer", color: C.textTertiary, fontSize: 16 }}>✕</button>
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: C.textTertiary }}>
            {supportsSaveLocationPicker()
              ? "When downloading, a save window opens — choose Desktop, Documents, or your USB drive (This PC → USB (E:))."
              : "Files are saved to your browser's Downloads folder."}
          </p>
        </div>

        {/* File list */}
        <div style={{ padding: 16, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
          {files.length === 0 && <p style={{ textAlign: "center", color: C.textTertiary, padding: 24 }}>No files available yet.</p>}
          {files.map((file) => {
            const prog = progress[file.id];
            const busy = prog && !["done", "error", "cancelled"].includes(prog.stage);
            return (
              <div key={file.id} style={{ background: C.bg, borderRadius: 14, padding: "12px 14px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: C.card, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{fileIcon(file.fileType)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: C.textPrimary, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{file.fileName}</div>
                    <div style={{ fontSize: 12, color: C.textTertiary }}>
                      {prog ? prog.message : file.fileType.split("/")[0] || "file"}
                    </div>
                  </div>
                  <button
                    onClick={() => startDownload(file)}
                    disabled={!!activeId || busy}
                    style={{ background: prog?.stage === "done" ? C.greenBg : C.medBlueBg, color: prog?.stage === "done" ? C.green : C.medBlue, border: "none", borderRadius: 10, padding: "8px 14px", fontWeight: 600, fontSize: 13, cursor: activeId && activeId !== file.id ? "default" : "pointer", opacity: activeId && activeId !== file.id ? 0.5 : 1, flexShrink: 0 }}
                  >
                    {prog?.stage === "done" ? "✓ Saved" : prog?.stage === "error" ? "Retry" : "Download"}
                  </button>
                </div>

                {/* Progress bar */}
                {prog && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ height: 6, background: C.separator, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${prog.percent}%`, height: "100%", borderRadius: 3, background: prog.stage === "done" ? C.green : prog.stage === "error" ? C.red : prog.stage === "picking" ? C.orange : C.medBlue, transition: "width 0.3s ease" }} />
                    </div>
                    {prog.stage === "picking" && <div style={{ fontSize: 12, color: C.orange, fontWeight: 600, marginTop: 6 }}>💾 A save window is open — pick where to store it (Desktop / USB…)</div>}
                    {prog.stage === "done" && <div style={{ fontSize: 12, color: C.green, fontWeight: 600, marginTop: 6 }}>✅ {prog.savedTo ? `Saved to “${prog.savedTo}”` : "Saved"}</div>}
                    {prog.stage === "error" && <div style={{ fontSize: 12, color: C.red, fontWeight: 600, marginTop: 6 }}>⚠️ {prog.message}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}