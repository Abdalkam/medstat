// src/database/settingsDB.ts
import { db } from "./db";
import type { BusinessSettings } from "../types";

// Save application settings
export async function saveSettings(settings: BusinessSettings) {
    try {
        await db.settings.put({
            ...settings,
            id: settings.id || "main",
            createdAt: settings.createdAt || new Date().toISOString()
        });
    } catch (error) {
        console.error("Failed to save settings. Clearing table to prevent crashes.", error);
        await db.settings.clear();
        throw error; // Re-throw so the UI can show an alert if needed
    }
}

// Get application settings
export async function getSettings() {
    try {
        return await db.settings.toArray();
    } catch (error) {
        console.error("Failed to load settings. Clearing corrupted table.", error);
        await db.settings.clear();
        return []; // Return empty array so the app doesn't crash
    }
}

// Get single main settings profile
export async function getMainSettings() {
    try {
        const settings = await db.settings.get("main");
        return settings || null;
    } catch (error) {
        console.error("Failed to load main settings. Clearing corrupted table.", error);
        await db.settings.clear();
        return null;
    }
}

// Delete settings
export async function clearSettings() {
    await db.settings.clear();
}