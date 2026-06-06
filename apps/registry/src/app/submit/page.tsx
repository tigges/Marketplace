"use client";

import { useState } from "react";

const defaultCapabilities = JSON.stringify(
  [{ name: "echo", description: "Return the provided payload unchanged." }],
  null,
  2,
);

export default function SubmitPage() {
  const [kind, setKind] = useState("connector");
  const [protocol, setProtocol] = useState("rest");
  const [mode, setMode] = useState("direct");
  const [pricing, setPricing] = useState("per_call");
  const [result, setResult] = useState<{ ok: boolean; message: string; slug?: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    const f = new FormData(e.currentTarget);

    let capabilities: unknown;
    try {
      capabilities = JSON.parse(String(f.get("capabilities") || "[]"));
    } catch {
      setResult({ ok: false, message: "Capabilities must be valid JSON." });
      setSubmitting(false);
      return;
    }

    const connection =
      mode === "direct"
        ? { mode: "direct", baseUrl: String(f.get("baseUrl") || "") }
        : { mode: "tunnel", tunnelId: String(f.get("tunnelId") || "") };

    const pricingObj =
      pricing === "free"
        ? { model: "free" }
        : { model: "per_call", priceCredits: Number(f.get("priceCredits") || 0) };

    const body = {
      slug: String(f.get("slug") || ""),
      name: String(f.get("name") || ""),
      description: String(f.get("description") || ""),
      kind,
      protocol,
      connection,
      pricing: pricingObj,
      capabilities,
      tags: String(f.get("tags") || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      homepage: String(f.get("homepage") || "") || undefined,
    };

    const res = await fetch("/api/manifests", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      setResult({ ok: true, message: "Listing published.", slug: data.slug });
    } else {
      setResult({ ok: false, message: data?.error?.message ?? "Submission failed", ...data });
    }
    setSubmitting(false);
  }

  return (
    <div className="container detail">
      <h1>Submit a listing</h1>
      <p className="lede">
        Publish an AI agent or data connector as a structured manifest. The router uses it to translate calls —
        no integration code required on either side.
      </p>

      {result ? (
        <div className={`notice ${result.ok ? "ok" : "err"}`} style={{ margin: "16px 0" }}>
          {result.message}{" "}
          {result.ok && result.slug ? (
            <a href={`/listing/${result.slug}`} style={{ textDecoration: "underline" }}>
              View listing →
            </a>
          ) : null}
        </div>
      ) : null}

      <form className="form" onSubmit={onSubmit}>
        <div className="row">
          <div className="field">
            <label>Name</label>
            <input name="name" required placeholder="Acme Weather" />
          </div>
          <div className="field">
            <label>Slug</label>
            <input name="slug" required placeholder="acme-weather" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" />
          </div>
        </div>

        <div className="field">
          <label>Description</label>
          <textarea name="description" required rows={3} placeholder="What does this connector/agent do?" />
        </div>

        <div className="row">
          <div className="field">
            <label>Kind</label>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="connector">Connector</option>
              <option value="agent">Agent</option>
            </select>
          </div>
          <div className="field">
            <label>Protocol</label>
            <select value={protocol} onChange={(e) => setProtocol(e.target.value)}>
              <option value="rest">REST</option>
              <option value="mcp">MCP</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Connection mode</label>
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="direct">Direct (public API)</option>
              <option value="tunnel">Tunnel (wave 2)</option>
            </select>
          </div>
          {mode === "direct" ? (
            <div className="field">
              <label>Base URL</label>
              <input name="baseUrl" placeholder="https://api.example.com" />
            </div>
          ) : (
            <div className="field">
              <label>Tunnel ID</label>
              <input name="tunnelId" placeholder="crm-bridge-prod-01" />
            </div>
          )}
        </div>

        <div className="row">
          <div className="field">
            <label>Pricing</label>
            <select value={pricing} onChange={(e) => setPricing(e.target.value)}>
              <option value="per_call">Per call</option>
              <option value="free">Free</option>
            </select>
          </div>
          {pricing === "per_call" ? (
            <div className="field">
              <label>Price (credits / call)</label>
              <input name="priceCredits" type="number" min={1} defaultValue={5} />
              <span className="hint">1 credit = $0.001</span>
            </div>
          ) : (
            <div />
          )}
        </div>

        <div className="field">
          <label>Tags (comma-separated)</label>
          <input name="tags" placeholder="weather, saas" />
        </div>

        <div className="field">
          <label>Homepage (optional)</label>
          <input name="homepage" placeholder="https://example.com" />
        </div>

        <div className="field">
          <label>Capabilities (JSON array)</label>
          <textarea name="capabilities" rows={8} defaultValue={defaultCapabilities} />
          <span className="hint">Each capability needs a unique name; inputSchema/outputSchema are optional JSON Schema.</span>
        </div>

        <div>
          <button className="btn" type="submit" disabled={submitting}>
            {submitting ? "Publishing…" : "Publish listing"}
          </button>
        </div>
      </form>
    </div>
  );
}
