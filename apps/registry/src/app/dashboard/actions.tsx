"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DashboardActions({ earningsBalance }: { earningsBalance: number }) {
  const router = useRouter();
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(url: string, body: unknown) {
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      return { ok: res.ok, data: await res.json() };
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel" style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button
          className="btn"
          disabled={busy}
          onClick={async () => {
            await call("/api/wallet", { credits: 1000 });
            router.refresh();
          }}
        >
          + Add 1,000 credits
        </button>
        <button
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            const { ok, data } = await call("/api/keys", { name: "agent-key" });
            if (ok) setIssuedKey(data.plaintext);
            router.refresh();
          }}
        >
          Issue API key
        </button>
        <button
          className="btn secondary"
          disabled={busy || earningsBalance <= 0}
          onClick={async () => {
            await call("/api/payouts", { amountCredits: earningsBalance });
            router.refresh();
          }}
        >
          Request payout ({earningsBalance})
        </button>
      </div>

      {issuedKey ? (
        <div className="notice ok">
          API key (copy now — shown once): <code>{issuedKey}</code>
        </div>
      ) : null}
    </div>
  );
}
