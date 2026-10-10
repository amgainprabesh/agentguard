// Shortcut: reads process.env lazily per call; Next.js auto-loads .env.local so no
// dotenv needed in dev. Upgrade to zod validation if env handling grows past this.
function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name} — copy .env.example to .env.local`);
  return v;
}

// This app is a sandbox demo: the UI hardcodes a test card and the ledger is a
// local file. Pointing it at the live API would attempt REAL charges with a test
// card. "live" is therefore not a supported mode — a stray PAYPAL_ENV=live in
// the environment fails closed to sandbox instead of moving real money.
// (PayPal's live mode also needs different credentials, which would 401 first —
// but failing closed is the safer default for a demo.)
const LIVE_MODE_SUPPORTED = false;

export const env = {
  paypalClientId: () => required("PAYPAL_CLIENT_ID"),
  paypalSecret: () => required("PAYPAL_SECRET"),
  paypalEnv: () => {
    const v = process.env.PAYPAL_ENV;
    if (v === "live" && LIVE_MODE_SUPPORTED) return "live";
    return "sandbox";
  },
  paypalBaseUrl: () =>
    env.paypalEnv() === "live"
      ? "https://api-m.paypal.com"
      : "https://api-m.sandbox.paypal.com",
  openrouterApiKey: () => required("OPENROUTER_API_KEY"),
  openrouterModel: () => process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3.5-lightning:free",
};
