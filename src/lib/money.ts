// The ONLY money arithmetic in the codebase. Integer cents, round-half-up on the
// capture side, remainder voids. Sum is always exactly the input total.
export function splitForScore(
  total_cents: number,
  score: number,
): { capture_cents: number; void_cents: number } {
  const clamped = Math.max(0, Math.min(100, score));
  const capture_cents = Math.round((total_cents * clamped) / 100);
  return { capture_cents, void_cents: total_cents - capture_cents };
}
