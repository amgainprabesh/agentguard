import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { card } = await req.json();
    const d = await decisions.approve(id, card);
    return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
