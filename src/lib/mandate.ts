import type { Mandate } from "./policy.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

export const DEFAULT_MANDATE: Mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

// Runtime-editable mandate for the demo. Single JSON file, one demo user — a DB
// table is YAGNI until there are real users.
function validate(m: unknown): Mandate {
  const o = m as Record<string, unknown>;
  const num = (k: keyof Mandate) => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error(`mandate.${k} must be a non-negative number`);
    return v;
  };
  if (!Array.isArray(o.vendor_allowlist) || !o.vendor_allowlist.every((s) => typeof s === "string")) {
    throw new Error("mandate.vendor_allowlist must be an array of strings");
  }
  const cats = o.category_limits_cents as Record<string, unknown>;
  if (typeof cats !== "object" || cats === null || Object.values(cats).some((v) => typeof v !== "number")) {
    throw new Error("mandate.category_limits_cents must be an object of numbers");
  }
  return {
    monthly_budget_cents: num("monthly_budget_cents"),
    per_txn_cap_cents: num("per_txn_cap_cents"),
    velocity_max_per_hour: num("velocity_max_per_hour"),
    approval_threshold_cents: num("approval_threshold_cents"),
    vendor_allowlist: o.vendor_allowlist as string[],
    category_limits_cents: cats as Record<string, number>,
  };
}

export class MandateStore {
  private current: Mandate;
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
    this.current = existsSync(path) ? validate(JSON.parse(readFileSync(path, "utf8"))) : DEFAULT_MANDATE;
  }
  get(): Mandate { return this.current; }
  update(next: unknown): Mandate {
    const validated = validate(next);
    writeFileSync(this.path, JSON.stringify(validated, null, 2));
    this.current = validated;
    return validated;
  }
}
