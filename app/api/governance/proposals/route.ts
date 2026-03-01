import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { snapshot, analytics } = await ensureFreshData(force);
    const githubActivities = analytics.githubActivities || [];
    const evidenceActivities = analytics.proposalEvidenceActivity || [];
    const githubByProposal = new Map(githubActivities.map((item) => [item.proposalId, item]));
    const evidenceByProposal = new Map(evidenceActivities.map((item) => [item.proposalId, item]));
    const proposals = (snapshot?.proposals || []).map((proposal) => {
      const github = githubByProposal.get(proposal.id);
      const evidence = evidenceByProposal.get(proposal.id);
      return {
        ...proposal,
        achievementEvidence: evidence
          ? {
              sourceUrl: evidence.sourceUrl || null,
              resolvedUrl: evidence.resolvedUrl || null,
              hasEvidence: evidence.hasEvidence,
              evidenceScore: evidence.evidenceScore,
              completionRate: evidence.completionRate,
              kpiEvidenceCount: evidence.kpiItems.length,
              milestoneCount: evidence.milestoneItems.length,
              completedMilestones: evidence.completedMilestones,
              error: evidence.error || null
            }
          : null,
        githubLiveCheck: github
          ? {
              hasRepository: github.hasRepository,
              repository: github.repository?.fullName || null,
              isLive: github.isLive,
              status: !github.hasRepository ? "no-repo" : github.reachable ? (github.isLive ? "live" : "stale") : "error",
              commits30d: github.commits30d,
              activityScore: github.activityScore,
              liveReason: github.liveReason
            }
          : null
      };
    });

    return NextResponse.json({
      ok: true,
      count: proposals.length,
      proposals
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
