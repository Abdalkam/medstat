// src/components/Updater.tsx
import { useEffect, useRef } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

const CHECK_DELAY_MS = 5000;              // first check 5s after launch
const RETRY_INTERVAL_MS = 60 * 60 * 1000; // re-check hourly

export default function Updater() {
  const checkingRef = useRef(false);

  useEffect(() => {
    if (!(window as any).__TAURI_INTERNALS__) return;

    let cancelled = false;

    const run = async () => {
      if (checkingRef.current || cancelled) return;
      checkingRef.current = true;
      try {
        const update = await check();

        if (cancelled) return;

        if (!update) {
          console.log("[updater] App is up to date.");
          return;
        }

        console.log(`[updater] Update v${update.version} found — downloading silently...`);

        let received = 0;
        let total = 0;
        await update.downloadAndInstall((event) => {
          if (event.event === "Started") {
            total = event.data.contentLength ?? 0;
            console.log(`[updater] Download started (${(total / 1e6).toFixed(1)} MB)`);
          } else if (event.event === "Progress") {
            received += event.data.chunkLength;
            if (total > 0 && Math.random() < 0.1) {
              console.log(`[updater] ${Math.round((received / total) * 100)}%`);
            }
          } else if (event.event === "Finished") {
            console.log("[updater] Download finished — installing...");
          }
        });

        console.log("[updater] Installed. Relaunching...");
        await relaunch();
      } catch (err) {
        // THE important line — prints the real reason (404, permission denied,
        // plugin not registered, signature mismatch...) instead of dying silently
        console.error("[updater] Auto-update failed:", err);
      } finally {
        checkingRef.current = false;
      }
    };

    const first = setTimeout(run, CHECK_DELAY_MS);
    const interval = setInterval(run, RETRY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(first);
      clearInterval(interval);
    };
  }, []);

  return null;
}