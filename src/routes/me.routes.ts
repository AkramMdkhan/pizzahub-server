import { Response, Router } from "express";
import { requireRole, verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

// Any logged-in user
router.get("/me", verifyToken, (req: AuthRequest, res: Response) => {
  res.json({ user: req.user });
});

// Admin only
router.get(
  "/admin-check",
  verifyToken,
  requireRole("admin"),
  (_req: AuthRequest, res: Response) => {
    res.json({ message: "Welcome, admin" });
  }
);

export default router;