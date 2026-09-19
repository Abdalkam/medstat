// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
import { DailyProvider } from "@daily-co/daily-react";
import { useRegisterSW } from "virtual:pwa-register/react";

// AUTH
import Startup from "./auth/startup";

// LAYOUTS
import AdminLayout from "./admin/AdminLayout";
import AppLayout from "./components/AppLayout";

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
import Updater from "./components/Updater"; // ✅ Import the Updater component

export default function App() {
    // ⚠️ TEMPORARY: Force kill the old Service Worker to clear corrupted cache
    useEffect(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function(registrations) {
          for(let registration of registrations) {
            registration.unregister();
            console.log("🧹 Old Service Worker unregistered!");
          }
        });
      }
    }, []);

    const [currentUser, setCurrentUser] = useState<any>(() => {
        const saved = localStorage.getItem("currentUser");
        return saved ? JSON.parse(saved) : null;
    });

    const {
        needRefresh: [needRefresh, setNeedRefresh],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(url) { console.log("SW registered:", url); },
        onRegisterError(error) { console.log("SW error:", error); },
    });

    useEffect(() => {
        if (needRefresh) { updateServiceWorker(true); setNeedRefresh(false); }
    }, [needRefresh, updateServiceWorker, setNeedRefresh]);

    // ✅ FIX: Centralized auth handler. It ONLY updates state if the user actually changed.
    useEffect(() => {
        const loadUser = () => {
            const saved = localStorage.getItem("currentUser");
            const parsedUser = saved ? JSON.parse(saved) : null;
            
            // Only trigger a state update if the user ID changed or they logged out
            setCurrentUser((prev: any) => {
                if (prev?.id === parsedUser?.id) return prev;
                return parsedUser;
            });
        };
        loadUser();
        
        window.addEventListener("authStateChanged", loadUser);
        
        return () => {
            window.removeEventListener("authStateChanged", loadUser);
        };
    }, []);

    const getDashboardPath = (role: string) => {
        if (role === "admin") return "/admin";
        if (role === "trainer") return "/trainer";
        return "/user";
    };

    // ✅ FIX: Redirect to /login explicitly to prevent flashing the dashboard
    const ProtectedAdmin = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "admin") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser])

    const ProtectedTrainer = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "trainer" && currentUser.role !== "admin") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser])

    const ProtectedUser = useCallback(({ children }: { children: React.ReactNode }) => {
        if (!currentUser) return <Navigate to="/login" replace />;
        if (currentUser.role !== "trainee") return <Navigate to={getDashboardPath(currentUser.role)} replace />;
        return <>{children}</>;
    }, [currentUser])

    return (
        <DailyProvider>
            <BrowserRouter>
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

                    <Route path="/trainer/assignments/:courseId" element={<ProtectedTrainer><AppLayout user={currentUser} /></ProtectedTrainer>}>
                        <Route index element={<TrainerAssignments />} />
                    </Route>
                    <Route path="/trainer/assignment-builder/:courseId/:assignmentId?" element={<ProtectedTrainer><AppLayout user={currentUser} /></ProtectedTrainer>}>
                        <Route index element={<AssignmentBuilder />} />
                    </Route>
                    <Route path="/trainer/submissions/:assignmentId" element={<ProtectedTrainer><AppLayout user={currentUser} /></ProtectedTrainer>}>
                        <Route index element={<TrainerSubmissions />} />
                    </Route>

                    {/* USER */}
                    <Route path="/user" element={<ProtectedUser><UserDashboard /></ProtectedUser>} />
                    <Route path="/user/settings" element={<ProtectedUser><ProfileSettings role="trainee" /></ProtectedUser>} />
                    <Route path="/user/assignments/:courseId" element={<ProtectedUser><UserAssignments /></ProtectedUser>} />
                    <Route path="/user/assignment-taker/:assignmentId" element={<ProtectedUser><UserAssignmentTaker /></ProtectedUser>} />

                    {/* USER STANDALONE */}
                    <Route path="/user/classroom/:courseId" element={<ProtectedUser><Classroom /></ProtectedUser>} />

                    {/* ✅ FIX: Send unknown routes to login instead of root */}
                    <Route path="*" element={<Navigate to="/login" replace />} />
                </Routes>
                
                {/* ✅ Added the Updater component globally so it checks for updates on startup */}
                <Updater />
            </BrowserRouter>
        </DailyProvider>
    );
}