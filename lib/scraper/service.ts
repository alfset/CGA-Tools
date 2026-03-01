import { GovernanceAnalytics, GovernanceSnapshot } from "@/lib/cardano/types";
import { GovernanceScraper } from "@/lib/scraper/governance-scraper";

const LIVE_REFRESH_MIN_INTERVAL_MS = Number(process.env.LIVE_REFRESH_MIN_INTERVAL_MS || 20000);

let lastGoodData: { analytics: GovernanceAnalytics; snapshot: GovernanceSnapshot | null; at: number } | null = null;
let refreshInFlight: Promise<{ analytics: GovernanceAnalytics; snapshot: GovernanceSnapshot | null }> | null = null;

function normalizeAnalytics(analytics: GovernanceAnalytics): GovernanceAnalytics {
  const proposals = Array.isArray(analytics.proposals)
    ? analytics.proposals.map((proposal) => ({
        ...proposal,
        roleVotes: Array.isArray(proposal.roleVotes) ? proposal.roleVotes : [],
        governanceScore: typeof proposal.governanceScore === "number" ? proposal.governanceScore : 0,
        evidenceScore: typeof proposal.evidenceScore === "number" ? proposal.evidenceScore : 0,
        milestoneCompletionRate: typeof proposal.milestoneCompletionRate === "number" ? proposal.milestoneCompletionRate : 0,
        kpiEvidenceCount: typeof proposal.kpiEvidenceCount === "number" ? proposal.kpiEvidenceCount : 0,
        milestoneCount: typeof proposal.milestoneCount === "number" ? proposal.milestoneCount : 0,
        completedMilestoneCount: typeof proposal.completedMilestoneCount === "number" ? proposal.completedMilestoneCount : 0,
        developmentScore: typeof proposal.developmentScore === "number" ? proposal.developmentScore : 0,
        onchainScore: typeof proposal.onchainScore === "number" ? proposal.onchainScore : 0,
        implementationFidelity: typeof proposal.implementationFidelity === "number" ? proposal.implementationFidelity : 0,
        impactScore: typeof proposal.impactScore === "number" ? proposal.impactScore : 0,
        implementationSpeed: typeof proposal.implementationSpeed === "number" ? proposal.implementationSpeed : 0,
        achievementScore: typeof proposal.achievementScore === "number" ? proposal.achievementScore : 0,
        hitEvidenceTarget: proposal.hitEvidenceTarget === true,
        hitMilestoneTarget: proposal.hitMilestoneTarget === true,
        hitGithubTarget: proposal.hitGithubTarget !== false
      }))
    : [];

  const roleMetrics = Array.isArray(analytics.roleMetrics)
    ? analytics.roleMetrics
    : [
        { role: "DREP" as const, totalVotes: 0, uniqueVoters: 0, yesRate: 0, noRate: 0, abstainRate: 0 },
        { role: "SPO" as const, totalVotes: 0, uniqueVoters: 0, yesRate: 0, noRate: 0, abstainRate: 0 },
        { role: "CC" as const, totalVotes: 0, uniqueVoters: 0, yesRate: 0, noRate: 0, abstainRate: 0 }
      ];

  const githubActivities = Array.isArray(analytics.githubActivities) ? analytics.githubActivities : [];
  const proposalEvidenceActivity = Array.isArray(analytics.proposalEvidenceActivity) ? analytics.proposalEvidenceActivity : [];
  const onchainMetrics = analytics.onchainMetrics || {
    fetchedAt: analytics.generatedAt || new Date().toISOString(),
    onchainHealthScore: 0
  };

  const proposalsWithGithub =
    typeof analytics.proposalsWithGithub === "number"
      ? analytics.proposalsWithGithub
      : githubActivities.filter((item) => item.hasRepository).length;

  const liveGithubProposalCount =
    typeof analytics.liveGithubProposalCount === "number"
      ? analytics.liveGithubProposalCount
      : githubActivities.filter((item) => item.hasRepository && item.isLive).length;

  const githubWithRepo = githubActivities.filter((item) => item.hasRepository);
  const avgGithubActivityScore =
    typeof analytics.avgGithubActivityScore === "number"
      ? analytics.avgGithubActivityScore
      : Number(
          (
            githubWithRepo.reduce((sum, item) => sum + item.activityScore, 0) /
            (githubWithRepo.length || 1)
          ).toFixed(4)
        );

  return {
    ...analytics,
    provider: analytics.provider || "unknown",
    onchainMetrics,
    proposals,
    roleMetrics,
    githubActivities,
    proposalEvidenceActivity,
    totalAdaStake: typeof analytics.totalAdaStake === "number" ? analytics.totalAdaStake : 0,
    totalAdaDelegatedToDrep: typeof analytics.totalAdaDelegatedToDrep === "number" ? analytics.totalAdaDelegatedToDrep : 0,
    totalAdaNotDelegated: typeof analytics.totalAdaNotDelegated === "number" ? analytics.totalAdaNotDelegated : 0,
    governanceIndex: analytics.governanceIndex || {
      votingParticipation: 0,
      proposalAcceptanceRatio: 0,
      implementationRate: 0,
      communitySatisfaction: 0,
      score: 0
    },
    drepCount: typeof analytics.drepCount === "number" ? analytics.drepCount : 0,
    activeDrepCount: typeof analytics.activeDrepCount === "number" ? analytics.activeDrepCount : 0,
    proposalsWithGithub,
    liveGithubProposalCount,
    avgGithubActivityScore
  };
}

function normalizeSnapshot(snapshot: GovernanceSnapshot): GovernanceSnapshot {
  return {
    ...snapshot,
    proposals: Array.isArray(snapshot.proposals) ? snapshot.proposals : [],
    votes: Array.isArray(snapshot.votes) ? snapshot.votes : [],
    dreps: Array.isArray(snapshot.dreps) ? snapshot.dreps : [],
    proposalGithubActivity: Array.isArray(snapshot.proposalGithubActivity) ? snapshot.proposalGithubActivity : [],
    proposalEvidenceActivity: Array.isArray(snapshot.proposalEvidenceActivity) ? snapshot.proposalEvidenceActivity : []
  };
}

function hasSnapshotSignal(snapshot: GovernanceSnapshot | null): boolean {
  if (!snapshot) {
    return false;
  }
  return snapshot.proposals.length > 0 || snapshot.votes.length > 0 || snapshot.dreps.length > 0;
}

async function refreshFromScraper(): Promise<{ analytics: GovernanceAnalytics; snapshot: GovernanceSnapshot | null }> {
  const scraper = new GovernanceScraper();
  const result = await scraper.runOnce();
  const normalized = {
    analytics: normalizeAnalytics(result.analytics),
    snapshot: normalizeSnapshot(result.snapshot)
  };
  if (hasSnapshotSignal(normalized.snapshot)) {
    lastGoodData = {
      ...normalized,
      at: Date.now()
    };
  }
  return normalized;
}

export async function ensureFreshData(_force = false): Promise<{
  analytics: GovernanceAnalytics;
  snapshot: GovernanceSnapshot | null;
}> {
  const now = Date.now();
  if (!_force && lastGoodData && now - lastGoodData.at <= LIVE_REFRESH_MIN_INTERVAL_MS) {
    return {
      analytics: lastGoodData.analytics,
      snapshot: lastGoodData.snapshot
    };
  }

  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = refreshFromScraper()
    .then((fresh) => {
      if (hasSnapshotSignal(fresh.snapshot)) {
        return fresh;
      }
      if (lastGoodData) {
        return {
          analytics: lastGoodData.analytics,
          snapshot: lastGoodData.snapshot
        };
      }
      return fresh;
    })
    .catch((error) => {
      if (lastGoodData) {
        return {
          analytics: lastGoodData.analytics,
          snapshot: lastGoodData.snapshot
        };
      }
      throw error;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}
