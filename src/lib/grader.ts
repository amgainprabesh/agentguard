// Sprint 1 stub: fixed score so the vertical slice runs without an LLM.
// Sprint 2 replaces gradeStub with a real OpenRouter call + strict JSON schema.
export async function gradeStub(
  _submission: string,
  rubric: { criterion: string; weight: number }[],
): Promise<{ score: number; breakdown: { criterion: string; score: number }[] }> {
  return {
    score: 75,
    breakdown: rubric.map((r) => ({ criterion: r.criterion, score: 75 })),
  };
}
