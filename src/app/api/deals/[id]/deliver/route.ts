import { NextRequest, NextResponse } from "next/server";
import { escrow } from "@/lib/escrow-singleton";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { submission } = await req.json();
  try {
    const deal = await escrow.deliver(id, submission);
    return NextResponse.json(deal);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
