// src/database/livePresentationDB.ts
// Local (Dexie) mirror of the shared live_presentations state: which material
// is on screen, the current PDF page, and the blackboard ink/labels.
import { db } from "./db";
import type { LivePresentation } from "../types";

/* Default per-device layout, applied when a course has no saved state yet. */
const DEFAULT_LAYOUT = {
  zoom: 1,
  fullscreen: false,
  sidebarWidth: 280,
  chatWidth: 320,
  presentationHeight: 700,
  showSidebar: true,
  showChat: true,
} as const;

// =============================
// START / UPDATE PRESENTATION
// =============================
export async function startPresentation(
  courseId: string,
  materialId: string,
  trainerId: string
): Promise<LivePresentation> {
  const existing = await getLivePresentation(courseId);

  /* Re-entering the SAME material (page refresh, accidental exit) must not
   * wipe the blackboard ink — carry it over. A genuinely new material starts
   * with a clean board. The page always resets to 1 (strict reset). */
  const sameMaterial = existing?.materialId === materialId;

  const presentation: LivePresentation = {
    id: existing?.id ?? crypto.randomUUID(),
    courseId,
    materialId,
    startedBy: trainerId,
    updatedAt: new Date().toISOString(),

    // STRICT RESET: Always reset to page 1 when a new presentation starts
    currentPage: 1,

    // Required board state — preserved when restarting the same material
    isBlackboard: sameMaterial ? (existing?.isBlackboard ?? false) : false,
    blackboardStrokes: sameMaterial ? (existing?.blackboardStrokes ?? []) : [],
    blackboardLines: sameMaterial ? (existing?.blackboardLines ?? []) : [],
    blackboardLabels: sameMaterial ? (existing?.blackboardLabels ?? []) : [],
    tenantId: existing?.tenantId,

    // Per-device layout, remembered across sessions
    zoom: existing?.zoom ?? DEFAULT_LAYOUT.zoom,
    fullscreen: existing?.fullscreen ?? DEFAULT_LAYOUT.fullscreen,
    sidebarWidth: existing?.sidebarWidth ?? DEFAULT_LAYOUT.sidebarWidth,
    chatWidth: existing?.chatWidth ?? DEFAULT_LAYOUT.chatWidth,
    presentationHeight: existing?.presentationHeight ?? DEFAULT_LAYOUT.presentationHeight,
    showSidebar: existing?.showSidebar ?? DEFAULT_LAYOUT.showSidebar,
    showChat: existing?.showChat ?? DEFAULT_LAYOUT.showChat,
  };

  await db.livePresentations.put(presentation);
  return presentation;
}

// =============================
// GET LIVE PRESENTATION
// =============================
export async function getLivePresentation(courseId: string): Promise<LivePresentation | undefined> {
  return db.livePresentations.where("courseId").equals(courseId).first();
}

// =============================
// UPDATE PRESENTATION
// =============================
export async function updatePresentation(presentation: LivePresentation): Promise<void> {
  await db.livePresentations.put({
    ...presentation,
    updatedAt: new Date().toISOString(),
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
    updatedAt: new Date().toISOString(),
  };

  await db.livePresentations.put(updated);
}

// =============================
// CLEAR PRESENTATION
// =============================
/* Removes every local row for the course (guards against duplicate rows
 * left behind by older versions of startPresentation). */
export async function clearPresentation(courseId: string): Promise<void> {
  const rows = await db.livePresentations.where("courseId").equals(courseId).toArray();
  await db.livePresentations.bulkDelete(rows.map((row) => row.id));
}

// =============================
// STOP PRESENTATION (Alias)
// =============================
export async function stopPresentation(courseId: string): Promise<void> {
  await clearPresentation(courseId);
}
