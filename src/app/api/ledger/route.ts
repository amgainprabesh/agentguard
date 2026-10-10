import { NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function GET() {
  return NextResponse.json({ records: decisions.ledgerRecords(), chain: decisions.verifyChain() });
}
