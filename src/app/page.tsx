import Link from "next/link";

const views = [
  { href: "/mandate", label: "Mandate editor", blurb: "The six rules the policy engine enforces — edit and save." },
  { href: "/decisions", label: "Decision dashboard", blurb: "Send a spend request; watch ALLOW / DENY / ESCALATE, resolve escalations." },
  { href: "/audit", label: "Auditor view", blurb: "Hash-chained ledger, verify the chain, run the live tamper demo." },
];

export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-8 px-6 py-12">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">AgentGuard</h1>
        <p className="mt-2 text-neutral-400">
          Spend policy control plane for AI purchasing agents. Policy is code, not prompt.
        </p>
      </div>
      <div className="flex flex-col gap-3">
        {views.map((v) => (
          <Link key={v.href} href={v.href} className="rounded-lg border border-neutral-700 px-4 py-3 hover:bg-neutral-800">
            <span className="font-medium">{v.label}</span>
            <span className="mt-1 block text-sm text-neutral-400">{v.blurb}</span>
          </Link>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Policy engine live — six rules, ALLOW / DENY / ESCALATE, hash-chained audit trail.
        Verified against the PayPal sandbox.
      </p>
    </main>
  );
}
