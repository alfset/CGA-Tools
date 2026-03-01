import Link from "next/link";
import { ensureFreshData } from "@/lib/scraper/service";
import { GovernanceDrep, GovernanceRole, GovernanceVote, RoleMetrics } from "@/lib/cardano/types";
import { buildProposalViewModels, buildVoteTimeline } from "@/lib/proposals/view-model";
import {
  resolveDisplayStatus,
  resolveProposalType,
  statusBadgeClass,
  spoVotingAllowed,
  getVotingThresholds,
  adaCompact,
  type ProposalDisplayStatus,
  type ProposalDisplayType,
} from "@/lib/proposals/proposal-status";

export const dynamic = "force-dynamic";

const ROLE_ORDER: GovernanceRole[] = ["DREP", "SPO", "CC"];

/* ─── Formatters ─── */

function pct(value: number): string {
  const percent = (value * 100).toFixed(2);
  const cleaned = percent.replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return `${cleaned}%`;
}

function compact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs < 1000)
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 })
      .format(value)
      .replace(/(\.\d*?[1-9])0+$/, "$1")
      .replace(/\.0+$/, "");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    compactDisplay: "short",
    maximumFractionDigits: 2,
  })
    .format(value)
    .replace(/(\.\d*?[1-9])0+(?=[A-Za-z])/g, "$1")
    .replace(/\.0+(?=[A-Za-z])/g, "");
}

function readQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function roleData(roleMetrics: RoleMetrics[], role: GovernanceRole): RoleMetrics {
  return (
    roleMetrics.find((item) => item.role === role) || {
      role,
      totalVotes: 0,
      uniqueVoters: 0,
      yesRate: 0,
      noRate: 0,
      abstainRate: 0,
    }
  );
}

function votePct(value: number, total: number): number {
  if (!total) return 0;
  return (value / total) * 100;
}

function buildPolylinePoints(values: number[], width = 640, height = 190): string {
  if (!values.length) return "";
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

function topDreps(dreps: GovernanceDrep[]): GovernanceDrep[] {
  return [...dreps]
    .sort((a, b) => (b.votingPower || 0) - (a.votingPower || 0))
    .slice(0, 10);
}

function drepAlias(id: string): string {
  if (!id) return "DRep";
  return `DRep ${id.slice(0, 12)}…`;
}

function roleClassName(role: GovernanceRole): string {
  return role.toLowerCase();
}

/* ─── Sub-components ─── */

function StatusBadge({ status }: { status: ProposalDisplayStatus }) {
  return <span className={`status-badge ${statusBadgeClass(status)}`}>{status}</span>;
}

function ProposalTypeBadge({ type }: { type: ProposalDisplayType }) {
  return <span className="type-badge">{type}</span>;
}

function StatCard({
  label,
  value,
  note,
  tone = "default",
}: {
  label: string;
  value: string | number;
  note?: string;
  tone?: "default" | "primary" | "success";
}) {
  return (
    <article className={`card stat-card stat-${tone}`}>
      <p className="label">{label}</p>
      <p className="value">{value}</p>
      {note ? <p className="muted compact">{note}</p> : null}
    </article>
  );
}

function RoleTotalCard({ role }: { role: RoleMetrics }) {
  return (
    <article className="card role-summary-card">
      <p className="label">Total {role.role}</p>
      <p className="value">{role.uniqueVoters}</p>
      <p className="muted">{role.totalVotes} votes recorded</p>
    </article>
  );
}

function CircleKpi({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(1, Math.max(0, value));
  const size = 96;
  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - normalized);

  return (
    <article className="card stat-card kpi-circle-card">
      <p className="label">{label}</p>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`${label} ${pct(normalized)}`}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className="kpi-circle-track" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="kpi-circle-fill"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <p className="value">{pct(normalized)}</p>
    </article>
  );
}

function MetricBarChart({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ role: GovernanceRole; value: number; label?: string }>;
}) {
  const max = Math.max(...rows.map((row) => row.value), 1);
  return (
    <section className="card">
      <h2>{title}</h2>
      <div className="metric-bars">
        {rows.map((row) => {
          const width = (row.value / max) * 100;
          return (
            <div className="metric-bar-row" key={`${title}-${row.role}`}>
              <p className="compact">
                <strong>{row.role}</strong> <span className="muted">{row.label || ""}</span>
              </p>
              <div className="metric-bar-track" role="img" aria-label={`${row.role} ${row.value}`}>
                <span className={`metric-bar-fill ${roleClassName(row.role)}`} style={{ width: `${width}%` }} />
              </div>
              <p className="compact">{row.value}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Per-role vote panel with threshold indicator and stake breakdown.
 * Matches syncgovhub.com layout.
 */
function ProposalRoleVoteCard({
  role,
  yes,
  no,
  abstain,
  total,
  uniqueVoters,
  yesStake,
  noStake,
  abstainStake,
  totalStake,
  threshold,
  allowed,
}: {
  role: "DReps" | "SPOs" | "CC";
  yes: number;
  no: number;
  abstain: number;
  total: number;
  uniqueVoters: number;
  yesStake?: number;
  noStake?: number;
  abstainStake?: number;
  totalStake?: number;
  threshold: number | null;
  allowed: boolean;
}) {
  const safeTotal = total || 1;
  const yesRate = yes / safeTotal;
  const noRate = no / safeTotal;
  const abstainRate = abstain / safeTotal;
  const isYesLeading = yes >= no;
  const participation =
    totalStake && totalStake > 0
      ? (((yesStake ?? 0) + (noStake ?? 0)) / totalStake) * 100
      : null;

  if (!allowed) {
    return (
      <div className="role-vote-panel role-vote-panel--disabled">
        <p className="role-label">{role} Voting Not Allowed</p>
        <p className="muted compact">
          This proposal type does not allow {role === "SPOs" ? "Stake Pool Operator" : role} voting.
        </p>
        <div className="threshold-indicator threshold-indicator--na">
          <span className="muted">0%</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`role-vote-panel ${isYesLeading ? "role-vote-panel--yes" : "role-vote-panel--no"}`}>
      {/* Role + verdict header */}
      <div className="role-vote-panel__header">
        <span className="role-label">{role}</span>
        <span className={`vote-verdict ${isYesLeading ? "yes" : "no"}`}>
          {isYesLeading ? "YES" : "NO"} ({(isYesLeading ? yesRate : noRate) * 100 > 0 ? ((isYesLeading ? yesRate : noRate) * 100).toFixed(2) : "0"}%)
        </span>
      </div>

      {/* Stacked bar */}
      <div className="vote-composition-bar" role="img" aria-label={`${role} votes`}>
        <span className="segment yes" style={{ width: `${yesRate * 100}%` }} />
        <span className="segment no" style={{ width: `${noRate * 100}%` }} />
        <span className="segment abstain" style={{ width: `${abstainRate * 100}%` }} />
      </div>

      {/* Threshold */}
      {threshold !== null && (
        <div className="vote-threshold-row">
          <span className="threshold-label">{(threshold * 100).toFixed(0)}%</span>
          <div className="threshold-bar-track">
            <span
              className={`threshold-bar-fill ${yesRate >= threshold ? "above" : "below"}`}
              style={{ width: `${Math.min(yesRate / threshold, 1) * 100}%` }}
            />
          </div>
          <span className={`threshold-pill ${yesRate >= threshold ? "above" : "below"}`}>
            {yesRate >= threshold ? "↑ Above" : "↓ Below"}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="role-vote-stats">
        <div>
          <p className="muted compact">Total votes</p>
          <p className="compact">
            <strong>{total}</strong>
          </p>
        </div>
        <div>
          <p className="muted compact">Voters</p>
          <p className="compact">
            <strong>{uniqueVoters}</strong>
          </p>
        </div>
        {totalStake !== undefined && (
          <div>
            <p className="muted compact">Total stake</p>
            <p className="compact">
              <strong>{adaCompact(totalStake)}</strong>
            </p>
          </div>
        )}
        {participation !== null && (
          <div>
            <p className="muted compact">Participation</p>
            <p className="compact">
              <strong>{participation.toFixed(2)}%</strong>
            </p>
          </div>
        )}
      </div>

      {/* Breakdown */}
      <div className="vote-breakdown-lines">
        <div className="vbl-row">
          <span className="legend-dot yes" />
          <span className="vbl-label">Yes</span>
          <span className="vbl-pct yes">{(yesRate * 100).toFixed(2)}%</span>
          {yesStake !== undefined && <span className="muted compact">{adaCompact(yesStake)}</span>}
        </div>
        <div className="vbl-row">
          <span className="legend-dot no" />
          <span className="vbl-label">No</span>
          <span className="vbl-pct no">{(noRate * 100).toFixed(2)}%</span>
          {noStake !== undefined && <span className="muted compact">{adaCompact(noStake)}</span>}
        </div>
        <div className="vbl-row">
          <span className="legend-dot abstain" />
          <span className="vbl-label">Abstain</span>
          <span className="vbl-pct">{(abstainRate * 100).toFixed(2)}%</span>
          {abstainStake !== undefined && <span className="muted compact">{adaCompact(abstainStake)}</span>}
        </div>
      </div>
    </div>
  );
}

function ProposalVoteComposition({
  yes,
  no,
  abstain,
  total,
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
      <h2>Selected Proposal Overall Vote Composition</h2>
      <div className="stacked-chart" role="img" aria-label="Vote composition yes no abstain">
        <span className="segment yes" style={{ width: `${yesWidth}%` }} />
        <span className="segment no" style={{ width: `${noWidth}%` }} />
        <span className="segment abstain" style={{ width: `${abstainWidth}%` }} />
      </div>
      <div className="chart-legend">
        <p>
          <span className="legend-dot yes" /> Yes: <strong>{yes}</strong> ({pct(yesWidth / 100)})
        </p>
        <p>
          <span className="legend-dot no" /> No: <strong>{no}</strong> ({pct(noWidth / 100)})
        </p>
        <p>
          <span className="legend-dot abstain" /> Abstain: <strong>{abstain}</strong> (
          {pct(abstainWidth / 100)})
        </p>
      </div>
    </section>
  );
}

function ProposalVoteTrend({ votes }: { votes: GovernanceVote[] }) {
  const timeline = buildVoteTimeline(votes)
    .filter((point) => point.label !== "unknown")
    .slice(-12);
  const undatedCount = votes.filter((vote) => !vote.timestamp).length;

  if (!timeline.length) {
    return (
      <section className="card">
        <h2>Selected Proposal Vote Trend</h2>
        <p className="muted">
          No timestamped votes available for trend chart.
          {undatedCount ? ` Undated votes: ${undatedCount}.` : ""}
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
      <h2>Selected Proposal Vote Trend</h2>
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
              +{point.total} ({cumulativeValues[index]})
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Treasury Analytics ─── */

function TreasuryAnalyticsCard({ analytics }: { analytics: any }) {
  const treasury = analytics.treasuryMetrics || analytics.onchainMetrics || {};
  const totalWithdrawals = analytics.proposals?.filter(
    (p: any) => resolveProposalType(p.actionType || p.type) === "TreasuryWithdrawal"
  ) || [];
  const enactedWithdrawals = totalWithdrawals.filter(
    (p: any) => resolveDisplayStatus(p.status) === "Enacted"
  );
  const totalWithdrawnAda = enactedWithdrawals.reduce(
    (sum: number, p: any) => sum + (p.treasuryAmount || 0),
    0
  );

  return (
    <section className="card treasury-analytics-card">
      <h2>ADA Treasury Analytics</h2>
      <div className="treasury-stats-grid">
        <div className="treasury-stat">
          <p className="muted compact">Treasury Reserves</p>
          <p className="value">
            <strong>{adaCompact(treasury.treasuryBalance || treasury.reserves || 0)}</strong>
          </p>
        </div>
        <div className="treasury-stat">
          <p className="muted compact">Circulating Supply</p>
          <p className="value">
            <strong>{adaCompact(treasury.circulatingSupply || 0)}</strong>
          </p>
        </div>
        <div className="treasury-stat">
          <p className="muted compact">Treasury Withdrawals (Total)</p>
          <p className="value">
            <strong>{totalWithdrawals.length}</strong>
          </p>
        </div>
        <div className="treasury-stat">
          <p className="muted compact">Enacted Withdrawals</p>
          <p className="value">
            <strong>{enactedWithdrawals.length}</strong>
          </p>
        </div>
        <div className="treasury-stat">
          <p className="muted compact">Total ADA Withdrawn</p>
          <p className="value">
            <strong>{adaCompact(totalWithdrawnAda)}</strong>
          </p>
        </div>
        <div className="treasury-stat">
          <p className="muted compact">Onchain Health Score</p>
          <p className="value">
            <strong>{pct(treasury.onchainHealthScore || analytics.onchainMetrics?.onchainHealthScore || 0)}</strong>
          </p>
        </div>
      </div>
    </section>
  );
}

/* ─── Proposal List Card (syncgovhub-style) ─── */

function ProposalListItem({
  proposal,
  selected,
}: {
  proposal: ReturnType<typeof buildProposalViewModels>[number];
  selected: boolean;
}) {
  const status = resolveDisplayStatus(proposal.metric.status);
  const type = resolveProposalType((proposal.metric as any).actionType || proposal.metric.status);
  const total = proposal.metric.voteCount || 1;
  const drepVotes = proposal.metric.roleVotes.find((r) => r.role === "DREP");
  const spoVotes = proposal.metric.roleVotes.find((r) => r.role === "SPO");
  const ccVotes = proposal.metric.roleVotes.find((r) => r.role === "CC");
  const drepTotal = drepVotes?.totalVotes || 1;
  const spoTotal = spoVotes?.totalVotes || 1;
  const ccTotal = ccVotes?.totalVotes || 1;
  const drepYesRate = drepVotes ? drepVotes.yes / drepTotal : 0;
  const spoYesRate = spoVotes ? spoVotes.yes / spoTotal : 0;
  const ccYesRate = ccVotes ? ccVotes.yes / ccTotal : 0;
  const drepIsYes = drepYesRate >= 0.5;
  const spoIsYes = spoYesRate >= 0.5;
  const ccIsYes = ccYesRate >= 0.5;
  const spoAllowed = spoVotingAllowed(type);

  return (
    <Link
      href={`?proposalId=${encodeURIComponent(proposal.metric.proposalId)}`}
      className={`proposal-list-item ${selected ? "proposal-list-item--selected" : ""}`}
    >
      <div className="pli-header">
        <span className={`status-badge ${statusBadgeClass(status)}`}>{status}</span>
        <span className="type-badge">{type}</span>
      </div>
      <p className="pli-title">{proposal.metric.title}</p>
      <div className="pli-votes">
        <span className={`pli-role-vote ${drepIsYes ? "yes" : "no"}`}>
          DReps {drepIsYes ? "YES" : "NO"} ({(drepYesRate * 100).toFixed(1)}%)
        </span>
        {spoAllowed ? (
          <span className={`pli-role-vote ${spoIsYes ? "yes" : "no"}`}>
            SPOs {spoIsYes ? "YES" : "NO"} ({(spoYesRate * 100).toFixed(1)}%)
          </span>
        ) : (
          <span className="pli-role-vote na">SPO N/A</span>
        )}
        <span className={`pli-role-vote ${ccIsYes ? "yes" : "no"}`}>
          CC {ccIsYes ? "YES" : "NO"} ({(ccYesRate * 100).toFixed(1)}%)
        </span>
      </div>
    </Link>
  );
}

/* ─── Page ─── */

interface DashboardPageProps {
  searchParams: { proposalId?: string | string[] };
}

export default async function DashboardPage({ searchParams }: DashboardPageProps) {
  const { analytics, snapshot } = await ensureFreshData(true);
  const roleMetrics = analytics.roleMetrics || [];
  const proposals = buildProposalViewModels(analytics, snapshot);
  const queryProposalId = readQueryValue(searchParams.proposalId).trim();
  const currentProposal =
    proposals.find((item) => item.metric.proposalId === queryProposalId) || proposals[0];
  const currentProposalId = currentProposal?.metric.proposalId || "";
  const currentVotes = (snapshot?.votes || []).filter((v) => v.proposalId === currentProposalId);

  /* Role vote breakdown for selected proposal */
  const currentRoleMetrics = ROLE_ORDER.map((role) => {
    const data = currentProposal?.metric.roleVotes.find((item) => item.role === role);
    return { role, totalVotes: data?.totalVotes || 0, yes: data?.yes || 0, no: data?.no || 0 };
  });

  /* Derived counts */
  const ongoing = proposals.filter((item) => item.phase === "ongoing").length;
  const previous = proposals.filter((item) => item.phase === "previous").length;
  const upcoming = proposals.filter((item) => item.phase === "upcoming").length;

  /* Role-level totals */
  const drep = roleData(roleMetrics, "DREP");
  const spo = roleData(roleMetrics, "SPO");
  const cc = roleData(roleMetrics, "CC");

  /* DRep activity for voting power fallback */
  const drepVoteActivity = new Map<string, number>();
  for (const vote of snapshot?.votes || []) {
    if (vote.role !== "DREP") continue;
    drepVoteActivity.set(vote.voterId, (drepVoteActivity.get(vote.voterId) || 0) + 1);
  }
  const featuredDreps = topDreps(
    (snapshot?.dreps || []).map((row) => ({
      ...row,
      votingPower: row.votingPower ?? drepVoteActivity.get(row.id),
    }))
  );

  /* Selected proposal derived data */
  const totalSelectedVotes = currentProposal?.metric.voteCount || 0;
  const selectedYesRate = totalSelectedVotes ? currentProposal!.metric.yes / totalSelectedVotes : 0;
  const selectedNoRate = totalSelectedVotes ? currentProposal!.metric.no / totalSelectedVotes : 0;
  const selectedAbstainRate = totalSelectedVotes
    ? currentProposal!.metric.abstain / totalSelectedVotes
    : 0;

  const governanceIndex = analytics.governanceIndex || {
    votingParticipation: 0,
    proposalAcceptanceRatio: 0,
    implementationRate: 0,
    communitySatisfaction: 0,
    score: 0,
  };

  /* Current proposal type + thresholds */
  const currentStatus = currentProposal
    ? resolveDisplayStatus(currentProposal.metric.status)
    : "Unknown";
  const currentType = currentProposal
    ? resolveProposalType(
        (currentProposal.metric as any).actionType || currentProposal.metric.status
      )
    : "Unknown";
  const thresholds = getVotingThresholds(currentType);
  const spoAllowed = spoVotingAllowed(currentType);

  /* ADA stake fields from snapshot proposal */
  const snapshotProposal = (snapshot?.proposals || []).find(
    (p) => p.id === currentProposalId
  ) as any;

  /* Role-specific vote totals */
  const drepRM = currentRoleMetrics.find((r) => r.role === "DREP");
  const spoRM = currentRoleMetrics.find((r) => r.role === "SPO");
  const ccRM = currentRoleMetrics.find((r) => r.role === "CC");

  const drepUniqueVoters = new Set(currentVotes.filter((v) => v.role === "DREP").map((v) => v.voterId)).size;
  const spoUniqueVoters = new Set(currentVotes.filter((v) => v.role === "SPO").map((v) => v.voterId)).size;
  const ccUniqueVoters = new Set(currentVotes.filter((v) => v.role === "CC").map((v) => v.voterId)).size;

  const drepTotal = drepRM?.totalVotes || 0;
  const spoTotal = spoRM?.totalVotes || 0;
  const ccTotal = ccRM?.totalVotes || 0;
  const drepYes = drepRM?.yes || 0;
  const drepNo = drepRM?.no || 0;
  const spoYes = spoRM?.yes || 0;
  const spoNo = spoRM?.no || 0;
  const ccYes = ccRM?.yes || 0;
  const ccNo = ccRM?.no || 0;
  const drepAbstain = Math.max(0, drepTotal - drepYes - drepNo);
  const spoAbstain = Math.max(0, spoTotal - spoYes - spoNo);
  const ccAbstain = Math.max(0, ccTotal - ccYes - ccNo);

  return (
    <main className="page dashboard dashboard-sync">
      {/* ── Hero ── */}
      <header className="dashboard-header card dashboard-hero">
        <p className="eyebrow">Live Governance Analytics</p>
        <h1>Cardano Governance Intelligence Hub</h1>
        <p className="muted">
          Real-time governance metrics for DRep, SPO, CC participation and proposal outcome
          tracking.
        </p>
        <div className="dashboard-hero-meta">
          <span className="metric-chip">Network: {analytics.network}</span>
          <span className="metric-chip">Provider: {analytics.provider}</span>
          <span className="metric-chip">
            Updated: {new Date(analytics.generatedAt).toLocaleString()}
          </span>
        </div>
        <div className="actions">
          <Link href="/proposals" className="btn">
            Open Proposal Metrics
          </Link>
          <Link href="/funded" className="btn">
            Funded Forum
          </Link>
          <Link href="/participants" className="btn">
            Search DRep/SPO/CC
          </Link>
        </div>
      </header>

      {/* ── Summary Stats ── */}
      <section className="stats-grid stats-grid-compact">
        <StatCard label="Total Proposals" value={compact(analytics.proposalCount || 0)} />
        <StatCard label="Total Votes" value={compact(analytics.voteCount || 0)} />
        <StatCard label="Unique Voters" value={compact(analytics.uniqueVoterCount || 0)} />
        <StatCard label="Total DReps" value={compact(analytics.drepCount || 0)} />
        <StatCard
          label="Total ADA Stake"
          value={adaCompact(analytics.totalAdaStake || 0)}
          note="ADA eligible for governance"
        />
        <StatCard
          label="ADA Delegated to DRep"
          value={adaCompact(analytics.totalAdaDelegatedToDrep || 0)}
          note="Delegated voting stake"
        />
        <StatCard
          label="ADA Not Delegated"
          value={adaCompact(analytics.totalAdaNotDelegated || 0)}
          note="Stake not delegated to DRep"
        />
        <StatCard
          label="Governance Success Index"
          value={pct(analytics.overallSuccessRate || 0)}
          tone="success"
          note={`${analytics.successfulProposalCount || 0} successful proposals`}
        />
        <StatCard
          label="Governance Index (GI)"
          value={pct(governanceIndex.score)}
          tone="primary"
          note="GI = VP + PAR + IR + CS (weighted)"
        />
        <StatCard
          label="Onchain Health Index"
          value={pct(analytics.onchainMetrics?.onchainHealthScore || 0)}
          tone="primary"
          note={`${analytics.liveGithubProposalCount || 0} live GitHub linked`}
        />
      </section>

      {/* ── Treasury Analytics ── */}
      <TreasuryAnalyticsCard analytics={analytics} />

      {/* ── Main + Sidebar layout ── */}
      <section className="analytics-grid">
        <div className="analytics-main">
          <section className="role-summary-grid">
            <RoleTotalCard role={drep} />
            <RoleTotalCard role={spo} />
            <RoleTotalCard role={cc} />
          </section>

          <section className="chart-grid chart-grid-primary">
            <MetricBarChart
              title="Voters by Governance Role"
              rows={[
                { role: "DREP", value: drep.uniqueVoters, label: "unique voters" },
                { role: "SPO", value: spo.uniqueVoters, label: "unique voters" },
                { role: "CC", value: cc.uniqueVoters, label: "unique voters" },
              ]}
            />
            <MetricBarChart
              title="Total Votes by Governance Role"
              rows={[
                { role: "DREP", value: drep.totalVotes, label: "votes" },
                { role: "SPO", value: spo.totalVotes, label: "votes" },
                { role: "CC", value: cc.totalVotes, label: "votes" },
              ]}
            />
            <CircleKpi label="Governance Success Index" value={analytics.overallSuccessRate || 0} />
            <CircleKpi label="Onchain Health Index" value={analytics.onchainMetrics?.onchainHealthScore || 0} />
            <CircleKpi label="Governance Index (GI)" value={governanceIndex.score} />
            <section className="card">
              <h2>Governance Index Components</h2>
              <div className="insight-grid">
                <p>
                  VP <strong>{pct(governanceIndex.votingParticipation)}</strong>
                </p>
                <p>
                  PAR <strong>{pct(governanceIndex.proposalAcceptanceRatio)}</strong>
                </p>
                <p>
                  IR <strong>{pct(governanceIndex.implementationRate)}</strong>
                </p>
                <p>
                  CS <strong>{pct(governanceIndex.communitySatisfaction)}</strong>
                </p>
              </div>
            </section>
          </section>

          {/* ── Per-role vote panels for selected proposal ── */}
          {currentProposal ? (
            <>
              <section className="card proposal-vote-header">
                <div className="proposal-title-row">
                  <h2 className="proposal-subtitle">{currentProposal.metric.title}</h2>
                  <div className="proposal-badges">
                    <StatusBadge status={currentStatus} />
                    <ProposalTypeBadge type={currentType} />
                  </div>
                </div>
                {(snapshotProposal?.treasuryAmount) && (
                  <p className="treasury-request">
                    Treasury Request:{" "}
                    <strong>{adaCompact(snapshotProposal.treasuryAmount)}</strong>
                  </p>
                )}
              </section>

              <section className="role-vote-panels-section">
                <ProposalRoleVoteCard
                  role="DReps"
                  yes={drepYes}
                  no={drepNo}
                  abstain={drepAbstain}
                  total={drepTotal}
                  uniqueVoters={drepUniqueVoters}
                  yesStake={snapshotProposal?.drepYesStake}
                  noStake={snapshotProposal?.drepNoStake}
                  abstainStake={snapshotProposal?.drepAbstainStake}
                  totalStake={snapshotProposal?.drepTotalStake}
                  threshold={thresholds.drep}
                  allowed={true}
                />
                <ProposalRoleVoteCard
                  role="SPOs"
                  yes={spoYes}
                  no={spoNo}
                  abstain={spoAbstain}
                  total={spoTotal}
                  uniqueVoters={spoUniqueVoters}
                  yesStake={snapshotProposal?.spoYesStake}
                  noStake={snapshotProposal?.spoNoStake}
                  totalStake={snapshotProposal?.spoTotalStake}
                  threshold={thresholds.spo}
                  allowed={spoAllowed}
                />
                <ProposalRoleVoteCard
                  role="CC"
                  yes={ccYes}
                  no={ccNo}
                  abstain={ccAbstain}
                  total={ccTotal}
                  uniqueVoters={ccUniqueVoters}
                  yesStake={snapshotProposal?.ccYesStake}
                  noStake={snapshotProposal?.ccNoStake}
                  totalStake={snapshotProposal?.ccTotalStake}
                  threshold={thresholds.cc}
                  allowed={true}
                />
              </section>

              <section className="chart-grid">
                <MetricBarChart
                  title="Selected Proposal Role Voters"
                  rows={ROLE_ORDER.map((role) => ({
                    role,
                    value: new Set(currentVotes.filter((v) => v.role === role).map((v) => v.voterId)).size,
                    label: "unique voters",
                  }))}
                />
                <MetricBarChart
                  title="Selected Proposal Role Votes"
                  rows={currentRoleMetrics.map((item) => ({
                    role: item.role,
                    value: item.totalVotes,
                    label: "total votes",
                  }))}
                />
                <MetricBarChart
                  title="YES Votes By Role"
                  rows={currentRoleMetrics.map((item) => ({
                    role: item.role,
                    value: item.yes,
                    label: "yes votes",
                  }))}
                />
                <MetricBarChart
                  title="NO Votes By Role"
                  rows={currentRoleMetrics.map((item) => ({
                    role: item.role,
                    value: item.no,
                    label: "no votes",
                  }))}
                />
                <ProposalVoteComposition
                  yes={currentProposal.metric.yes}
                  no={currentProposal.metric.no}
                  abstain={currentProposal.metric.abstain}
                  total={currentProposal.metric.voteCount}
                />
                <ProposalVoteTrend votes={currentVotes} />
              </section>
            </>
          ) : (
            <section className="card">
              <p className="muted">No proposal data available.</p>
            </section>
          )}
        </div>

        {/* ── Sidebar ── */}
        <aside className="analytics-side">
          <section className="card proposal-selector sticky-card">
            <h2>Proposal Governance Metrics</h2>
            <p className="muted">Choose proposal to refresh all charts.</p>
            <form method="get" className="filter-form">
              <label>
                Proposal
                <select name="proposalId" defaultValue={currentProposalId}>
                  {proposals.map((item) => {
                    const ds = resolveDisplayStatus(item.metric.status);
                    return (
                      <option key={item.metric.proposalId} value={item.metric.proposalId}>
                        [{ds}] {item.metric.title}
                      </option>
                    );
                  })}
                </select>
              </label>
              <button type="submit" className="btn">
                Change Proposal
              </button>
              {currentProposal ? (
                <Link
                  href={`/proposals/${encodeURIComponent(currentProposal.metric.proposalId)}`}
                  className="btn btn-outline"
                >
                  Open Proposal Detail
                </Link>
              ) : null}
            </form>
          </section>

          {/* Proposal list (syncgovhub sidebar style) */}
          <section className="card proposal-list-sidebar">
            <h2>All Proposals ({proposals.length})</h2>
            <div className="proposal-list-scroll">
              {proposals.map((item, i) => (
                <ProposalListItem
                  key={item.metric.proposalId}
                  proposal={item}
                  selected={item.metric.proposalId === currentProposalId}
                />
              ))}
            </div>
          </section>

          {currentProposal ? (
            <section className="card insights-card">
              <h2>Selected Proposal Snapshot</h2>
              <p className="compact">
                <strong>{currentProposal.metric.title}</strong>
              </p>
              <div className="proposal-badges" style={{ marginBottom: "0.5rem" }}>
                <StatusBadge status={currentStatus} />
                <ProposalTypeBadge type={currentType} />
              </div>
              <div className="insight-grid">
                <p>
                  Votes <strong>{currentProposal.metric.voteCount}</strong>
                </p>
                <p>
                  Voters <strong>{currentProposal.metric.uniqueVoters}</strong>
                </p>
                <p>
                  Success <strong>{pct(currentProposal.metric.successScore)}</strong>
                </p>
                <p>
                  Achievement <strong>{pct(currentProposal.metric.achievementScore)}</strong>
                </p>
                <p>
                  Evidence <strong>{pct(currentProposal.metric.evidenceScore)}</strong>
                </p>
                <p>
                  KPI <strong>{pct(currentProposal.metric.milestoneCompletionRate)}</strong>
                </p>
                <p>
                  IF <strong>{pct(currentProposal.metric.implementationFidelity || 0)}</strong>
                </p>
                <p>
                  IS <strong>{pct(currentProposal.metric.impactScore || 0)}</strong>
                </p>
                <p>
                  ISpeed <strong>{pct(currentProposal.metric.implementationSpeed || 0)}</strong>
                </p>
              </div>
              <div className="insight-vote-lines">
                <p>
                  Yes <strong>{pct(selectedYesRate)}</strong> ({currentProposal.metric.yes})
                </p>
                <p>
                  No <strong>{pct(selectedNoRate)}</strong> ({currentProposal.metric.no})
                </p>
                <p>
                  Abstain <strong>{pct(selectedAbstainRate)}</strong> (
                  {currentProposal.metric.abstain})
                </p>
              </div>
              {!spoAllowed && (
                <p className="muted compact" style={{ marginTop: "0.5rem" }}>
                  ⚠ SPO voting not applicable for {currentType}.
                </p>
              )}
            </section>
          ) : null}

          <section className="card insights-card">
            <h2>Proposal Window</h2>
            <div className="insight-grid">
              <p>
                Ongoing <strong>{ongoing}</strong>
              </p>
              <p>
                Previous <strong>{previous}</strong>
              </p>
              <p>
                Upcoming <strong>{upcoming}</strong>
              </p>
            </div>
          </section>

          <section className="card">
            <p className="muted">
              Data source: live {analytics.provider} blockchain API + proposal source crawler
              (IPFS/URL). Governance Index uses VP, PAR, IR, CS formula. Proposal success uses IF,
              IS, ISpeed formula.
            </p>
          </section>
        </aside>
      </section>

      {/* ── Top DRep table ── */}
      <section className="card table-card top-drep-card">
        <h2>Top DRep Profiles</h2>
        <p className="muted compact">
          Name and country depend on DRep metadata published on-chain/off-chain.
        </p>
        {!featuredDreps.length ? (
          <p className="muted">No DRep profile data available.</p>
        ) : (
          <table className="top-drep-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Country</th>
                <th>DRep ID</th>
                <th>Voting Power</th>
              </tr>
            </thead>
            <tbody>
              {featuredDreps.map((drep) => (
                <tr key={drep.id}>
                  <td>{drep.name || drepAlias(drep.id)}</td>
                  <td>{drep.country || "Unknown"}</td>
                  <td title={drep.id}>{drep.id}</td>
                  <td>{drep.votingPower != null ? adaCompact(drep.votingPower) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}