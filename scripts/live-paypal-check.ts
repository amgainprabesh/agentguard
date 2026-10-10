// Verifies the app's own createOrder() against the live PayPal sandbox.
// Run from repo root: npx tsx scripts/live-paypal-check.ts  (or via a quick node --import)
import { createOrder } from "../src/lib/paypal.ts";

const order = await createOrder({ amount_cents: 100, currency: "USD" });
console.log("LIVE ORDER:", JSON.stringify(order, null, 2));

if (!order.id) throw new Error("no order id returned");
if (order.status !== "CREATED") throw new Error(`unexpected status: ${order.status}`);
console.log("PASS: app createOrder works against live sandbox");
