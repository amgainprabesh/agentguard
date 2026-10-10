import { NextRequest, NextResponse } from "next/server";
import { Escrow } from "@/lib/escrow";
import { Ledger } from "@/lib/ledger";
import { join } from "node:path";

// shortcut: one Escrow per route module; deal state is per-route (Sprint 2: shared singleton)
const ledger = new Ledger(join(process.cwd(), "data", "agentguard.db"));
const escrow = new Escrow(ledger);

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deal = await escrow.settle(id);
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
