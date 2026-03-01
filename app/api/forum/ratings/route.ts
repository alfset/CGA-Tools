import { NextRequest, NextResponse } from "next/server";
import { listRatings, upsertRating } from "@/lib/forum/storage";

function average(values: number[]): number {
  if (!values.length) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const proposalId = (request.nextUrl.searchParams.get("proposalId") || "").trim();
    if (!proposalId) {
      return NextResponse.json({ ok: false, error: "proposalId is required" }, { status: 400 });
    }

    const ratings = await listRatings(proposalId);
    return NextResponse.json({
      ok: true,
      proposalId,
      ratingCount: ratings.length,
      averageRating: average(ratings.map((item) => item.rating)),
      ratings
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

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const payload = (await request.json()) as {
      proposalId?: string;
      walletAddress?: string;
      rating?: number;
    };

    const proposalId = (payload.proposalId || "").trim();
    const walletAddress = (payload.walletAddress || "").trim();
    const rating = Number(payload.rating);

    if (!proposalId || !walletAddress || !Number.isFinite(rating)) {
      return NextResponse.json({ ok: false, error: "proposalId, walletAddress, and rating are required" }, { status: 400 });
    }

    const bounded = Math.max(1, Math.min(5, Math.round(rating)));
    const row = await upsertRating({
      proposalId,
      walletAddress,
      rating: bounded
    });
    return NextResponse.json({ ok: true, rating: row });
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
