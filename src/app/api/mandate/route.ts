import { NextRequest, NextResponse } from "next/server";
import { getMandateStore, getDecisions } from "@/lib/decisions-singleton";
import { ValidationError } from "@/lib/mandate";
import { errorMessage, parseJson } from "../_errors";

export async function GET() {
  return NextResponse.json(getMandateStore().get());
}

export async function PUT(req: NextRequest) {
  try {
    const updated = getMandateStore().update(await parseJson(req));
    getDecisions().setMandate(updated);
    return NextResponse.json(updated);
  } catch (e) {
    const status = e instanceof ValidationError ? 400 : 500;
    return NextResponse.json({ error: errorMessage(e, "mandate update failed") }, { status });
  }
}
