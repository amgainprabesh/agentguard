import { NextRequest, NextResponse } from "next/server";
import { Escrow } from "@/lib/escrow";
import { Ledger } from "@/lib/ledger";
import { join } from "node:path";

// shortcut: one Escrow per route module; deal state is per-route (Sprint 2: shared singleton)
const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const deal = await escrow.createDeal(body);
    return NextResponse.json(deal, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
