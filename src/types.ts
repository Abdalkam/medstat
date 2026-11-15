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
  /* offline-sync bookkeeping (Dexie createHook sets it to false on create,
   * sync jobs flip it to true after a successful Supabase push) */
  synced?: boolean;
  /* tuition ledger for learners — amounts may arrive as strings from forms,
   * consumers run parseFloat(String(x || "0")) so both types are allowed */
  tuition?: { expected?: number | string; paid?: number | string };
  /* trainer pay ledger (UserManagement.tsx sync/export view) */
  remuneration?: { netSalary?: number | string; perDiem?: number | string };
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

/* ============================================================================
 * App-domain types shared by the admin/trainer screens and the offline-first
 * Dexie layer (courseDB, enrollmentDB, assignmentDB, scheduleDB,
 * supabaseCourseSync). They are intentionally permissive:
 *   - every field is optional, because sync code builds partial rows from
 *     Supabase responses before hydrating them;
 *   - an index signature keeps the many screens that read/write these rows
 *     compiling while the shapes are being tightened field by field.
 * `id` is the Dexie primary key for each of these tables.
 * ========================================================================== */

export interface Course {
  [key: string]: any;
  id?: string;
  title?: string;
  name?: string;
  description?: string;
  tenantId?: string;
  status?: string;
  coverImage?: string;
  assignedTrainers?: string[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Enrollment {
  [key: string]: any;
  id?: string;
  courseId?: string;
  userId?: string;
  username?: string;
  tenantId?: string;
  status?: string;
  progress?: number;
  enrolledAt?: string;
  completedAt?: string;
}

export interface AssignmentField {
  [key: string]: any;
  id?: string;
  assignmentId?: string;
  label?: string;
  name?: string;
  type?: string; // "text" | "number" | "date" | "select" | ...
  required?: boolean;
  options?: string[];
  order?: number;
  placeholder?: string;
}

export interface Assignment {
  [key: string]: any;
  id?: string;
  courseId?: string;
  title?: string;
  description?: string;
  dueDate?: string;
  maxScore?: number;
  fields?: AssignmentField[];
  createdBy?: string;
  tenantId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AssignmentSubmission {
  [key: string]: any;
  id?: string;
  assignmentId?: string;
  userId?: string;
  username?: string;
  values?: Record<string, unknown>; // answers keyed by AssignmentField id
  submittedAt?: string;
  status?: string;
  score?: number;
  feedback?: string;
  tenantId?: string;
}

export interface Schedule {
  [key: string]: any;
  id?: string;
  courseId?: string;
  trainerId?: string;
  title?: string;
  day?: string;
  startTime?: string;
  endTime?: string;
  startDate?: string;
  endDate?: string;
  recurring?: boolean;
  tenantId?: string;
  createdAt?: string;
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
  /* optional: supabaseCourseSync and UploadMaterials build materials from
   * forms/remote rows where tenant scoping and presentation flags are set
   * later by the trainer screen */
  tenantId?: string;
  title: string;
  description: string;
  fileUrl: string;
  fileName: string;
  fileType: string; // MIME type, e.g. "application/pdf"
  allowDownload: boolean;
  uploadedBy: string;
  uploadedAt: string;
  isPresentation?: boolean;
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
  /* per-device UI state persisted by livePresentationDB so the trainer can
   * reload mid-lesson without losing the layout */
  zoom?: number;
  fullscreen?: boolean;
  sidebarWidth?: number;
  chatWidth?: number;
  presentationHeight?: number;
  showSidebar?: boolean;
  showChat?: boolean;
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
