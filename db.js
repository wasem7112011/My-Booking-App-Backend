import dotenv from "dotenv";
dotenv.config();

import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);

await client.connect();

const db = client.db("Booking");

export const users = db.collection("users");
export const priests = db.collection("priests");
export const bookings = db.collection("bookings");

async function seedPriests() {
  const count = await priests.countDocuments();
  if (count === 0) {
    await priests.insertMany([
      { name: "ابونا مقار", password: "123" },
    ]);
  }
}
seedPriests();