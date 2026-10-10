import { env } from "./env.ts";

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
  });
  if (!res.ok) throw new Error(`PayPal token failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expires_at: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export async function createOrder(input: { amount_cents: number; currency?: string }): Promise<{ id: string; status: string }> {
  const tok = await getToken();
  const res = await fetch(`${env.paypalBaseUrl()}/v2/checkout/orders`, {
    method: "POST",
    headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({
      intent: "AUTHORIZE", // funds held, not taken — the whole escrow thesis
      purchase_units: [
        {
          amount: {
            currency_code: input.currency ?? "USD",
            value: (input.amount_cents / 100).toFixed(2),
          },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PayPal createOrder failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as { id: string; status: string };
}
