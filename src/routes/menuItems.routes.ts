import { Router, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db";
import { verifyToken, requireRole } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

function menuItems() {
  return getDB().collection("menuItems");
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function validateItem(body: any, partial = false) {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};

  if (!partial || body.name !== undefined) {
    const v = typeof body.name === "string" ? body.name.trim() : "";
    if (v.length < 2 || v.length > 80) errors.push("Name must be 2-80 characters");
    else data.name = v;
  }

  if (!partial || body.description !== undefined) {
    const v = typeof body.description === "string" ? body.description.trim() : "";
    if (v.length < 10 || v.length > 500) errors.push("Description must be 10-500 characters");
    else data.description = v;
  }

  if (!partial || body.category !== undefined) {
    const v = typeof body.category === "string" ? body.category.trim() : "";
    if (!v) errors.push("Category is required");
    else data.category = v;
  }

  if (!partial || body.price !== undefined) {
    const v = Number(body.price);
    if (!Number.isFinite(v) || v <= 0 || v > 1000) errors.push("Price must be a number between 0 and 1000");
    else data.price = Math.round(v * 100) / 100;
  }

  if (!partial || body.image !== undefined) {
    const v = typeof body.image === "string" ? body.image.trim() : "";
    if (!/^https?:\/\//i.test(v)) errors.push("A valid image URL is required");
    else data.image = v;
  }

  if (!partial || body.location !== undefined) {
    const v = typeof body.location === "string" ? body.location.trim() : "";
    if (v.length < 2 || v.length > 100) errors.push("Location must be 2-100 characters");
    else data.location = v;
  }

  if (body.ingredients !== undefined) {
    if (Array.isArray(body.ingredients) && body.ingredients.every((i: unknown) => typeof i === "string")) {
      data.ingredients = body.ingredients.map((i: string) => i.trim()).filter(Boolean);
    } else {
      errors.push("Ingredients must be an array of text");
    }
  }

  if (body.isVegetarian !== undefined) {
    data.isVegetarian = Boolean(body.isVegetarian);
  }

  return { errors, data };
}

// Helper to create the $lookup pipeline
const vendorLookupPipeline = [
  {
    $lookup: {
      from: "user",
      let: { vendorIdStr: "$vendorId" },
      pipeline: [
        {
          $match: {
            $expr: {
              $or: [
                { $eq: [{ $toString: "$_id" }, "$$vendorIdStr"] },
                { $eq: ["$id", "$$vendorIdStr"] }
              ]
            }
          }
        },
        { $project: { subscriptionPlan: 1 } }
      ],
      as: "vendorDetails"
    }
  },
  {
    $addFields: {
      isPremiumVendor: {
        $eq: [{ $arrayElemAt: ["$vendorDetails.subscriptionPlan", 0] }, "premium"]
      }
    }
  },
  { $project: { vendorDetails: 0 } }
];

// GET /api/menu-items  (public: only APPROVED items; search, category, sort, pagination)
router.get("/", async (req, res: Response) => {
  try {
    const search = String(req.query.search || "").trim();
    const category = String(req.query.category || "").trim();
    const sort = String(req.query.sort || "newest");
    const page = Math.max(1, parseInt(String(req.query.page)) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit)) || 9));

    const filter: Record<string, unknown> = { status: "approved" };

    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: regex }, { description: regex }];
    }
    if (category && category !== "all") {
      filter.category = category;
    }

    const sortMap: Record<string, Record<string, 1 | -1>> = {
      "price-asc": { price: 1, _id: 1 },
      "price-desc": { price: -1, _id: 1 },
      newest: { createdAt: -1, _id: -1 },
    };

    const pipeline: any[] = [
      { $match: filter },
      { $sort: sortMap[sort] || sortMap.newest },
      { $skip: (page - 1) * limit },
      { $limit: limit },
      ...vendorLookupPipeline
    ];

    const [items, total] = await Promise.all([
      menuItems().aggregate(pipeline).toArray(),
      menuItems().countDocuments(filter),
    ]);

    res.json({ items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch menu items" });
  }
});

// GET /api/menu-items/mine (vendor: only my items)
router.get("/mine", verifyToken, requireRole("vendor"), async (req: AuthRequest, res: Response) => {
  try {
    const items = await menuItems().find({ vendorId: req.user!.id }).sort({ createdAt: -1 }).toArray();
    res.json({ items, total: items.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch your menu items" });
  }
});

// GET /api/menu-items/mine/:id (vendor: one of my own items)
router.get("/mine/:id", verifyToken, requireRole("vendor"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid item id" });

    const item = await menuItems().findOne({ _id: new ObjectId(id) });
    if (!item) return res.status(404).json({ message: "Menu item not found" });
    if (item.vendorId !== req.user!.id) return res.status(403).json({ message: "You can only view your own items" });

    res.json(item);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch menu item" });
  }
});

// GET /api/menu-items/:id  (public: only APPROVED items, WITH Premium lookup)
router.get("/:id", async (req, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid item id" });

    const pipeline: any[] = [
      { $match: { _id: new ObjectId(id), status: "approved" } },
      ...vendorLookupPipeline
    ];

    const items = await menuItems().aggregate(pipeline).toArray();
    if (items.length === 0) return res.status(404).json({ message: "Menu item not found" });

    res.json(items[0]); // Return the single object
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch menu item" });
  }
});

// POST /api/menu-items  (vendor only; new items start as "pending")
router.post("/", verifyToken, requireRole("vendor"), async (req: AuthRequest, res: Response) => {
  try {
    const { errors, data } = validateItem(req.body || {});
    if (errors.length) return res.status(400).json({ message: errors[0], errors });

    // 3-item limit check
    const users = getDB().collection("user");
    const vendor = await users.findOne({ 
      $or: [
        ...(ObjectId.isValid(req.user!.id) ? [{ _id: new ObjectId(req.user!.id) }] : []),
        { id: req.user!.id }
      ]
    });

    if (vendor?.subscriptionPlan !== "premium") {
      const activeCount = await menuItems().countDocuments({
        vendorId: req.user!.id,
        status: { $ne: "rejected" } 
      });
      if (activeCount >= 3) {
        return res.status(403).json({ message: "Free plan limit reached. Please upgrade to Premium to add more items." });
      }
    }

    const now = new Date();
    const doc = {
      ...data,
      status: "pending",
      vendorId: req.user!.id,
      vendorEmail: req.user!.email,
      createdAt: now,
      updatedAt: now,
    };

    const result = await menuItems().insertOne(doc);
    res.status(201).json({ _id: result.insertedId, ...doc });
  } catch (error) {
    res.status(500).json({ message: "Failed to create menu item" });
  }
});

// PATCH /api/menu-items/:id  (owner vendor only)
router.patch("/:id", verifyToken, requireRole("vendor"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid item id" });

    const existing = await menuItems().findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ message: "Menu item not found" });
    if (existing.vendorId !== req.user!.id) return res.status(403).json({ message: "You can only edit your own items" });

    const { errors, data } = validateItem(req.body || {}, true);
    if (errors.length) return res.status(400).json({ message: errors[0], errors });
    if (Object.keys(data).length === 0) return res.status(400).json({ message: "Nothing to update" });

    await menuItems().updateOne({ _id: existing._id }, { $set: { ...data, updatedAt: new Date() } });
    const updated = await menuItems().findOne({ _id: existing._id });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ message: "Failed to update menu item" });
  }
});

// DELETE /api/menu-items/:id  (owner vendor or admin)
router.delete("/:id", verifyToken, requireRole("vendor", "admin"), async (req: AuthRequest, res: Response) => {
  try {
    const id = String(req.params.id);
    if (!ObjectId.isValid(id)) return res.status(400).json({ message: "Invalid item id" });

    const existing = await menuItems().findOne({ _id: new ObjectId(id) });
    if (!existing) return res.status(404).json({ message: "Menu item not found" });

    const isOwner = existing.vendorId === req.user!.id;
    if (!isOwner && req.user!.role !== "admin") {
      return res.status(403).json({ message: "You can only delete your own items" });
    }

    await menuItems().deleteOne({ _id: existing._id });
    res.json({ message: "Menu item deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete menu item" });
  }
});

export default router;