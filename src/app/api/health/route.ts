import { NextResponse } from "next/server";

// Health probe: proves the app boots, env is wired, and which PayPal environment is active.
// NOTE: intentionally does NOT touch PayPal or the DB — it must stay fast and side-effect free.
export async function GET() {
  return NextResponse.json({
    ok: true,
    paypal_env: process.env.PAYPAL_ENV === "live" ? "live" : "sandbox",
    llm_model: process.env.OPENROUTER_MODEL ?? "nvidia/nemotron-3-ultra-550b-a55b:free",
  });
}
