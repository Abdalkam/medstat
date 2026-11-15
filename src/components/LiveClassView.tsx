/* ============================================================================
 * src/components/LiveClassView.tsx
 * Renders the material that is live right now: PDF (page N), video, audio,
 * image — and a download card for PPTX/Word which browsers cannot render.
 *
 * Accepts EVERY source shape the app produces:
 *   - data: URLs                     ("data:application/pdf;base64,…")
 *   - raw base64                     ("JVBER…" / "iVBORw0KGgo…" / "SUQz…")
 *   - raw PDF text                   ("%PDF-1.7 …")
 *   - http(s) URLs                   (Supabase Storage signed/public URLs)
 *
 * FIXES over the previous version:
 *   1. PDFs / media are converted from base64 or data: URLs into Blob object
 *      URLs before being handed to <iframe>/<video>. Chrome and Safari are
 *      far more reliable rendering blob: PDFs inside an iframe than giant
 *      data: URLs (and raw "%PDF" text never worked at all).
 *   2. A small "Open in new tab" escape hatch sits on the PDF — iOS Safari
 *      cannot render PDFs in an iframe at all, so users can always get to
 *      the document.
 *   3. Image/PDF/audio sniffing from the base64 header when file_type is
 *      generic ("application/octet-stream").
 *   4. A dedicated "syncing" state when the material row is known but its
 *      file bytes have not arrived yet (large base64 rows take a moment).
 *   5. Office files hosted on http(s) get an optional in-browser preview via
 *      Microsoft's Office viewer (opt-in click; only for already-public URLs).
 * ========================================================================== */
import { useEffect, useMemo, useState } from "react";
import type { CourseMaterial } from "../types";

interface Props {
  material: CourseMaterial & { file_data?: string };
  page: number;
}

/* ---------------- source resolution helpers ---------------- */

function base64Body(value: string): string {
  return value.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
}

function isProbablyBase64(value: string): boolean {
  return value.length > 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

const IMAGE_BASE64_HEADERS = ["/9j/", "iVBORw0KGgo", "R0lGOD", "UklGR"]; // jpeg/png/gif/webp
const AUDIO_BASE64_HEADERS = ["SUQz", "//u"]; // mp3 (ID3 / frame sync)

function blobFrom(bytes: Uint8Array, mime: string): Blob {
  // Copy into a plain ArrayBuffer-backed view (TS 5.7+ BlobPart typing).
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type: mime });
}

function base64ToBlob(base64: string, mime: string): Blob | null {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return blobFrom(bytes, mime);
  } catch {
    return null;
  }
}

/* ---------------- component ---------------- */

export default function LiveClassView({ material, page }: Props) {
  // Aggressively check for file data. Sometimes it's mapped to file_data,
  // fileUrl, or file_url — accept all three (plus title/fileName fallbacks).
  const rawFileData: string =
    material.file_data || material.fileUrl || (material as { file_url?: string }).file_url || "";
  const fileType: string =
    material.fileType || (material as { file_type?: string }).file_type || "";
  const fileName: string =
    material.fileName || (material as { file_name?: string }).file_name || material.title || "file";

  // FIX: support direct URLs (Supabase Storage signed/public URLs) alongside
  // data: URLs and raw base64 — without this, URL-based materials never render.
  const isHttpUrl = rawFileData.startsWith("http");
  const isDataUrl = rawFileData.startsWith("data:");

  // ---- type detection (field first, then base64/data-URL header sniffing) --
  const isPdf =
    fileType.includes("pdf") ||
    rawFileData.startsWith("data:application/pdf") ||
    rawFileData.startsWith("JVBER") ||
    rawFileData.startsWith("%PDF");

  const isVideo =
    fileType.includes("video") || rawFileData.startsWith("data:video/");

  const isAudio =
    fileType.includes("audio") ||
    rawFileData.startsWith("data:audio/") ||
    (!isPdf && AUDIO_BASE64_HEADERS.some((h) => rawFileData.startsWith(h)));

  const isImage =
    fileType.includes("image") ||
    rawFileData.startsWith("data:image/") ||
    (!isPdf && !isVideo && !isAudio && IMAGE_BASE64_HEADERS.some((h) => rawFileData.startsWith(h)));

  const isPptx =
    fileType.includes("presentation") ||
    fileType.includes("powerpoint") ||
    fileType.includes("ppt") ||
    fileName.toLowerCase().endsWith(".pptx") ||
    fileName.toLowerCase().endsWith(".ppt");
  const isWord =
    fileType.includes("word") ||
    fileType.includes("officedocument.wordprocessingml") ||
    fileName.toLowerCase().endsWith(".docx") ||
    fileName.toLowerCase().endsWith(".doc");

  const mime = isPdf
    ? "application/pdf"
    : isVideo
      ? "video/mp4"
      : isAudio
        ? "audio/mpeg"
        : isImage
          ? "image/png"
          : "application/octet-stream";

  /* FIX: convert data:/base64/%PDF sources into a blob: object URL once per
   * payload. blob: URLs render far more reliably in iframes (PDF viewers)
   * and <video>/<audio> elements across Chrome / Edge / Safari / Firefox. */
  const [blobSrc, setBlobSrc] = useState<string>("");
  useEffect(() => {
    if (!rawFileData || isHttpUrl || !(isPdf || isVideo || isAudio || isImage)) {
      setBlobSrc("");
      return;
    }
    let cancelled = false;
    let created: string | null = null;

    (async () => {
      try {
        if (isDataUrl) {
          const res = await fetch(rawFileData); // data: URLs are fetchable
          created = URL.createObjectURL(await res.blob());
        } else if (rawFileData.startsWith("%PDF")) {
          // Raw PDF text (not base64) — encode the bytes directly.
          created = URL.createObjectURL(blobFrom(new TextEncoder().encode(rawFileData), mime));
        } else if (isProbablyBase64(rawFileData)) {
          created = URL.createObjectURL(base64ToBlob(base64Body(rawFileData), mime) as Blob);
        }
      } catch {
        created = null; // fall back to the inline src below
      }
      if (!cancelled && created) setBlobSrc(created);
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFileData]);

  const containerStyle: React.CSSProperties = {
    width: "100%",
    height: "100%",
    display: "flex",
    overflow: "hidden",
    borderRadius: "12px",
    background: "#FFFFFF",
  };

  /* The src a media element should use, given a preferred prefix fallback. */
  const resolvedSrc = useMemo(
    () =>
      blobSrc ||
      (isHttpUrl || isDataUrl
        ? rawFileData
        : isPdf
          ? `data:application/pdf;base64,${base64Body(rawFileData)}`
          : `data:${mime};base64,${base64Body(rawFileData)}`),
    [blobSrc, isHttpUrl, isDataUrl, isPdf, rawFileData, mime]
  );

  /* ---- material known but bytes not synced yet ---- */
  if (!rawFileData) {
    return (
      <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", background: "#F2F2F7" }}>
        <div style={{ textAlign: "center", color: "#1C1C1E", background: "#FFFFFF", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", maxWidth: "400px" }}>
          <div style={{ width: 48, height: 48, margin: "0 auto 16px", border: "4px solid rgba(10,132,255,0.2)", borderTopColor: "#0A84FF", borderRadius: "50%", animation: "lcvspin 0.9s linear infinite" }} />
          <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}>{material.title || "File"}</h3>
          <p style={{ margin: 0, fontSize: "14px", color: "#8E8E93" }}>Syncing file from the trainer… this can take a moment for large documents.</p>
        </div>
        <style>{`@keyframes lcvspin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  /* ---- PDF ---- */
  if (isPdf) {
    return (
      <div style={{ width: "100%", height: "100%", overflow: "hidden", background: "#FFFFFF", borderRadius: 0, position: "relative" }}>
        <iframe
          key={material.id}
          src={`${resolvedSrc}#page=${page}&zoom=page-width&view=FitH&toolbar=0&navpanes=0`}
          title={material.title || "PDF"}
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            outline: "none",
            display: "block",
            background: "#FFFFFF",
            colorScheme: "light",
          }}
          allowFullScreen
        />
        {/* FIX: iOS Safari cannot show PDFs inside an iframe — always give an
            escape hatch that opens the document in a real tab. */}
        <a
          href={resolvedSrc}
          target="_blank"
          rel="noreferrer"
          title="Open PDF in a new tab"
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 5,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 12px",
            background: "rgba(28,28,30,0.75)",
            backdropFilter: "blur(12px)",
            color: "#FFFFFF",
            borderRadius: 10,
            fontSize: 12,
            fontWeight: "600",
            textDecoration: "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Open PDF
        </a>
      </div>
    );
  }

  /* ---- Video ---- */
  if (isVideo) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center", background: "#000000" }}>
        <video
          key={material.id}
          src={resolvedSrc}
          controls
          autoPlay
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            border: "none",
            outline: "none",
            display: "block",
            borderRadius: "12px",
          }}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    );
  }

  /* ---- Audio ---- */
  if (isAudio) {
    return (
      <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", background: "#F2F2F7" }}>
        <div style={{ textAlign: "center", color: "#1C1C1E", background: "#FFFFFF", padding: "32px", borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)" }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill="#AF52DE" style={{ marginBottom: 16 }}>
            <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
          </svg>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "18px", fontWeight: "600" }}>{material.title || "Audio"}</h3>
          <audio src={resolvedSrc} controls autoPlay style={{ width: "300px", outline: "none" }}>
            Your browser does not support the audio element.
          </audio>
        </div>
      </div>
    );
  }

  /* ---- Image ---- */
  if (isImage) {
    return (
      <div style={{ ...containerStyle, background: "#FFFFFF" }}>
        <img
          key={material.id}
          src={resolvedSrc}
          alt={material.title || "Image"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            border: "none",
            outline: "none",
            display: "block",
            borderRadius: "12px",
          }}
        />
      </div>
    );
  }

  /* ---- PPTX / Word — not natively renderable in browsers ---- */
  if ((isPptx || isWord) && rawFileData) {
    const downloadSrc =
      isHttpUrl || isDataUrl
        ? rawFileData
        : isProbablyBase64(rawFileData)
          ? `data:application/octet-stream;base64,${base64Body(rawFileData)}`
          : rawFileData;
    const officeViewerSrc = isHttpUrl
      ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(resolvedSrc)}`
      : "";
    return (
      <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", background: "#F2F2F7" }}>
        <div style={{ textAlign: "center", color: "#1C1C1E", background: "#FFFFFF", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", maxWidth: "400px" }}>
          <svg width="64" height="64" viewBox="0 0 24 24" fill={isPptx ? "#FF9F0A" : "#0A84FF"} style={{ marginBottom: 16 }}>
            {isPptx ? (
              <path d="M4 5a2 2 0 0 1 2-2h8l6 6v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5z" opacity="0.9" />
            ) : (
              <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" opacity="0.9" />
            )}
          </svg>
          <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}>{material.title || "File"}</h3>
          <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#8E8E93" }}>Web browsers cannot natively render PowerPoint or Word files.</p>
          <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#8E8E93" }}>
            For the best live presentation experience, please upload <strong>PDFs</strong> or <strong>Images</strong>.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", alignItems: "center" }}>
            <a
              href={downloadSrc}
              download={fileName}
              target={isHttpUrl ? "_blank" : undefined}
              rel={isHttpUrl ? "noreferrer" : undefined}
              style={{
                display: "inline-block",
                padding: "12px 24px",
                background: "#0A84FF",
                color: "#fff",
                textDecoration: "none",
                borderRadius: "10px",
                fontWeight: "600",
                fontSize: "15px",
              }}
            >
              Download File
            </a>
            {officeViewerSrc && (
              <a
                href={officeViewerSrc}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: "13px", color: "#0A84FF", textDecoration: "none", fontWeight: "600" }}
              >
                Preview in browser (Office viewer)
              </a>
            )}
          </div>
        </div>
      </div>
    );
  }

  /* ---- Fallback ---- */
  return (
    <div style={{ ...containerStyle, justifyContent: "center", alignItems: "center", background: "#F2F2F7" }}>
      <div style={{ textAlign: "center", color: "#1C1C1E", background: "#FFFFFF", padding: "40px", borderRadius: "16px", boxShadow: "0 4px 12px rgba(0,0,0,0.05)", maxWidth: "400px" }}>
        <svg width="64" height="64" viewBox="0 0 24 24" fill="#8E8E93" style={{ marginBottom: 16 }}>
          <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5z" />
        </svg>
        <h3 style={{ margin: "0 0 8px 0", fontSize: "18px", fontWeight: "600" }}>{material.title || "File"}</h3>
        <p style={{ margin: "0 0 24px 0", fontSize: "14px", color: "#8E8E93" }}>Live preview is not available for this file type.</p>
      </div>
    </div>
  );
}
