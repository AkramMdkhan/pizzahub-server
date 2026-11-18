import { Db, MongoClient } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectDB(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  client = new MongoClient(uri);
  await client.connect();

  db = client.db(process.env.DB_NAME || "pizzahub");
  await db.command({ ping: 1 });
  console.log("MongoDB connected");

  return db;
}

export function getDB(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}