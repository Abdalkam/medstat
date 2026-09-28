// src/utils/downloadMaterial.ts

export type DownloadStage =
  | "preparing" | "picking" | "saving" | "done" | "error" | "cancelled";

export interface DownloadProgress {
  stage: DownloadStage;
  percent: number;   // 0 – 100
  message: string;
  savedTo?: string;  // e.g. "notes.pdf", "Downloads"
  error?: string;
}

export interface DownloadResult {
  success: boolean;
  method: "file-picker" | "anchor" | "cancelled";
  savedTo?: string;
}

/** Chromium browsers let the user pick the exact location (Desktop, USB…). */
export const supportsSaveLocationPicker = () =>
  typeof window !== "undefined" && "showSaveFilePicker" in window;

function describeHandle(handle: any): string {
  try { if (handle?.name) return handle.name; } catch { /* ignore */ }
  return "your chosen folder";
}

function dataUrlToBlob(dataUrl: string, fallbackMime: string): Blob {
  const [meta, b64] = dataUrl.split(",");
  const mime = meta?.match(/data:(.*?)(;|$)/)?.[1] || fallbackMime || "application/octet-stream";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function toBlob(source: string, mime: string): Promise<Blob> {
  if (source.startsWith("data:")) return dataUrlToBlob(source, mime);
  const res = await fetch(source, { cache: "force-cache" });
  if (!res.ok) throw new Error("Could not fetch the file.");
  return res.blob();
}

/**
 * Downloads a material with visible progress. When the browser supports it,
 * a native save dialog opens so the user picks WHERE to store the file
 * (Desktop, Documents, USB drive…). Otherwise falls back to Downloads folder.
 */
export async function downloadMaterial(
  material: { fileName?: string; fileType?: string; fileUrl?: string; allowDownload?: boolean },
  onProgress?: (p: DownloadProgress) => void,
): Promise<DownloadResult> {
  const fileName = material.fileName || "download";
  const fileType = material.fileType || "application/octet-stream";
  const emit = (stage: DownloadStage, percent: number, message: string, extra?: Partial<DownloadProgress>) =>
    onProgress?.({ stage, percent, message, ...extra });

  if (material.allowDownload === false) {
    emit("error", 0, "The trainer has disabled downloads for this material.");
    return { success: false, method: "cancelled" };
  }
  if (!material.fileUrl) {
    emit("error", 0, "File data isn't available offline yet — reconnect and try again.");
    return { success: false, method: "cancelled" };
  }

  let handle: any = null;

  // 1) Open the "where do you want to save it?" dialog FIRST (needs a fresh user gesture)
  if (supportsSaveLocationPicker()) {
    emit("picking", 5, "Save dialog open — choose Desktop, Documents or your USB drive…");
    const ext = (fileName.split(".").pop() || "file").toLowerCase();
    try {
      handle = await (window as any).showSaveFilePicker({
        suggestedName: fileName,
        startIn: "desktop", // opens at Desktop; user can navigate to This PC → USB drive
        types: [{ description: "File", accept: { [fileType]: [`.${ext}`] } }],
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        emit("cancelled", 0, "Save cancelled.");
        return { success: false, method: "cancelled" };
      }
      handle = null; // picker failed → fall through to anchor
    }
  }

  try {
    // 2) Decode / fetch the data (offline-first: base64 comes from IndexedDB)
    emit("preparing", 25, "Loading file…");
    await new Promise((r) => setTimeout(r, 80)); // let the UI paint
    const blob = await toBlob(material.fileUrl, fileType);
    emit("preparing", 55, `Loaded ${(blob.size / 1024).toFixed(0)} KB`);

    // 3) Write it to the chosen location
    if (handle) {
      emit("saving", 70, `Saving to “${describeHandle(handle)}”…`);
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      const where = describeHandle(handle);
      emit("done", 100, `Saved to ${where}`, { savedTo: where });
      return { success: true, method: "file-picker", savedTo: where };
    }

    // 4) Fallback: classic download → browser's Downloads folder
    emit("saving", 75, "Saving to your Downloads folder…");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    emit("done", 100, "Saved to Downloads", { savedTo: "Downloads" });
    return { success: true, method: "anchor", savedTo: "Downloads" };
  } catch (err: any) {
    emit("error", 0, err?.message || "Download failed.");
    return { success: false, method: "cancelled" };
  }
}