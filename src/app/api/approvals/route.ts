import { NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function GET() {
  return NextResponse.json(decisions.listPending());
}
