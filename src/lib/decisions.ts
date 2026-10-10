import { Ledger, type LedgerRecord } from "./ledger.ts";
import { createOrderWithCard, capturePartial } from "./paypal.ts";
import { evaluate, type Mandate, type MonthContext, type SpendIntent } from "./policy.ts";
import { extractIntent } from "./intent.ts";

export interface CardInput {
  number: string;
  expiry: string;
  security_code: string;
  name: string;
}

export interface DecisionResult {
  decision: "ALLOW" | "DENY" | "ESCALATE";
  reasons: string[];
  intent?: SpendIntent;
  capture_id?: string;
  approval_id?: string;
}

export interface PendingApproval {
  id: string;
  intent: SpendIntent;
  reasons: string[];
}

export class DecisionService {
  private pending = new Map<string, PendingApproval>();
  private ledger: Ledger;
  private mandate: Mandate;

  constructor(ledger: Ledger, mandate: Mandate) {
    this.ledger = ledger;
    this.mandate = mandate;
  }

  // shortcut: full-table scan per decision, aggregate in SQL when the ledger exceeds ~10k rows
  private monthContext(category: string): MonthContext {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const hourAgo = Date.now() - 3_600_000;
    let month_spend_cents = 0;
    let txns_last_hour = 0;
    const byCategory = new Map<string, number>();
    for (const r of this.ledger.all()) {
      if (r.action !== "ALLOW") continue;
      const t = Date.parse(r.created_at);
      if (t >= monthStart.getTime()) {
        month_spend_cents += r.amount_cents;
        const cat = r.category ?? "uncategorized";
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.amount_cents);
      }
      if (t >= hourAgo) txns_last_hour++;
    }
    return { month_spend_cents, category_spend_cents: byCategory.get(category) ?? 0, txns_last_hour };
  }

  async decide(request: string, card: CardInput): Promise<DecisionResult> {
    const intent = await extractIntent(request);
    const { decision, reasons } = evaluate(intent, this.mandate, this.monthContext(intent.category));

    if (decision === "DENY") {
      this.ledger.append({
        action: "DENY",
        amount_cents: intent.amount_cents,
        category: intent.category,
        reason: `denied ${intent.vendor} ${intent.category}: ${reasons.join("; ")}`,
      });
      return { decision: "DENY", reasons, intent };
    }

    if (decision === "ESCALATE") {
      const approval_id = crypto.randomUUID();
      this.pending.set(approval_id, { id: approval_id, intent, reasons });
      this.ledger.append({
        action: "ESCALATE",
        amount_cents: intent.amount_cents,
        category: intent.category,
        reason: `escalated ${intent.vendor} ${intent.category} $${(intent.amount_cents / 100).toFixed(2)}: ${reasons.join("; ")} (approval ${approval_id})`,
      });
      return { decision: "ESCALATE", reasons, intent, approval_id };
    }

    // ALLOW — capture immediately
    const capture_id = await this.capture(intent, card, "allowed");
    return { decision: "ALLOW", reasons, intent, capture_id };
  }

  async approve(approval_id: string, card: CardInput): Promise<DecisionResult> {
    const p = this.pending.get(approval_id);
    if (!p) throw new Error(`approval ${approval_id} not found`);
    this.pending.delete(approval_id);
    const capture_id = await this.capture(p.intent, card, "approved");
    return { decision: "ALLOW", reasons: p.reasons, intent: p.intent, capture_id };
  }

  async denyApproval(approval_id: string): Promise<void> {
    const p = this.pending.get(approval_id);
    if (!p) throw new Error(`approval ${approval_id} not found`);
    this.pending.delete(approval_id);
    this.ledger.append({
      action: "DENY",
      amount_cents: p.intent.amount_cents,
      category: p.intent.category,
      reason: `rejected escalation ${approval_id}: ${p.intent.vendor} ${p.intent.category}`,
    });
  }

  listPending(): PendingApproval[] {
    return [...this.pending.values()];
  }

  setMandate(m: Mandate): void { this.mandate = m; }

  ledgerRecords(): LedgerRecord[] { return this.ledger.all(); }

  verifyChain() { return this.ledger.verifyChain(); }

  tamperRecord(seq: number): void { this.ledger.tamper(seq); }

  private async capture(intent: SpendIntent, card: CardInput, verb: string): Promise<string> {
    try {
      const { auth_id } = await createOrderWithCard({ amount_cents: intent.amount_cents, card });
      const cap = await capturePartial(auth_id, intent.amount_cents);
      this.ledger.append({
        action: "ALLOW",
        amount_cents: intent.amount_cents,
        category: intent.category,
        reason: `${verb} ${intent.vendor} ${intent.category} $${(intent.amount_cents / 100).toFixed(2)}, capture ${cap.id}`,
      });
      return cap.id;
    } catch (e) {
      this.ledger.append({
        action: "DENY",
        amount_cents: intent.amount_cents,
        category: intent.category,
        reason: `capture failed for ${intent.vendor}: ${e}`,
      });
      throw e;
    }
  }
}
