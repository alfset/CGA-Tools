import Link from "next/link";
import { ensureFreshData } from "@/lib/scraper/service";
import { buildProposalViewModels } from "@/lib/proposals/view-model";
import { ProposalForum } from "@/app/components/proposal-forum";
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

/* ─── Formatters ─── */

function pct(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function pctRaw(value: number): string {
  const s = (value * 100).toFixed(2).replace(/(\.\d*?[1-9])0+$/, "$1").replace(/\.0+$/, "");
  return `${s}%`;
}

function readQueryValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function isFundedStatus(status: string): boolean {
  const ds = resolveDisplayStatus(status);
  return (
    ds === "Enacted" ||
    ds === "Ratified" ||
    ds === "Passed" ||
    ds === "Expired" 
  );
}

/* ─── Sub-components ─── */

function StatusBadge({ status }: { status: ProposalDisplayStatus }) {
  return <span className={`status-badge ${statusBadgeClass(status)}`}>{status}</span>;
}

function ProposalTypeBadge({ type }: { type: ProposalDisplayType }) {
  return <span className="type-badge">{type}</span>;
}

function CircleKpi({ label, value }: { label: string; value: number }) {
  const normalized = Math.min(1, Math.max(0, value));
  const size = 110;
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
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className="kpi-circle-track"
          strokeWidth={stroke}
        />
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

function ScoreProfileLine({
  evidence,
  development,
  onchain,
  achievement,
  success,
}: {
  evidence: number;
  development: number;
  onchain: number;
  achievement: number;
  success: number;
}) {
  const values = [evidence, development, onchain, achievement, success].map((v) =>
    Math.min(1, Math.max(0, v))
  );
  const labels = ["Evidence", "GitHub", "Onchain", "Achievement", "Success"];
  const width = 640;
  const height = 220;
  const pad = 30;
  const points = values
    .map((value, index) => {
      const x = pad + (index * (width - pad * 2)) / (values.length - 1);
      const y = height - pad - value * (height - pad * 2);
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <section className="card">
      <h2>Proposal KPI Score Profile</h2>
      <svg
        className="line-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Proposal KPI score profile"
      >
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} className="axis" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} className="axis" />
        <polyline points={points} className="trend-line" />
      </svg>
      <div className="timeline-grid">
        {labels.map((item, index) => (
          <div className="timeline-cell" key={item}>
            <p className="muted compact">{item}</p>
            <p>{pct(values[index])}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * Vote result panel per governance role — matches syncgovhub layout.
 * Shows: threshold bar, yes/no/abstain breakdown, stake amounts, participation.
 */
function RoleVotePanel({
  role,
  yesRate,
  noRate,
  abstainRate,
  totalVotes,
  uniqueVoters,
  yesStake,
  noStake,
  abstainStake,
  totalStake,
  threshold,
  allowed,
}: {
  role: "DReps" | "SPOs" | "CC";
  yesRate: number;
  noRate: number;
  abstainRate: number;
  totalVotes: number;
  uniqueVoters: number;
  yesStake?: number;
  noStake?: number;
  abstainStake?: number;
  totalStake?: number;
  threshold: number | null;
  allowed: boolean;
}) {
  const yesPct = (yesRate * 100).toFixed(2);
  const noPct = (noRate * 100).toFixed(2);
  const participation = totalStake && totalStake > 0 ? (((yesStake ?? 0) + (noStake ?? 0)) / totalStake) * 100 : 0;
  const isYesLeading = yesRate >= noRate;

  if (!allowed) {
    return (
      <div className="role-vote-panel role-vote-panel--disabled">
        <div className="role-vote-panel__header">
          <span className="role-label">{role}</span>
          <span className="role-vote-na">Voting Not Allowed</span>
        </div>
        <p className="muted compact">
          This proposal type does not allow {role === "SPOs" ? "Stake Pool Operator" : role} voting.
        </p>
      </div>
    );
  }

  return (
    <div className={`role-vote-panel ${isYesLeading ? "role-vote-panel--yes" : "role-vote-panel--no"}`}>
      <div className="role-vote-panel__header">
        <span className="role-label">{role}</span>
        <span className={`vote-verdict ${isYesLeading ? "yes" : "no"}`}>
          {isYesLeading ? "YES" : "NO"} ({isYesLeading ? yesPct : noPct}%)
        </span>
      </div>

      {/* Stacked bar */}
      <div className="vote-composition-bar" role="img" aria-label={`${role} vote breakdown`}>
        <span className="segment yes" style={{ width: `${yesRate * 100}%` }} title={`Yes ${yesPct}%`} />
        <span className="segment no" style={{ width: `${noRate * 100}%` }} title={`No ${noPct}%`} />
        <span
          className="segment abstain"
          style={{ width: `${abstainRate * 100}%` }}
          title={`Abstain ${(abstainRate * 100).toFixed(2)}%`}
        />
      </div>

      {/* Threshold indicator */}
      {threshold !== null && (
        <div className="vote-threshold-row">
          <span className="threshold-label">{(threshold * 100).toFixed(0)}% threshold</span>
          <div className="threshold-bar-track">
            <span
              className={`threshold-bar-fill ${yesRate >= threshold ? "above" : "below"}`}
              style={{ width: `${Math.min(yesRate / threshold, 1) * 100}%` }}
            />
            <span className="threshold-marker" style={{ left: "100%" }} />
          </div>
          <span className={`threshold-status ${yesRate >= threshold ? "above" : "below"}`}>
            {yesRate >= threshold ? "✓ Above" : "✗ Below"}
          </span>
        </div>
      )}

      {/* Stats grid */}
      <div className="vote-stats-grid">
        <div>
          <p className="muted compact">Total Votes</p>
          <p className="compact">{totalVotes.toLocaleString()}</p>
        </div>
        <div>
          <p className="muted compact">Voters</p>
          <p className="compact">{uniqueVoters.toLocaleString()}</p>
        </div>
        {totalStake !== undefined && (
          <div>
            <p className="muted compact">Total Stake</p>
            <p className="compact">{adaCompact(totalStake)}</p>
          </div>
        )}
        {participation > 0 && (
          <div>
            <p className="muted compact">Participation</p>
            <p className="compact">{participation.toFixed(2)}%</p>
          </div>
        )}
      </div>

      {/* Breakdown lines */}
      <div className="vote-breakdown-lines">
        <div className="vbl-row">
          <span className="legend-dot yes" />
          <span>Yes</span>
          <span className="vbl-pct yes">{yesPct}%</span>
          {yesStake !== undefined && <span className="muted compact">{adaCompact(yesStake)}</span>}
        </div>
        <div className="vbl-row">
          <span className="legend-dot no" />
          <span>No</span>
          <span className="vbl-pct no">{noPct}%</span>
          {noStake !== undefined && <span className="muted compact">{adaCompact(noStake)}</span>}
        </div>
        <div className="vbl-row">
          <span className="legend-dot abstain" />
          <span>Abstain</span>
          <span className="vbl-pct">{(abstainRate * 100).toFixed(2)}%</span>
          {abstainStake !== undefined && <span className="muted compact">{adaCompact(abstainStake)}</span>}
        </div>
      </div>
    </div>
  );
}

/* ─── Page ─── */

interface FundedPageProps {
  searchParams: { proposalId?: string | string[] };
}

export default async function FundedGovernancePage({ searchParams }: FundedPageProps) {
  const { analytics, snapshot } = await ensureFreshData(false);
  const rows = buildProposalViewModels(analytics, snapshot);

  const fundedRows = rows.filter(
    (row) => isFundedStatus(row.metric.status || "") || row.phase === "previous"
  );

  const queryProposalId = readQueryValue(searchParams.proposalId).trim();
  const current =
    fundedRows.find((item) => item.metric.proposalId === queryProposalId) || fundedRows[0];

  const passedCount = fundedRows.filter((item) => item.metric.successScore >= 0.5).length;
  const passRate = fundedRows.length ? passedCount / fundedRows.length : 0;

  /* Current proposal derived data */
  const currentStatus = current ? resolveDisplayStatus(current.metric.status) : "Unknown";
  const currentType = current ? resolveProposalType((current.metric as any).actionType || current.metric.status) : "Unknown";
  const thresholds = getVotingThresholds(currentType);
  const spoAllowed = spoVotingAllowed(currentType);

  const currentRoleVotes = current?.metric.roleVotes || [];
  const drepVotes = currentRoleVotes.find((r) => r.role === "DREP");
  const spoVotes = currentRoleVotes.find((r) => r.role === "SPO");
  const ccVotes = currentRoleVotes.find((r) => r.role === "CC");

  const totalVotes = current?.metric.voteCount || 0;
  const drepTotal = drepVotes?.totalVotes || 0;
  const spoTotal = spoVotes?.totalVotes || 0;
  const ccTotal = ccVotes?.totalVotes || 0;

  const drepYesRate = drepTotal ? (drepVotes?.yes || 0) / drepTotal : 0;
  const drepNoRate = drepTotal ? (drepVotes?.no || 0) / drepTotal : 0;
  const drepAbstainRate = Math.max(0, 1 - drepYesRate - drepNoRate);

  const spoYesRate = spoTotal ? (spoVotes?.yes || 0) / spoTotal : 0;
  const spoNoRate = spoTotal ? (spoVotes?.no || 0) / spoTotal : 0;
  const spoAbstainRate = Math.max(0, 1 - spoYesRate - spoNoRate);

  const ccYesRate = ccTotal ? (ccVotes?.yes || 0) / ccTotal : 0;
  const ccNoRate = ccTotal ? (ccVotes?.no || 0) / ccTotal : 0;
  const ccAbstainRate = Math.max(0, 1 - ccYesRate - ccNoRate);

  /* ADA stake (lovelace) — from snapshot if available */
  const currentSnapshotProposal = snapshot?.proposals?.find(
    (p) => p.id === current?.metric.proposalId
  ) as any;
  const drepYesStake = currentSnapshotProposal?.drepYesStake;
  const drepNoStake = currentSnapshotProposal?.drepNoStake;
  const drepAbstainStake = currentSnapshotProposal?.drepAbstainStake;
  const drepTotalStake = currentSnapshotProposal?.drepTotalStake;
  const spoYesStake = currentSnapshotProposal?.spoYesStake;
  const spoNoStake = currentSnapshotProposal?.spoNoStake;
  const spoTotalStake = currentSnapshotProposal?.spoTotalStake;
  const ccYesStake = currentSnapshotProposal?.ccYesStake;
  const ccNoStake = currentSnapshotProposal?.ccNoStake;
  const ccTotalStake = currentSnapshotProposal?.ccTotalStake;

  /* Treasury amount for withdrawal proposals */
  const treasuryAmount = currentSnapshotProposal?.treasuryAmount;

  return (
    <main className="page dashboard">
      {/* ── Header ── */}
      <header className="card dashboard-header">
        <h1>Funded Governance KPI Analytics + Forum</h1>
        <p>
          Professional analytics for enacted/expired proposals with onchain KPI, evidence KPI,
          GitHub activity, community discussion, and decentralized rating.
        </p>
        <div className="actions">
          <Link href="/" className="btn btn-outline">
            Back To Dashboard
          </Link>
        </div>
      </header>

      {/* ── Summary KPIs ── */}
      <section className="stats-grid">
        <article className="card stat-card">
          <p className="label">Funded / Previous Proposals</p>
          <p className="value">{fundedRows.length}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Passed By KPI Success Index</p>
          <p className="value">{passedCount}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Pass Rate</p>
          <p className="value">{pct(passRate)}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Network Onchain Health</p>
          <p className="value">{pct(analytics.onchainMetrics?.onchainHealthScore || 0)}</p>
        </article>
      </section>

      {/* ── Proposal Selector ── */}
      <section className="card proposal-selector">
        <h2>Choose Passed / Funded Proposal</h2>
        <form method="get" className="filter-form">
          <label>
            Proposal
            <select name="proposalId" defaultValue={current?.metric.proposalId || ""}>
              {fundedRows.map((item) => {
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
          {current ? (
            <Link
              href={`/proposals/${encodeURIComponent(current.metric.proposalId)}`}
              className="btn btn-outline"
            >
              Open Proposal Detail
            </Link>
          ) : null}
        </form>
      </section>

      {current ? (
        <>
          {/* ── Proposal Header Card ── */}
          <section className="card proposal-detail-header">
            <div className="proposal-title-row">
              <h2 className="proposal-title">{current.metric.title}</h2>
              <div className="proposal-badges">
                <StatusBadge status={currentStatus} />
                <ProposalTypeBadge type={currentType} />
              </div>
            </div>

            {treasuryAmount && (
              <div className="proposal-treasury-row">
                <span className="muted">Treasury Request:</span>
                <strong className="treasury-amount">{adaCompact(treasuryAmount)}</strong>
              </div>
            )}

            <div className="proposal-meta-grid">
              <div>
                <p className="muted compact">Status</p>
                <p>
                  <strong>{currentStatus}</strong>
                </p>
              </div>
              <div>
                <p className="muted compact">Type</p>
                <p>
                  <strong>{currentType}</strong>
                </p>
              </div>
              <div>
                <p className="muted compact">Total Votes</p>
                <p>
                  <strong>{totalVotes.toLocaleString()}</strong>
                </p>
              </div>
              <div>
                <p className="muted compact">KPI Result</p>
                <p>
                  <strong
                    className={current.metric.successScore >= 0.5 ? "text-success" : "text-danger"}
                  >
                    {current.metric.successScore >= 0.5 ? "PASSED KPI" : "NOT PASSED KPI"}
                  </strong>
                </p>
              </div>
            </div>
          </section>

          {/* ── Role Vote Panels ── */}
          <section className="card">
            <h2>Governance Vote Breakdown by Role</h2>
            <div className="role-vote-panels">
              <RoleVotePanel
                role="DReps"
                yesRate={drepYesRate}
                noRate={drepNoRate}
                abstainRate={drepAbstainRate}
                totalVotes={drepTotal}
                uniqueVoters={
                  new Set(
                    (snapshot?.votes || [])
                      .filter(
                        (v) => v.proposalId === current.metric.proposalId && v.role === "DREP"
                      )
                      .map((v) => v.voterId)
                  ).size
                }
                yesStake={drepYesStake}
                noStake={drepNoStake}
                abstainStake={drepAbstainStake}
                totalStake={drepTotalStake}
                threshold={thresholds.drep}
                allowed={true}
              />
              <RoleVotePanel
                role="SPOs"
                yesRate={spoYesRate}
                noRate={spoNoRate}
                abstainRate={spoAbstainRate}
                totalVotes={spoTotal}
                uniqueVoters={
                  new Set(
                    (snapshot?.votes || [])
                      .filter(
                        (v) => v.proposalId === current.metric.proposalId && v.role === "SPO"
                      )
                      .map((v) => v.voterId)
                  ).size
                }
                yesStake={spoYesStake}
                noStake={spoNoStake}
                totalStake={spoTotalStake}
                threshold={thresholds.spo}
                allowed={spoAllowed}
              />
              <RoleVotePanel
                role="CC"
                yesRate={ccYesRate}
                noRate={ccNoRate}
                abstainRate={ccAbstainRate}
                totalVotes={ccTotal}
                uniqueVoters={
                  new Set(
                    (snapshot?.votes || [])
                      .filter(
                        (v) => v.proposalId === current.metric.proposalId && v.role === "CC"
                      )
                      .map((v) => v.voterId)
                  ).size
                }
                yesStake={ccYesStake}
                noStake={ccNoStake}
                totalStake={ccTotalStake}
                threshold={thresholds.cc}
                allowed={true}
              />
            </div>
          </section>

          {/* ── KPI Circle Grid ── */}
          <section className="chart-grid">
            <CircleKpi label="Evidence KPI" value={current.metric.evidenceScore} />
            <CircleKpi label="Milestone KPI" value={current.metric.milestoneCompletionRate} />
            <CircleKpi label="GitHub KPI" value={current.metric.developmentScore} />
            <CircleKpi label="Onchain KPI" value={current.metric.onchainScore} />
            <CircleKpi label="Implementation Fidelity" value={current.metric.implementationFidelity || 0} />
            <CircleKpi label="Impact Score" value={current.metric.impactScore || 0} />
            <CircleKpi label="Implementation Speed" value={current.metric.implementationSpeed || 0} />
            <CircleKpi label="Achievement Index" value={current.metric.achievementScore} />
            <CircleKpi label="Success Index" value={current.metric.successScore} />
          </section>

          <ScoreProfileLine
            evidence={current.metric.evidenceScore}
            development={current.metric.developmentScore}
            onchain={current.metric.onchainScore}
            achievement={current.metric.achievementScore}
            success={current.metric.successScore}
          />

          {/* ── Summary Result ── */}
          <section className="card">
            <h2>Proposal KPI Result Summary</h2>
            <p>
              Proposal: <strong>{current.metric.title}</strong>
            </p>
            <p>
              Status: <StatusBadge status={currentStatus} /> &nbsp; Type:{" "}
              <ProposalTypeBadge type={currentType} /> &nbsp; KPI Result:{" "}
              <strong
                className={current.metric.successScore >= 0.5 ? "text-success" : "text-danger"}
              >
                {current.metric.successScore >= 0.5 ? "PASSED KPI ✓" : "NOT PASSED KPI ✗"}
              </strong>
            </p>
            <p className="muted">
              Evidence {pctRaw(current.metric.evidenceScore)} · Milestone{" "}
              {pctRaw(current.metric.milestoneCompletionRate)} · GitHub{" "}
              {pctRaw(current.metric.developmentScore)} · Onchain{" "}
              {pctRaw(current.metric.onchainScore)} · IF{" "}
              {pctRaw(current.metric.implementationFidelity || 0)} · Impact{" "}
              {pctRaw(current.metric.impactScore || 0)} · ISpeed{" "}
              {pctRaw(current.metric.implementationSpeed || 0)}
            </p>
          </section>

          <ProposalForum
            proposalId={current.metric.proposalId}
            proposalTitle={current.metric.title}
          />
        </>
      ) : (
        <section className="card">
          <p className="muted">No funded/previous proposals available yet.</p>
        </section>
      )}
    </main>
  );
}