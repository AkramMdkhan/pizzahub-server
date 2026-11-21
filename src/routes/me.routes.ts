import { Response, Router } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db";
import { requireRole, verifyToken } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

// Wrap the collection in a function to ensure the DB is connected before we use it
function users() {
  return getDB().collection("user");
}

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

// PATCH /api/profile (Update Name & Image)
router.patch("/profile", verifyToken, async (req: AuthRequest, res: Response) => {
  try {
    const { name, image } = req.body;

    const updateData: Record<string, unknown> = {};

    // Validate Name
    if (name !== undefined) {
      const v = typeof name === "string" ? name.trim() : "";
      if (v.length < 2 || v.length > 80) {
        return res.status(400).json({ message: "Name must be 2-80 characters" });
      }
      updateData.name = v;
    }

    // Validate Image (Optional)
    if (image !== undefined) {
      // Allow empty string to remove the image, or a valid URL
      if (image !== "" && !/^https?:\/\//i.test(image)) {
        return res.status(400).json({ message: "Image must be a valid URL or empty" });
      }
      updateData.image = image;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    updateData.updatedAt = new Date();

    // Update in the Better Auth user collection
    // Notice we use users() here, which is now a function
    const result = await users().updateOne(
      { _id: new ObjectId(req.user!.id) },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ message: "Profile updated successfully", updated: updateData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

export default router;