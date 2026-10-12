import { NextResponse } from "next/server";

// Error responses used to be `String(e)` — the raw exception text, e.g.
// "Error: approval not-a-real-id not found" with a stack-shaped prefix and
// internal details (PayPal bodies, file paths) when a fetch fails. The client
// only needs the message; anything unexpected becomes a generic 500 so no
// internals leak. Known validation errors keep their message (the UI shows
// them as "Rejected: …").
const MAX_ERROR_LEN = 200;

export function errorResponse(e: unknown, fallback = "internal error"): NextResponse {
  const msg = e instanceof Error ? e.message : String(e);
  const isValidation = msg.length > 0 && msg.length <= MAX_ERROR_LEN;
  return NextResponse.json(
    { error: isValidation ? msg : fallback },
    { status: 400 },
  );
}
