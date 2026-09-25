// src/components/Updater.tsx
import { useEffect } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export default function Updater() {
  useEffect(() => {
    const checkForUpdates = async () => {
      try {
        const update = await check();
        
        // If an update is available, download and install it SILENTLY
        if (update) {
          await update.downloadAndInstall();
          await relaunch();
        }
      } catch (err) {
        // Silently fail in the background without bothering the user
        console.error("Auto-update failed:", err);
      }
    };

    // Only run if inside the Tauri desktop app
    if ((window as any).__TAURI_INTERNALS__) {
      // Wait 5 seconds after app opens before checking
      const timer = setTimeout(checkForUpdates, 5000);
      return () => clearTimeout(timer);
    }
  }, []);

  // This component returns nothing, so it will never show a progress bar or text!
  return null;
}