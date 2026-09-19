// =============================
// USER
// =============================
export interface User {
    id: string;
    tenantId?: string;
    username: string;
    email: string;
    phone?: string;
    password: string;
    role: "admin" | "trainer" | "trainee";
    assignedCourses?: string[];
    profilePic?: string;
    createdAt: string;
    synced?: boolean;
    tuition?: {
        expected: number;
        paid: number;
    };
    remuneration?: {
        netSalary: number;
        perDiem: number;
    };
}

// =============================
// COURSE
// =============================
export interface Course {
    id: string;
    tenantId?: string;
    name: string;
    description: string;
    tuitionType: "free" | "paid";
    amount: number;
    startDate: string;
    period: string;
    logo?: string;
    mediaUrl?: string;
    mediaType?: string;
    mediaName?: string;
    trainerId?: string; 
    createdAt: string;
    synced?: boolean;
}

// =============================
// COURSE MATERIAL
// =============================
export interface CourseMaterial {
    id: string;
    courseId: string;
    tenantId?: string;
    title: string;
    description: string;
    fileUrl?: string; 
    fileName: string;
    fileType: string;
    allowDownload: boolean;
    uploadedBy: string;
    uploadedAt: string;
    isPresentation?: boolean;
    presentationOrder?: number;
}

// =============================
// ENROLLMENT
// =============================
export interface Enrollment {
    id: string;
    tenantId?: string;
    courseId: string;
    userId: string;
    role: "trainer" | "trainee";
    enrolledAt: string;
    status?: string;
    createdAt?: string; 
}

// =============================
// LIVE SESSION
// =============================
export interface LiveSession {
    id: string;
    tenantId?: string;
    courseId: string;
    trainerId: string;
    active: boolean;
    startedAt: string;
    updatedAt: string;
    createdAt?: string; 
}

// =============================
// LIVE PRESENTATION
// =============================
export interface Stroke {
    id: string;
    points: { x: number; y: number }[];
    color?: string;
    width?: number;
    tool?: 'pen' | 'eraser' | 'text';
}

export interface LivePresentation {
    id: string;
    tenantId?: string;
    courseId: string;
    materialId?: string; 
    isBlackboard?: boolean; 
    blackboardLines?: string[]; 
    blackboardStrokes?: Stroke[]; 
    blackboardLabels?: { text: string; x: number; y: number; }[];
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

// =============================
// CHAT MESSAGE
// =============================
export interface ChatMessage {
    id: string;
    tenantId?: string;
    courseId: string;
    userId: string;
    username: string;
    message: string;
    createdAt: string;
    imageUrl?: string | null; // ✅ ADDED THIS LINE
}

// =============================
// BUSINESS SETTINGS
// =============================
export interface BusinessSettings {
    id?: string;
    tenantId?: string;
    businessName: string;
    address?: string;
    phone: string;
    email: string;
    website?: string;
    logo?: string;
    header?: string; 
    adminProfile?: string;
    loginBackground?: string; 
    themeColor?: string;
    appBarItems: string[];
    createdAt?: string;
}

// =============================
// ASSIGNMENTS MODULE
// =============================
export type AssignmentFieldType = "text" | "paragraph" | "dropdown" | "checkbox" | "toggle" | "file" | "note" | "header";

export interface Assignment {
    id: string;
    tenantId?: string;
    courseId: string;
    trainerId: string;
    title: string;
    description: string;
    dueDate?: string;
    createdAt: string;
    allowDownload?: boolean; 
}

export interface AssignmentField {
    id: string;
    assignmentId: string;
    type: AssignmentFieldType;
    label: string;
    required: boolean;
    options?: string[]; 
    fileTypes?: string[]; 
    x?: number;
    y?: number;
}

export interface AssignmentSubmission {
    id: string;
    tenantId?: string;
    assignmentId: string;
    userId: string;
    username: string;
    submittedAt: string;
    answers: Record<string, any>; 
    marks?: Record<string, "tick" | "cross">; 
    grade?: string;
    feedback?: string;
    gradedBy?: string;
    gradedAt?: string;
}

// =============================
// SCHEDULE MODULE
// =============================
export interface Schedule {
    id: string;
    tenantId?: string;
    courseId: string;
    trainerId: string;
    trainerName: string;
    title: string;
    description: string;
    scheduledAt: string;
    createdAt: string;
}

// =============================
// LIVE PARTICIPANT
// =============================
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