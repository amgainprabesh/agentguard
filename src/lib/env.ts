// Shortcut: reads process.env lazily per call; Next.js auto-loads .env.local so no
// dotenv needed in dev. Upgrade to zod validation if env handling grows past this.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} — copy .env.example to .env.local`);
  return v;
}

export const env = {
  paypalClientId: () => required("PAYPAL_CLIENT_ID"),
  paypalSecret: () => required("PAYPAL_SECRET"),
  paypalEnv: () => (process.env.PAYPAL_ENV === "live" ? "live" : "sandbox"),
  paypalBaseUrl: () =>
    env.paypalEnv() === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com",
  openrouterApiKey: () => required("OPENROUTER_API_KEY"),
  openrouterModel: () => process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-lightning:free",
};
