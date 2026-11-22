import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { connectDB } from "./config/db";
import meRoutes from "./routes/me.routes";
import menuItemsRoutes from "./routes/menuItems.routes";
import ordersRoutes from "./routes/orders.routes";
import adminRoutes from "./routes/admin.routes";
import stripeRoutes from "./routes/stripe.routes";
import { handleStripeWebhook } from "./routes/stripe.webhook";

const app = express();

// 1. CORS configuration
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// 2. Handle Preflight requests explicitly (critical for Vercel)
app.options(/.*/, cors());


// --- DATABASE CONNECTION LOGIC ---
let isConnected = false;

async function connectToDatabase() {
  if (isConnected) return;
  try {
    await connectDB();
    isConnected = true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

app.use(async (_req: Request, res: Response, next: NextFunction) => {
  await connectToDatabase();
  if (!isConnected) {
    return res.status(500).json({ message: "Database connection failed" });
  }
  next();
});
// ---------------------------------

// 3. Stripe webhook MUST be parsed with raw body
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

// 4. JSON body parser (moved below the webhook)
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "PizzaHub API is running" });
});

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.use("/api", meRoutes);
app.use("/api/menu-items", menuItemsRoutes);
app.use("/api/orders", ordersRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/stripe", stripeRoutes);

// Export the app for Vercel
export default app;

// app.listen runs for local development ONLY
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 5000;

  connectToDatabase().then(() => {
    if (!isConnected) {
      console.error("Server not started: could not connect to MongoDB.");
      process.exit(1);
    }
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  });
}