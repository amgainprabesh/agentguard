import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

// demo-only endpoint behind the auditor view's "break the chain" button
export async function POST(req: NextRequest) {
  try {
    const { seq } = await req.json();
    decisions.tamperRecord(Number(seq));
    return NextResponse.json({ ok: true, chain: decisions.verifyChain() });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
