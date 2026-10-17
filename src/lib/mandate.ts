import type { Mandate } from "./policy.ts";
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { ValidationError } from "./validation.ts";

// re-exported so route handlers can import the marker class alongside mandate
export { ValidationError };

export const DEFAULT_MANDATE: Mandate = {
  monthly_budget_cents: 1500000,
  per_txn_cap_cents: 100000,
  vendor_allowlist: ["acme.com", "globex.com"],
  category_limits_cents: { snacks: 50000, ads: 200000 },
  velocity_max_per_hour: 10,
  approval_threshold_cents: 50000,
};

// sane ceiling: $10M per field. A trillions-wide budget is always a typo or abuse.
const MAX_MANDATE_CENTS = 100_000_000;

// Runtime-editable mandate for the demo. Single JSON file, one demo user — a DB
// table is YAGNI until there are real users.
function validate(m: unknown): Mandate {
  const o = m as Record<string, unknown>;
  const known = new Set([
    "monthly_budget_cents",
    "per_txn_cap_cents",
    "vendor_allowlist",
    "category_limits_cents",
    "velocity_max_per_hour",
    "approval_threshold_cents",
  ]);
  const unknownFields = Object.keys(o).filter((k) => !known.has(k));
  if (unknownFields.length > 0) {
    throw new ValidationError(`mandate has unknown field(s): ${unknownFields.slice(0, 5).join(", ")} — not saved`);
  }
  const num = (k: keyof Mandate, opts: { min?: number } = {}) => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new ValidationError(`mandate.${k} must be a non-negative number`);
    if (opts.min !== undefined && v < opts.min) throw new ValidationError(`mandate.${k} must be at least ${opts.min}`);
    if (v > MAX_MANDATE_CENTS) throw new ValidationError(`mandate.${k} is too large (max $${(MAX_MANDATE_CENTS / 100).toLocaleString()})`);
    return v;
  };
  if (!Array.isArray(o.vendor_allowlist) || !o.vendor_allowlist.every((s) => typeof s === "string")) {
    throw new ValidationError("mandate.vendor_allowlist must be an array of strings");
  }
  const cats = o.category_limits_cents as Record<string, unknown>;
  const forbidden = ["__proto__", "constructor", "prototype"];
  if (typeof cats !== "object" || cats === null || Object.values(cats).some((v) => typeof v !== "number")) {
    throw new ValidationError("mandate.category_limits_cents must be an object of numbers");
  }
  const badKey = Object.keys(cats).find((k) => forbidden.includes(k));
  if (badKey) throw new ValidationError(`mandate.category_limits_cents contains a forbidden key: ${badKey}`);
  return {
    monthly_budget_cents: num("monthly_budget_cents", { min: 1 }),
    per_txn_cap_cents: num("per_txn_cap_cents", { min: 1 }),
    // velocity 0 would deny every request (an empty number input in the editor
    // parses as 0 — the demo would freeze with no visible cause)
    velocity_max_per_hour: num("velocity_max_per_hour", { min: 1 }),
    approval_threshold_cents: num("approval_threshold_cents", { min: 1 }),
    vendor_allowlist: o.vendor_allowlist as string[],
    category_limits_cents: cats as Record<string, number>,
  };
}

export class MandateStore {
  private current: Mandate;
  private readonly path: string;
  constructor(path: string) {
    this.path = path;
    // A corrupted mandate.json (interrupted write, manual edit) must not brick
    // the app: fall back to the default mandate and let the editor re-save.
    if (existsSync(path)) {
      try {
        this.current = validate(JSON.parse(readFileSync(path, "utf8")));
        return;
      } catch (e) {
        console.error(`mandate store: ${path} invalid (${e}) — using DEFAULT_MANDATE`);
      }
    }
    this.current = DEFAULT_MANDATE;
  }
  get(): Mandate { return this.current; }
  update(next: unknown): Mandate {
    const validated = validate(next);
    // write-then-swap so a failed write never leaves a half-saved file
    mkdirSync(dirname(this.path), { recursive: true }); // data/ may not exist on a fresh clone
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(validated, null, 2));
    renameSync(tmp, this.path);
    this.current = validated;
    return validated;
  }
}
