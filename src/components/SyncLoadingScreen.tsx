import { useEffect, useState } from "react";

const MEDICAL_BLUE = "#007AFF";

export default function SyncLoadingScreen({ onSyncComplete }: { onSyncComplete: () => void }) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const performSync = async () => {
      try {
        // --- INSTRUCTIONS ---
        // Replace this simulated loop with your actual Supabase & Local DB sync logic.
        // If your sync function returns a percentage, update the state using setProgress(progressValue)
        
        // Simulating sync progress for UI demonstration
        for (let i = 0; i <= 100; i += 5) {
          if (!isMounted) return;
          setProgress(i);
          // Simulate network/database delay (adjust or remove for real sync)
          await new Promise((resolve) => setTimeout(resolve, 80)); 
        }

        if (isMounted) {
          // Small delay at 100% before transitioning to login
          setTimeout(() => onSyncComplete(), 400);
        }
      } catch (error) {
        console.error("Synchronization failed:", error);
        // Proceed to login anyway, or handle offline mode appropriately
        if (isMounted) onSyncComplete();
      }
    };

    performSync();

    return () => {
      isMounted = false;
    };
  }, [onSyncComplete]);

  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#FFFFFF", // WhatsApp uses a clean white background for this
        fontFamily: "-apple-system, sans-serif",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* App Logo */}
      <img
        src="/applogo.png" // Ensure applogo.png is inside your /public folder
        alt="App Logo"
        style={{
          width: "96px",
          height: "96px",
          borderRadius: "20px",
          marginBottom: "32px",
          objectFit: "contain",
        }}
      />

      {/* Sync Text */}
      <h2 style={{ fontSize: "16px", fontWeight: "600", color: "#8E8E93", marginBottom: "24px" }}>
        Synchronizing Data
      </h2>

      {/* Thin Progress Bar Track */}
      <div
        style={{
          width: "180px",
          height: "3px",
          backgroundColor: "#E5E5EA",
          borderRadius: "3px",
          overflow: "hidden",
        }}
      >
        {/* Progress Bar Filler */}
        <div
          style={{
            width: `${progress}%`,
            height: "100%",
            backgroundColor: MEDICAL_BLUE,
            borderRadius: "3px",
            transition: "width 0.2s ease-out",
          }}
        />
      </div>
    </div>
  );
}