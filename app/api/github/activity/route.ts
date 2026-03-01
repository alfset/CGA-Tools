import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const proposalId = request.nextUrl.searchParams.get("proposalId");

    const { analytics } = await ensureFreshData(force);
    const githubActivities = analytics.githubActivities || [];

    const items = githubActivities
      .filter((item) => (proposalId ? item.proposalId === proposalId : true))
      .sort((a, b) => b.activityScore - a.activityScore);

    return NextResponse.json({
      ok: true,
      summary: {
        proposalsWithGithub: analytics.proposalsWithGithub,
        liveGithubProposalCount: analytics.liveGithubProposalCount,
        avgGithubActivityScore: analytics.avgGithubActivityScore
      },
      count: items.length,
      items
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
