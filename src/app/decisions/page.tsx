"use client";
import { useCallback, useEffect, useState } from "react";

const card = { number: "4111111111111111", expiry: "2028-12", security_code: "123", name: "Test Buyer" };

type Intent = { vendor: string; amount_cents: number; category: string };
type Decision = { decision: "ALLOW" | "DENY" | "ESCALATE"; reasons: string[]; intent?: Intent; capture_id?: string; approval_id?: string };
type Pending = { id: string; intent: Intent; reasons: string[] };

const badgeCls = (d: string) => (d === "ALLOW" ? "text-allow" : d === "DENY" ? "text-deny" : "text-escalate");
const inputCls = "mt-1 w-full rounded border border-neutral-700 bg-neutral-900 p-2 text-sm";
const labelCls = "block text-sm text-neutral-300";

export default function DecisionsPage() {
  const [request, setRequest] = useState("buy $42 of snacks from acme.com");
  const [result, setResult] = useState<Decision | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((data) => setPending(Array.isArray(data) ? data : []))
      .catch(() => setPending([])); // a failed poll must not wedge the pending list
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [refresh]);

  async function submit() {
    setError("");
    // guard against a runaway click-spam filling the ledger and tripping velocity
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/decide", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request, card }),
      });
      // guard the body: a 500 serves an HTML error page, so res.json() throws
      // and an unguarded read would leave the form wedged with no message
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(`Rejected: ${j?.error ?? "unknown error"}`); return; }
      setResult(j);
      refresh();
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function act(id: string, verb: "approve" | "reject") {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/approvals/${id}/${verb}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ card }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setError(`Rejected: ${j?.error ?? "unknown error"}`); refresh(); return; }
      if (verb === "approve") setResult(j); // show the ALLOW result + capture id
      refresh();
    } catch (e) {
      setError(`Request failed: ${String(e)}`);
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-semibold">Decision dashboard</h1>

      <div className="flex flex-col gap-2">
        <label className={labelCls}>Spend request (plain English)
          <textarea className={inputCls} rows={2} value={request} onChange={(e) => setRequest(e.target.value)} />
        </label>
        <button onClick={submit} disabled={busy} aria-busy={busy} className="self-start rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-50">{busy ? "Running…" : "Run decision"}</button>
        {/* role=alert: screen readers announce the decision/error without a manual re-read */}
        {error && <p role="alert" className="text-sm text-deny">{error}</p>}
      </div>

      {result && (
        <div role="status" aria-live="polite" className="rounded-lg border border-neutral-700 p-4">
          <p className={`text-lg font-semibold ${badgeCls(result.decision)}`}>{result.decision}</p>
          {result.intent && (
            <p className="mt-1 text-sm text-neutral-400">
              {result.intent.vendor} · {result.intent.category} · ${(result.intent.amount_cents / 100).toFixed(2)}
            </p>
          )}
          <ul className="mt-2 list-disc pl-5 text-sm text-neutral-300">
            {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
          {result.capture_id && <p className="mt-2 text-xs text-neutral-500">PayPal capture: {result.capture_id}</p>}
          {result.approval_id && <p className="mt-2 text-xs text-neutral-500">Parked as {result.approval_id}</p>}
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-neutral-300">Pending escalations</h2>
        {pending.length === 0 && <p className="mt-1 text-sm text-neutral-500">None.</p>}
        {pending.map((p) => (
          <div key={p.id} className="mt-2 flex items-center justify-between rounded-lg border border-neutral-700 p-3">
            <div className="text-sm">
              <p>{p.intent.vendor} · ${(p.intent.amount_cents / 100).toFixed(2)}</p>
              <p className="text-xs text-neutral-500">{p.reasons[0]}</p>
            </div>
            <div className="flex gap-2">
              {/* aria-labels: two buttons both reading "Approve" is ambiguous out of context */}
              <button onClick={() => act(p.id, "approve")} disabled={busy} aria-label={`Approve escalation for ${p.intent.vendor} $${(p.intent.amount_cents / 100).toFixed(2)}`} className="rounded border border-neutral-600 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50">Approve</button>
              <button onClick={() => act(p.id, "reject")} disabled={busy} aria-label={`Reject escalation for ${p.intent.vendor} $${(p.intent.amount_cents / 100).toFixed(2)}`} className="rounded border border-neutral-600 px-3 py-1 text-xs hover:bg-neutral-800 disabled:opacity-50">Reject</button>
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-neutral-500">Card: PayPal sandbox test card 4111 1111 1111 1111 (hardcoded, sandbox only).</p>
    </main>
  );
}
