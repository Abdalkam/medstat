// src/components/UpdateListener.tsx
import { useEffect } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

export default function UpdateListener() {
    const {
        needRefresh: [needRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        // Add an underscore _ to swUrl
        onRegisteredSW(_swUrl, r) {
            console.log("Service Worker Registered");
            // Check for updates every hour
            if (r) {
                setInterval(() => {
                    r.update();
                }, 60 * 60 * 1000); // 1 hour
            }
        },
        onRegisterError(error) {
            console.error("SW registration error", error);
        },
    });

    // Automatically reload the page when a new version is downloaded
    useEffect(() => {
        if (needRefresh) {
            console.log("New version downloaded, applying update...");
            updateServiceWorker(true); // true triggers the page reload
        }
    }, [needRefresh, updateServiceWorker]);

    return null; // This component runs invisibly in the background
}