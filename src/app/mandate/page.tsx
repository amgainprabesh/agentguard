"use client";
import { useEffect, useState } from "react";

type Mandate = {
  monthly_budget_cents: number;
  per_txn_cap_cents: number;
  vendor_allowlist: string[];
  category_limits_cents: Record<string, number>;
  velocity_max_per_hour: number;
  approval_threshold_cents: number;
};

const dollars = (cents: number) => (cents / 100).toString();
const inputCls = "mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm";
const labelCls = "block text-sm text-neutral-300";

export default function MandatePage() {
  const [form, setForm] = useState<Mandate | null>(null);
  const [msg, setMsg] = useState("");
  const [newCat, setNewCat] = useState("");
  const [newLimit, setNewLimit] = useState("");

  useEffect(() => {
    fetch("/api/mandate").then((r) => r.json()).then(setForm);
  }, []);

  if (!form) return <main className="p-6 text-neutral-400">Loading…</main>;

  const setCents = (key: "monthly_budget_cents" | "per_txn_cap_cents" | "approval_threshold_cents", d: string) =>
    setForm({ ...form, [key]: Math.round(Number(d) * 100) });

  async function save() {
    const res = await fetch("/api/mandate", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    });
    setMsg(res.ok ? "Saved — the rule engine now enforces this mandate." : `Rejected: ${(await res.json()).error}`);
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Mandate editor</h1>
      <label className={labelCls}>Monthly budget ($)
        <input className={inputCls} type="number" step="0.01" value={dollars(form.monthly_budget_cents)}
          onChange={(e) => setCents("monthly_budget_cents", e.target.value)} />
      </label>
      <label className={labelCls}>Per-transaction cap ($)
        <input className={inputCls} type="number" step="0.01" value={dollars(form.per_txn_cap_cents)}
          onChange={(e) => setCents("per_txn_cap_cents", e.target.value)} />
      </label>
      <label className={labelCls}>Approval threshold ($)
        <input className={inputCls} type="number" step="0.01" value={dollars(form.approval_threshold_cents)}
          onChange={(e) => setCents("approval_threshold_cents", e.target.value)} />
      </label>
      <label className={labelCls}>Velocity max per hour
        <input className={inputCls} type="number" value={form.velocity_max_per_hour}
          onChange={(e) => setForm({ ...form, velocity_max_per_hour: Number(e.target.value) })} />
      </label>
      <label className={labelCls}>Vendor allowlist (comma-separated)
        <input className={inputCls} value={form.vendor_allowlist.join(", ")}
          onChange={(e) => setForm({ ...form, vendor_allowlist: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} />
      </label>
      <div className="text-sm text-neutral-300">Category limits ($)</div>
      {Object.entries(form.category_limits_cents).map(([cat, c]) => (
        <div key={cat} className="flex items-end gap-2">
          <label className={`${labelCls} flex-1`}>{cat}
            <input className={inputCls} type="number" step="0.01" value={dollars(c)}
              onChange={(e) => setForm({ ...form, category_limits_cents: { ...form.category_limits_cents, [cat]: Math.round(Number(e.target.value) * 100) } })} />
          </label>
          <button
            onClick={() => {
              const next = { ...form.category_limits_cents };
              delete next[cat];
              setForm({ ...form, category_limits_cents: next });
            }}
            className="mb-1 rounded border border-neutral-600 px-2 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
          >Remove</button>
        </div>
      ))}
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const cat = newCat.trim().toLowerCase();
          if (!cat || cat in form.category_limits_cents) return;
          setForm({ ...form, category_limits_cents: { ...form.category_limits_cents, [cat]: Math.round(Number(newLimit || "0") * 100) } });
          setNewCat("");
          setNewLimit("");
        }}
      >
        <label className={`${labelCls} flex-1`}>New category
          <input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="e.g. cloud" />
        </label>
        <label className={`${labelCls} w-32`}>Limit ($)
          <input className={inputCls} type="number" step="0.01" value={newLimit} onChange={(e) => setNewLimit(e.target.value)} placeholder="0 = unlimited" />
        </label>
        <button type="submit" className="mb-1 rounded border border-neutral-600 px-3 py-2 text-xs hover:bg-neutral-800">Add</button>
      </form>
      <button onClick={save} className="rounded-lg bg-neutral-100 px-4 py-2 font-medium text-neutral-950">Save mandate</button>
      {msg && <p className="text-sm text-neutral-400">{msg}</p>}
    </main>
  );
}
