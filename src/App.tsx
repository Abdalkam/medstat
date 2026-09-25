import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { DailyProvider } from "@daily-co/daily-react";

// AUTH & LOADING
import SyncLoadingScreen from "./components/SyncLoadingScreen";
import Startup from "./auth/startup";

// LAYOUTS
import AdminLayout from "./admin/AdminLayout";

// ADMIN
import AdminDashboard from "./admin/AdminDashboard";
import UserManagement from "./admin/UserManagement";
import CourseManagement from "./admin/CourseManagement";
import SMSManagement from "./admin/SMSManagement";
import Settings from "./admin/Settings";

// TRAINER
import TrainerDashboard from "./trainer/TrainerDashboard";
import UploadMaterials from "./trainer/UploadMaterials";
import TrainerLiveClassroom from "./trainer/TrainerLiveClassroom";
import TrainerAssignments from "./trainer/TrainerAssignments";
import AssignmentBuilder from "./trainer/AssignmentBuilder";
import TrainerSubmissions from "./trainer/TrainerSubmissions";

// USER
import UserDashboard from "./user/UserDashboard";
import Classroom from "./user/Classroom";
import UserAssignments from "./user/UserAssignments";
import UserAssignmentTaker from "./user/UserAssignmentTaker";

// COMPONENTS
import ProfileSettings from "./components/ProfileSettings";

// 🛑 BLOCK NATIVE BROWSER DIALOGS
if (typeof window !== "undefined") {
  window.alert = (message) => { console.warn("🚨 ALERT SUPPRESSED:", message); };
  window.confirm = (message) => { console.warn("🚨 CONFIRM SUPPRESSED (auto-false):", message); return false; };
  window.prompt = (message, _default) => { console.warn("🚨 PROMPT SUPPRESSED (auto-null):", message); return null; };
}

export default function App() {
    const [isSynced, setIsSynced] = useState(false);

    const [currentUser, setCurrentUser] = useState<any>(() => {
        const saved = localStorage.getItem("currentUser");
        return saved ? JSON.parse(saved) : null;
    });

    // ✅ SILENT TAURI AUTO-UPDATE (No UI)
    useEffect(() => {
        const checkTauriUpdate = async () => {
            if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

            try {
                const { check } = await import('@tauri-apps/plugin-updater');
                const { relaunch } = await import('@tauri-apps/plugin-process');

                const update = await check();
                if (update) {
                    // Download and install completely silently
                    await update.downloadAndInstall();
                    await relaunch();
                }
            } catch (err) {
                console.error('Tauri update check failed:', err);
            }
        };

        const timer = setTimeout(checkTauriUpdate, 5000);
        return () => clearTimeout(timer);
    }, []);

    useEffect(() => {
        const loadUser = () => {
            const saved = localStorage.getItem("currentUser");
            const parsedUser = saved ? JSON.parse(saved) : null;
            setCurrentUser((prev: any) => {
                if (prev?.id === parsedUser?.id) return prev;
                return parsedUser;
            });
        };
        loadUser();
        window.addEventListener("authStateChanged", loadUser);
        return () => window.removeEventListener("authStateChanged", loadUser);
    }, []);

    const getDashboardPath = (role: string) => {
        if (role === "admin") return "/admin";
        if (role === "trainer") return "/trainer";
        return "/user";
    };

    const ProtectedAdmin = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "admin") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser]);

    const ProtectedTrainer = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "trainer" && currentUser.role !== "admin") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser]);

    const ProtectedUser = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "trainee") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser]);

    return (
        <DailyProvider>
            <BrowserRouter>
                {/* ✅ SHOW SYNC LOADING SCREEN FIRST */}
                {!isSynced ? (
                    <SyncLoadingScreen onSyncComplete={() => setIsSynced(true)} />
                ) : (
                    <Routes>
                        <Route path="/login" element={currentUser ? <Navigate to={getDashboardPath(currentUser.role)} replace /> : <Startup />} />
                        <Route path="/" element={currentUser ? <Navigate to={getDashboardPath(currentUser.role)} replace /> : <Startup />} />

                        {/* ADMIN */}
                        <Route path="/admin" element={<ProtectedAdmin><AdminLayout user={currentUser} /></ProtectedAdmin>}>
                            <Route index element={<AdminDashboard />} />
                            <Route path="users" element={<UserManagement />} />
                            <Route path="courses" element={<CourseManagement />} />
                            <Route path="sms" element={<SMSManagement />} />
                            <Route path="settings" element={<Settings />} />
                        </Route>

                        {/* TRAINER */}
                        <Route path="/trainer" element={<ProtectedTrainer><TrainerDashboard /></ProtectedTrainer>} />
                        <Route path="/trainer/settings" element={<ProtectedTrainer><ProfileSettings role="trainer" /></ProtectedTrainer>} />
                        <Route path="/trainer/upload/:courseId" element={<ProtectedTrainer><UploadMaterials /></ProtectedTrainer>} />
                        <Route path="/trainer/live/:courseId" element={<ProtectedTrainer><TrainerLiveClassroom /></ProtectedTrainer>} />
                        <Route path="/trainer/assignments/:courseId" element={<ProtectedTrainer><TrainerAssignments /></ProtectedTrainer>} />
                        <Route path="/trainer/assignment-builder/:courseId/:assignmentId?" element={<ProtectedTrainer><AssignmentBuilder /></ProtectedTrainer>} />
                        <Route path="/trainer/submissions/:assignmentId" element={<ProtectedTrainer><TrainerSubmissions /></ProtectedTrainer>} />

                        {/* USER */}
                        <Route path="/user" element={<ProtectedUser><UserDashboard /></ProtectedUser>} />
                        <Route path="/user/settings" element={<ProtectedUser><ProfileSettings role="trainee" /></ProtectedUser>} />
                        <Route path="/user/assignments/:courseId" element={<ProtectedUser><UserAssignments /></ProtectedUser>} />
                        <Route path="/user/assignment-taker/:assignmentId" element={<ProtectedUser><UserAssignmentTaker /></ProtectedUser>} />
                        <Route path="/user/classroom/:courseId" element={<ProtectedUser><Classroom /></ProtectedUser>} />

                        <Route path="*" element={<Navigate to="/login" replace />} />
                    </Routes>
                )}
            </BrowserRouter>
        </DailyProvider>
    );
}