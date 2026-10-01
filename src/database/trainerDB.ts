// src/database/trainerDB.ts
import { db } from "./db";
import type { User } from "../types";

// Helper: tenant match that tolerates camelCase (local writes) and
// snake_case (rows mirrored straight from Supabase by the sync hooks).
function sameTenant(u: any, tenantId?: string): boolean {
    if (!tenantId) return true;
    return u?.tenantId === tenantId || u?.tenant_id === tenantId;
}

// =============================
// GET ALL TRAINERS
// Pass tenantId to scope to one institution (recommended — the local DB can
// hold users from more than one tenant after multi-tenant logins).
// =============================
export async function getTrainers(tenantId?: string): Promise<User[]> {
    const all = await db.users
        .filter(user => user.role === "trainer")
        .toArray();
    return all.filter(u => sameTenant(u, tenantId));
}

// =============================
// GET TRAINER BY ID
// =============================
export async function getTrainer(id: string): Promise<User | undefined> {
    return await db.users.get(id);
}

// =============================
// CREATE TRAINER
// =============================
export async function addTrainer(trainer: User): Promise<void> {
    // Usernames are CASE-SENSITIVE at login, but two users differing only by
    // capitalization would be a support trap — block them within the tenant,
    // mirroring createUserApi's duplicate guard.
    const uname = (trainer.username || "").trim().toLowerCase();
    if (uname) {
        const existing = await db.users
            .filter(u =>
                (u.username || "").trim().toLowerCase() === uname &&
                sameTenant(u, (trainer as any).tenantId || (trainer as any).tenant_id)
            )
            .first();
        if (existing) {
            throw new Error("A user with this username already exists in this institution (names that differ only by capitalization are not allowed).");
        }
    }

    // put (not add): idempotent when the sync hooks rewrite the same row;
    // add() throws a raw ConstraintError on a repeated id.
    await db.users.put(trainer);
}

// =============================
// UPDATE TRAINER
// =============================
export async function updateTrainer(trainer: User): Promise<void> {
    // Block renaming into a collision with another user in the same tenant.
    if (trainer.username) {
        const uname = trainer.username.trim().toLowerCase();
        const clash = await db.users
            .filter(u =>
                u.id !== trainer.id &&
                (u.username || "").trim().toLowerCase() === uname &&
                sameTenant(u, (trainer as any).tenantId || (trainer as any).tenant_id)
            )
            .first();
        if (clash) {
            throw new Error("That username is already taken by another user in this institution.");
        }
    }

    await db.users.put(trainer);
}

// =============================
// DELETE TRAINER
// =============================
export async function deleteTrainer(id: string): Promise<void> {
    await db.users.delete(id);
}