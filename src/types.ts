/* ============================================================================
 * src/types.ts — shared types for the live classroom.
 * Kept in lock-step with the columns of the Supabase tables created by
 * supabase/live-classroom-schema.sql.
 * ========================================================================== */

export type UserRole = "trainer" | "trainee" | "admin";

export interface User {
  id: string;
  username: string;
  email: string;
  password?: string;
  role: UserRole;
  profilePic?: string;
  phone?: string;
  assignedCourses?: string[];
  tenantId: string;
  createdAt?: string;
}

/* A person currently connected to the live classroom (used by
 * components/LiveSidebar.tsx and the realtime presence channel).
 * `handRaised` / `lastHandRaiseTime` go together: the trainer screen sets
 * both when a learner presses "raise hand", and LiveSidebar formats the
 * timestamp with its timeAgo(number) helper — so lastHandRaiseTime is a
 * required number even while the hand is down (use 0 = no raise yet). */
export interface Participant {
  id: string;
  username: string;
  /** true while the learner's hand is raised */
  handRaised: boolean;
  /** epoch ms of the last "raise hand" press (0 if never) */
  lastHandRaiseTime: number;
  /** true while Daily reports active audio levels for this user */
  speaking: boolean;
  /* optional extras the room state may carry */
  role?: UserRole;
  micAllowed?: boolean;
  cameraAllowed?: boolean;
  avatarUrl?: string;
  joinedAt?: string;
}

/* A lesson file uploaded for a course. `fileUrl` may be:
 *   - a data: URL            ("data:application/pdf;base64,JVBERi…")
 *   - a raw base64 payload   ("JVBERi…" — converted by LiveClassView)
 *   - an http(s) URL         (Supabase Storage signed/public URL)
 * depending on how the material was uploaded. LiveClassView accepts all of
 * them (see LiveClassView.tsx). */
export interface CourseMaterial {
  id: string;
  courseId: string;
  tenantId: string;
  title: string;
  description: string;
  fileUrl: string;
  fileName: string;
  fileType: string; // MIME type, e.g. "application/pdf"
  allowDownload: boolean;
  uploadedBy: string;
  uploadedAt: string;
  isPresentation: boolean;
  presentationOrder: number;
}

/* Stroke points are stored in PIXELS of the blackboard's 1280×720 bitmap.
 * The canvas blackboard (DrawingBlackboard.tsx) captures them through the
 * letterboxed bitmap rect, so the same stored points render identically on
 * the trainer's desktop and a learner's phone (the bitmap is scaled with
 * object-fit: contain, aspect ratio always preserved). */
export interface StrokePoint {
  x: number; // 0–1280
  y: number; // 0–720
}

export interface Stroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
  tool: "pen" | "eraser" | "text" | "line";
}

/* Named text labels for the canvas blackboard (DrawingBlackboard "text"
 * tool — used to name parts of a drawing). Stored in
 * live_presentations.blackboard_labels (jsonb). x/y are pixels of the
 * 1280×720 bitmap; the label is placed/edited/dragged directly on the board
 * and committed through TrainerLiveClassroom.handleTextUpsert (upsert by id). */
export interface BlackboardLabel {
  id: string;
  x: number;
  y: number;
  text: string;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  fontWeight: string;
  fontStyle: string;
}

/* One row of the `live_presentations` table — the shared "what is on
 * screen right now" state that both the trainer and every learner poll /
 * receive realtime updates for. */
export interface LivePresentation {
  id: string;
  courseId: string;
  materialId: string;
  isBlackboard: boolean;
  blackboardStrokes: Stroke[];
  blackboardLines: string[];
  blackboardLabels?: BlackboardLabel[];
  currentPage: number; // PDF page pushed to LiveClassView (#page=N)
  tenantId?: string;
  startedBy?: string;
  updatedAt?: string;
}

/* One row of the `live_session` table. */
export interface LiveSession {
  id: string;
  courseId: string;
  trainerId: string;
  active: boolean;
  startedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  tenantId?: string;
}

export interface BusinessSettings {
  id?: string;
  businessName: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  header?: string;
  adminProfile?: string;
  loginBackground?: string;
  themeColor?: string;
  appBarItems?: unknown[];
  tenantId?: string;
  createdAt?: string;
}

/* One row of the `class_chat` table (used by components/ClassChat.tsx). */
export interface ChatMessage {
  id: string;
  courseId: string;
  tenantId?: string;
  userId: string;
  username: string;
  role?: string;
  text: string;
  createdAt: string;
}
