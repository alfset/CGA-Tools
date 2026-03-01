import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";
import { buildProposalViewModels } from "@/lib/proposals/view-model";
import { resolveProposalDisplayStatus } from "@/lib/proposals/proposal-metadata";

export const dynamic = "force-dynamic";

/**
 * A proposal is "funded/previous" if its resolved display status is one of:
 * Enacted, Ratified, Passed, Expired, Dropped — i.e. no longer Active.
 *
 * NOTE: "Active" / "ongoing" proposals are NOT included here.
 * The old check used raw string contains which accidentally matched "ongoing" as nothing,
 * but left "Active" proposals in the list when status was empty.
 */
function isFundedOrPrevious(status: string): boolean {
  const resolved = resolveProposalDisplayStatus(status);
  return (
    resolved === "Enacted" ||
    resolved === "Ratified" ||
    resolved === "Passed" ||
    resolved === "Expired" ||
    resolved === "Dropped"
  );
}

function avg(items: number[]): number {
  if (!items.length) return 0;
  return Number(
    (items.reduce((sum, value) => sum + value, 0) / items.length).toFixed(4)
  );
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { analytics, snapshot } = await ensureFreshData(force);

    const evidenceByProposal = new Map(
      (analytics.proposalEvidenceActivity || []).map((item) => [item.proposalId, item])
    );

    // Primary: proposals with terminal on-chain status
    const primaryFunded = (analytics.proposals || [])
      .filter((proposal) => isFundedOrPrevious(proposal.status || ""))
      .sort((a, b) => b.successScore - a.successScore)
      .map((proposal) => {
        const evidence = evidenceByProposal.get(proposal.proposalId);
        return {
          proposalId: proposal.proposalId,
          title: proposal.title,           // already resolved by normalizeProposals in scraper
          status: resolveProposalDisplayStatus(proposal.status), // double-safe
          achievementIndex: proposal.achievementScore,
          successIndex: proposal.successScore,
          evidenceScore: proposal.evidenceScore,
          milestoneCompletionRate: proposal.milestoneCompletionRate,
          kpiEvidenceCount: proposal.kpiEvidenceCount,
          milestoneCount: proposal.milestoneCount,
          completedMilestones: proposal.completedMilestoneCount,
          githubActivityScore: proposal.githubActivityScore || 0,
          githubLive: proposal.githubLive || false,
          onchainScore: proposal.onchainScore,
          voteSummary: {
            yes: proposal.yes,
            no: proposal.no,
            abstain: proposal.abstain,
            roleVotes: proposal.roleVotes,
          },
          evidenceSource: evidence
            ? {
                sourceUrl: evidence.sourceUrl || null,
                resolvedUrl: evidence.resolvedUrl || null,
                error: evidence.error || null,
              }
            : null,
        };
      });

    // Fallback: view-model "previous" phase
    const fallbackFunded = buildProposalViewModels(analytics, snapshot)
      .filter((row) => row.phase === "previous")
      .slice(0, 30)
      .map((row) => {
        const proposal = row.metric;
        const evidence = evidenceByProposal.get(proposal.proposalId);
        return {
          proposalId: proposal.proposalId,
          title: proposal.title,
          status: resolveProposalDisplayStatus(proposal.status),
          achievementIndex: proposal.achievementScore,
          successIndex: proposal.successScore,
          evidenceScore: proposal.evidenceScore,
          milestoneCompletionRate: proposal.milestoneCompletionRate,
          kpiEvidenceCount: proposal.kpiEvidenceCount,
          milestoneCount: proposal.milestoneCount,
          completedMilestones: proposal.completedMilestoneCount,
          githubActivityScore: proposal.githubActivityScore || 0,
          githubLive: proposal.githubLive || false,
          onchainScore: proposal.onchainScore,
          voteSummary: {
            yes: proposal.yes,
            no: proposal.no,
            abstain: proposal.abstain,
            roleVotes: proposal.roleVotes,
          },
          evidenceSource: evidence
            ? {
                sourceUrl: evidence.sourceUrl || null,
                resolvedUrl: evidence.resolvedUrl || null,
                error: evidence.error || null,
              }
            : null,
        };
      });

    const fundedProposals = primaryFunded.length ? primaryFunded : fallbackFunded;

    return NextResponse.json({
      ok: true,
      analysisType: "previously-funded-proposal-achievement",
      source: primaryFunded.length ? "funded-status" : "previous-phase-fallback",
      count: fundedProposals.length,
      summary: {
        averageAchievementIndex: avg(fundedProposals.map((item) => item.achievementIndex)),
        averageMilestoneCompletionRate: avg(
          fundedProposals.map((item) => item.milestoneCompletionRate)
        ),
        averageEvidenceScore: avg(fundedProposals.map((item) => item.evidenceScore)),
        averageGithubActivityScore: avg(fundedProposals.map((item) => item.githubActivityScore)),
        networkOnchainHealthScore: analytics.onchainMetrics?.onchainHealthScore || 0,
      },
      fundedProposals,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error",
      },
      { status: 500 }
    );
  }
}