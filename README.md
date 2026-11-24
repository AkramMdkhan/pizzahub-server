<div align="center">

# 🍕 PizzaHub Server

**The REST API behind PizzaHub, a role-based pizza ordering and delivery platform**

An Express and MongoDB backend that secures every request with JWT, enforces customer, vendor and admin permissions, and handles Stripe Premium subscriptions through verified webhooks.

<p>
  <img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/Express-000000?style=for-the-badge&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/MongoDB-47A248?style=for-the-badge&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Stripe-635BFF?style=for-the-badge&logo=stripe&logoColor=white" />
  <img src="https://img.shields.io/badge/Render-46E3B7?style=for-the-badge&logo=render&logoColor=black" />
</p>

 [Live Client](https://pizzahub-client-beige.vercel.app) · [Client Repository](https://github.com/AkramMdkhan/pizzahub-client) · [Server Repository](https://github.com/AkramMdkhan/pizzahub-server)

</div>

---

## 📖 About the Project

PizzaHub connects customers who want to order pizza with local vendors who run their menus, and admins who keep the platform trustworthy. This repository is the **server** that powers it.

The client signs users in with Better Auth and sends a JWT with every protected request. The server verifies that token, checks the user's role and ownership of the resource, and only then reads or writes data. Nothing is trusted from the client, so roles, subscription fields and order statuses can only be changed through the rules defined here.

**What the server handles:**
- **Menu items:** Vendors create and manage items. Items start as `pending` and only appear publicly once an admin approves them.
- **Orders:** Customers place and cancel orders, and vendors accept or reject them, with every business rule enforced on the server.
- **Admin tools:** Platform statistics, user management, menu moderation and a read-only transaction log.
- **Subscriptions:** Stripe Checkout sessions for the vendor Premium plan, activated only by verified webhook events.

> **Note on order checkout:** Customers do not pay through Stripe when ordering a pizza. Stripe is used only for vendor Premium subscriptions.

---

## ✨ Features

- **JWT Authentication:** A `verifyToken` middleware validates the token on every protected route. Invalid or expired tokens return `401`.
- **Role-Based Access:** A `requireRole` middleware restricts routes to `customer`, `vendor` or `admin`. Insufficient role or ownership returns `403`.
- **Menu Item Management:** Full create, read, update and delete for vendors, with ownership checks. Public routes return approved items only.
- **Advanced Search and Price Sorting:** The public menu endpoint supports search, category and location filters, price sorting and pagination.
- **Order Rules:**
  - Vendors cannot order their own items, and admins cannot place orders.
  - Only approved and active items can be ordered.
  - A customer cannot place a duplicate active order for the same item and delivery date.
  - Customers cancel only `pending` orders, and vendors accept or reject `pending` orders only once.
- **Free Plan Limit:** Free vendors can have at most 3 pending or approved items, while Premium vendors are unlimited.
- **Stripe Premium Subscription:** Checkout session creation and session status lookup, with Premium activation driven by signed webhook events.
- **Verified Webhooks:** The webhook route reads the raw request body and verifies the Stripe signature before changing anything.
- **Transactions Log:** Every subscription payment is stored and exposed to admins in a read-only view.
- **Admin Moderation:** Approve, reject, deactivate or delete menu items, search and filter users, and view platform-wide statistics.

---

## 🧰 Tech Stack

| Category | Technologies |
| --- | --- |
| Runtime and Framework | Node.js, Express.js |
| Language | TypeScript |
| Database | MongoDB (native driver) |
| Authentication | JWT verification (secret shared with the Better Auth client) |
| Payments | Stripe Checkout, Stripe Webhooks |
| Security | CORS with an allowed client origin |
| Deployment | Render |

---

## 📦 Dependencies

| Package | Purpose |
| --- | --- |
| `express` | HTTP server and routing |
| `mongodb` | Database driver |
| `jsonwebtoken` | JWT verification |
| `stripe` | Checkout sessions and webhook verification |
| `cors` | Cross-origin requests from the client |
| `dotenv` | Environment variables |
| `typescript`, `tsx` | Type checking and development runner |

See [`package.json`](./package.json) for the complete list.

---

## 🗂️ Collections

| Collection | Purpose |
| --- | --- |
| `users` | Accounts created by Better Auth, including `role`, `subscriptionPlan` and `subscriptionExpiresAt` |
| `menuItems` | Pizzas and other items with category, price, location, images and approval status |
| `orders` | Customer orders with delivery details and status |
| `transactions` | Subscription payment records created from Stripe events |

---

## 🛣️ API Overview

| Area | Base Path | Access |
| --- | --- | --- |
| Health | `/api/health` | Public |
| Menu Items | `/api/menu-items` | Public reads (approved only), vendor writes |
| Orders | `/api/orders` | Customer and vendor, role-checked |
| Admin | `/api/admin` | Admin only: stats, users, menu items, transactions |
| Stripe | `/api/stripe` | Vendor: checkout and session status |
| Stripe Webhook | `/api/stripe/webhook` | Stripe only, signature verified |

### Menu query parameters

```http
GET /api/menu-items?search=margherita&category=Classic&location=Dhaka&sort=price_asc&page=1
```

`sort` accepts `price_asc` or `price_desc`.

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- A MongoDB connection string
- A Stripe account (test mode) and the [Stripe CLI](https://stripe.com/docs/stripe-cli) for local webhooks
- The [PizzaHub client](https://github.com/AkramMdkhan/pizzahub-client) for the full experience

### Installation

```bash
git clone https://github.com/AkramMdkhan/pizzahub-server.git
cd pizzahub-server
npm install
```

### Environment Variables

Create a `.env` file in the project root. Never commit it to GitHub.

```env
PORT=5000
MONGODB_URI=your_mongodb_connection_string
JWT_SECRET=same_secret_used_by_the_client
CLIENT_URL=http://localhost:3000
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_signing_secret
```

`JWT_SECRET` must match the secret the client uses to sign tokens.

### Run Locally

```bash
npm run dev
```

The API will be available at http://localhost:5000.

### Test Stripe Webhooks Locally

```bash
stripe listen --events checkout.session.completed,invoice.paid,invoice.payment_failed,customer.subscription.deleted --forward-to localhost:5000/api/stripe/webhook
```

Copy the signing secret it prints into `STRIPE_WEBHOOK_SECRET`.

### Production Build

```bash
npm run build
npm start
```

---

## ☁️ Deployment

The server is deployed on **Render**.

- Set every variable from the list above in the Render dashboard, with `CLIENT_URL` set to the live client address.
- In the Stripe dashboard, add a webhook endpoint at `https://YOUR-RENDER-URL.onrender.com/api/stripe/webhook` for the four events above, and use its signing secret as `STRIPE_WEBHOOK_SECRET`.
- Render's free tier may sleep after inactivity, so the first request can take a few seconds.

---

## 🔗 Links

- **Live Client:** https://pizzahub-client-beige.vercel.app
- **Client Repository:** https://github.com/AkramMdkhan/pizzahub-client
- **Server Repository:** https://github.com/AkramMdkhan/pizzahub-server

---

## 👤 Author

**Akram Mohammad Khan**, MERN Stack Developer

[Portfolio](https://akram-mohammad-khan-portfolio.vercel.app) · [GitHub](https://github.com/AkramMdkhan) · [LinkedIn](https://www.linkedin.com/in/akrammdkhan)
