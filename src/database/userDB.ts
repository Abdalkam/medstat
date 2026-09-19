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

export async function loginUser(username: string, password: string): Promise<User | null> {
    const users = await db.users.toArray();
    const localUser = users.find(u => 
        (u.username?.toLowerCase() === username.toLowerCase() || u.phone === username) 
        && u.password === password
    );
    
    if (localUser) return localUser;
    return null;
}