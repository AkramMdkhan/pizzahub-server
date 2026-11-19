import { Router, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db";
import { verifyToken, requireRole } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

function orders() {
  return getDB().collection("orders");
}

function menuItems() {
  return getDB().collection("menuItems");
}

// Reads the customer's display name from the Better Auth "user" collection.
// Falls back to the email if the user cannot be found.
async function getUserName(id: string, fallback: string) {
  try {
    const users = getDB().collection("user");
    const user = await users.findOne({
      $or: [
        ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
        { id },
      ],
    });
    const name = user && typeof user.name === "string" ? user.name.trim() : "";
    return name || fallback;
  } catch {
    return fallback;
  }
}

function todayString() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateString(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// POST /api/orders  (customers only)
router.post(
  "/",
  verifyToken,
  requireRole("customer"),
  async (req: AuthRequest, res: Response) => {
    try {
      const body = req.body || {};

      const itemId = String(body.itemId || "");
      if (!ObjectId.isValid(itemId)) {
        return res.status(400).json({ message: "Invalid item id" });
      }

      const deliveryDate =
        typeof body.deliveryDate === "string" ? body.deliveryDate.trim() : "";
      if (!isValidDateString(deliveryDate)) {
        return res
          .status(400)
          .json({ message: "Please choose a valid delivery date" });
      }
      if (deliveryDate < todayString()) {
        return res
          .status(400)
          .json({ message: "Delivery date cannot be in the past" });
      }

      const deliveryAddress =
        typeof body.deliveryAddress === "string"
          ? body.deliveryAddress.trim()
          : "";
      if (deliveryAddress.length < 5 || deliveryAddress.length > 200) {
        return res
          .status(400)
          .json({ message: "Delivery address must be 5-200 characters" });
      }

      const message =
        typeof body.message === "string" ? body.message.trim() : "";
      if (message.length > 300) {
        return res
          .status(400)
          .json({ message: "Message must be 300 characters or less" });
      }

      // Only approved items can be ordered
      const item = await menuItems().findOne({
        _id: new ObjectId(itemId),
        status: "approved",
      });
      if (!item) {
        return res
          .status(404)
          .json({ message: "This item is not available for ordering" });
      }

      // A vendor can never order their own item
      if (item.vendorId === req.user!.id) {
        return res
          .status(403)
          .json({ message: "You cannot order your own items" });
      }

      // No duplicate active order for the same item and delivery date
      const duplicate = await orders().findOne({
        customerId: req.user!.id,
        itemId: item._id,
        deliveryDate,
        status: { $in: ["pending", "accepted"] },
      });
      if (duplicate) {
        return res.status(409).json({
          message: "You already have an active order for this item on that date",
        });
      }

      const now = new Date();
      const doc = {
        itemId: item._id,
        vendorId: item.vendorId as string,
        customerId: req.user!.id,
        deliveryDate,
        deliveryAddress,
        message,
        status: "pending",
        // Snapshots, so order lists still work if the item or user changes later
        itemName: item.name as string,
        itemImage: item.image as string,
        itemPrice: item.price as number,
        vendorEmail: (item.vendorEmail as string) || "",
        customerName: await getUserName(req.user!.id, req.user!.email),
        customerEmail: req.user!.email,
        createdAt: now,
        updatedAt: now,
      };

      const result = await orders().insertOne(doc);
      res.status(201).json({ _id: result.insertedId, ...doc });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to place order" });
    }
  }
);

// GET /api/orders/stats  (customer or vendor: counts by status for the overview)
// Must stay above "/:id"
router.get(
  "/stats",
  verifyToken,
  requireRole("customer", "vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const field = req.user!.role === "vendor" ? "vendorId" : "customerId";

      const rows = await orders()
        .aggregate([
          { $match: { [field]: req.user!.id } },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ])
        .toArray();

      const stats = {
        total: 0,
        pending: 0,
        accepted: 0,
        rejected: 0,
        cancelled: 0,
      };
      for (const row of rows) {
        const key = String(row._id) as keyof typeof stats;
        if (key in stats) stats[key] = row.count as number;
        stats.total += row.count as number;
      }

      res.json(stats);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to load order stats" });
    }
  }
);

// GET /api/orders/mine  (customer: only my orders)
router.get(
  "/mine",
  verifyToken,
  requireRole("customer"),
  async (req: AuthRequest, res: Response) => {
    try {
      const items = await orders()
        .find({ customerId: req.user!.id })
        .sort({ createdAt: -1 })
        .toArray();

      res.json({ items, total: items.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch your orders" });
    }
  }
);

// GET /api/orders/vendor  (vendor: only orders for my items)
router.get(
  "/vendor",
  verifyToken,
  requireRole("vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const filter: Record<string, unknown> = { vendorId: req.user!.id };

      const status = String(req.query.status || "").trim();
      if (["pending", "accepted", "rejected", "cancelled"].includes(status)) {
        filter.status = status;
      }

      const items = await orders()
        .find(filter)
        .sort({ createdAt: -1 })
        .toArray();

      res.json({ items, total: items.length });
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch orders" });
    }
  }
);

// GET /api/orders/:id  (the customer who placed it, the vendor it belongs to, or an admin)
router.get(
  "/:id",
  verifyToken,
  requireRole("customer", "vendor", "admin"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid order id" });
      }

      const order = await orders().findOne({ _id: new ObjectId(id) });
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      const user = req.user!;
      const allowed =
        user.role === "admin" ||
        (user.role === "customer" && order.customerId === user.id) ||
        (user.role === "vendor" && order.vendorId === user.id);
      if (!allowed) {
        return res
          .status(403)
          .json({ message: "You cannot view this order" });
      }

      res.json(order);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to fetch order" });
    }
  }
);

// PATCH /api/orders/:id/status
// Vendor: pending -> accepted or rejected (own orders only)
// Customer: pending -> cancelled (own orders only)
router.patch(
  "/:id/status",
  verifyToken,
  requireRole("customer", "vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const id = String(req.params.id);
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ message: "Invalid order id" });
      }

      const newStatus = String(req.body?.status || "");
      const user = req.user!;

      const order = await orders().findOne({ _id: new ObjectId(id) });
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (user.role === "vendor") {
        if (order.vendorId !== user.id) {
          return res
            .status(403)
            .json({ message: "You can only manage orders for your own items" });
        }
        if (newStatus !== "accepted" && newStatus !== "rejected") {
          return res
            .status(400)
            .json({ message: "Vendors can only accept or reject orders" });
        }
      } else {
        if (order.customerId !== user.id) {
          return res
            .status(403)
            .json({ message: "You can only cancel your own orders" });
        }
        if (newStatus !== "cancelled") {
          return res
            .status(400)
            .json({ message: "Customers can only cancel orders" });
        }
      }

      if (order.status !== "pending") {
        return res.status(409).json({
          message: `This order is already ${order.status}, so it cannot be changed`,
        });
      }

      // The status: "pending" condition makes the change happen only once,
      // even if two requests arrive at the same time
      const result = await orders().updateOne(
        { _id: order._id, status: "pending" },
        { $set: { status: newStatus, updatedAt: new Date() } }
      );
      if (result.matchedCount === 0) {
        return res
          .status(409)
          .json({ message: "This order was already updated" });
      }

      const updated = await orders().findOne({ _id: order._id });
      res.json(updated);
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to update order" });
    }
  }
);

export default router;