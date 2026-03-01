import {
  GovernanceAnalytics,
  OnchainMetrics,
  GovernanceProposal,
  GovernanceRole,
  GovernanceSnapshot,
  GovernanceVote,
  ProposalEvidenceActivity,
  ProposalGitHubActivity,
  ProposalMetrics,
  RoleMetrics
} from "@/lib/cardano/types";

const ROLES: GovernanceRole[] = ["DREP", "SPO", "CC"];
const GI_WEIGHT_VP = Number(process.env.GOV_INDEX_WEIGHT_VP || 0.3);
const GI_WEIGHT_PAR = Number(process.env.GOV_INDEX_WEIGHT_PAR || 0.2);
const GI_WEIGHT_IR = Number(process.env.GOV_INDEX_WEIGHT_IR || 0.4);
const GI_WEIGHT_CS = Number(process.env.GOV_INDEX_WEIGHT_CS || 0.1);
const PS_WEIGHT_IF = Number(process.env.PROPOSAL_SUCCESS_WEIGHT_IF || 0.4);
const PS_WEIGHT_IS = Number(process.env.PROPOSAL_SUCCESS_WEIGHT_IS || 0.35);
const PS_WEIGHT_ISPEED = Number(process.env.PROPOSAL_SUCCESS_WEIGHT_ISPEED || 0.25);

function ratio(value: number, total: number): number {
  if (!total) {
    return 0;
  }
  return Number((value / total).toFixed(4));
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function normalizeWeights(weights: number[]): number[] {
  const safe = weights.map((value) => (Number.isFinite(value) && value > 0 ? value : 0));
  const total = safe.reduce((sum, value) => sum + value, 0);
  if (!total) {
    return safe.map(() => 0);
  }
  return safe.map((value) => value / total);
}

function normalizeAdaValue(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  if (Number.isInteger(value) && value >= 1_000_000_000) {
    return value / 1_000_000;
  }
  return value;
}

function hasAcceptedStatus(status: string): boolean {
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

function hasImplementedStatus(status: string): boolean {
  const value = status.toLowerCase();
  return value.includes("enacted") || value.includes("implemented") || value.includes("completed");
}

function parseIso(value?: string): number | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.getTime();
}

function computeImplementationSpeed(proposal: GovernanceProposal, completionRate: number): number {
  const createdAt = parseIso(proposal.createdAt);
  const expiresAt = parseIso(proposal.expiresAt);
  const now = Date.now();

  let scheduleScore = hasImplementedStatus(proposal.status) ? 1 : 0.5;

  if (createdAt !== null && expiresAt !== null && expiresAt > createdAt) {
    const elapsed = Math.min(Math.max(now - createdAt, 0), expiresAt - createdAt);
    const expectedProgress = elapsed / (expiresAt - createdAt);
    scheduleScore = expectedProgress <= 0 ? 1 : Math.min(1, completionRate / expectedProgress);
  }

  if (hasImplementedStatus(proposal.status)) {
    scheduleScore = Math.max(scheduleScore, 0.85);
  }

  return clampRatio(completionRate * 0.7 + scheduleScore * 0.3);
}

function createRoleMetrics(votes: GovernanceVote[], role: GovernanceRole): RoleMetrics {
  const roleVotes = votes.filter((vote) => vote.role === role);
  const totalVotes = roleVotes.length;
  const yes = roleVotes.filter((vote) => vote.choice === "yes").length;
  const no = roleVotes.filter((vote) => vote.choice === "no").length;
  const abstain = roleVotes.filter((vote) => vote.choice === "abstain").length;

  return {
    role,
    totalVotes,
    uniqueVoters: new Set(roleVotes.map((vote) => vote.voterId)).size,
    yesRate: ratio(yes, totalVotes),
    noRate: ratio(no, totalVotes),
    abstainRate: ratio(abstain, totalVotes)
  };
}

function computeOnchainExecutionScore(onchainMetrics: OnchainMetrics): number {
  const healthScore = onchainMetrics.onchainHealthScore || 0;
  const epochTxCount = onchainMetrics.epochTxCount || 0;
  const txScore = Math.min(1, epochTxCount / 120000);

  const totalDreps = onchainMetrics.totalDrepCount || 0;
  const activeDreps = onchainMetrics.activeDrepCount || 0;
  const drepRatio = totalDreps ? activeDreps / totalDreps : 0;
  const drepScore = drepRatio >= 0.65 ? 1 : drepRatio >= 0.45 ? 0.7 : drepRatio > 0 ? 0.4 : 0.2;

  const activePools = onchainMetrics.activeStakePoolCount || 0;
  const poolScore = activePools >= 1000 ? 1 : activePools >= 700 ? 0.8 : activePools >= 400 ? 0.6 : activePools > 0 ? 0.4 : 0.25;

  return Number((healthScore * 0.5 + txScore * 0.2 + drepScore * 0.15 + poolScore * 0.15).toFixed(4));
}

function createProposalMetrics(
  proposal: GovernanceProposal,
  votes: GovernanceVote[],
  maxVotes: number,
  onchainExecutionScore: number,
  githubActivity?: ProposalGitHubActivity,
  evidenceActivity?: ProposalEvidenceActivity
): ProposalMetrics {
  const proposalVotes = votes.filter((vote) => vote.proposalId === proposal.id);

  const yes = proposalVotes.filter((vote) => vote.choice === "yes").length;
  const no = proposalVotes.filter((vote) => vote.choice === "no").length;
  const abstain = proposalVotes.filter((vote) => vote.choice === "abstain").length;
  const voteCount = proposalVotes.length;
  const uniqueVoters = new Set(proposalVotes.map((vote) => vote.voterId)).size;
  const approvalBase = yes + no;
  const approvalRate = ratio(yes, approvalBase);
  const participationScore = ratio(voteCount, maxVotes || 1);
  const uniqueVoterScore = ratio(uniqueVoters, Math.max(5, uniqueVoters));
  const governanceScore = Number((approvalRate * 0.5 + participationScore * 0.3 + uniqueVoterScore * 0.2).toFixed(4));

  const roleVotes = ROLES.map((role) => {
    const roleSet = proposalVotes.filter((vote) => vote.role === role);
    return {
      role,
      totalVotes: roleSet.length,
      yes: roleSet.filter((vote) => vote.choice === "yes").length,
      no: roleSet.filter((vote) => vote.choice === "no").length,
      abstain: roleSet.filter((vote) => vote.choice === "abstain").length,
      uniqueVoters: new Set(roleSet.map((vote) => vote.voterId)).size
    };
  });

  const evidenceScore = evidenceActivity?.evidenceScore || 0;
  const milestoneCompletionRate = evidenceActivity?.completionRate || 0;
  const kpiEvidenceCount = evidenceActivity?.kpiItems.length || 0;
  const milestoneCount = evidenceActivity?.milestoneItems.length || 0;
  const completedMilestoneCount = evidenceActivity?.completedMilestones || 0;

  const developmentScore = githubActivity?.activityScore || 0;
  const onchainScore = onchainExecutionScore;
  const implementationFidelity = clampRatio(milestoneCount ? completedMilestoneCount / milestoneCount : milestoneCompletionRate);
  const impactScore = clampRatio(governanceScore * 0.25 + onchainScore * 0.35 + developmentScore * 0.25 + evidenceScore * 0.15);
  const implementationSpeed = computeImplementationSpeed(proposal, milestoneCompletionRate);
  const [psIf, psIs, psIspeed] = normalizeWeights([PS_WEIGHT_IF, PS_WEIGHT_IS, PS_WEIGHT_ISPEED]);
  const successScore = clampRatio(implementationFidelity * psIf + impactScore * psIs + implementationSpeed * psIspeed);
  const achievementScore = clampRatio(evidenceScore * 0.5 + developmentScore * 0.2 + onchainScore * 0.15 + successScore * 0.15);

  const hitEvidenceTarget = evidenceScore >= 0.4;
  const hitMilestoneTarget = milestoneCompletionRate >= 0.35 || completedMilestoneCount >= 2;
  const hitGithubTarget = githubActivity?.hasRepository ? githubActivity.isLive || (githubActivity.commits30d || 0) >= 3 : true;

  return {
    proposalId: proposal.id,
    title: proposal.title,
    status: proposal.status,
    voteCount,
    uniqueVoters,
    yes,
    no,
    abstain,
    approvalRate,
    participationScore,
    roleVotes,
    governanceScore,
    evidenceScore,
    milestoneCompletionRate,
    kpiEvidenceCount,
    milestoneCount,
    completedMilestoneCount,
    developmentScore: Number(developmentScore.toFixed(4)),
    onchainScore: Number(onchainScore.toFixed(4)),
    implementationFidelity,
    impactScore,
    implementationSpeed,
    achievementScore,
    successScore,
    githubRepo: githubActivity?.repository?.fullName,
    githubLive: githubActivity?.isLive,
    githubActivityScore: githubActivity?.activityScore,
    githubCommits30d: githubActivity?.commits30d,
    githubLastCommitAt: githubActivity?.lastCommitAt,
    hitEvidenceTarget,
    hitMilestoneTarget,
    hitGithubTarget
  };
}

function inferSuccess(proposal: ProposalMetrics): boolean {
  return (
    proposal.hitEvidenceTarget &&
    proposal.hitMilestoneTarget &&
    proposal.hitGithubTarget &&
    proposal.successScore >= 0.5
  );
}

export function buildGovernanceAnalytics(snapshot: GovernanceSnapshot): GovernanceAnalytics {
  const votes = snapshot.votes;
  const proposals = snapshot.proposals;
  const dreps = snapshot.dreps || [];
  const onchainMetrics = snapshot.onchainMetrics || { fetchedAt: snapshot.fetchedAt, onchainHealthScore: 0 };
  const githubActivities = snapshot.proposalGithubActivity || [];
  const proposalEvidenceActivity = snapshot.proposalEvidenceActivity || [];
  const githubByProposal = new Map(githubActivities.map((item) => [item.proposalId, item]));
  const evidenceByProposal = new Map(proposalEvidenceActivity.map((item) => [item.proposalId, item]));
  const maxVotes = proposals.reduce((max, proposal) => {
    const total = votes.filter((vote) => vote.proposalId === proposal.id).length;
    return Math.max(max, total);
  }, 0);

  const onchainExecutionScore = computeOnchainExecutionScore(onchainMetrics);

  const proposalMetrics = proposals
    .map((proposal) =>
      createProposalMetrics(
        proposal,
        votes,
        maxVotes,
        onchainExecutionScore,
        githubByProposal.get(proposal.id),
        evidenceByProposal.get(proposal.id)
      )
    )
    .sort((a, b) => b.successScore - a.successScore);

  const successfulProposalCount = proposalMetrics.filter(inferSuccess).length;
  const proposalsWithGithub = githubActivities.filter((item) => item.hasRepository).length;
  const liveGithubProposalCount = githubActivities.filter((item) => item.hasRepository && item.isLive).length;
  const githubForAverage = githubActivities.filter((item) => item.hasRepository);
  const avgGithubActivityScore = Number(
    (
      githubForAverage.reduce((sum, item) => sum + item.activityScore, 0) /
      (githubForAverage.length || 1)
    ).toFixed(4)
  );
  const totalAdaStake = Number((onchainMetrics.liveStakeAda || onchainMetrics.circulatingSupplyAda || 0).toFixed(6));
  const totalAdaDelegatedToDrep = Number(
    dreps.reduce((sum, drep) => sum + normalizeAdaValue(drep.votingPower || 0), 0).toFixed(6)
  );
  const totalAdaNotDelegated = Number(Math.max(0, totalAdaStake - totalAdaDelegatedToDrep).toFixed(6));

  const totalVotingPowerUsed = votes.reduce((sum, vote) => sum + normalizeAdaValue(vote.votingPower || 0), 0);
  const votingParticipation = ratio(totalVotingPowerUsed, totalAdaStake || 1);
  const acceptedCount = proposals.filter((proposal) => hasAcceptedStatus(proposal.status || "")).length;
  const implementedCount = proposals.filter((proposal) => hasImplementedStatus(proposal.status || "")).length;
  const proposalAcceptanceRatio = ratio(acceptedCount, proposals.length || 1);
  const implementationRate = ratio(implementedCount, acceptedCount || 1);
  const totalYes = proposalMetrics.reduce((sum, proposal) => sum + proposal.yes, 0);
  const totalNo = proposalMetrics.reduce((sum, proposal) => sum + proposal.no, 0);
  const communitySatisfaction = ratio(totalYes, totalYes + totalNo);
  const [giVp, giPar, giIr, giCs] = normalizeWeights([GI_WEIGHT_VP, GI_WEIGHT_PAR, GI_WEIGHT_IR, GI_WEIGHT_CS]);
  const governanceIndexScore = clampRatio(
    votingParticipation * giVp +
    proposalAcceptanceRatio * giPar +
    implementationRate * giIr +
    communitySatisfaction * giCs
  );

  return {
    generatedAt: new Date().toISOString(),
    snapshotId: snapshot.id,
    network: snapshot.network,
    provider: snapshot.provider,
    onchainMetrics,
    proposalCount: proposals.length,
    voteCount: votes.length,
    uniqueVoterCount: new Set(votes.map((vote) => vote.voterId)).size,
    totalAdaStake,
    totalAdaDelegatedToDrep,
    totalAdaNotDelegated,
    governanceIndex: {
      votingParticipation,
      proposalAcceptanceRatio,
      implementationRate,
      communitySatisfaction,
      score: governanceIndexScore
    },
    drepCount: dreps.length,
    activeDrepCount: dreps.filter((drep) => drep.active !== false).length,
    successfulProposalCount,
    overallSuccessRate: ratio(successfulProposalCount, proposals.length || 1),
    proposalsWithGithub,
    liveGithubProposalCount,
    avgGithubActivityScore,
    roleMetrics: ROLES.map((role) => createRoleMetrics(votes, role)),
    proposals: proposalMetrics,
    githubActivities,
    proposalEvidenceActivity
  };
}
