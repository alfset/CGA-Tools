import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";
import { buildProposalViewModels } from "@/lib/proposals/view-model";

export const dynamic = "force-dynamic";

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

function avg(items: number[]): number {
  if (!items.length) {
    return 0;
  }
  return Number((items.reduce((sum, value) => sum + value, 0) / items.length).toFixed(4));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { analytics, snapshot } = await ensureFreshData(force);
    const evidenceByProposal = new Map(
      (analytics.proposalEvidenceActivity || []).map((item) => [item.proposalId, item])
    );
    const primaryFunded = (analytics.proposals || [])
      .filter((proposal) => isFundedStatus(proposal.status || ""))
      .sort((a, b) => b.successScore - a.successScore)
      .map((proposal) => {
        const evidence = evidenceByProposal.get(proposal.proposalId);
        return {
          proposalId: proposal.proposalId,
          title: proposal.title,
          status: proposal.status,
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
            roleVotes: proposal.roleVotes
          },
          evidenceSource: evidence
            ? {
                sourceUrl: evidence.sourceUrl || null,
                resolvedUrl: evidence.resolvedUrl || null,
                error: evidence.error || null
              }
            : null
        };
      });
    const fallbackFunded = buildProposalViewModels(analytics, snapshot)
      .filter((row) => row.phase === "previous")
      .slice(0, 30)
      .map((row) => {
        const proposal = row.metric;
        const evidence = evidenceByProposal.get(proposal.proposalId);
        return {
          proposalId: proposal.proposalId,
          title: proposal.title,
          status: proposal.status,
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
            roleVotes: proposal.roleVotes
          },
          evidenceSource: evidence
            ? {
                sourceUrl: evidence.sourceUrl || null,
                resolvedUrl: evidence.resolvedUrl || null,
                error: evidence.error || null
              }
            : null
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
        averageMilestoneCompletionRate: avg(fundedProposals.map((item) => item.milestoneCompletionRate)),
        averageEvidenceScore: avg(fundedProposals.map((item) => item.evidenceScore)),
        averageGithubActivityScore: avg(fundedProposals.map((item) => item.githubActivityScore)),
        networkOnchainHealthScore: analytics.onchainMetrics?.onchainHealthScore || 0
      },
      fundedProposals
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected error"
      },
      { status: 500 }
    );
  }
}
