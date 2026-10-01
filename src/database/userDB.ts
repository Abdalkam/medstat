// src/database/userDB.ts
import { db } from "./db";
import type { User } from "../types";

export async function getUsers(): Promise<User[]> {
    return await db.users.toArray();
}

// ADDED: Fetch users specifically for the logged-in tenant (Matches Postgres idx_users_tenant)
export async function getUsersByTenant(tenantId: string): Promise<User[]> {
    return await db.users.where("tenantId").equals(tenantId).toArray();
}

export async function getUser(id: string): Promise<User | undefined> {
    return await db.users.get(id);
}

export async function addUser(user: User) {
    await db.users.put(user);
}

export async function updateUser(user: User) {
    await db.users.put(user);
}

export async function deleteUser(id: string) {
    await db.users.delete(id);
}

export async function adminExists(): Promise<boolean> {
    const admin = await db.users.where("role").equals("admin").first();
    return !!admin;
}

export async function loginUser(username: string, password: string, tenantId?: string): Promise<User | null> {
    // Trim whitespace only — NEVER change the case. Trimming is clearly
    // unintentional input; case is significant.
    const entered = username.trim();

    const users = await db.users.toArray();

    // SECURITY: username matching is CASE-SENSITIVE (exact) —
    // aDmin ≠ admin ≠ ADMIN ≠ Admin. Phone matching is exact too
    // (phone numbers carry no case). Password stays exact — never trim it,
    // since passwords may legitimately contain leading/trailing spaces.
    const localUser = users.find(u =>
        (u.username === entered || (u.phone != null && u.phone === entered))
        && u.password === password
        // SECURITY: when the caller knows the tenant, scope the match so the
        // same username in two institutions can never cross-login offline.
        // (Defensive: accept both camelCase and snake_case storage.)
        && (!tenantId || (u as any).tenantId === tenantId || (u as any).tenant_id === tenantId)
    );

    return localUser || null;
}