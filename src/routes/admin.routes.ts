import { Router, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db";
import { verifyToken, requireRole } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

// Every route in this file is admin only
router.use(verifyToken, requireRole("admin"));

function users() {
  return getDB().collection("user"); // Better Auth collection
}

function menuItems() {
  return getDB().collection("menuItems");
}

function transactions() {
  return getDB().collection("transactions");
}

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getPaging(req: AuthRequest, defaultLimit = 10) {
  const page = Math.max(1, parseInt(String(req.query.page)) || 1);
  const limit = Math.min(
    50,
    Math.max(1, parseInt(String(req.query.limit)) || defaultLimit)
  );
  return { page, limit, skip: (page - 1) * limit };
}

// GET /api/admin/stats  (overview cards)
router.get("/stats", async (_req: AuthRequest, res: Response) => {
  try {
    const [
      totalUsers,
      totalVendors,
      totalCustomers,
      totalMenuItems,
      pendingMenuItems,
      totalTransactions,
    ] = await Promise.all([
      users().countDocuments({}),
      users().countDocuments({ role: "vendor" }),
      users().countDocuments({ role: "customer" }),
      menuItems().countDocuments({}),
      menuItems().countDocuments({ status: "pending" }),
      transactions().countDocuments({}),
    ]);

    res.json({
      totalUsers,
      totalVendors,
      totalCustomers,
      totalMenuItems,
      pendingMenuItems,
      totalTransactions,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to load admin stats" });
  }
});

// GET /api/admin/users?search=&role=&page=&limit=
router.get("/users", async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = getPaging(req);
    const search = String(req.query.search || "").trim();
    const role = String(req.query.role || "").trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: regex }, { email: regex }];
    }
    if (["vendor", "customer", "admin"].includes(role)) {
      filter.role = role;
    }

    const [items, total] = await Promise.all([
      users()
        .find(filter, {
          projection: {
            name: 1,
            email: 1,
            image: 1,
            role: 1,
            isBlocked: 1,
            businessName: 1,
            subscriptionPlan: 1,
            subscriptionExpiresAt: 1,
            createdAt: 1,
          },
        })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      users().countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

// GET /api/admin/menu-items?search=&status=&category=&page=&limit=
router.get("/menu-items", async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = getPaging(req);
    const search = String(req.query.search || "").trim();
    const status = String(req.query.status || "").trim();
    const category = String(req.query.category || "").trim();

    const filter: Record<string, unknown> = {};
    if (search) {
      const regex = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ name: regex }, { vendorEmail: regex }, { location: regex }];
    }
    if (["pending", "approved", "rejected", "inactive"].includes(status)) {
      filter.status = status;
    }
    if (category && category !== "all") {
      filter.category = category;
    }

    const [items, total] = await Promise.all([
      menuItems()
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      menuItems().countDocuments(filter),
    ]);

    res.json({
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch menu items" });
  }
});

// PATCH /api/admin/menu-items/:id/status
// Approve, reject, or set an item inactive. Deleting uses the existing
// DELETE /api/menu-items/:id route, which already allows admins.
router.patch(
  "/menu-items/:id/status",
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid item id" });
      }

      const newStatus = String(req.body?.status || "");
      if (!["approved", "rejected", "inactive"].includes(newStatus)) {
        return res.status(400).json({
          message: "Status must be approved, rejected or inactive",
        });
      }

      const existing = await menuItems().findOne({ _id: new ObjectId(id) });
      if (!existing) {
        return res.status(404).json({ message: "Menu item not found" });
      }

      await menuItems().updateOne(
        { _id: existing._id },
        { $set: { status: newStatus, updatedAt: new Date() } }
      );

      const updated = await menuItems().findOne({ _id: existing._id });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update item status" });
    }
  }
);

// GET /api/admin/transactions?page=&limit=  (read only: there is no edit route)
router.get("/transactions", async (req: AuthRequest, res: Response) => {
  try {
    const { page, limit, skip } = getPaging(req);

    const [items, total] = await Promise.all([
      transactions()
        .find({})
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      transactions().countDocuments({}),
    ]);

    // Attach vendor name and email for display
    const vendorIds = [
      ...new Set(
        items
          .map((t) => String(t.vendorId || ""))
          .filter((id) => ObjectId.isValid(id))
      ),
    ];
    const vendors = vendorIds.length
      ? await users()
          .find(
            { _id: { $in: vendorIds.map((id) => new ObjectId(id)) } },
            { projection: { name: 1, email: 1 } }
          )
          .toArray()
      : [];
    const vendorMap = new Map(vendors.map((v) => [String(v._id), v]));

    const withVendors = items.map((t) => {
      const vendor = vendorMap.get(String(t.vendorId));
      return {
        ...t,
        vendorName: vendor?.name ?? null,
        vendorEmail: vendor?.email ?? null,
      };
    });

    res.json({
      items: withVendors,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to fetch transactions" });
  }
});

export default router;