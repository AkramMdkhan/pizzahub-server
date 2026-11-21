import { Router, Response } from "express";
import { ObjectId } from "mongodb";
import { getDB } from "../config/db";
import { getStripe, PREMIUM_PLAN } from "../config/stripe";
import { verifyToken, requireRole } from "../middleware/auth";
import { AuthRequest } from "../types";

const router = Router();

const clientUrl = () => process.env.CLIENT_URL || "http://localhost:3000";

// Reads the vendor's record from the Better Auth "user" collection
async function findUser(id: string) {
  const users = getDB().collection("user");
  return users.findOne({
    $or: [
      ...(ObjectId.isValid(id) ? [{ _id: new ObjectId(id) }] : []),
      { id },
    ],
  });
}

// Premium counts only while the paid period has not ended
function readPlan(user: Record<string, unknown> | null) {
  const rawExpiry = user?.subscriptionExpiresAt;
  const expiresAt =
    rawExpiry instanceof Date ||
    typeof rawExpiry === "string" ||
    typeof rawExpiry === "number"
      ? new Date(rawExpiry)
      : null;

  const isPremium =
    user?.subscriptionPlan === "premium" &&
    expiresAt !== null &&
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() > Date.now();

  return {
    plan: isPremium ? "premium" : "free",
    isPremium,
    expiresAt: isPremium ? expiresAt : null,
  };
}

// POST /api/stripe/checkout  (vendors only)
// The vendor is always the logged-in user from the token.
// Nothing about who is paying is read from the request body.
router.post(
  "/checkout",
  verifyToken,
  requireRole("vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const vendor = req.user!;

      const user = await findUser(vendor.id);
      if (!user) {
        return res.status(404).json({ message: "Vendor account not found" });
      }

      if (readPlan(user).isPremium) {
        return res
          .status(409)
          .json({ message: "You already have an active Premium plan" });
      }

      const session = await getStripe().checkout.sessions.create({
        mode: "subscription",
        client_reference_id: vendor.id,
        customer_email: vendor.email,
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: PREMIUM_PLAN.currency,
              unit_amount: PREMIUM_PLAN.amount,
              recurring: { interval: PREMIUM_PLAN.interval },
              product_data: {
                name: PREMIUM_PLAN.name,
                description: PREMIUM_PLAN.description,
              },
            },
          },
        ],
        // The webhook uses these to know which vendor paid
        metadata: { vendorId: vendor.id },
        subscription_data: { metadata: { vendorId: vendor.id } },
        success_url: `${clientUrl()}/dashboard/vendor/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${clientUrl()}/dashboard/vendor/payment-cancel`,
      });

      if (!session.url) {
        return res
          .status(502)
          .json({ message: "Stripe did not return a checkout link" });
      }

      res.json({ url: session.url });
    } catch (error) {
      console.error("Checkout error:", error);
      res.status(500).json({ message: "Could not start the payment" });
    }
  }
);

// GET /api/stripe/status  (vendors only: my current plan, read from the database)
router.get(
  "/status",
  verifyToken,
  requireRole("vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const user = await findUser(req.user!.id);
      if (!user) {
        return res.status(404).json({ message: "Vendor account not found" });
      }
      res.json(readPlan(user));
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Failed to load subscription status" });
    }
  }
);

// GET /api/stripe/session/:id  (vendors only)
// Used by the success page to show a confirmation. It only reads data.
// Premium is never switched on here: only the verified webhook does that.
router.get(
  "/session/:id",
  verifyToken,
  requireRole("vendor"),
  async (req: AuthRequest, res: Response) => {
    try {
      const sessionId = String(req.params.id);
      if (!sessionId.startsWith("cs_")) {
        return res.status(400).json({ message: "Invalid session id" });
      }

      const session = await getStripe().checkout.sessions.retrieve(sessionId);

      // A vendor can only look at their own payment
      if (session.client_reference_id !== req.user!.id) {
        return res
          .status(403)
          .json({ message: "You cannot view this payment" });
      }

      res.json({
        paymentStatus: session.payment_status,
        amount: session.amount_total,
        currency: session.currency,
        email: session.customer_details?.email ?? null,
      });
    } catch (error) {
      console.error(error);
      res.status(404).json({ message: "Payment session not found" });
    }
  }
);

export default router;