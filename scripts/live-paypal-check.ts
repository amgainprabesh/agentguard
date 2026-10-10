// Verifies the app's own card create + partial capture + void against the LIVE PayPal sandbox.
// Run: npm run live-check:paypal
import { createOrderWithCard, capturePartial, voidAuthorization } from "../src/lib/paypal.ts";

const { order_id, auth_id } = await createOrderWithCard({
  amount_cents: 1000,
  card: {
    number: process.env.TEST_CARD_NUMBER ?? "4111111111111111",
    expiry: "2028-12",
    security_code: "123",
    name: "Test Buyer",
  },
});
console.log("order:", order_id, "auth:", auth_id);

const cap = await capturePartial(auth_id, 400);
console.log("captured $4:", cap.id, cap.status);

const voided = await voidAuthorization(auth_id);
console.log("voided remainder:", voided);

if (voided !== true) throw new Error("void did not return true");
console.log("PASS: partial capture + void works end to end");
