import { Deal } from "./deal.ts";
import { Ledger } from "./ledger.ts";
import { createOrderWithCard, capturePartial, voidAuthorization } from "./paypal.ts";
import { gradeStub } from "./grader.ts";
import { splitForScore } from "./money.ts";

export interface EscrowDealView {
  id: string;
  state: Deal["state"];
  auth_id: string | null;
  score: number | null;
  capture_cents?: number;
  void_cents?: number;
}

export class Escrow {
  private deals = new Map<string, Deal>();
  private ledger: Ledger;

  constructor(ledger: Ledger) {
    this.ledger = ledger;
  }

  async createDeal(input: {
    amount_cents: number;
    card: { number: string; expiry: string; security_code: string; name: string };
    rubric: { criterion: string; weight: number }[];
  }): Promise<EscrowDealView & { auth_id: string }> {
    if (!Number.isInteger(input.amount_cents) || input.amount_cents <= 0) {
      throw new Error("amount_cents must be a positive integer");
    }
    const id = crypto.randomUUID();
    const deal = new Deal({ id, amount_cents: input.amount_cents, rubric: input.rubric });
    this.deals.set(id, deal);

    const { order_id, auth_id } = await createOrderWithCard({
      amount_cents: input.amount_cents,
      card: input.card,
    });
    deal.authorize(auth_id);

    this.ledger.append({
      action: "ALLOW",
      amount_cents: input.amount_cents,
      reason: `deal ${id} authorized, order ${order_id}, auth ${auth_id}, rubric ${input.rubric.map((r) => r.criterion).join(",")}`,
    });
    return { id, state: deal.state, auth_id, score: null };
  }

  private get(id: string): Deal {
    const d = this.deals.get(id);
    if (!d) throw new Error(`deal ${id} not found`);
    return d;
  }

  async deliver(id: string, submission: string): Promise<EscrowDealView> {
    const deal = this.get(id);
    deal.deliver(submission);
    return { id, state: deal.state, auth_id: deal.auth_id, score: deal.score };
  }

  async settle(id: string): Promise<EscrowDealView & { capture_cents: number; void_cents: number }> {
    const deal = this.get(id);
    const grade = await gradeStub(deal.submission ?? "", deal.init.rubric ?? []);
    deal.grade(grade.score);

    const total = deal.init.amount_cents;
    const { capture_cents, void_cents } = splitForScore(total, grade.score);

    if (!deal.auth_id) throw new Error("deal has no authorization to settle against");

    // capture the earned share, then void the rest; any failure marks the deal
    // FAILED so it can never half-settle twice
    try {
      const cap = await capturePartial(deal.auth_id, capture_cents);
      this.ledger.append({
        action: "ALLOW",
        amount_cents: capture_cents,
        reason: `deal ${id} captured score ${grade.score}, capture ${cap.id}`,
      });

      // skip void when capture took the full amount — void of a fully-captured
      // authorization 422s
      if (void_cents > 0) {
        await voidAuthorization(deal.auth_id);
        this.ledger.append({
          action: "DENY",
          amount_cents: void_cents,
          reason: `deal ${id} voided remainder`,
        });
      }
    } catch (e) {
      deal.fail(`settlement failed: ${e}`);
      throw e;
    }

    deal.settle();
    return { id, state: deal.state, auth_id: deal.auth_id, score: deal.score, capture_cents, void_cents };
  }
}
