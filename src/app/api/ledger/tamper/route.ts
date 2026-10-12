import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";
import { errorMessage } from "../../_errors";

// demo-only endpoint behind the auditor view's "break the chain" button
export async function POST(req: NextRequest) {
  try {
    const { seq } = await req.json();
    // a seq that isn't a positive integer that EXISTS is a silent lie: the
    // UPDATE matches nothing, we'd return ok:true, and the demo would look
    // broken on stage ("nothing happened"). Fail loudly instead.
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1) {
      return NextResponse.json({ error: "seq must be a positive integer" }, { status: 400 });
    }
    if (!decisions.hasLedgerRow(seq)) {
      return NextResponse.json({ error: `no ledger row with seq ${seq}` }, { status: 404 });
    }
    decisions.tamperRecord(seq);
    return NextResponse.json({ ok: true, chain: decisions.verifyChain() });
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "tamper failed") }, { status: 400 });
  }
}
