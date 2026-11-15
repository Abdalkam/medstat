// src/components/LiveControls.tsx
import { useState } from "react";
import type { CourseMaterial } from "../types";

// Initialize Supabase client
import { supabase } from "../auth/supabase";

interface Props {
  courseId: string;
  trainerId: string;
  currentPage: number;
  materials: CourseMaterial[];
  onUpdate: () => void;
}

export default function LiveControls({ courseId, trainerId, materials, onUpdate }: Props) {
  const [loading, setLoading] = useState(false);

  async function changePage(direction: "next" | "prev") {
    setLoading(true);
    try {
      // Fetch current live session from Supabase
      const { data: live, error: fetchError } = await supabase
        .from("live_session")
        .select("*")
        .eq("course_id", courseId)
        .maybeSingle();

      if (fetchError) throw fetchError;
      if (!live || materials.length === 0) return;

      const currentIndex = materials.findIndex(m => m.id === live.material_id);
      if (currentIndex === -1) return;

      const newIndex = direction === "next" ? currentIndex + 1 : currentIndex - 1;

      if (newIndex >= 0 && newIndex < materials.length) {
        const newMaterialId = materials[newIndex].id;
        
        // Upsert the live session in Supabase
        const { error: updateError } = await supabase
          .from("live_session")
          .upsert({
            course_id: courseId,
            material_id: newMaterialId,
            trainer_id: trainerId,
            current_page: 1,
            updated_at: new Date().toISOString()
          }, { onConflict: 'course_id' }); // Assumes course_id is the unique constraint for a live session

        if (updateError) throw updateError;
        onUpdate();
      }
    } catch (error) {
      console.error("Failed to change page:", error);
    } finally {
      setLoading(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", padding: "8px", 
    border: "none", borderRadius: "8px", flex: 1, cursor: "pointer",
    transition: "background 0.2s ease, color 0.2s ease, transform 0.1s ease",
    WebkitTapHighlightColor: "transparent"
  };

  return (
    <div style={{ display: "flex", gap: "8px" }}>
      <button onClick={() => changePage("prev")} disabled={loading} className="page-nav-btn" style={{ ...btnStyle, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button onClick={() => changePage("next")} disabled={loading} className="page-nav-btn" style={{ ...btnStyle, opacity: loading ? 0.5 : 1, cursor: loading ? "not-allowed" : "pointer" }}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  );
}