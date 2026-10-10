"use client";
import { useCallback, useEffect, useState } from "react";

type Row = { seq: number; action: "ALLOW" | "DENY" | "ESCALATE"; amount_cents: number; reason: string; category: string | null; created_at: string };
type LedgerView = { records: Row[]; chain: { ok: boolean; brokenAt: number | null } };

const badgeCls = (a: string) => (a === "ALLOW" ? "text-allow" : a === "DENY" ? "text-deny" : "text-escalate");

export default function AuditPage() {
  const [view, setView] = useState<LedgerView | null>(null);
  const [seq, setSeq] = useState("1");

  const refresh = useCallback(() => {
    fetch("/api/ledger").then((r) => r.json()).then(setView);
  }, []);

  useEffect(refresh, [refresh]);

  async function tamper() {
    await fetch("/api/ledger/tamper", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ seq: Number(seq) }),
    });
    refresh();
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-4 px-6 py-10">
      <h1 className="text-2xl font-semibold">Auditor view</h1>

      <div className="flex items-center gap-4">
        <p role="status" aria-live="polite" className="text-sm">
          Chain:{" "}
          {view ? (
            view.chain.ok
              ? <span className="font-semibold text-allow">verified ({view.records.length} rows)</span>
              : <span className="font-semibold text-deny">BROKEN at row {view.chain.brokenAt}</span>
          ) : "…"}
        </p>
        <button onClick={refresh} className="rounded border border-neutral-600 px-3 py-1 text-xs hover:bg-neutral-800">Re-verify</button>
      </div>

      <div className="flex items-end gap-2 text-xs text-neutral-500">
        <label>Tamper row seq
          <input className="ml-2 w-16 rounded border border-neutral-700 bg-neutral-900 p-1" value={seq} onChange={(e) => setSeq(e.target.value)} />
        </label>
        <button onClick={tamper} className="rounded border border-neutral-600 px-3 py-1 hover:bg-neutral-800">Break the chain (demo)</button>
      </div>

      <table className="w-full text-left text-sm">
        <thead className="text-xs text-neutral-500">
          <tr><th className="py-1">#</th><th>Time</th><th>Decision</th><th>Amount</th><th>Category</th><th>Reason</th></tr>
        </thead>
        <tbody>
          {(view?.records ?? []).map((r) => (
            <tr key={r.seq} className="border-t border-neutral-800 align-top">
              <td className="py-1 pr-2">{r.seq}</td>
              <td className="pr-2 text-xs text-neutral-500">{r.created_at.slice(0, 19).replace("T", " ")}</td>
              <td className={`pr-2 font-medium ${badgeCls(r.action)}`}>{r.action}</td>
              <td className="pr-2">${(r.amount_cents / 100).toFixed(2)}</td>
              <td className="pr-2 text-neutral-400">{r.category ?? "—"}</td>
              <td className="text-neutral-400">{r.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-neutral-500">A hash chain proves tampering, not deletion — the ledger can be wiped entirely.</p>
    </main>
  );
}
