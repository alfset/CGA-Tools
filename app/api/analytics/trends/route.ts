import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { analytics, snapshot } = await ensureFreshData(force);
    const trends = [
      {
        snapshotId: snapshot?.id || analytics.snapshotId,
        fetchedAt: snapshot?.fetchedAt || analytics.generatedAt,
        proposalCount: analytics.proposalCount,
        voteCount: analytics.voteCount,
        drepCount: analytics.drepCount,
        activeDrepCount: analytics.activeDrepCount,
        successfulProposalCount: analytics.successfulProposalCount,
        successRate: analytics.overallSuccessRate,
        liveGithubProposalCount: analytics.liveGithubProposalCount,
        avgGithubActivityScore: analytics.avgGithubActivityScore,
        onchainHealthScore: analytics.onchainMetrics.onchainHealthScore
      }
    ];

    return NextResponse.json({
      ok: true,
      mode: "live-only",
      count: trends.length,
      trends
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
