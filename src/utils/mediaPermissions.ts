// src/utils/mediaPermissions.ts
// Device-permission utilities for the live classroom.
//
// Why this exists:
//   Tauri's WebView2 prompt is auto-granted via --use-fake-ui-for-media-stream
//   (tauri.conf.json), but the WINDOWS OS privacy toggle is a separate layer.
//   If "Let desktop apps access your camera/microphone" is off in Windows
//   Settings, getUserMedia fails silently. This file:
//     1. probeDevice()      — pre-flight test that classifies WHY a device
//                             can't start (denied / busy / missing / ok)
//     2. openWindows*Settings() — deep-links the user to the exact Settings
//                             page via the Tauri opener plugin (ms-settings:*)
//
// This is a browser/OS utility — it does NOT touch Supabase or IndexedDB.

import { openUrl } from "@tauri-apps/plugin-opener";

export type DeviceProbe = "ok" | "denied" | "busy" | "missing";

// Pre-flight probe — tells you WHY a device can't start, not just that it failed.
// The stream is opened and immediately closed; no data is captured or stored.
export async function probeDevice(kind: "audio" | "video"): Promise<DeviceProbe> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(
      kind === "audio" ? { audio: true } : { video: true }
    );
    stream.getTracks().forEach((t) => t.stop());
    return "ok";
  } catch (e: any) {
    switch (e?.name) {
      case "NotAllowedError":
      case "SecurityError":
        return "denied";   // Windows privacy toggle off (or GPO-locked)
      case "NotReadableError":
      case "TrackStartError":
        return "busy";     // another app (Zoom/Teams) holds the device
      case "NotFoundError":
      case "OverconstrainedError":
      default:
        return "missing";  // no device attached
    }
  }
}

// Opens the exact Windows Settings page for the failing device.
// Allowed by capabilities/default.json: "opener:allow-open-url" scoped to ms-settings:*
export function openWindowsMicSettings() {
  return openUrl("ms-settings:privacy-microphone");
}

export function openWindowsCamSettings() {
  return openUrl("ms-settings:privacy-webcam");
}