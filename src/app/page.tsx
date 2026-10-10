export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-8 px-6">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">AgentGuard</h1>
        <p className="mt-2 text-neutral-400">
          Spend policy control plane for AI purchasing agents. Policy is code, not prompt.
        </p>
      </div>
      <div className="flex gap-3">
        {["ALLOW", "DENY", "ESCALATE"].map((label) => (
          <button
            key={label}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-sm font-medium hover:bg-neutral-800"
          >
            {label}
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">Sprint 0 skeleton — decisions wired in Sprint 1.</p>
    </main>
  );
}
