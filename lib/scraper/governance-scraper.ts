import crypto from "crypto";
import { getGovernanceProvider, GovernanceProvider } from "@/lib/cardano/provider";
import { buildProposalGithubActivity } from "@/lib/github/scraper";
import { buildGovernanceAnalytics } from "@/lib/metrics/kpi";
import { buildProposalEvidenceActivity } from "@/lib/proposals/evidence-scraper";
import { inferKpiTargets } from "@/lib/metrics/targets";
import { GovernanceAnalytics, GovernanceSnapshot } from "@/lib/cardano/types";
import { normalizeProposals } from "@/lib/proposals/normalize-proposal";

const SCRAPER_ERROR_LOG_COOLDOWN_MS = Number(
  process.env.SCRAPER_ERROR_LOG_COOLDOWN_MS || 20000
);
const lastErrorLogByKey = new Map<string, number>();

function logScraperError(key: string, message: string, reason: unknown): void {
  const now = Date.now();
  const lastAt = lastErrorLogByKey.get(key) || 0;
  if (now - lastAt < SCRAPER_ERROR_LOG_COOLDOWN_MS) return;
  lastErrorLogByKey.set(key, now);
  console.error(message, reason);
}

export class GovernanceScraper {
  private readonly provider: GovernanceProvider;
  private readonly network: string;

  constructor(
    provider?: GovernanceProvider,
    network = process.env.CARDANO_NETWORK || "mainnet"
  ) {
    this.network = network;
    this.provider = provider || getGovernanceProvider(network);
  }

  async runOnce(): Promise<{ snapshot: GovernanceSnapshot; analytics: GovernanceAnalytics }> {
    const [proposalResult, voteResult, drepResult, onchainResult] = await Promise.allSettled([
      this.provider.fetchProposals(this.network),
      this.provider.fetchVotes(this.network),
      this.provider.fetchDreps(this.network),
      this.provider.fetchOnchainMetrics(this.network),
    ]);

    const rawProposals =
      proposalResult.status === "fulfilled" ? proposalResult.value : [];
    const votes =
      voteResult.status === "fulfilled" ? voteResult.value : [];
    const dreps =
      drepResult.status === "fulfilled" ? drepResult.value : [];
    const onchainMetrics =
      onchainResult.status === "fulfilled"
        ? onchainResult.value
        : { fetchedAt: new Date().toISOString(), onchainHealthScore: 0 };

    if (proposalResult.status === "rejected")
      logScraperError("proposals", "[scraper] failed to fetch proposals", proposalResult.reason);
    if (voteResult.status === "rejected")
      logScraperError("votes", "[scraper] failed to fetch votes", voteResult.reason);
    if (drepResult.status === "rejected")
      logScraperError("dreps", "[scraper] failed to fetch dreps", drepResult.reason);
    if (onchainResult.status === "rejected")
      logScraperError("onchain", "[scraper] failed to fetch onchain metrics", onchainResult.reason);

    // ─────────────────────────────────────────────────────────────────────────
    // STEP 1: Normalize titles and statuses BEFORE anything else touches them.
    //         This fixes:
    //           • title = "CIP108:title"  →  actual proposal title
    //           • status = "ongoing"      →  "Active"
    //           • status = "expired"      →  "Expired"   (already correct but normalised)
    // ─────────────────────────────────────────────────────────────────────────
    const normalizedRaw = normalizeProposals(rawProposals as any[]);

    // STEP 2: Inject KPI targets
    const proposals = normalizedRaw.map((proposal) => ({
      ...proposal,
      kpiTargets: proposal.kpiTargets || inferKpiTargets(proposal as any),
    }));

    // STEP 3: Enrich with GitHub + evidence (uses resolved titles now)
    const [proposalGithubActivity, proposalEvidenceActivity] = await Promise.all([
      buildProposalGithubActivity(proposals as any),
      buildProposalEvidenceActivity(proposals as any),
    ]);

    const snapshot: GovernanceSnapshot = {
      id: crypto.randomUUID(),
      network: this.network,
      fetchedAt: new Date().toISOString(),
      proposals: proposals as any,
      votes,
      dreps,
      onchainMetrics,
      proposalGithubActivity,
      proposalEvidenceActivity,
      provider: this.provider.name,
    };

    const analytics = buildGovernanceAnalytics(snapshot);

    return { snapshot, analytics };
  }

  async runDaemon(
    intervalMs = Number(process.env.SCRAPER_INTERVAL_MS || 300000)
  ): Promise<void> {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error(`Invalid interval: ${intervalMs}`);
    }

    while (true) {
      try {
        await this.runOnce();
      } catch (error) {
        console.error("[scraper] cycle failed", error);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }
}