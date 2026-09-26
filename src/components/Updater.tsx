// src/components/Updater.tsx
import { useEffect, useState } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export default function Updater() {
  const [status, setStatus] = useState("Idle...");

  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        setStatus("Checking GitHub...");
        const update = await check();
        
        if (update) {
          setStatus(`Update v${update.version} found! Downloading...`);
          await update.downloadAndInstall();
          setStatus("Installed! Relaunching...");
          await relaunch();
        } else {
          setStatus("App is up to date.");
        }
      } catch (err: any) {
        // Show the exact error on screen
        setStatus(`ERROR: ${err.message}`);
        console.error("Auto-update failed:", err);
      }
    };

    if ((window as any).__TAURI_INTERNALS__) {
      const timer = setTimeout(checkForUpdates, 3000);
      return () => clearTimeout(timer);
    } else {
      setStatus("Not a Tauri environment.");
    }
  }, []);

  return (
    <div style={{
      position: "fixed", bottom: "10px", right: "10px", 
      background: "rgba(0,0,0,0.85)", color: "#0f0", 
      padding: "10px 14px", borderRadius: "8px", 
      fontSize: "12px", fontFamily: "monospace", 
      zIndex: 999999, maxWidth: "350px", boxShadow: "0 4px 10px rgba(0,0,0,0.5)"
    }}>
      Updater: {status}
    </div>
  );
}