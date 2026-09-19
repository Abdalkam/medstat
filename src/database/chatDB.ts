// src/database/chatDB.ts


import {
    db
} from "./db";


import type {
    ChatMessage
} from "../types";


// =============================
// SEND MESSAGE
// =============================

export async function sendChatMessage(

    data:ChatMessage

):Promise<void>{


    await db.chatMessages.add(

        data

    );


}







// =============================
// GET COURSE CHAT
// =============================

export async function getChatMessages(

    courseId:string

):Promise<ChatMessage[]>{


    return await db.chatMessages

        .where("courseId")

        .equals(courseId)

        .sortBy("createdAt");


}