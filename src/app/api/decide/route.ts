import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(req: NextRequest) {
  const { request, card } = await req.json();
  try {
    const d = await decisions.decide(request, card);
    return NextResponse.json(d, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
