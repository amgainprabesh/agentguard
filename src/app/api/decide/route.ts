import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";
import { errorMessage } from "../_errors";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const request = body?.request;
    if (typeof request !== "string" || !request.trim()) {
      return NextResponse.json({ error: "request must be a non-empty string" }, { status: 400 });
    }
    // cap the prompt: the whole string is sent to the LLM — an unbounded body
    // burns tokens and blocks the decide() path. 2,000 chars is ~10x any real
    // spend request.
    if (request.length > 2_000) {
      return NextResponse.json({ error: "request must be 2,000 characters or fewer" }, { status: 400 });
    }
    const d = await decisions.decide(request, body?.card);
    return NextResponse.json(d, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "decision failed") }, { status: 400 });
  }
}
