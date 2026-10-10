import { NextRequest, NextResponse } from "next/server";
import { escrow } from "@/lib/escrow-singleton";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const deal = await escrow.settle(id);
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
