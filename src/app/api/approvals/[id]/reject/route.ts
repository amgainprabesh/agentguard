import { NextRequest, NextResponse } from "next/server";
import { getDecisions } from "@/lib/decisions-singleton";
import { ValidationError } from "@/lib/mandate";
import { errorMessage } from "../../../_errors";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await getDecisions().denyApproval(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(e, "rejection failed") }, { status });
  }
}
