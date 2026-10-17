import { NextRequest, NextResponse } from "next/server";
import { getDecisions } from "@/lib/decisions-singleton";
import { ValidationError } from "@/lib/mandate";
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
    const d = await getDecisions().decide(request, body?.card);
    return NextResponse.json(d, { status: 201 });
  } catch (e) {
    // validation = client error (400); vendor/LLM failures = server error (500,
    // generic body — the DENY row in the ledger keeps the detail for the auditor)
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(e, "decision failed") }, { status });
  }
}
