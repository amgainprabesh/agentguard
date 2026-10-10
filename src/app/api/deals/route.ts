import { NextRequest, NextResponse } from "next/server";
import { escrow } from "@/lib/escrow-singleton";

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const deal = await escrow.createDeal(body);
    return NextResponse.json(deal, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
