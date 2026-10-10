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

// Trust boundary: card data comes from an untrusted JSON body. Validate shape
// here so a malformed card fails fast with a clear message instead of a cryptic
// PayPal/LLM error. Sandbox-only app — no real cards expected.
function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function validateCard(input: unknown): CardInput {
  const c = input as Record<string, unknown> | null | undefined;
  if (typeof c !== "object" || c === null) throw new Error("card must be an object");
  const digits = typeof c.number === "string" ? c.number.replace(/\D/g, "") : "";
  if (digits.length < 13 || digits.length > 19) throw new Error("card.number must be 13-19 digits");
  // Luhn checksum: a typo'd test card (4111…1112) passes every shape check but
  // PayPal rejects it with an opaque INVALID_RESOURCE_ID — catch it here instead.
  if (!luhnValid(digits)) throw new Error("card.number failed the Luhn checksum");
  if (typeof c.expiry !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(c.expiry)) {
    throw new Error("card.expiry must be YYYY-MM");
  }
  // expired card: PayPal declines with an opaque error; reject with a clear message
  const [expYear, expMonth] = c.expiry.split("-").map(Number);
  const expiryEnd = new Date(Date.UTC(expYear, expMonth, 1)).getTime(); // first ms after the card's last valid month
  if (expiryEnd <= Date.now()) throw new Error("card.expiry is in the past");
  if (typeof c.security_code !== "string" || !/^\d{3,4}$/.test(c.security_code)) {
    throw new Error("card.security_code must be 3-4 digits");
  }
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 100) {
    throw new Error("card.name must be a non-empty string (max 100 chars)");
  }
  return { number: digits, expiry: c.expiry, security_code: c.security_code, name: c.name.trim() };
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

  // shortcut: full-table scan per decision, aggregate in SQL when the ledger exceeds ~10k rows.
  // Measured: 49ms at 10k rows — and every decide already spends 15-40s in the LLM,
  // so the scan is not on the critical path until the ledger is orders of magnitude bigger.
  private monthContext(category: string): MonthContext {
    // UTC month boundary, not local: created_at is stored as UTC ISO, and a
    // local midnight (NPT +5:45, NY -5) silently miscounts an early-month UTC row.
    const monthPrefix = new Date().toISOString().slice(0, 7); // "2026-10"
    const hourAgo = Date.now() - 3_600_000;
    let month_spend_cents = 0;
    let txns_last_hour = 0;
    // lowercase the key: the LLM's category word varies ("Snacks"/"snacks") —
    // an exact-match map would split one category's spend across two buckets.
    const catKey = category.trim().toLowerCase();
    const byCategory = new Map<string, number>();
    for (const r of this.ledger.all()) {
      if (r.action !== "ALLOW") continue;
      const t = Date.parse(r.created_at);
      if (r.created_at.slice(0, 7) === monthPrefix) {
        month_spend_cents += r.amount_cents;
        const cat = (r.category ?? "uncategorized").trim().toLowerCase();
        byCategory.set(cat, (byCategory.get(cat) ?? 0) + r.amount_cents);
      }
      if (t >= hourAgo) txns_last_hour++;
    }
    return { month_spend_cents, category_spend_cents: byCategory.get(catKey) ?? 0, txns_last_hour };
  }

  async decide(request: string, card: CardInput): Promise<DecisionResult> {
    validateCard(card);
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
      // the approval id lives only in this in-memory Map — a restart or dev
      // hot-reload drops it while the ledger keeps the ESCALATE row, so the
      // auditor can always find the id again from the ledger reason
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
    if (!p) {
      // distinguish "never existed" from "lost to a restart": the ledger keeps
      // every ESCALATE row with its approval id, so a lookup tells them apart
      const inLedger = this.ledger.all().some(
        (r) => r.action === "ESCALATE" && r.reason.includes(`(approval ${approval_id})`),
      );
      throw new Error(
        inLedger
          ? `approval ${approval_id} was parked but lost to a server restart — re-run the request`
          : `approval ${approval_id} not found`,
      );
    }
    validateCard(card);
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
        // cap the error text: a PayPal error body is unbounded JSON with debug
        // details — the ledger row must stay one readable line for the auditor
        reason: `capture failed for ${intent.vendor}: ${String(e).slice(0, 300)}`,
      });
      throw e;
    }
  }
}
