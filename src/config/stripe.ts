import Stripe from "stripe";

let stripeClient: Stripe | null = null;

// Created on first use, so the rest of the server still starts
// even if the Stripe key is missing.
export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set in the server .env file");
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}

// The Premium subscription. Amount is in cents (1999 = $19.99).
export const PREMIUM_PLAN = {
  name: "PizzaHub Premium",
  description:
    "Unlimited active menu items, Premium badge and featured placement",
  amount: 1999,
  currency: "usd",
  interval: "month" as const,
};

// Free plan limit from the requirements
export const FREE_PLAN_MAX_ACTIVE_ITEMS = 3;