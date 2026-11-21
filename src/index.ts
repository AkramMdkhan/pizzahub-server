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

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Stripe webhook: must come BEFORE express.json()
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

app.use(express.json());

// --- DATABASE CONNECTION LOGIC ---
let isConnected = false;

async function connectToDatabase() {
  if (isConnected) return;
  try {
    await connectDB();
    isConnected = true;
    console.log("MongoDB connected successfully.");
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
  }
}

// Middleware for Vercel (connects on request if cold start)
app.use(async (_req: Request, res: Response, next: NextFunction) => {
  await connectToDatabase();
  if (!isConnected) {
    return res.status(500).json({ message: "Database connection failed" });
  }
  next();
});
// ---------------------------------

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

// Keep app.listen and immediate DB connection for local development ONLY
if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 5000;
  
  // Connect to DB immediately on local start
  connectToDatabase().then(() => {
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  });
}