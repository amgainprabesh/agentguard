import { env } from "./env.ts";

// 15s cap per PayPal call: a hung TCP connect would otherwise leave an
// authorization in flight with no way to recover the decide() path.
const TIMEOUT_MS = 15_000;

interface Token {
  value: string;
  expires_at: number;
}
let token: Token | null = null;

// Test hook: clears the module-level token cache so caching tests are order-independent.
export function resetPayPalToken(): void {
  token = null;
}

async function getToken(): Promise<string> {
  if (token && token.expires_at > Date.now() + 30_000) return token.value;
  const basic = Buffer.from(`${env.paypalClientId()}:${env.paypalSecret()}`).toString("base64");
  const res = await fetch(`${env.paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    // status only in the error — the body goes to the server log, never into
    // the ledger or back toward the client
    console.error(`PayPal token failed: ${res.status} ${await res.text()}`);
    throw new Error(`PayPal token failed: ${res.status}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return token.value;
}

// Create order + embedded authorization in one call, using a card payment_source.
// The authorization id comes back INSIDE the create response — there is no separate
// authorize step for card orders (the authorize endpoint 422s with ORDER_ALREADY_AUTHORIZED).
export async function createOrderWithCard(input: {
  amount_cents: number;
  card: { number: string; expiry: string; security_code: string; name: string };
}): Promise<{ order_id: string; auth_id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${tok}`,
      "content-type": "application/json",
      // PayPal REQUIRES this header when payment_source is present at create time
      "PayPal-Request-Id": crypto.randomUUID(),
    },
    body: JSON.stringify({
      intent: "AUTHORIZE",
      purchase_units: [
        {
          amount: {
            currency_code: "USD",
            value: (input.amount_cents / 100).toFixed(2),
          },
        },
      ],
      payment_source: {
        card: {
          number: input.card.number,
          expiry: input.card.expiry,
          security_code: input.card.security_code,
          name: input.card.name,
          billing_address: {
            address_line_1: "123 Main St",
            admin_area_2: "San Jose",
            admin_area_1: "CA",
            postal_code: "95131",
            country_code: "US",
          },
        },
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }),
  });
  if (!res.ok) {
    // status only in the error — the body (unbounded JSON with debug details)
    // goes to the server log, never into the ledger row or the API error
    console.error(`PayPal createOrderWithCard failed: ${res.status} ${await res.text()}`);
    throw new Error(`PayPal createOrderWithCard failed: ${res.status}`);
  }
  const data = (await res.json()) as {
    id: string;
    status: string;
    purchase_units: { payments: { authorizations: { id: string; status: string }[] } }[];
  };
  const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error("no authorization returned in create response");
  return { order_id: data.id, auth_id: auth.id, status: auth.status };
}

export async function capturePartial(
  auth_id: string,
  amount_cents: number,
): Promise<{ id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/payments/authorizations/${auth_id}/capture`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      amount: { currency_code: "USD", value: (amount_cents / 100).toFixed(2) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    console.error(`PayPal capturePartial failed: ${res.status} ${await res.text()}`);
    throw new Error(`PayPal capturePartial failed: ${res.status}`);
  }
  return (await res.json()) as { id: string; status: string };
}
