import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import { connectDB } from "./config/db";
import meRoutes from "./routes/me.routes";
import menuItemsRoutes from "./routes/menuItems.routes";
import ordersRoutes from "./routes/orders.routes";

const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:3000",
    credentials: true,
  })
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

async function start() {
  try {
    await connectDB();
    app.listen(port, () => {
      console.log(`Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();