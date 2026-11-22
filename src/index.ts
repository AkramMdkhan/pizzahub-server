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

// CORS (also answers preflight requests for the client address)
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// --- DATABASE CONNECTION LOGIC ---
// connectDB() is cheap while the connection is healthy and reconnects when it is not
async function connectToDatabase() {
  try {
    await connectDB();
    return true;
  } catch (error) {
    console.error("Failed to connect to MongoDB:", error);
    return false;
  }
}

// Runs before every route, including the Stripe webhook
app.use(async (_req: Request, res: Response, next: NextFunction) => {
  if (!(await connectToDatabase())) {
    return res.status(500).json({ message: "Database connection failed" });
  }
  next();
});
// ---------------------------------

// Stripe webhook: must be parsed with the raw body, before express.json()
app.post(
  "/api/stripe/webhook",
  express.raw({ type: "application/json" }),
  handleStripeWebhook
);

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

  connectToDatabase().then((connected) => {
    if (!connected) {
      console.error("Server not started: could not connect to MongoDB.");
      process.exit(1);
    }
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  });
}