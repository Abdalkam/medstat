// src/components/AppLayout.tsx
import { Outlet } from "react-router-dom";
import AppBar from "./AppBar";
import type { User } from "../types";

const C = {
  bg: "#F2F2F7",
  textPrimary: "#1C1C1E",
};

interface Props {
  user: User | null;
}

export default function AppLayout({ user }: Props) {
  return (
    <div style={{
      height: "100dvh", width: "100%", display: "flex", flexDirection: "column",
      background: C.bg, fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      color: C.textPrimary, overflow: "hidden", boxSizing: "border-box",
    }}>
      {/* Shared app bar — one source of truth for logo, contact details and the user menu.
          It is offline-first (localStorage hydrates instantly, Supabase refreshes in background)
          and is re-mounted when the signed-in user changes so cached data is re-hydrated. */}
      <AppBar key={user?.id ?? "anonymous"} />

      <main style={{
        flex: 1, overflowY: "auto", overflowX: "hidden",
        WebkitOverflowScrolling: "touch", width: "100%", minHeight: 0, boxSizing: "border-box",
      }}>
        <Outlet />
      </main>
    </div>
  );
}
