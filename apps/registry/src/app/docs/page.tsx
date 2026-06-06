import { routerUrl } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function DocsPage() {
  return (
    <div className="container detail">
      <h1>How appbazaar works</h1>
      <p className="lede">
        appbazaar is a neutral registry plus a non-custodial routing layer. Creators publish manifests; agents
        discover them and call them through the router, which handles protocol translation, tenant isolation, and
        billing — without any custom integration code.
      </p>

      <div className="section">
        <h2>1 · Registry</h2>
        <div className="panel">
          A listing is a structured manifest: name, description, capability schema, connection mode (direct or
          tunnel), pricing (free or per-call), and protocol (MCP or REST today — the model is protocol-agnostic).
        </div>
      </div>

      <div className="section">
        <h2>2 · Routing layer</h2>
        <div className="panel">
          A stateless, horizontally scalable SSE router pipes data between a requesting agent and a connector.
          Session state lives in Durable Objects; a Redis backplane delivers events across instances. Raw payloads
          stream through and are <strong>never persisted</strong> — only payload-free metrics are recorded.
        </div>
      </div>

      <div className="section">
        <h2>3 · Identity &amp; billing</h2>
        <div className="panel">
          Agents authenticate with API keys. Callers prepay into a credit wallet. Every routed call is logged to a
          usage ledger and revenue is split (platform 5–10%, remainder to the creator). Payouts settle via Stripe
          Connect.
        </div>
      </div>

      <div className="section">
        <h2>Quickstart</h2>
        <pre className="code">{`# 1. Issue an API key + fund your wallet on the Dashboard.
# 2. Discover a listing in the Directory and copy its Listing ID.
# 3. Call it through the router:

curl -X POST ${routerUrl}/v1/invoke/<listingId> \\
  -H "Authorization: Bearer $APPBAZAAR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"capability":"<name>","input":{ }}'`}</pre>
      </div>
    </div>
  );
}
