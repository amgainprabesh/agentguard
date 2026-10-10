import { NextRequest, NextResponse } from "next/server";
import { decisions } from "@/lib/decisions-singleton";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await decisions.denyApproval(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }
}
