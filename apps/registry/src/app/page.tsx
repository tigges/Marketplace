import Link from "next/link";
import { listManifests } from "@appbazaar/db";
import { getDb } from "@/lib/db";
import { priceLabel } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  kind?: string;
  protocol?: string;
  mode?: string;
}

export default async function DirectoryPage({ searchParams }: { searchParams: SearchParams }) {
  const db = await getDb();
  const rows = await listManifests(db, {
    q: searchParams.q,
    kind: searchParams.kind,
    protocol: searchParams.protocol,
    connectionMode: searchParams.mode,
  });

  return (
    <div className="container">
      <section className="hero">
        <h1>Discover, connect, and pay for AI agents &amp; data connectors</h1>
        <p>
          A neutral registry and non-custodial routing layer. Any agent can find a connector here, call it
          through the router, and be billed automatically — no custom integration code, regardless of protocol.
        </p>
      </section>

      <form className="filters" method="get">
        <input type="search" name="q" placeholder="Search connectors and agents…" defaultValue={searchParams.q ?? ""} />
        <select name="kind" defaultValue={searchParams.kind ?? ""}>
          <option value="">All kinds</option>
          <option value="connector">Connectors</option>
          <option value="agent">Agents</option>
        </select>
        <select name="protocol" defaultValue={searchParams.protocol ?? ""}>
          <option value="">All protocols</option>
          <option value="mcp">MCP</option>
          <option value="rest">REST</option>
        </select>
        <select name="mode" defaultValue={searchParams.mode ?? ""}>
          <option value="">All modes</option>
          <option value="direct">Direct</option>
          <option value="tunnel">Tunnel</option>
        </select>
        <button className="btn secondary" type="submit">
          Filter
        </button>
      </form>

      {rows.length === 0 ? (
        <p className="muted">No listings match. Try clearing filters or submit the first one.</p>
      ) : (
        <div className="grid">
          {rows.map((m) => (
            <Link key={m.id} href={`/listing/${m.slug}`} className="card">
              <div className="top">
                <h3>{m.name}</h3>
              </div>
              <div className="badges">
                <span className="badge kind">{m.kind}</span>
                <span className="badge proto">{m.protocol}</span>
                <span className={`badge ${m.connectionMode === "tunnel" ? "mode-tunnel" : ""}`}>
                  {m.connectionMode}
                </span>
              </div>
              <p className="desc">{m.description}</p>
              <span className="price">{priceLabel(m.pricingModel, m.priceCredits)}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
