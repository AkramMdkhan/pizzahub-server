import { Request, Response } from "express";
import { ObjectId } from "mongodb";
import Stripe from "stripe";
import { getDB } from "../config/db";
import { getStripe, FREE_PLAN_MAX_ACTIVE_ITEMS } from "../config/stripe";

function users() {
  return getDB().collection("user"); // Better Auth collection
}

function transactions() {
  return getDB().collection("transactions");
}

function menuItems() {
  return getDB().collection("menuItems");
}

function userFilter(vendorId: string) {
  return ObjectId.isValid(vendorId)
    ? { _id: new ObjectId(vendorId) }
    : { id: vendorId };
}

// Stripe moved the period end between API versions, so check both places
function getPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0] as unknown as
    | { current_period_end?: number }
    | undefined;
  const legacy = subscription as unknown as { current_period_end?: number };
  const seconds = item?.current_period_end ?? legacy.current_period_end;
  return seconds ? new Date(seconds * 1000) : null;
}

// Same idea for the subscription id on an invoice
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
  const inv = invoice as unknown as {
    subscription?: string | { id: string } | null;
    parent?: {
      subscription_details?: { subscription?: string | { id: string } | null };
    } | null;
  };
  const ref = inv.subscription ?? inv.parent?.subscription_details?.subscription;
  if (!ref) return null;
  return typeof ref === "string" ? ref : ref.id;
}

async function activatePremium(vendorId: string, expiresAt: Date) {
  await users().updateOne(userFilter(vendorId), {
    $set: {
      subscriptionPlan: "premium",
      subscriptionExpiresAt: expiresAt,
      updatedAt: new Date(),
    },
  });
}

// Back to Free. Approved items beyond the free limit become inactive
// (the oldest ones stay active).
async function downgradeToFree(vendorId: string) {
  await users().updateOne(userFilter(vendorId), {
    $set: { subscriptionPlan: "free", updatedAt: new Date() },
    $unset: { subscriptionExpiresAt: "" },
  });

  const approved = await menuItems()
    .find({ vendorId, status: "approved" })
    .sort({ createdAt: 1, _id: 1 })
    .toArray();

  const extraIds = approved
    .slice(FREE_PLAN_MAX_ACTIVE_ITEMS)
    .map((item) => item._id);

  if (extraIds.length > 0) {
    await menuItems().updateMany(
      { _id: { $in: extraIds } },
      { $set: { status: "inactive", updatedAt: new Date() } }
    );
  }
}

async function getSubscriptionVendorId(subscriptionId: string) {
  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  return {
    subscription,
    vendorId: subscription.metadata?.vendorId || null,
  };
}

export async function handleStripeWebhook(req: Request, res: Response) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = req.headers["stripe-signature"];

  if (!secret || typeof signature !== "string") {
    return res.status(400).send("Missing webhook secret or signature");
  }

  // Only events that really come from Stripe pass this check
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(req.body, signature, secret);
  } catch (error) {
    console.error("Webhook signature check failed:", error);
    return res.status(400).send("Invalid signature");
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode !== "subscription" || session.payment_status !== "paid") {
          break;
        }

        const vendorId =
          session.client_reference_id || session.metadata?.vendorId;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!vendorId || !subscriptionId) break;

        const subscription = await getStripe().subscriptions.retrieve(
          subscriptionId
        );
        const expiresAt =
          getPeriodEnd(subscription) ??
          new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);

        await activatePremium(vendorId, expiresAt);

        // One transaction per checkout session, even if Stripe retries the event
        await transactions().updateOne(
          { stripeSessionId: session.id },
          {
            $setOnInsert: {
              vendorId,
              plan: "premium",
              amount: (session.amount_total ?? 0) / 100,
              currency: session.currency ?? "usd",
              stripeSessionId: session.id,
              stripeSubscriptionId: subscriptionId,
              status: "paid",
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        // The first invoice is handled by checkout.session.completed
        if (invoice.billing_reason !== "subscription_cycle") break;

        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;

        const { subscription, vendorId } = await getSubscriptionVendorId(
          subscriptionId
        );
        if (!vendorId) break;

        const expiresAt = getPeriodEnd(subscription);
        if (expiresAt) await activatePremium(vendorId, expiresAt);

        await transactions().updateOne(
          { stripeInvoiceId: invoice.id },
          {
            $setOnInsert: {
              vendorId,
              plan: "premium",
              amount: (invoice.amount_paid ?? 0) / 100,
              currency: invoice.currency ?? "usd",
              stripeSessionId: null,
              stripeInvoiceId: invoice.id,
              stripeSubscriptionId: subscriptionId,
              status: "paid",
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = getInvoiceSubscriptionId(invoice);
        if (!subscriptionId) break;

        const { vendorId } = await getSubscriptionVendorId(subscriptionId);
        if (!vendorId) break;

        await transactions().updateOne(
          { stripeInvoiceId: invoice.id },
          {
            $setOnInsert: {
              vendorId,
              plan: "premium",
              amount: (invoice.amount_due ?? 0) / 100,
              currency: invoice.currency ?? "usd",
              stripeSessionId: null,
              stripeInvoiceId: invoice.id,
              stripeSubscriptionId: subscriptionId,
              status: "failed",
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const vendorId = subscription.metadata?.vendorId;
        if (vendorId) await downgradeToFree(vendorId);
        break;
      }

      default:
        // Other events are not needed
        break;
    }
  } catch (error) {
    console.error("Webhook handler failed:", error);
    // A 500 makes Stripe try the event again later
    return res.status(500).send("Webhook handler failed");
  }

  res.json({ received: true });
}