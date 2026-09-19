// src/database/livePresentationDB.ts
import { db } from "./db";
import type { LivePresentation } from "../types";

// =============================
// START / UPDATE PRESENTATION
// =============================
export async function startPresentation(courseId: string, materialId: string, trainerId: string): Promise<void> {
    const existing = await getLivePresentation(courseId);

    const presentation: LivePresentation = {
        id: existing?.id ?? crypto.randomUUID(),
        courseId,
        materialId,
        startedBy: trainerId,
        updatedAt: new Date().toISOString(),
        
        // STRICT RESET: Always reset to page 1 when a new presentation starts
        currentPage: 1, 
        
        zoom: existing?.zoom ?? 1,
        fullscreen: existing?.fullscreen ?? false,
        sidebarWidth: existing?.sidebarWidth ?? 280,
        chatWidth: existing?.chatWidth ?? 320,
        presentationHeight: existing?.presentationHeight ?? 700,
        showSidebar: existing?.showSidebar ?? true,
        showChat: existing?.showChat ?? true
    };

    await db.livePresentations.put(presentation);
}

// =============================
// GET LIVE PRESENTATION
// =============================
export async function getLivePresentation(courseId: string): Promise<LivePresentation | undefined> {
    return await db.livePresentations.where("courseId").equals(courseId).first();
}

// =============================
// UPDATE PRESENTATION
// =============================
export async function updatePresentation(presentation: LivePresentation): Promise<void> {
    await db.livePresentations.put({
        ...presentation,
        updatedAt: new Date().toISOString()
    });
}

// =============================
// CHANGE PAGE
// =============================
export async function setPresentationPage(courseId: string, page: number): Promise<void> {
    const presentation = await getLivePresentation(courseId);
    if (!presentation) return;

    presentation.currentPage = page;
    await updatePresentation(presentation);
}

// =============================
// CHANGE ZOOM
// =============================
export async function setPresentationZoom(courseId: string, zoom: number): Promise<void> {
    const presentation = await getLivePresentation(courseId);
    if (!presentation) return;

    presentation.zoom = zoom;
    await updatePresentation(presentation);
}

// =============================
// FULLSCREEN
// =============================
export async function setPresentationFullscreen(courseId: string, fullscreen: boolean): Promise<void> {
    const presentation = await getLivePresentation(courseId);
    if (!presentation) return;

    presentation.fullscreen = fullscreen;
    await updatePresentation(presentation);
}

// =============================
// UPDATE LAYOUT
// =============================
export async function updatePresentationLayout(
    courseId: string,
    layout: {
        sidebarWidth?: number;
        chatWidth?: number;
        presentationHeight?: number;
        showSidebar?: boolean;
        showChat?: boolean;
    }
): Promise<void> {
    const presentation = await getLivePresentation(courseId);
    if (!presentation) return;

    const updated: LivePresentation = {
        ...presentation,
        ...layout,
        updatedAt: new Date().toISOString()
    };

    await db.livePresentations.put(updated);
}

// =============================
// CLEAR PRESENTATION
// =============================
export async function clearPresentation(courseId: string): Promise<void> {
    const presentation = await getLivePresentation(courseId);
    if (!presentation) return;

    await db.livePresentations.delete(presentation.id);
}

// =============================
// STOP PRESENTATION (Alias)
// =============================
export async function stopPresentation(courseId: string): Promise<void> {
    await clearPresentation(courseId);
}