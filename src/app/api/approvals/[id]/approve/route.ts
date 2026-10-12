import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";
import { errorMessage } from "../../../_errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const d = await decisions.approve(id, body?.card);
    return NextResponse.json(d);
  } catch (e) {
    return NextResponse.json({ error: errorMessage(e, "approval failed") }, { status: 400 });
  }
}
