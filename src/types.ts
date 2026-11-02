
export interface User {
  id: string;
  tenantId?: string;
  username: string;
  email?: string;
  phone?: string;
  password: string;
  role: "admin" | "trainer" | "trainee";
  assignedCourses?: string[];
  assignedDepartments?: string[];
  profilePic?: string;
  createdAt?: string;
  synced?: boolean;
  tuition?: {
    expected: number;
    paid: number;
  };
  remuneration?: {
    netSalary?: number;
    perDiem?: number;
    net_salary?: number;
    per_diem?: number;
  };
}

export interface Tenant {
  id: string;
  phone: string;
  businessName: string;
  accountNumber?: string;
  status?: string;
  createdAt?: string;
}

export interface Course {
  id: string;
  tenantId?: string;
  name: string;
  description?: string;
  tuitionType?: "free" | "paid";
  amount?: number;
  startDate?: string;
  period?: string;
  logo?: string;
  imageUrl?: string;
  mediaUrl?: string;
  mediaType?: string;
  mediaName?: string;
  trainerId?: string;
  category?: string;
  createdAt?: string;
  synced?: boolean;
}

export interface CourseMaterial {
  id: string;
  courseId: string;
  tenantId?: string;
  title: string;
  description?: string;
  fileUrl?: string;
  fileName?: string;
  fileType?: string;
  fileData?: string;
  allowDownload?: boolean;
  uploadedBy?: string;
  uploadedAt?: string;
  isPresentation?: boolean;
  presentationOrder?: number;
  synced?: boolean;
  createdAt?: string;
}

export interface Enrollment {
  id: string;
  tenantId?: string;
  courseId: string;
  userId: string;
  role?: "admin" | "trainer" | "trainee";
  enrolledAt?: string;
  status?: string;
  createdAt?: string;
  synced?: boolean;
}

export interface LiveSession {
  id: string;
  tenantId?: string;
  courseId: string;
  trainerId: string;
  active: boolean;
  startedAt?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface Stroke {
  id: string;
  points: { x: number; y: number }[];
  color?: string;
  width?: number;
  tool?: "pen" | "eraser" | "text";
}

export interface LivePresentation {
  id: string;
  tenantId?: string;
  courseId: string;
  materialId?: string;
  isBlackboard?: boolean;
  blackboardLines?: string[];
  blackboardStrokes?: Stroke[];
  blackboardLabels?: {
    text: string;
    x: number;
    y: number;
  }[];
  startedBy?: string;
  updatedAt?: string;
  currentPage?: number;
  zoom?: number;
  fullscreen?: boolean;
  sidebarWidth?: number;
  chatWidth?: number;
  presentationHeight?: number;
  showSidebar?: boolean;
  showChat?: boolean;
}

export interface ChatMessage {
  id: string;
  tenantId?: string;
  courseId: string;
  userId: string;
  username: string;
  message: string;
  createdAt?: string;
  imageUrl?: string | null;
}

export interface BusinessSettings {
  id?: string;
  tenantId?: string;
  businessName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  header?: string;
  adminProfile?: string;
  loginBackground?: string;
  themeColor?: string;
  appBarItems?: string[];
  createdAt?: string;
  [key: string]: any;
}

export type AssignmentFieldType =
  | "text"
  | "paragraph"
  | "dropdown"
  | "checkbox"
  | "toggle"
  | "file"
  | "note"
  | "header";

export interface Assignment {
  id: string;
  tenantId?: string;
  courseId: string;
  trainerId: string;
  title: string;
  description?: string;
  dueDate?: string;
  allowDownload?: boolean;
  videoUrl?: string;
  audioUrl?: string;
  status?: "draft" | "published" | "closed";
  passmark?: number;
  createdAt?: string;
  updatedAt?: string;
  synced?: boolean;
}

export interface AssignmentField {
  id: string;
  tenantId?: string;
  assignmentId: string;
  type: AssignmentFieldType | string;
  label?: string;
  required?: boolean;
  options?: string[];
  fileTypes?: string[];
  x?: number;
  y?: number;
  blocksNext?: boolean;
  blockMessage?: string;
  sortOrder?: number;
  maxChars?: number;
  points?: number;
  placeholder?: string;
  correctAnswer?: string;
  pageId?: string;
  fileUrl?: string;
  createdAt?: string;
}

export interface AssignmentSubmission {
  id: string;
  tenantId?: string;
  assignmentId?: string;
  userId?: string;
  username?: string;
  submittedAt?: string;
  answers?: Record<string, any>;
  marks?: Record<string, any>;
  questionNotes?: Record<string, any>;
  grade?: string;
  feedback?: string;
  gradedBy?: string;
  gradedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  synced?: boolean;
}

export interface Schedule {
  id: string;
  tenantId?: string;
  courseId: string;
  trainerId: string;
  trainerName?: string;
  title?: string;
  description?: string;
  scheduledAt: string;
  createdAt?: string;
  synced?: boolean;
}

export interface Participant {
  id: string;
  tenantId?: string;
  username: string;
  role: "trainer" | "trainee";
  speaking: boolean;
  handRaised: boolean;
  lastHandRaiseTime: number;
  micEnabled: boolean;
}

export interface ProfileSettings {
  id: string;
  userId: string;
  tenantId: string;
  username: string;
  email: string;
  phone: string;
  avatarUrl?: string;
  password?: string;
  role?: string;
  synced?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface SmsLog {
  id: string;
  tenantId?: string;
  phone: string;
  message: string;
  status: string;
  sentBy?: string;
  sentAt: string;
  synced?: boolean;
}

export interface FormCache {
  id: string;
  tenantId?: string;
  name?: string;
  description?: string;
  fields?: any[];
  synced?: boolean;
  [key: string]: any;
}
