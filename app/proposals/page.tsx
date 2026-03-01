import Link from "next/link";
import { GovernanceRole, GovernanceVote } from "@/lib/cardano/types";
import { ensureFreshData } from "@/lib/scraper/service";
import { ProposalPhase, ProposalViewModel, buildProposalViewModels } from "@/lib/proposals/view-model";

export const dynamic = "force-dynamic";

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatDate(value?: string): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString();
}

function phaseLabel(phase: ProposalPhase): string {
  if (phase === "ongoing") {
    return "Ongoing Vote";
  }
  if (phase === "previous") {
    return "Previous Vote";
  }
  if (phase === "upcoming") {
    return "Upcoming";
  }
  return "Unknown";
}

function phaseClass(phase: ProposalPhase): string {
  return `phase-pill phase-${phase}`;
}

function parseRole(value?: string): GovernanceRole | null {
  const normalized = (value || "").toUpperCase();
  if (normalized === "DREP" || normalized === "SPO" || normalized === "CC") {
    return normalized;
  }
  return null;
}

function isFundedStatus(status: string): boolean {
  const value = status.toLowerCase();
  return (
    value.includes("enacted") ||
    value.includes("ratified") ||
    value.includes("approved") ||
    value.includes("passed") ||
    value.includes("funded") ||
    value.includes("completed")
  );
}

function ProposalSection({
  title,
  items,
  emptyLabel,
  evidenceByProposal
}: {
  title: string;
  items: ProposalViewModel[];
  emptyLabel: string;
  evidenceByProposal: Map<string, { kpiItems: string[]; milestoneItems: string[] }>;
}) {
  return (
    <section className="card proposal-section">
      <h2>{title}</h2>
      {!items.length ? (
        <p className="muted">{emptyLabel}</p>
      ) : (
        <div className="proposal-list">
          {items.map((item) => {
            const evidence = evidenceByProposal.get(item.metric.proposalId);
            const milestonePreview = evidence?.milestoneItems?.slice(0, 2).join(" | ");
            const kpiPreview = evidence?.kpiItems?.slice(0, 2).join(" | ");

            return (
              <article className="proposal-list-item" key={item.metric.proposalId}>
                <div className="proposal-head">
                  <span className={phaseClass(item.phase)}>{phaseLabel(item.phase)}</span>
                  <span className="muted">{item.metric.status}</span>
                </div>

                <h3>
                  <Link href={`/proposals/${encodeURIComponent(item.metric.proposalId)}`}>{item.metric.title}</Link>
                </h3>
                <p className="muted compact">
                  {(item.proposal?.body || item.proposal?.abstract || "No proposal description available").slice(0, 320)}
                </p>

                <p className="muted compact">ID: {item.metric.proposalId}</p>

                <div className="proposal-meta-grid">
                  <p>
                    Votes: <strong>{item.metric.voteCount}</strong>
                  </p>
                  <p>
                    KPI Completion: <strong>{pct(item.metric.milestoneCompletionRate)}</strong>
                  </p>
                  <p>
                    KPI Evidence Items: <strong>{item.metric.kpiEvidenceCount}</strong>
                  </p>
                  <p>
                    Milestones: <strong>{item.metric.completedMilestoneCount}/{item.metric.milestoneCount}</strong>
                  </p>
                  <p>
                    Achievement: <strong>{pct(item.metric.achievementScore)}</strong>
                  </p>
                  <p>
                    Success Index: <strong>{pct(item.metric.successScore)}</strong>
                  </p>
                  <p>
                    IF: <strong>{pct(item.metric.implementationFidelity || 0)}</strong>
                  </p>
                  <p>
                    IS: <strong>{pct(item.metric.impactScore || 0)}</strong>
                  </p>
                  <p>
                    ISpeed: <strong>{pct(item.metric.implementationSpeed || 0)}</strong>
                  </p>
                  <p>
                    Expires: <strong>{formatDate(item.proposal?.expiresAt)}</strong>
                  </p>
                </div>
                {kpiPreview ? <p className="muted compact">KPI Preview: {kpiPreview}</p> : null}
                {milestonePreview ? <p className="muted compact">Milestone Preview: {milestonePreview}</p> : null}

                <div className="actions">
                  <Link href={`/proposals/${encodeURIComponent(item.metric.proposalId)}`} className="btn btn-outline">
                    Open Proposal Metrics
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

interface SearchParams {
  q?: string;
  voter?: string;
  role?: string;
}

export default async function ProposalsPage({ searchParams }: { searchParams: SearchParams }) {
  const query = (searchParams.q || "").trim().toLowerCase();
  const voterQuery = (searchParams.voter || "").trim().toLowerCase();
  const role = parseRole(searchParams.role);
  const { analytics, snapshot } = await ensureFreshData(false);
  const rows = buildProposalViewModels(analytics, snapshot);
  const evidenceByProposal = new Map(
    (analytics.proposalEvidenceActivity || []).map((item) => [
      item.proposalId,
      {
        kpiItems: item.kpiItems || [],
        milestoneItems: item.milestoneItems || []
      }
    ])
  );
  const voteByProposal = new Map<string, GovernanceVote[]>();
  for (const vote of snapshot?.votes || []) {
    voteByProposal.set(vote.proposalId, [...(voteByProposal.get(vote.proposalId) || []), vote]);
  }

  const filteredRows = rows.filter((row) => {
    if (query) {
      const text = [row.metric.title, row.proposal?.abstract || "", row.proposal?.body || ""].join(" ").toLowerCase();
      if (!text.includes(query)) {
        return false;
      }
    }

    if (voterQuery || role) {
      const votes = voteByProposal.get(row.metric.proposalId) || [];
      const matched = votes.some((vote) => {
        if (role && vote.role !== role) {
          return false;
        }
        if (voterQuery && !vote.voterId.toLowerCase().includes(voterQuery)) {
          return false;
        }
        return true;
      });

      if (!matched) {
        return false;
      }
    }

    return true;
  });

  const ongoing = filteredRows.filter((row) => row.phase === "ongoing");
  const previous = filteredRows.filter((row) => row.phase === "previous");
  const upcoming = filteredRows.filter((row) => row.phase === "upcoming");
  const funded = filteredRows.filter((row) => isFundedStatus(row.metric.status || "") || row.phase === "previous");

  return (
    <main className="page dashboard">
      <header className="card dashboard-header">
        <h1>Proposal Metrics</h1>
        <p>
          Halaman ini fokus achievement KPI/milestone per proposal (evidence source + GitHub + onchain) dan histori voting DRep/SPO/CC.
        </p>
        <div className="actions">
          <Link href="/" className="btn btn-outline">
            Back To Dashboard
          </Link>
          <Link href="/participants" className="btn btn-outline">
            Participant Search
          </Link>
          <Link href="/api/governance/proposals" className="btn btn-outline">
            Proposals API
          </Link>
        </div>
      </header>

      <section className="card">
        <form className="filter-form" method="get">
          <label>
            Search Proposal Title/Body
            <input type="text" name="q" defaultValue={searchParams.q || ""} placeholder="constitution, treasury, ..." />
          </label>
          <label>
            Search Voter (DRep/SPO/CC)
            <input type="text" name="voter" defaultValue={searchParams.voter || ""} placeholder="drep1..., pool..., cc..." />
          </label>
          <label>
            Role
            <select name="role" defaultValue={(role || "") as string}>
              <option value="">All</option>
              <option value="DREP">DREP</option>
              <option value="SPO">SPO</option>
              <option value="CC">CC</option>
            </select>
          </label>
          <button className="btn" type="submit">
            Filter
          </button>
        </form>
      </section>

      <section className="stats-grid">
        <article className="card stat-card">
          <p className="label">Matched Proposals</p>
          <p className="value">{filteredRows.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Ongoing Votes</p>
          <p className="value">{ongoing.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Previous Votes</p>
          <p className="value">{previous.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Upcoming</p>
          <p className="value">{upcoming.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Passed/Funded Candidates</p>
          <p className="value">{funded.length}</p>
        </article>
      </section>

      <section className="card">
        <h2>How Passed/Funded Data Is Built</h2>
        <p className="muted compact">
          Sumber utama proposal/vote diambil dari provider on-chain (Blockfrost). Proposal masuk kategori passed/funded bila status mengandung:
          enacted, ratified, approved, passed, funded, completed atau sudah fase previous.
        </p>
        <p className="muted compact">
          KPI, milestone, dan deskripsi diperkaya dari source URL proposal (termasuk IPFS) lalu dihitung jadi Achievement/Success index.
        </p>
        <div className="actions">
          <Link href="/funded" className="btn btn-outline">
            Open Funded Analytics
          </Link>
        </div>
      </section>

      <section className="card">
        <h2>Key API & CLI Queries For Passed Proposals</h2>
        <p className="muted compact">
          CLI (all governance actions): <code>cardano-cli conway query proposals --all-proposals</code>
        </p>
        <p className="muted compact">
          CLI (specific proposal status): <code>cardano-cli conway query proposals --tx-id {"<TX_ID>"} --tx-ix {"<INDEX>"}</code>
        </p>
        <p className="muted compact">
          React SDK query: <code>@wingriders/governance-frontend-react-sdk</code> with <code>useProposalsQuery()</code> for proposal status display.
        </p>
        <p className="muted compact">
          Off-chain metadata source: Cardano Token Registry API for related metadata lookup.
        </p>
        <p className="muted compact">
          Internal API for passed/funded analytics in this app: <code>/api/analytics/overview</code> and <code>/api/governance/proposals</code>.
        </p>
      </section>

      <ProposalSection
        title="Ongoing Proposal Votes"
        items={ongoing}
        emptyLabel="Belum ada proposal dengan status ongoing pada data saat ini."
        evidenceByProposal={evidenceByProposal}
      />

      <ProposalSection
        title="Previous Proposal Votes"
        items={previous}
        emptyLabel="Belum ada historical vote proposal pada data saat ini."
        evidenceByProposal={evidenceByProposal}
      />

      {upcoming.length > 0 ? (
        <ProposalSection title="Upcoming Proposals" items={upcoming} emptyLabel="" evidenceByProposal={evidenceByProposal} />
      ) : null}
    </main>
  );
}
