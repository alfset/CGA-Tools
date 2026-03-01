import { NextRequest, NextResponse } from "next/server";
import { GovernanceScraper } from "@/lib/scraper/governance-scraper";

export const dynamic = "force-dynamic";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return true;
  }

  const fromQuery = request.nextUrl.searchParams.get("secret");
  const fromHeader = request.headers.get("x-cron-secret");

  return fromQuery === secret || fromHeader === secret;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const scraper = new GovernanceScraper();
    const result = await scraper.runOnce();

    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshot.id,
      generatedAt: result.analytics.generatedAt,
      proposalCount: result.analytics.proposalCount,
      voteCount: result.analytics.voteCount
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
