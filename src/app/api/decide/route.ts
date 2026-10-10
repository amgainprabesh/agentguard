import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const request = body?.request;
    if (typeof request !== "string" || !request.trim()) {
      return NextResponse.json({ error: "request must be a non-empty string" }, { status: 400 });
    }
    const d = await decisions.decide(request, body?.card);
    return NextResponse.json(d, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
