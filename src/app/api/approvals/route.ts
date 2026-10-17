import { NextResponse } from "next/server";
import { getDecisions } from "@/lib/decisions-singleton";

export async function GET() {
  return NextResponse.json(getDecisions().listPending());
}
