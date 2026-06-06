/**
 * appbazaar.ai — live demo (Cloudflare Worker)
 *
 * A self-contained, publicly reachable demonstration of the MVP success
 * metric: register a connector -> discover it -> route a real call through the
 * non-custodial router -> have it logged and billed.
 *
 * It mirrors the logic of the monorepo (`@appbazaar/core` + `@appbazaar/router-
 * core`) but is dependency-free so it bundles cleanly for Workers. State is
 * in-memory (per isolate, ephemeral) — this is a demo, not the production
 * registry (which uses Postgres/Supabase + Durable Objects + Upstash).
 *
 * Non-custodial guarantee preserved: payloads stream through; only byte
 * counts, timing, and status are recorded in the ledger.
 */

const PLATFORM_FEE_BPS = 1000; // 10%
const DEMO_API_KEY = "ab_live_demo";

interface Capability {
  name: string;
  description?: string;
}
interface Listing {
  id: string;
  slug: string;
  name: string;
  description: string;
  kind: "connector" | "agent";
  protocol: "mcp" | "rest";
  connectionMode: "direct" | "tunnel";
  baseUrl?: string; // "self://connector" for built-in demo connectors
  tunnelId?: string;
  pricingModel: "free" | "per_call";
  priceCredits: number;
  capabilities: Capability[];
  tags: string[];
  owner: "creator";
}
interface LedgerRow {
  callId: string;
  capability: string;
  listing: string;
  status: "ok" | "error";
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  grossCredits: number;
  platformFeeCredits: number;
  creatorCredits: number;
  at: string;
}

interface State {
  listings: Listing[];
  walletCredits: number;
  earningsCredits: number;
  ledger: LedgerRow[];
  seeded: boolean;
}

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function seed(state: State): void {
  if (state.seeded) return;
  state.seeded = true;
  const base: Omit<Listing, "id">[] = [
    {
      slug: "echo-connector",
      name: "Echo Connector",
      description: "Reference REST connector. Echoes structured input and reverses text. Fully routable in this demo.",
      kind: "connector",
      protocol: "rest",
      connectionMode: "direct",
      baseUrl: "self://connector",
      pricingModel: "per_call",
      priceCredits: 5,
      capabilities: [
        { name: "echo", description: "Return the provided payload unchanged." },
        { name: "reverse", description: "Reverse a string." },
      ],
      tags: ["reference", "rest"],
      owner: "creator",
    },
    {
      slug: "acme-weather",
      name: "Acme Weather",
      description: "Current conditions for any lat/long. SaaS connector via public API (external — discovery only in demo).",
      kind: "connector",
      protocol: "rest",
      connectionMode: "direct",
      baseUrl: "https://weather.example.com",
      pricingModel: "per_call",
      priceCredits: 25,
      capabilities: [{ name: "current", description: "Current weather for coordinates." }],
      tags: ["weather", "saas"],
      owner: "creator",
    },
    {
      slug: "internal-crm-bridge",
      name: "Internal CRM Bridge",
      description: "Reads records from a private CRM. Tunnel connector (wave 2) — registered today, routable once tunnels ship.",
      kind: "connector",
      protocol: "mcp",
      connectionMode: "tunnel",
      tunnelId: "crm-bridge-prod-01",
      pricingModel: "free",
      priceCredits: 0,
      capabilities: [{ name: "lookup_contact", description: "Find a contact by email." }],
      tags: ["crm", "tunnel", "mcp"],
      owner: "creator",
    },
  ];
  for (const l of base) state.listings.push({ id: id("mfst"), ...l });
}

function clampFee(bps: number): number {
  return Math.min(1000, Math.max(500, bps));
}
function computeSplit(gross: number, bps = PLATFORM_FEE_BPS) {
  const fee = Math.ceil((gross * clampFee(bps)) / 10_000);
  return { gross, platformFeeCredits: fee, creatorCredits: gross - fee };
}
function byteLength(v: unknown): number {
  if (v == null) return 0;
  return new TextEncoder().encode(typeof v === "string" ? v : JSON.stringify(v)).length;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

function authed(req: Request): boolean {
  return (req.headers.get("authorization") ?? "") === `Bearer ${DEMO_API_KEY}`;
}

/** Built-in reference connector (the thing being called). */
function runConnector(capability: string, input: any): unknown {
  if (capability === "echo") return { echoed: input?.message ?? null, at: new Date().toISOString() };
  if (capability === "reverse") return { reversed: [...String(input?.text ?? "")].reverse().join("") };
  throw new Error("unknown capability");
}

/** The non-custodial routing path: resolve -> transport -> adapter -> bill. */
async function routeCall(state: State, listing: Listing, capability: string, input: unknown) {
  if (!listing.capabilities.some((c) => c.name === capability)) {
    return { status: "error" as const, code: "validation", message: `capability '${capability}' not declared` };
  }
  // Tunnel mode is wired but inactive in the MVP (wave 2).
  if (listing.connectionMode === "tunnel") {
    return { status: "error" as const, code: "tunnel_not_implemented", message: "tunnel connectors arrive in wave 2" };
  }
  // Prepaid enforcement.
  if (listing.pricingModel === "per_call" && state.walletCredits < listing.priceCredits) {
    return { status: "error" as const, code: "insufficient_credits", message: "wallet balance too low" };
  }

  const started = Date.now();
  const requestBytes = byteLength(input);
  let responseBytes = 0;
  let status: "ok" | "error" = "error";
  let result: unknown;
  let message: string | undefined;

  try {
    if (listing.baseUrl?.startsWith("self://")) {
      // Built-in connector — invoked in-process (avoids self-fetch).
      result = runConnector(capability, input);
      responseBytes = byteLength(result);
      status = "ok";
    } else {
      // External connector — REST adapter convention: capability `foo` -> POST {baseUrl}/foo.
      const res = await fetch(`${(listing.baseUrl ?? "").replace(/\/+$/, "")}/${capability}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input ?? {}),
      });
      const text = await res.text(); // streamed through; never persisted
      responseBytes = byteLength(text);
      if (res.status >= 400) {
        message = `connector returned ${res.status}`;
      } else {
        status = "ok";
        try {
          result = JSON.parse(text);
        } catch {
          result = text;
        }
      }
    }
  } catch (e) {
    message = `connector unreachable: ${String(e)}`;
  }

  // Settle: charge successful paid calls only; split revenue; log metadata.
  const paid = status === "ok" && listing.pricingModel === "per_call" && listing.priceCredits > 0;
  const gross = paid ? listing.priceCredits : 0;
  const split = computeSplit(gross);
  if (gross > 0) {
    state.walletCredits -= gross;
    state.earningsCredits += split.creatorCredits;
  }
  const row: LedgerRow = {
    callId: id("call"),
    capability,
    listing: listing.name,
    status,
    requestBytes,
    responseBytes,
    durationMs: Date.now() - started,
    grossCredits: split.gross,
    platformFeeCredits: split.platformFeeCredits,
    creatorCredits: split.creatorCredits,
    at: new Date().toISOString(),
  };
  state.ledger.unshift(row);
  state.ledger = state.ledger.slice(0, 25);

  return status === "ok"
    ? { status, result, callId: row.callId, charged: gross }
    : { status, code: (message && "upstream_error") || "error", message, callId: row.callId };
}

/**
 * Durable Object holding the single, globally-consistent demo state and all
 * mutations (register, route+bill). Mirrors how the production router uses a
 * Durable Object per session.
 */
export class DemoStore {
  private state: State = { listings: [], walletCredits: 1000, earningsCredits: 0, ledger: [], seeded: false };

  async fetch(req: Request): Promise<Response> {
    seed(this.state);
    const url = new URL(req.url);
    const path = url.pathname;
    const s = this.state;

    if (path === "/listings") return json({ listings: s.listings });
    if (path === "/state")
      return json({ walletCredits: s.walletCredits, earningsCredits: s.earningsCredits, ledger: s.ledger });

    if (req.method === "POST" && path === "/register") {
      const b = (await req.json().catch(() => ({}))) as any;
      if (!b?.slug || !b?.name || !Array.isArray(b?.capabilities) || b.capabilities.length === 0)
        return json({ error: { code: "validation", message: "slug, name, and capabilities are required" } }, 422);
      const listing: Listing = {
        id: id("mfst"),
        slug: String(b.slug),
        name: String(b.name),
        description: String(b.description ?? ""),
        kind: b.kind === "agent" ? "agent" : "connector",
        protocol: b.protocol === "mcp" ? "mcp" : "rest",
        connectionMode: b.connectionMode === "tunnel" ? "tunnel" : "direct",
        baseUrl: b.baseUrl,
        tunnelId: b.tunnelId,
        pricingModel: b.pricingModel === "free" ? "free" : "per_call",
        priceCredits: Number(b.priceCredits ?? 0),
        capabilities: b.capabilities.map((c: any) => ({ name: String(c.name), description: c.description })),
        tags: Array.isArray(b.tags) ? b.tags.map(String) : [],
        owner: "creator",
      };
      s.listings.unshift(listing);
      return json({ id: listing.id, slug: listing.slug }, 201);
    }

    if (req.method === "POST" && path === "/invoke") {
      const b = (await req.json().catch(() => ({}))) as any;
      const listing = s.listings.find((l) => l.id === b?.listing || l.slug === b?.listing);
      if (!listing) return json({ error: { code: "not_found", message: "listing not found" } }, 404);
      if (!b?.capability) return json({ error: { code: "validation", message: "capability required" } }, 422);
      const out = await routeCall(s, listing, String(b.capability), b.input ?? {});
      const code = out.status === "ok" ? 200 : out.code === "insufficient_credits" ? 402 : 502;
      return json(out, code);
    }

    return json({ error: { code: "not_found", message: "unknown internal route" } }, 404);
  }
}

interface Env {
  DEMO_STORE: { idFromName(n: string): unknown; get(id: unknown): { fetch(r: Request): Promise<Response> } };
}

function store(env: Env) {
  return env.DEMO_STORE.get(env.DEMO_STORE.idFromName("global"));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "authorization,content-type",
        },
      });
    }

    if (path === "/health") return json({ ok: true, service: "appbazaar-demo" });
    if (path === "/" || path === "")
      return new Response(html(DEMO_API_KEY), { headers: { "content-type": "text/html; charset=utf-8" } });

    if (req.method === "GET" && path === "/api/listings")
      return store(env).fetch(new Request("https://do/listings"));
    if (req.method === "GET" && path === "/api/state") return store(env).fetch(new Request("https://do/state"));
    if (req.method === "POST" && path === "/api/register")
      return store(env).fetch(new Request("https://do/register", { method: "POST", body: await req.text() }));

    const invoke = path.match(/^\/v1\/invoke\/([^/]+)$/);
    if (req.method === "POST" && invoke) {
      if (!authed(req)) return json({ error: { code: "unauthorized", message: "invalid API key" } }, 401);
      const b = (await req.json().catch(() => ({}))) as any;
      return store(env).fetch(
        new Request("https://do/invoke", {
          method: "POST",
          body: JSON.stringify({ listing: invoke[1], capability: b?.capability, input: b?.input ?? {} }),
        }),
      );
    }

    return json({ error: { code: "not_found", message: "no such route" } }, 404);
  },
};

function html(apiKey: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>appbazaar.ai — live demo</title>
<style>
:root{--bg:#0a0b0f;--panel:#14161d;--panel2:#1b1e27;--border:#272b36;--text:#e7e9ee;--muted:#9aa1b1;--accent:#6d8bff;--accent2:#59e0b0;--danger:#ff6b6b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.container{max-width:1000px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--border);padding:16px 0}.brand{font-weight:700;font-size:18px}.brand .dot{color:var(--accent)}
.hero{padding:36px 0 8px}.hero h1{font-size:30px;letter-spacing:-.02em;margin:0 0 8px}.hero p{color:var(--muted);max-width:680px;margin:0}
.note{margin:16px 0;padding:10px 14px;border:1px solid #34406b;background:#11162b;border-radius:10px;color:#aeb9e6;font-size:13px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:18px 0}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px}
.card h3{margin:0 0 6px;font-size:16px}.desc{color:var(--muted);font-size:13px;line-height:1.5;margin:6px 0 12px}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px}
.badge{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;padding:3px 8px;border-radius:999px;border:1px solid var(--border);color:var(--muted);background:var(--panel2)}
.badge.kind{color:var(--accent2);border-color:#2c5a48}.badge.proto{color:var(--accent);border-color:#34406b}.badge.tunnel{color:#f4c069;border-color:#5a4a2c}
.price{font-size:12px;font-weight:600}
.row{display:flex;gap:8px;margin-top:8px}
input,button{font-family:inherit;font-size:13px;border-radius:9px;padding:8px 10px;border:1px solid var(--border)}
input{background:var(--panel2);color:var(--text);flex:1}
button{background:var(--accent);color:#0a0b0f;font-weight:600;border:none;cursor:pointer}button:disabled{opacity:.5}
.stat{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0 16px}
.stat .b{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:10px 14px}
.stat .n{font-size:20px;font-weight:700}.stat .l{color:var(--muted);font-size:12px}
pre{background:#0d0f15;border:1px solid var(--border);border-radius:9px;padding:10px;font-size:12px;overflow:auto;color:#cdd3e1;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}th{color:var(--muted)}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:24px 0 10px}
code{color:var(--accent2)}
footer{border-top:1px solid var(--border);color:var(--muted);font-size:12px;padding:20px 0;margin-top:30px}
</style></head><body>
<header><div class="container brand">appbazaar<span class="dot">.ai</span> · live demo</div></header>
<div class="container">
  <div class="hero"><h1>Discover, route, and bill calls between agents &amp; connectors</h1>
  <p>A neutral registry + non-custodial routing layer. Click <b>Call</b> below to route a real request through the router to a registered connector — it gets logged and billed automatically, with no integration code.</p></div>
  <div class="note">This is an ephemeral in-memory demo on Cloudflare Workers (resets periodically). The full platform uses Next.js + Supabase (registry), Cloudflare Workers + Durable Objects + Upstash (router), and Clerk + Stripe (identity &amp; billing). API key for this demo: <code>${apiKey}</code></div>

  <div class="stat" id="stat"></div>
  <div class="grid" id="listings"></div>

  <h2>Usage ledger (metadata only — payloads never stored)</h2>
  <div class="card"><table id="ledger"><thead><tr><th>Capability</th><th>Listing</th><th>Status</th><th>Bytes (req/resp)</th><th>Charged</th><th>When</th></tr></thead><tbody></tbody></table></div>
</div>
<footer><div class="container">appbazaar.ai · non-custodial routing for agents and connectors · MVP demo</div></footer>
<script>
const KEY=${JSON.stringify(apiKey)};
async function load(){
  const [l,s]=await Promise.all([fetch('/api/listings').then(r=>r.json()),fetch('/api/state').then(r=>r.json())]);
  document.getElementById('stat').innerHTML=
    '<div class="b"><div class="n">'+s.walletCredits+'</div><div class="l">Caller wallet (credits)</div></div>'+
    '<div class="b"><div class="n">'+s.earningsCredits+'</div><div class="l">Creator earnings</div></div>'+
    '<div class="b"><div class="n">'+s.ledger.length+'</div><div class="l">Calls logged</div></div>';
  document.getElementById('listings').innerHTML=l.listings.map(card).join('');
  const tb=document.querySelector('#ledger tbody');
  tb.innerHTML=s.ledger.map(r=>'<tr><td><code>'+r.capability+'</code></td><td>'+r.listing+'</td><td>'+r.status+'</td><td>'+r.requestBytes+'/'+r.responseBytes+'</td><td>'+r.grossCredits+'</td><td>'+new Date(r.at).toLocaleTimeString()+'</td></tr>').join('')||'<tr><td colspan=6 style="color:#9aa1b1">No calls yet — try one above.</td></tr>';
}
function card(m){
  const tunnel=m.connectionMode==='tunnel';
  const inputFor=c=> c==='reverse'?'{"text":"appbazaar"}': c==='echo'?'{"message":"hello"}':'{}';
  const tryRow=tunnel?'<div class="desc">Tunnel connector — routable in wave 2.</div>':
    m.capabilities.map(c=>'<div class="row"><input id="in_'+m.id+'_'+c.name+'" value=\\''+inputFor(c.name)+'\\'/><button onclick="call(\\''+m.id+'\\',\\''+c.name+'\\')">Call '+c.name+'</button></div>').join('');
  return '<div class="card"><div class="badges"><span class="badge kind">'+m.kind+'</span><span class="badge proto">'+m.protocol+'</span><span class="badge '+(tunnel?'tunnel':'')+'">'+m.connectionMode+'</span></div>'+
    '<h3>'+m.name+'</h3><div class="desc">'+m.description+'</div>'+
    '<div class="price">'+(m.pricingModel==='free'?'Free':m.priceCredits+' credits / call')+'</div>'+
    tryRow+'<pre id="out_'+m.id+'" style="display:none"></pre></div>';
}
async function call(id,cap){
  const out=document.getElementById('out_'+id);out.style.display='block';out.textContent='routing…';
  let input={};try{input=JSON.parse(document.getElementById('in_'+id+'_'+cap).value||'{}')}catch(e){}
  const res=await fetch('/v1/invoke/'+id,{method:'POST',headers:{'authorization':'Bearer '+KEY,'content-type':'application/json'},body:JSON.stringify({capability:cap,input})});
  const data=await res.json();out.textContent=JSON.stringify(data,null,2);load();
}
load();
</script></body></html>`;
}
