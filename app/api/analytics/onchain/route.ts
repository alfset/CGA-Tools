import { NextRequest, NextResponse } from "next/server";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const { analytics } = await ensureFreshData(force);

    return NextResponse.json({
      ok: true,
      provider: analytics.provider,
      network: analytics.network,
      onchainMetrics: analytics.onchainMetrics,
      drepCount: analytics.drepCount,
      activeDrepCount: analytics.activeDrepCount
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
