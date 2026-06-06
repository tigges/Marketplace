import Link from "next/link";
import { notFound } from "next/navigation";
import { getManifestBySlug } from "@appbazaar/db";
import { getDb } from "@/lib/db";
import { priceLabel, routerUrl } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ListingPage({ params }: { params: { slug: string } }) {
  const db = await getDb();
  const m = await getManifestBySlug(db, params.slug);
  if (!m) notFound();

  const firstCap = m.capabilities[0]?.name ?? "capability";
  const curl = `curl -X POST ${routerUrl}/v1/invoke/${m.id} \\
  -H "Authorization: Bearer $APPBAZAAR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"capability":"${firstCap}","input":{}}'`;

  const sse = `# 1) open a tenant-scoped session
curl -X POST ${routerUrl}/v1/sessions \\
  -H "Authorization: Bearer $APPBAZAAR_API_KEY" \\
  -d '{"manifestId":"${m.id}"}'
# -> { "sessionId": "...", "streamUrl": "...", "messagesUrl": "..." }

# 2) subscribe to the SSE stream, then POST messages to messagesUrl`;

  return (
    <div className="container detail">
      <Link href="/" className="muted">
        ← Back to directory
      </Link>
      <div className="badges" style={{ marginTop: 16 }}>
        <span className="badge kind">{m.kind}</span>
        <span className="badge proto">{m.protocol}</span>
        <span className={`badge ${m.connectionMode === "tunnel" ? "mode-tunnel" : ""}`}>{m.connectionMode}</span>
        {m.tags.map((t) => (
          <span key={t} className="badge">
            {t}
          </span>
        ))}
      </div>
      <h1>{m.name}</h1>
      <p className="lede">{m.description}</p>

      <div className="section">
        <h2>Details</h2>
        <div className="panel kv">
          <div className="k">Listing ID</div>
          <div>
            <code>{m.id}</code>
          </div>
          <div className="k">Pricing</div>
          <div>{priceLabel(m.pricingModel, m.priceCredits)}</div>
          <div className="k">Protocol</div>
          <div>{m.protocol.toUpperCase()}</div>
          <div className="k">Connection mode</div>
          <div>
            {m.connectionMode}
            {m.connectionMode === "tunnel" ? " (wave 2 — registered, routable once tunnels ship)" : ""}
          </div>
          {m.homepage ? (
            <>
              <div className="k">Homepage</div>
              <div>
                <a href={m.homepage} className="muted">
                  {m.homepage}
                </a>
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="section">
        <h2>Capabilities</h2>
        {m.capabilities.map((c) => (
          <div className="cap" key={c.name}>
            <code>{c.name}</code>
            {c.description ? <p>{c.description}</p> : null}
            {c.inputSchema ? (
              <pre className="code" style={{ marginTop: 8 }}>
                {JSON.stringify(c.inputSchema, null, 2)}
              </pre>
            ) : null}
          </div>
        ))}
      </div>

      <div className="section">
        <h2>Connect an agent (unary)</h2>
        <pre className="code">{curl}</pre>
      </div>

      <div className="section">
        <h2>Connect an agent (streaming / SSE)</h2>
        <pre className="code">{sse}</pre>
      </div>
    </div>
  );
}
