import Link from "next/link";
import { notFound } from "next/navigation";
import { GovernanceRole, GovernanceVote, ProposalMetrics } from "@/lib/cardano/types";
import {
  ProposalPhase,
  ProposalViewModel,
  buildProposalViewModels,
  buildRoleVoteSummary,
  buildVoteTimeline
} from "@/lib/proposals/view-model";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function votePct(value: number, total: number): number {
  if (!total) {
    return 0;
  }
  return (value / total) * 100;
}

function toEpoch(value?: string): number {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function shortId(value: string, max = 18): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 3)}...`;
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

function kpiFlagClass(hit: boolean): string {
  return hit ? "kpi-flag yes" : "kpi-flag no";
}

function KpiFlags({ metric }: { metric: ProposalMetrics }) {
  return (
    <div className="kpi-flag-grid">
      <div className={kpiFlagClass(metric.hitEvidenceTarget)}>
        Evidence Target: <strong>{metric.hitEvidenceTarget ? "Hit" : "Miss"}</strong>
      </div>
      <div className={kpiFlagClass(metric.hitMilestoneTarget)}>
        Milestone Target: <strong>{metric.hitMilestoneTarget ? "Hit" : "Miss"}</strong>
      </div>
      <div className={kpiFlagClass(metric.hitGithubTarget)}>
        GitHub Target: <strong>{metric.hitGithubTarget ? "Hit" : "Miss"}</strong>
      </div>
      <div className={kpiFlagClass(metric.successScore >= 0.5)}>
        Success Index Threshold: <strong>{metric.successScore >= 0.5 ? "Pass" : "Below"}</strong>
      </div>
    </div>
  );
}

function VoteCompositionChart({
  yes,
  no,
  abstain,
  total
}: {
  yes: number;
  no: number;
  abstain: number;
  total: number;
}) {
  const safeTotal = total || 1;
  const yesWidth = votePct(yes, safeTotal);
  const noWidth = votePct(no, safeTotal);
  const abstainWidth = votePct(abstain, safeTotal);

  return (
    <section className="card">
      <h2>Voting Composition Chart</h2>
      <div className="stacked-chart" role="img" aria-label="Vote composition yes no abstain">
        <span className="segment yes" style={{ width: `${yesWidth}%` }} />
        <span className="segment no" style={{ width: `${noWidth}%` }} />
        <span className="segment abstain" style={{ width: `${abstainWidth}%` }} />
      </div>
      <div className="chart-legend">
        <p>
          <span className="legend-dot yes" /> Yes: <strong>{yes}</strong> ({pct(votePct(yes, safeTotal) / 100)})
        </p>
        <p>
          <span className="legend-dot no" /> No: <strong>{no}</strong> ({pct(votePct(no, safeTotal) / 100)})
        </p>
        <p>
          <span className="legend-dot abstain" /> Abstain: <strong>{abstain}</strong> ({pct(votePct(abstain, safeTotal) / 100)})
        </p>
      </div>
    </section>
  );
}

function buildPolylinePoints(values: number[], width = 640, height = 190): string {
  if (!values.length) {
    return "";
  }

  const max = Math.max(...values, 1);
  const pad = 18;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : pad + (index * (width - pad * 2)) / (values.length - 1);
      const y = height - pad - (value / max) * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");
}

function VoteTrendChart({ votes }: { votes: GovernanceVote[] }) {
  const timeline = buildVoteTimeline(votes)
    .filter((point) => point.label !== "unknown")
    .slice(-12);
  const undatedCount = votes.filter((vote) => !vote.timestamp).length;

  if (!timeline.length) {
    return (
      <section className="card">
        <h2>Vote Trend Chart</h2>
        <p className="muted">
          Tidak ada timestamp vote yang cukup untuk dibuat trend chart.
          {undatedCount ? ` Vote tanpa timestamp: ${undatedCount}.` : ""}
        </p>
      </section>
    );
  }

  let cumulative = 0;
  const cumulativeValues = timeline.map((point) => {
    cumulative += point.total;
    return cumulative;
  });

  const points = buildPolylinePoints(cumulativeValues);

  return (
    <section className="card">
      <h2>Vote Trend Chart</h2>
      <svg className="line-chart" viewBox="0 0 640 190" role="img" aria-label="Cumulative proposal vote trend">
        <line x1="18" y1="172" x2="622" y2="172" className="axis" />
        <line x1="18" y1="18" x2="18" y2="172" className="axis" />
        <polyline points={points} className="trend-line" />
      </svg>
      <div className="timeline-grid">
        {timeline.map((point, index) => (
          <div className="timeline-cell" key={`${point.label}-${index}`}>
            <p className="muted compact">{point.label}</p>
            <p>
              +{point.total} votes ({cumulativeValues[index]})
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function RelatedProposalLinks({ title, items }: { title: string; items: ProposalViewModel[] }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {!items.length ? (
        <p className="muted">Tidak ada data.</p>
      ) : (
        <ul className="simple-list">
          {items.map((item) => (
            <li key={item.metric.proposalId}>
              <Link href={`/proposals/${encodeURIComponent(item.metric.proposalId)}`}>{item.metric.title}</Link>
              <span className="muted"> ({item.metric.voteCount} votes)</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface PageProps {
  params: {
    proposalId: string;
  };
  searchParams: {
    voter?: string;
    role?: string;
  };
}

export default async function ProposalDetailPage({ params, searchParams }: PageProps) {
  const proposalId = decodeURIComponent(params.proposalId);
  const voterQuery = (searchParams.voter || "").trim().toLowerCase();
  const roleFilter = parseRole(searchParams.role);
  const { analytics, snapshot } = await ensureFreshData(false);

  const rows = buildProposalViewModels(analytics, snapshot);
  const current = rows.find((row) => row.metric.proposalId === proposalId);
  const evidenceByProposal = new Map(
    (analytics.proposalEvidenceActivity || []).map((item) => [item.proposalId, item])
  );
  const currentEvidence = evidenceByProposal.get(proposalId);

  if (!current) {
    notFound();
  }

  const allVotes = snapshot?.votes || [];
  const proposalVotes = allVotes.filter((vote) => vote.proposalId === proposalId);
  const filteredVotes = proposalVotes.filter((vote) => {
    if (roleFilter && vote.role !== roleFilter) {
      return false;
    }
    if (voterQuery && !vote.voterId.toLowerCase().includes(voterQuery)) {
      return false;
    }
    return true;
  });
  const displayVotes = roleFilter || voterQuery ? filteredVotes : proposalVotes;
  const roleSummary = buildRoleVoteSummary(displayVotes);
  const yesVotes = displayVotes.filter((vote) => vote.choice === "yes").length;
  const noVotes = displayVotes.filter((vote) => vote.choice === "no").length;
  const abstainVotes = displayVotes.filter((vote) => vote.choice === "abstain").length;

  const recentVotes = [...displayVotes]
    .sort((a, b) => toEpoch(b.timestamp) - toEpoch(a.timestamp))
    .slice(0, 30);

  const ongoingOthers = rows
    .filter((row) => row.metric.proposalId !== proposalId && row.phase === "ongoing")
    .slice(0, 6);

  const previousOthers = rows
    .filter((row) => row.metric.proposalId !== proposalId && row.phase === "previous")
    .slice(0, 6);

  return (
    <main className="page dashboard">
      <header className="card dashboard-header">
        <div className="proposal-head">
          <span className={phaseClass(current.phase)}>{phaseLabel(current.phase)}</span>
          <span className="muted">{current.metric.status}</span>
        </div>
        <h1>{current.metric.title}</h1>
        <p className="muted compact">Proposal ID: {current.metric.proposalId}</p>
        <div className="actions">
          <Link href="/proposals" className="btn btn-outline">
            Back To Proposals
          </Link>
          <Link href="/" className="btn btn-outline">
            Back To Dashboard
          </Link>
        </div>
      </header>

      <section className="stats-grid">
        <article className="card stat-card">
          <p className="label">Votes</p>
          <p className="value">{current.metric.voteCount}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Unique Voters</p>
          <p className="value">{current.metric.uniqueVoters}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Achievement Index</p>
          <p className="value">{pct(current.metric.achievementScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">KPI Completion</p>
          <p className="value">{pct(current.metric.milestoneCompletionRate)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Evidence Score</p>
          <p className="value">{pct(current.metric.evidenceScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Success Index</p>
          <p className="value">{pct(current.metric.successScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Vote Signal Score</p>
          <p className="value">{pct(current.metric.governanceScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Development Score</p>
          <p className="value">{pct(current.metric.developmentScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Onchain Score</p>
          <p className="value">{pct(current.metric.onchainScore)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Implementation Fidelity (IF)</p>
          <p className="value">{pct(current.metric.implementationFidelity || 0)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Impact Score (IS)</p>
          <p className="value">{pct(current.metric.impactScore || 0)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Implementation Speed (ISpeed)</p>
          <p className="value">{pct(current.metric.implementationSpeed || 0)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">GitHub Repo</p>
          <p className="value small">{current.github?.repository?.fullName || "N/A"}</p>
        </article>
      </section>

      <section className="card">
        <h2>Proposal KPI Achievement Metrics</h2>
        <KpiFlags metric={current.metric} />
        <p className="muted compact">
          Formula proposal success: PS = v1*IF + v2*IS + v3*ISpeed (berbobot). Nilai yang ditampilkan sudah dinormalisasi 0-100%.
        </p>
      </section>

      <section className="card">
        <h2>Scraped KPI & Milestone Evidence</h2>
        <p>
          KPI Items: <strong>{current.metric.kpiEvidenceCount}</strong> | Milestones: <strong>{current.metric.milestoneCount}</strong> | Completed Milestones:{" "}
          <strong>{current.metric.completedMilestoneCount}</strong>
        </p>
        {currentEvidence?.kpiItems?.length ? (
          <ul className="simple-list">
            {currentEvidence.kpiItems.slice(0, 8).map((item, index) => (
              <li key={`kpi-${index}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No KPI evidence extracted from proposal source.</p>
        )}
        {currentEvidence?.milestoneItems?.length ? (
          <ul className="simple-list">
            {currentEvidence.milestoneItems.slice(0, 8).map((item, index) => (
              <li key={`ms-${index}`}>{item}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No milestone evidence extracted from proposal source.</p>
        )}
      </section>

      <section className="card">
        <h2>Proposal Title & Body</h2>
        <p>
          <strong>Title:</strong> {current.proposal?.title || current.metric.title}
        </p>
        <p className="proposal-body-text">
          {current.proposal?.body || current.proposal?.abstract || "No proposal body metadata available."}
        </p>
      </section>

      <VoteCompositionChart
        yes={yesVotes}
        no={noVotes}
        abstain={abstainVotes}
        total={displayVotes.length}
      />
      <VoteTrendChart votes={displayVotes} />

      <section className="card table-card">
        <h2>Vote Breakdown By Governance Role</h2>
        <table>
          <thead>
            <tr>
              <th>Role</th>
              <th>Total Votes</th>
              <th>Yes</th>
              <th>No</th>
              <th>Abstain</th>
              <th>Unknown</th>
            </tr>
          </thead>
          <tbody>
            {roleSummary.map((role) => (
              <tr key={role.role}>
                <td>{role.role}</td>
                <td>{role.total}</td>
                <td>{role.yes}</td>
                <td>{role.no}</td>
                <td>{role.abstain}</td>
                <td>{role.unknown}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card table-card">
        <h2>Current & Previous Vote Activity</h2>
        <form className="filter-form" method="get">
          <label>
            Search Voter (DRep/SPO/CC)
            <input type="text" name="voter" defaultValue={searchParams.voter || ""} placeholder="drep1..., pool..., cc..." />
          </label>
          <label>
            Role
            <select name="role" defaultValue={(roleFilter || "") as string}>
              <option value="">All</option>
              <option value="DREP">DREP</option>
              <option value="SPO">SPO</option>
              <option value="CC">CC</option>
            </select>
          </label>
          <button className="btn" type="submit">
            Filter Votes
          </button>
        </form>
        {roleFilter || voterQuery ? (
          <p className="muted compact">
            Showing filtered votes: <strong>{displayVotes.length}</strong> entries.
          </p>
        ) : null}
        {!recentVotes.length ? (
          <p className="muted">Belum ada vote untuk proposal ini.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Role</th>
                <th>Choice</th>
                <th>Voter</th>
                <th>Voting Power</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {recentVotes.map((vote, index) => (
                <tr key={`${vote.voterId}-${vote.txHash || "na"}-${index}`}>
                  <td>{formatDateTime(vote.timestamp)}</td>
                  <td>{vote.role}</td>
                  <td>{vote.choice}</td>
                  <td title={vote.voterId}>{shortId(vote.voterId, 24)}</td>
                  <td>{vote.votingPower ?? "-"}</td>
                  <td title={vote.txHash}>{vote.txHash ? shortId(vote.txHash, 24) : "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="info-grid">
        <section className="card">
          <h2>Proposal Context</h2>
          <p>
            Created: <strong>{formatDateTime(current.proposal?.createdAt)}</strong>
          </p>
          <p>
            Expires: <strong>{formatDateTime(current.proposal?.expiresAt)}</strong>
          </p>
          <p>
            GitHub Live: <strong>{current.github ? (current.github.isLive ? "Yes" : "No") : "N/A"}</strong>
          </p>
          {current.proposal?.url ? (
            <p>
              Source URL: <a href={current.proposal.url} target="_blank" rel="noreferrer">{current.proposal.url}</a>
            </p>
          ) : null}
          {currentEvidence?.resolvedUrl ? (
            <p>
              Evidence Source: <a href={currentEvidence.resolvedUrl} target="_blank" rel="noreferrer">{currentEvidence.resolvedUrl}</a>
            </p>
          ) : null}
          {currentEvidence?.error ? <p className="muted">Evidence scrape: {currentEvidence.error}</p> : null}
          {current.github?.liveReason ? <p className="muted">{current.github.liveReason}</p> : null}
        </section>

        <RelatedProposalLinks title="Other Ongoing Proposal Votes" items={ongoingOthers} />
        <RelatedProposalLinks title="Other Previous Proposal Votes" items={previousOthers} />
      </section>
    </main>
  );
}
