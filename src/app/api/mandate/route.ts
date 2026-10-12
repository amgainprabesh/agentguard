import { NextRequest, NextResponse } from "next/server";
import { mandateStore, decisions } from "@/lib/decisions-singleton";
import { errorMessage } from "../_errors";

export async function GET() {
  return NextResponse.json(mandateStore.get());
}

export async function PUT(req: NextRequest) {
  try {
    const updated = mandateStore.update(await req.json());
    decisions.setMandate(updated);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "mandate update failed") }, { status: 400 });
  }
}
