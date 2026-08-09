import dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";
import bcrypt from "bcrypt";

const client = new MongoClient(process.env.MONGO_URI);

await client.connect();

const db = client.db("test");

export const users = db.collection("users");
export const priests = db.collection("priests");
export const bookings = db.collection("bookings");

async function seedPriests() {
  const count = await priests.countDocuments();
  if (count === 0) {
    const hashedPassword = await bcrypt.hash("123", 10);
    await priests.insertMany([
      { name: "ابونا مقار", password: hashedPassword },
    ]);
  }
}
seedPriests();