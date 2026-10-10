import { NextResponse } from "next/server";
import { env } from "@/lib/env";

// Health probe: proves the app boots, env is wired, and which PayPal environment is active.
// NOTE: intentionally does NOT touch PayPal or the DB — it must stay fast and side-effect free.
export async function GET() {
  return NextResponse.json({
    ok: true,
    paypal_env: env.paypalEnv(),
    llm_model: env.openrouterModel(),
  });
}
