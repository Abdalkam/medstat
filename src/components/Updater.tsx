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
        // update.available is the correct boolean in Tauri v2
        if (update?.available) {
          setUpdateAvailable(true);
        }
      } catch (error) {
        console.error("Failed to check for updates:", error);
      }
    };

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
          switch (event.event) {
            case 'Started':
              // total size is provided here!
              total = event.data.contentLength ?? 0;
              break;
            case 'Progress':
              // chunk size is provided here
              downloaded += event.data.chunkLength;
              if (total > 0) {
                setDownloadProgress(Math.round((downloaded / total) * 100));
              }
              break;
            case 'Finished':
              setDownloadProgress(100);
              break;
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

  // If no update is available, don't render anything
  if (!updateAvailable) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, right: 20, background: "#0A84FF", color: "white",
      padding: "16px 24px", borderRadius: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      zIndex: 9999, display: "flex", alignItems: "center", gap: 16
    }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>A new version is available!</div>
        {isUpdating && (
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Downloading... {downloadProgress}%
            {/* Visual loading bar */}
            <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.3)', borderRadius: 2, marginTop: 4 }}>
              <div style={{ width: `${downloadProgress}%`, height: '100%', background: 'white', borderRadius: 2 }} />
            </div>
          </div>
        )}
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