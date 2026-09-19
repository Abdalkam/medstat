// src/database/trainerDB.ts


import {
    db
} from "./db";


import type {
    User
} from "../types";


// =============================
// GET ALL TRAINERS
// =============================

export async function getTrainers(){

    return await db.users

    .filter(

        user =>

        user.role === "trainer"

    )

    .toArray();

}









// =============================
// GET TRAINER BY ID
// =============================

export async function getTrainer(

    id:string

):Promise<User | undefined>{


    return await db.users.get(id);


}









// =============================
// CREATE TRAINER
// =============================

export async function addTrainer(

    trainer:User

){


    await db.users.add(

        trainer

    );


}









// =============================
// UPDATE TRAINER
// =============================

export async function updateTrainer(

    trainer:User

){


    await db.users.put(

        trainer

    );


}









// =============================
// DELETE TRAINER
// =============================

export async function deleteTrainer(

    id:string

){


    await db.users.delete(

        id

    );


}