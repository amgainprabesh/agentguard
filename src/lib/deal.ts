export type DealState = "CREATED" | "AUTHORIZED" | "DELIVERED" | "GRADED" | "SETTLED" | "FAILED";

const TRANSITIONS: Record<DealState, DealState[]> = {
  CREATED: ["AUTHORIZED", "FAILED"],
  AUTHORIZED: ["DELIVERED", "FAILED"],
  DELIVERED: ["GRADED", "FAILED"],
  GRADED: ["SETTLED", "FAILED"],
  SETTLED: [],
  FAILED: [],
};

export function canTransition(from: DealState, to: DealState): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface DealInit {
  id: string;
  amount_cents: number;
}

export class Deal {
  state: DealState = "CREATED";
  auth_id: string | null = null;
  submission: string | null = null;
  score: number | null = null;
  history: DealState[] = ["CREATED"];
  readonly init: DealInit;

  constructor(init: DealInit) {
    this.init = init;
  }

  private move(to: DealState): void {
    if (!canTransition(this.state, to)) {
      throw new Error(`illegal transition ${this.state} -> ${to}`);
    }
    this.state = to;
    this.history.push(to);
  }

  authorize(auth_id: string): void {
    if (this.state !== "CREATED") throw new Error("deal is not in CREATED state");
    this.auth_id = auth_id;
    this.move("AUTHORIZED");
  }

  deliver(submission: string): void {
    if (this.state !== "AUTHORIZED") throw new Error("deal is not authorized");
    this.submission = submission;
    this.move("DELIVERED");
  }

  grade(score: number): void {
    if (this.state !== "DELIVERED") throw new Error("deal has no submission to grade");
    this.score = Math.max(0, Math.min(100, score));
    this.move("GRADED");
  }

  settle(): void {
    if (this.state !== "GRADED") throw new Error("deal is not graded");
    this.move("SETTLED");
  }

  fail(reason: string): void {
    if (this.state === "SETTLED") throw new Error("cannot fail a settled deal");
    this.move("FAILED");
  }
}
