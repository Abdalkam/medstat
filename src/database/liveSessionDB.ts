// src/database/liveSessionDB.ts
import { db } from "./db";
import type { LiveSession } from "../types";

// =============================
// START LIVE SESSION
// =============================
export async function startLiveSession(courseId: string, trainerId: string): Promise<void> {
    const now = new Date().toISOString();

    const session: LiveSession = {
        id: courseId,
        courseId,
        trainerId,
        active: true,
        startedAt: now,
        updatedAt: now
    };

    await db.liveSessions.put(session);
}

// =============================
// END LIVE SESSION
// =============================
export async function endLiveSession(courseId: string): Promise<void> {
    const session = await getLiveSession(courseId);
    if (!session) return;

    await db.liveSessions.put({
        ...session,
        active: false,
        updatedAt: new Date().toISOString()
    });
}

// =============================
// GET LIVE SESSION
// =============================
export async function getLiveSession(courseId: string): Promise<LiveSession | undefined> {
    return await db.liveSessions.where("courseId").equals(courseId).first();
}

// =============================
// CHECK IF COURSE IS LIVE
// =============================
export async function isLive(courseId: string): Promise<boolean> {
    const session = await getLiveSession(courseId);
    return session?.active ?? false;
}