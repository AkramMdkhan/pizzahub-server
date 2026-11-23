# PizzaHub — Pizza Ordering & Delivery Platform (Server)

[![Node.js](https://img.shields.io/badge/Node.js-20.x-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-REST%20API-000000?logo=express&logoColor=white)](https://expressjs.com/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-47A248?logo=mongodb&logoColor=white)](https://www.mongodb.com/)
[![Better Auth](https://img.shields.io/badge/Auth-Better%20Auth%20%2B%20JWT-orange)](https://www.better-auth.com/)
[![Stripe](https://img.shields.io/badge/Payments-Stripe%20Checkout%20%26%20Webhooks-635BFF?logo=stripe&logoColor=white)](https://stripe.com/)

The **PizzaHub Server** is the RESTful backend powering **PizzaHub**, a role-based pizza ordering and delivery platform. Built with **Express.js**, **MongoDB**, **Better Auth**, **JWT role-based middleware**, and **Stripe Checkout + Webhooks**, it enforces business rules, role authorization, resource ownership, and verified vendor subscription billing.

---

## Live Links & Repositories

- **Live Client Website:** `https://pizzahub-client-beige.vercel.app`
- **Live Server API:** `https://your-pizzahub-server-url.com`
- **Server Repository:** `https://github.com/AkramMdkhan/pizzahub-server`
- **Client Repository:** `https://github.com/AkramMdkhan/pizzahub-client`

---

## Core Architecture & Features

### Authentication & Role-Based Security
- **Better Auth + MongoDB Adapter:** Handles credential sign-up/sign-in, password validation, Google OAuth, and session/JWT issuance.
- **Public Registration Guard:** Public sign-up allows only `customer` or `vendor` roles; `admin` privileges cannot be self-assigned via registration or profile updates.
- **JWT & Role Verification Middleware:**
  - `verifyToken`: Validates the incoming JWT/session token on protected routes and returns `401 Unauthorized` for missing, invalid, or expired tokens.
  - `checkBlocked`: Rejects blocked users (`isBlocked: true`) with `403 Forbidden` before any protected action executes.
  - `requireRole(...roles)`: Enforces server-side role access (`customer`, `vendor`, `admin`) and returns `403 Forbidden` on unauthorized role attempts.
  - **Ownership Enforcement:** Every update, status change, or delete operation checks resource ownership (`vendorId` or `customerId`) against the authenticated user ID extracted from the verified token — never trusting user IDs or roles sent in the request body.

### Business Rules & Workflows
- **Menu Item Moderation & Plan Limits:**
  - Vendors submit menu items (`pending` status by default) for Admin review.
  - Only `approved` and active items are returned to public catalog endpoints; `rejected` or `inactive` items remain hidden from customers.
  - **Subscription Limit:** Vendors on the `free` plan are restricted to a maximum of **3 active menu items**; `premium` vendors can publish **unlimited** active items.
- **Order Lifecycle Management:**
  - Customers submit orders (`pending` status) with delivery date, delivery address, and optional instructions.
  - Prevents vendors from ordering their own items, prevents admins from placing customer orders, and blocks duplicate active orders for the same item and delivery date.
  - **Customers** can cancel only their own `pending` orders.
  - **Vendors** can `accept` or `reject` incoming `pending` orders for their own items once.
- **Stripe Vendor Subscriptions & Webhooks:**
  - Vendors initiate a **Stripe Checkout Session** to upgrade to `premium`.
  - Premium status is activated **exclusively** after the backend verifies Stripe's `checkout.session.completed` webhook event signature (`STRIPE_WEBHOOK_SECRET`), records an immutable payment entry in `transactions`, and updates the vendor's `subscriptionPlan` and `subscriptionExpiresAt` fields.
- **Admin Governance:**
  - Manage registered users (search, filter by role, block/unblock).
  - Review submitted menu items (`approve`, `reject`, toggle status, or delete).
  - Inspect platform `transactions` in a strictly read-only audit endpoint (payment records cannot be altered by admins).

---

## MongoDB Database Schema

Beyond Better Auth's internal auth collections, the backend uses four structured collections:

| Collection | Key Fields & References |
| :--- | :--- |
| **`users`** *(Better Auth)* | `name`, `email`, `image`, `role` (`vendor` \| `customer` \| `admin`), `isBlocked`, `businessName` *(vendor)*, `subscriptionPlan` (`free` \| `premium`), `subscriptionExpiresAt` |
| **`menuItems`** | `vendorId` *(ref: `users`)*, `itemName`, `category`, `description`, `price`, `location`, `images`, `status` (`pending` \| `approved` \| `rejected` \| `inactive`), `createdAt` |
| **`orders`** | `itemId` *(ref: `menuItems`)*, `vendorId` *(ref: `users`)*, `customerId` *(ref: `users`)*, `deliveryDate`, `deliveryAddress`, `message`, `status` (`pending` \| `accepted` \| `rejected` \| `cancelled`), `createdAt` |
| **`transactions`** | `vendorId` *(ref: `users`)*, `plan`, `amount`, `currency`, `stripeSessionId`, `stripeSubscriptionId`, `status`, `createdAt` |

---

## API Endpoints Overview

### Public Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Server health check |
| `GET` | `/api/menu-items` | List approved & active menu items (supports search, filter & price sorting) |
| `GET` | `/api/menu-items/featured` | Fetch featured approved & active menu items for homepage |
| `GET` | `/api/menu-items/:id` | Fetch single menu item details |

### Authenticated Customer Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/orders` | Create a new order (`pending` status, enforces duplicate & self-order checks) |
| `GET` | `/api/orders/my-orders` | Get logged-in customer's orders |
| `PATCH` | `/api/orders/:id/cancel` | Cancel own `pending` order |
| `PATCH` | `/api/users/profile` | Update own editable profile fields (blocks role/subscription mutation) |

### Authenticated Vendor Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/menu-items` | Submit a new menu item (enforces Free plan max 3 active items) |
| `GET` | `/api/menu-items/vendor/me` | List all menu items owned by the authenticated vendor |
| `PATCH` | `/api/menu-items/:id` | Update owned menu item or toggle availability |
| `DELETE` | `/api/menu-items/:id` | Delete owned menu item |
| `GET` | `/api/orders/vendor` | View incoming customer orders for vendor's items |
| `PATCH` | `/api/orders/:id/status` | Accept or reject a `pending` order once |
| `POST` | `/api/payments/create-checkout-session` | Create a Stripe Checkout Session for Vendor Premium upgrade |

### Authenticated Admin Endpoints
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/admin/stats` | Platform overview counts & analytics |
| `GET` | `/api/admin/users` | List, search, and filter registered users |
| `PATCH` | `/api/admin/users/:id/block` | Block or unblock a user |
| `GET` | `/api/admin/menu-items` | View, search, and filter all submitted menu items |
| `PATCH` | `/api/admin/menu-items/:id/status` | Approve, reject, or update menu item status |
| `DELETE` | `/api/admin/menu-items/:id` | Delete inappropriate menu item |
| `GET` | `/api/admin/transactions` | Read-only list of all vendor subscription transactions |

### Webhooks
| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/webhooks/stripe` | Verified Stripe webhook handler (`express.raw`) for subscription activation |

---

## Challenge Implementations

1. **Advanced Search & Price Sorting API (`GET /api/menu-items`):**
   - Built a dynamic MongoDB query and sort pipeline supporting query parameters:
     - `search`: Case-insensitive regex match across `itemName` (and description/category).
     - `category`: Exact category filter (e.g., `Classic Pizzas`, `Meat Lovers`).
     - `location`: Case-insensitive filter on restaurant city/area (`location`).
     - `sort`: Supports `price_asc` (`{ price: 1 }`) and `price_desc` (`{ price: -1 }`), defaulting to `{ createdAt: -1 }`.
   - Always enforces `{ status: "approved" }` on public queries so unapproved or rejected items are never exposed.

2. **JWT Verification & Role-Based Middleware Flow:**
   - Every protected route passes through a sequential middleware chain: `verifyToken` → `checkBlocked` → `requireRole(...)`.
   - `verifyToken` extracts the `Authorization: Bearer <token>` header (or verified Better Auth session token), validates signature and expiration, attaches the decoded user (`id`, `email`, `role`) to `req.user`, and rejects invalid or expired tokens with `401 Unauthorized`.
   - `requireRole` verifies `req.user.role` against allowed roles and rejects unauthorized access with `403 Forbidden`, while route controllers validate document ownership before any write operation.

3. **Stripe Checkout & Webhook-Verified Subscriptions + Production Stability:**
   - **Stripe Webhook Flow:** Mounted `/api/webhooks/stripe` with `express.raw({ type: "application/json" })` *before* `express.json()` so Stripe's raw payload signature can be verified via `stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)`. Upon `checkout.session.completed`, the server extracts `vendorId` from session metadata, inserts a record into `transactions`, and upgrades `users.subscriptionPlan` to `"premium"`.
   - **Production Deployment:** Configured explicit CORS policies for the deployed frontend origin, centralized error-handling middleware, and proper HTTP status codes (`400`, `401`, `403`, `404`, `500`) to ensure zero CORS, `404`, or `504` issues in production.

---

## Technology Stack & Packages

- **Runtime & Framework:** [Node.js](https://nodejs.org/), [Express.js](https://expressjs.com/)
- **Database:** [MongoDB](https://www.mongodb.com/) (Official MongoDB Node.js Driver / Mongoose)
- **Authentication & Security:** [Better Auth](https://www.better-auth.com/), `jsonwebtoken`, `cors`, `dotenv`
- **Payments:** [Stripe Node SDK](https://www.npmjs.com/package/stripe) (`stripe`)

---

## Environment Variables

Create a `.env` file in the root of the server repository. **Never commit `.env` or secret credentials to GitHub.**

```env
# Server Configuration
PORT=5000
NODE_ENV=production
CLIENT_URL=http://localhost:3000

# MongoDB Connection
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/<database>?retryWrites=true&w=majority

# Better Auth & JWT Secrets
BETTER_AUTH_SECRET=your_better_auth_secret_key
BETTER_AUTH_URL=http://localhost:5000
JWT_SECRET=your_jwt_signing_secret

# Google OAuth
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret

# Stripe Keys (Server-Side Only)
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_stripe_webhook_signing_secret
STRIPE_PREMIUM_PRICE_ID=price_your_premium_subscription_price_id
