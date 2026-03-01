import { NextRequest, NextResponse } from "next/server";
import { addForumPost, ForumPostKind, listForumPosts, listRatings } from "@/lib/forum/storage";

function isValidKind(value: string): value is ForumPostKind {
  return value === "comment" || value === "discussion";
}

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

    const [posts, ratings] = await Promise.all([listForumPosts(proposalId), listRatings(proposalId)]);
    const commentCount = posts.filter((item) => item.kind === "comment").length;
    const discussionCount = posts.filter((item) => item.kind === "discussion").length;

    return NextResponse.json({
      ok: true,
      proposalId,
      summary: {
        commentCount,
        discussionCount,
        ratingCount: ratings.length,
        averageRating: average(ratings.map((item) => item.rating))
      },
      posts
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
      kind?: string;
      message?: string;
    };

    const proposalId = (payload.proposalId || "").trim();
    const walletAddress = (payload.walletAddress || "").trim();
    const kind = (payload.kind || "").trim();
    const message = (payload.message || "").trim();

    if (!proposalId || !walletAddress || !kind || !message) {
      return NextResponse.json({ ok: false, error: "proposalId, walletAddress, kind, and message are required" }, { status: 400 });
    }
    if (!isValidKind(kind)) {
      return NextResponse.json({ ok: false, error: "kind must be comment or discussion" }, { status: 400 });
    }
    if (message.length < 4 || message.length > 500) {
      return NextResponse.json({ ok: false, error: "message length must be 4-500 characters" }, { status: 400 });
    }

    const post = await addForumPost({
      proposalId,
      walletAddress,
      kind,
      message
    });

    return NextResponse.json({ ok: true, post });
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
