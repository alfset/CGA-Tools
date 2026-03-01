import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const proposalId = request.nextUrl.searchParams.get("proposalId");
    const onlyLive = request.nextUrl.searchParams.get("live") === "1";

    const { analytics } = await ensureFreshData(force);
    const githubActivities = analytics.githubActivities || [];

    const filtered = githubActivities.filter((item) => {
      if (proposalId && item.proposalId !== proposalId) {
        return false;
      }
      if (onlyLive && !item.isLive) {
        return false;
      }
      return true;
    });

    const items = filtered.map((item) => ({
      proposalId: item.proposalId,
      proposalTitle: item.proposalTitle,
      repository: item.repository?.fullName || null,
      hasRepository: item.hasRepository,
      isLive: item.isLive,
      status: !item.hasRepository ? "no-repo" : item.reachable ? (item.isLive ? "live" : "stale") : "error",
      liveReason: item.liveReason,
      lastCommitAt: item.lastCommitAt || null,
      commits7d: item.commits7d,
      commits30d: item.commits30d,
      activityScore: item.activityScore,
      error: item.error || null
    }));

    return NextResponse.json({
      ok: true,
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
