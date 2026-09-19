// src/components/LogoutButton.tsx
import { useState } from "react";
import { supabase } from "../auth/supabase";
import { stopPeriodicPull } from "../database/sync";

export default function LogoutButton() {
    const [isHovered, setIsHovered] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    // ✅ FIX: Synchronous logout. Clears storage and hard refreshes immediately.
    const handleLogout = () => {
        if (isLoggingOut) return;
        setIsLoggingOut(true);
        
        // 1. Stop background sync and clear storage
        stopPeriodicPull();
        localStorage.removeItem("currentUser");
        localStorage.removeItem("authToken");
        localStorage.removeItem("activeTenantId");
        localStorage.removeItem("adminDeviceId");
        
        // 2. Fire and forget Supabase sign out
        supabase.auth.signOut().catch(err => console.warn(err));
        
        // 3. Immediately replace the page with /login. No history trace, no flashing.
        window.location.replace("/login");
    };

    const buttonStyle: React.CSSProperties = {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "8px",
        padding: "10px 18px",
        border: "none",
        borderRadius: "10px",
        background: isActive ? "#c82333" : isHovered ? "#c82333" : "#dc3545",
        color: "#fff",
        fontSize: "15px",
        fontWeight: "600",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
        cursor: isLoggingOut ? "not-allowed" : "pointer",
        transition: "all .25s ease",
        boxShadow: isHovered ? "0 6px 14px rgba(0,0,0,.2)" : "0 3px 8px rgba(0,0,0,.15)",
        transform: isActive ? "scale(.97)" : isHovered ? "translateY(-2px)" : "none",
        outline: "none",
        opacity: isLoggingOut ? 0.5 : 1
    };

    return (
        <button
            style={buttonStyle}
            onClick={handleLogout}
            onMouseEnter={() => !isLoggingOut && setIsHovered(true)}
            onMouseLeave={() => {
                setIsHovered(false);
                setIsActive(false);
            }}
            onMouseDown={() => !isLoggingOut && setIsActive(true)}
            onMouseUp={() => setIsActive(false)}
            disabled={isLoggingOut}
            title="Logout"
            aria-label="Logout"
        >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            {isLoggingOut ? "Signing out..." : "Logout"}
        </button>
    );
}