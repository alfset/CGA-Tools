import { NextRequest, NextResponse } from "next/server";
import { GovernanceRole } from "@/lib/cardano/types";
import { ensureFreshData } from "@/lib/scraper/service";

export const dynamic = "force-dynamic";

function parseRole(value: string | null): GovernanceRole | null {
  if (!value) {
    return null;
  }

  const normalized = value.toUpperCase();
  if (normalized === "DREP" || normalized === "SPO" || normalized === "CC") {
    return normalized;
  }

  return null;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const proposalId = request.nextUrl.searchParams.get("proposalId");
    const role = parseRole(request.nextUrl.searchParams.get("role"));
    const voterQueryRaw =
      request.nextUrl.searchParams.get("voter") ||
      request.nextUrl.searchParams.get("voterId") ||
      request.nextUrl.searchParams.get("drep") ||
      request.nextUrl.searchParams.get("spo") ||
      request.nextUrl.searchParams.get("cc") ||
      "";
    const voterQuery = voterQueryRaw.trim().toLowerCase();

    const { snapshot } = await ensureFreshData(force);
    const votes = snapshot?.votes || [];
    const proposalCount = snapshot?.proposals.length || 0;

    const filtered = votes.filter((vote) => {
      if (proposalId && vote.proposalId !== proposalId) {
        return false;
      }
      if (role && vote.role !== role) {
        return false;
      }
      if (voterQuery && !vote.voterId.toLowerCase().includes(voterQuery)) {
        return false;
      }
      return true;
    });

    const roleBreakdown = ["DREP", "SPO", "CC"].map((name) => {
      const roleName = name as GovernanceRole;
      const roleVotes = filtered.filter((vote) => vote.role === roleName);
      const yes = roleVotes.filter((vote) => vote.choice === "yes").length;
      const no = roleVotes.filter((vote) => vote.choice === "no").length;
      const abstain = roleVotes.filter((vote) => vote.choice === "abstain").length;
      const votedProposalCount = new Set(roleVotes.map((vote) => vote.proposalId)).size;

      return {
        role: roleName,
        votes: roleVotes.length,
        yes,
        no,
        abstain,
        uniqueVoters: new Set(roleVotes.map((vote) => vote.voterId)).size,
        votedProposalCount,
        proposalParticipationRate: proposalCount ? Number((votedProposalCount / proposalCount).toFixed(4)) : 0
      };
    });

    return NextResponse.json({
      ok: true,
      count: filtered.length,
      summary: {
        proposalCount,
        votedProposalCount: new Set(filtered.map((vote) => vote.proposalId)).size,
        uniqueVoters: new Set(filtered.map((vote) => vote.voterId)).size,
        roleBreakdown
      },
      votes: filtered
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
