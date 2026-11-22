import { Db, MongoClient } from "mongodb";
import { attachDatabasePool } from "@vercel/functions";

let client: MongoClient | null = null;
let db: Db | null = null;
let connecting: Promise<Db> | null = null;
let lastCheck = 0;

// A healthy connection is re-checked at most this often
const CHECK_INTERVAL_MS = 15_000;

function createClient() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing in .env");
  }

  const newClient = new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  });

  // On Vercel, let the platform close idle connections before a function is suspended
  if (process.env.VERCEL) {
    attachDatabasePool(newClient);
  }

  return newClient;
}

async function open(): Promise<Db> {
  client = createClient();
  await client.connect();

  const database = client.db(process.env.DB_NAME || "pizzahub");
  await database.command({ ping: 1 });

  db = database;
  lastCheck = Date.now();
  console.log("MongoDB connected");
  return database;
}

async function reset() {
  const old = client;
  client = null;
  db = null;
  if (old) {
    try {
      await old.close();
    } catch {
      // The connection may already be closed
    }
  }
}

// Cheap when the connection is healthy. If it is dead, it reconnects.
export async function connectDB(): Promise<Db> {
  // Verified recently: reuse it
  if (db && Date.now() - lastCheck < CHECK_INTERVAL_MS) return db;

  // Older connection: check that it is still alive
  if (db) {
    try {
      await db.command({ ping: 1 });
      lastCheck = Date.now();
      return db;
    } catch (error) {
      console.error("MongoDB connection lost, reconnecting:", error);
      await reset();
    }
  }

  // Concurrent requests share one connection attempt
  if (!connecting) {
    connecting = open()
      .catch(async (error) => {
        await reset();
        throw error;
      })
      .finally(() => {
        connecting = null;
      });
  }
  return connecting;
}

export function getDB(): Db {
  if (!db) {
    throw new Error("Database not connected. Call connectDB() first.");
  }
  return db;
}