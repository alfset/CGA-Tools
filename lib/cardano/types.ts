export type GovernanceRole = "DREP" | "SPO" | "CC";

export type VoteChoice = "yes" | "no" | "abstain" | "unknown";

export interface ProposalKpiTargets {
  participationTarget?: number;
  approvalTarget?: number;
  minUniqueVoters?: number;
}

export interface GovernanceProposal {
  id: string;
  govActionId?: string;
  txHash?: string;
  certIndex?: number;
  title: string;
  body?: string;
  abstract?: string;
  status: string;
  createdAt?: string;
  expiresAt?: string;
  url?: string;
  kpiTargets?: ProposalKpiTargets;
}

export interface GovernanceDrep {
  id: string;
  name?: string;
  country?: string;
  votingPower?: number;
  active?: boolean;
  txHash?: string;
  metadataUrl?: string;
}

export interface OnchainMetrics {
  fetchedAt: string;
  latestEpoch?: number;
  latestBlockHeight?: number;
  latestSlot?: number;
  latestBlockAt?: string;
  epochTxCount?: number;
  epochBlockCount?: number;
  mempoolTxCount?: number;
  mempoolBytes?: number;
  mempoolFeesAda?: number;
  circulatingSupplyAda?: number;
  totalSupplyAda?: number;
  liveStakeAda?: number;
  activeStakePoolCount?: number;
  retiringStakePoolCount?: number;
  proposalCount?: number;
  totalDrepCount?: number;
  activeDrepCount?: number;
  onchainHealthScore: number;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
  fullName: string;
  url: string;
}

export interface ProposalGitHubActivity {
  proposalId: string;
  proposalTitle: string;
  scannedAt: string;
  hasRepository: boolean;
  repository?: GitHubRepoRef;
  reachable: boolean;
  isLive: boolean;
  liveReason: string;
  lastCommitAt?: string;
  pushedAt?: string;
  commits7d: number;
  commits30d: number;
  uniqueCommitters30d: number;
  stars?: number;
  forks?: number;
  openIssues?: number;
  watchers?: number;
  activityScore: number;
  error?: string;
}

export interface ProposalEvidenceActivity {
  proposalId: string;
  proposalTitle: string;
  scannedAt: string;
  sourceUrl?: string;
  resolvedUrl?: string;
  reachable: boolean;
  hasEvidence: boolean;
  kpiItems: string[];
  milestoneItems: string[];
  completedMilestones: number;
  totalMilestones: number;
  completionRate: number;
  evidenceScore: number;
  error?: string;
}

export interface GovernanceVote {
  proposalId: string;
  role: GovernanceRole;
  voterId: string;
  choice: VoteChoice;
  votingPower?: number;
  txHash?: string;
  slot?: number;
  timestamp?: string;
}

export interface GovernanceSnapshot {
  id: string;
  network: string;
  fetchedAt: string;
  proposals: GovernanceProposal[];
  votes: GovernanceVote[];
  dreps: GovernanceDrep[];
  onchainMetrics: OnchainMetrics;
  proposalGithubActivity: ProposalGitHubActivity[];
  proposalEvidenceActivity: ProposalEvidenceActivity[];
  provider: string;
}

export interface RoleMetrics {
  role: GovernanceRole;
  totalVotes: number;
  uniqueVoters: number;
  yesRate: number;
  noRate: number;
  abstainRate: number;
}

export interface ProposalMetrics {
  proposalId: string;
  title: string;
  status: string;
  voteCount: number;
  uniqueVoters: number;
  yes: number;
  no: number;
  abstain: number;
  approvalRate: number;
  participationScore: number;
  roleVotes: Array<{
    role: GovernanceRole;
    totalVotes: number;
    yes: number;
    no: number;
    abstain: number;
    uniqueVoters: number;
  }>;
  governanceScore: number;
  evidenceScore: number;
  milestoneCompletionRate: number;
  kpiEvidenceCount: number;
  milestoneCount: number;
  completedMilestoneCount: number;
  developmentScore: number;
  onchainScore: number;
  implementationFidelity: number;
  impactScore: number;
  implementationSpeed: number;
  achievementScore: number;
  successScore: number;
  githubRepo?: string;
  githubLive?: boolean;
  githubActivityScore?: number;
  githubCommits30d?: number;
  githubLastCommitAt?: string;
  hitEvidenceTarget: boolean;
  hitMilestoneTarget: boolean;
  hitGithubTarget: boolean;
}

export interface GovernanceAnalytics {
  generatedAt: string;
  snapshotId: string;
  network: string;
  provider: string;
  onchainMetrics: OnchainMetrics;
  proposalCount: number;
  voteCount: number;
  uniqueVoterCount: number;
  totalAdaStake: number;
  totalAdaDelegatedToDrep: number;
  totalAdaNotDelegated: number;
  governanceIndex: {
    votingParticipation: number;
    proposalAcceptanceRatio: number;
    implementationRate: number;
    communitySatisfaction: number;
    score: number;
  };
  drepCount: number;
  activeDrepCount: number;
  successfulProposalCount: number;
  overallSuccessRate: number;
  proposalsWithGithub: number;
  liveGithubProposalCount: number;
  avgGithubActivityScore: number;
  roleMetrics: RoleMetrics[];
  proposals: ProposalMetrics[];
  githubActivities: ProposalGitHubActivity[];
  proposalEvidenceActivity: ProposalEvidenceActivity[];
}
