import { NextResponse } from "next/server";
import { getDecisions } from "@/lib/decisions-singleton";

export async function GET() {
  const d = getDecisions();
  return NextResponse.json({ records: d.ledgerRecords(), chain: d.verifyChain() });
}
