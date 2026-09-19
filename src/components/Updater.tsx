// src/components/Updater.tsx
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export default function Updater() {
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update?.available) {
          setUpdateAvailable(true);
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };

    // ✅ FIX: Cast window to any to check for Tauri internals without TS errors
    if ((window as any).__TAURI_INTERNALS__) {
      checkForUpdates();
    }
  }, []);

  const handleUpdate = async () => {
    setIsUpdating(true);
    try {
      const update = await check();
      if (update) {
        let downloaded = 0;
        let total = 0;
        
        // Download and install
        await update.downloadAndInstall((event) => {
          // ✅ FIX: Cast event.data to any to safely access length properties
          if (event.event === "Progress") {
            const data = event.data as any;
            if (data.contentLength) total = data.contentLength;
            if (data.chunkLength) downloaded += data.chunkLength;
            
            if (total > 0) {
              setDownloadProgress(Math.round((downloaded / total) * 100));
            }
          }
        });
        
        // Restart the app after installation
        await relaunch();
      }
    } catch (error) {
      console.error("Failed to install update:", error);
      alert("Update failed. Please try again later.");
      setIsUpdating(false);
    }
  };

  if (!updateAvailable) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, background: "#0A84FF", color: "white",
      padding: "16px 24px", borderRadius: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      zIndex: 9999, display: "flex", alignItems: "center", gap: 16
    }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>A new version is available!</div>
        {isUpdating && <div style={{ fontSize: 13, opacity: 0.9 }}>Downloading... {downloadProgress}%</div>}
      </div>
      {!isUpdating && (
        <button 
          onClick={handleUpdate} 
          style={{
            background: "white", color: "#0A84FF", border: "none", borderRadius: 8,
            padding: "8px 16px", fontWeight: 700, cursor: "pointer"
          }}
        >
          Update Now
        </button>
      )}
    </div>
  );
}