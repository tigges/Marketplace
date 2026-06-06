import {
  getEarnings,
  getWallet,
  listApiKeys,
  listManifestsByOwner,
  listPayouts,
  listUsageForCreator,
  listUsageForRequester,
} from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { creditLabel } from "@/lib/format";
import { DashboardActions } from "./actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = await getDb();
  const tenant = await resolveTenant();
  const [wallet, earnings, keys, listings, asRequester, asCreator, payouts] = await Promise.all([
    getWallet(db, tenant.id),
    getEarnings(db, tenant.id),
    listApiKeys(db, tenant.id),
    listManifestsByOwner(db, tenant.id),
    listUsageForRequester(db, tenant.id, 20),
    listUsageForCreator(db, tenant.id, 20),
    listPayouts(db, tenant.id),
  ]);

  return (
    <div className="container detail">
      <h1>Dashboard</h1>
      <p className="lede">
        Tenant <code>{tenant.slug}</code>. Identity, prepaid wallet, usage ledger, and creator revenue — the
        Phase 3 surfaces.
      </p>

      <div className="section">
        <h2>Overview</h2>
        <div className="statgrid">
          <div className="stat">
            <div className="n">{wallet?.balanceCredits.toLocaleString() ?? 0}</div>
            <div className="l">Wallet balance ({creditLabel(wallet?.balanceCredits ?? 0)})</div>
          </div>
          <div className="stat">
            <div className="n">{earnings?.balanceCredits.toLocaleString() ?? 0}</div>
            <div className="l">Available earnings</div>
          </div>
          <div className="stat">
            <div className="n">{earnings?.lifetimeCredits.toLocaleString() ?? 0}</div>
            <div className="l">Lifetime earnings</div>
          </div>
          <div className="stat">
            <div className="n">{listings.length}</div>
            <div className="l">Published listings</div>
          </div>
        </div>
      </div>

      <div className="section">
        <h2>Actions</h2>
        <DashboardActions earningsBalance={earnings?.balanceCredits ?? 0} />
      </div>

      <div className="section">
        <h2>API keys ({keys.length})</h2>
        <div className="panel">
          {keys.length === 0 ? (
            <span className="muted">No keys yet. Issue one above to authenticate an agent against the router.</span>
          ) : (
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Prefix</th>
                  <th>Last used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td>
                      <code>{k.displayPrefix}…</code>
                    </td>
                    <td>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "—"}</td>
                    <td>{k.revokedAt ? "revoked" : "active"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="section">
        <h2>Usage as caller ({asRequester.length})</h2>
        <UsageTable rows={asRequester} amountKey="grossCredits" amountLabel="Charged" />
      </div>

      <div className="section">
        <h2>Earnings as creator ({asCreator.length})</h2>
        <UsageTable rows={asCreator} amountKey="creatorCredits" amountLabel="Earned" />
      </div>

      {payouts.length > 0 ? (
        <div className="section">
          <h2>Payouts</h2>
          <div className="panel">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.amountCredits}</td>
                    <td>{p.status}</td>
                    <td>{new Date(p.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UsageTable({
  rows,
  amountKey,
  amountLabel,
}: {
  rows: Array<Record<string, any>>;
  amountKey: string;
  amountLabel: string;
}) {
  if (rows.length === 0) return <p className="muted">No activity yet.</p>;
  return (
    <div className="panel">
      <table className="ledger">
        <thead>
          <tr>
            <th>Capability</th>
            <th>Status</th>
            <th>Bytes (req/resp)</th>
            <th>{amountLabel}</th>
            <th>When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <code>{r.capability}</code>
              </td>
              <td>{r.status}</td>
              <td>
                {r.requestBytes}/{r.responseBytes}
              </td>
              <td>{r[amountKey]}</td>
              <td>{new Date(r.createdAt).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
