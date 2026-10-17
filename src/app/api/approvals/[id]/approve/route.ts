import { NextRequest, NextResponse } from "next/server";
import { getDecisions } from "@/lib/decisions-singleton";
import { ValidationError } from "@/lib/mandate";
import { errorMessage } from "../../../_errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await req.json();
    const d = await getDecisions().approve(id, body?.card);
    return NextResponse.json(d);
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(e, "approval failed") }, { status });
  }
}
