import { Db, MongoClient } from "mongodb";

let client: MongoClient | null = null;
let db: Db | null = null;
let connecting: Promise<Db> | null = null;
let lastCheck = 0;

// A healthy connection is re-checked at most this often
const CHECK_INTERVAL_MS = 15_000;

function createClient(): MongoClient {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is missing in environment variables");
  }

  return new MongoClient(uri, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 10000,
  });
}

async function open(): Promise<Db> {
  const newClient = createClient();
  await newClient.connect();

  const database = newClient.db(process.env.DB_NAME || "pizzahub");
  await database.command({ ping: 1 });

  client = newClient;
  db = database;
  lastCheck = Date.now();
  console.log("MongoDB connected");
  return database;
}

async function reset(): Promise<void> {
  const oldClient = client;
  const oldDb = db;
  client = null;
  db = null;
  lastCheck = 0;

  if (oldClient) {
    try {
      await oldClient.close();
    } catch {
      // The connection may already be closed
    }
  } else if (oldDb) {
    // Fallback if needed
  }
}

// Cheap when the connection is healthy. If it is dead, it reconnects.
export async function connectDB(): Promise<Db> {
  // Verified recently: reuse it
  if (db && Date.now() - lastCheck < CHECK_INTERVAL_MS) {
    return db;
  }

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