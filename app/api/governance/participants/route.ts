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

interface ParticipantRow {
  voterId: string;
  role: GovernanceRole;
  displayName: string;
  whois: string;
  country?: string;
  totalVotes: number;
  votedProposalCount: number;
  participationRate: number;
  yes: number;
  no: number;
  abstain: number;
  lastVoteAt?: string;
  proposals: Array<{ proposalId: string; title: string }>;
}

function shortId(value: string, size = 14): string {
  if (value.length <= size) {
    return value;
  }
  return `${value.slice(0, size)}...`;
}

function buildRoleWhois(role: GovernanceRole): string {
  if (role === "DREP") {
    return "Delegated Representative";
  }
  if (role === "SPO") {
    return "Stake Pool Operator";
  }
  return "Constitutional Committee";
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const query = (request.nextUrl.searchParams.get("q") || request.nextUrl.searchParams.get("voter") || "")
      .trim()
      .toLowerCase();
    const role = parseRole(request.nextUrl.searchParams.get("role"));

    const { snapshot } = await ensureFreshData(force);
    const votes = snapshot?.votes || [];
    const proposals = snapshot?.proposals || [];
    const drepById = new Map((snapshot?.dreps || []).map((drep) => [drep.id, drep]));
    const proposalById = new Map(proposals.map((proposal) => [proposal.id, proposal]));

    const filtered = votes.filter((vote) => {
      if (role && vote.role !== role) {
        return false;
      }
      return true;
    });

    const map = new Map<string, ParticipantRow>();

    for (const vote of filtered) {
      const key = `${vote.role}|${vote.voterId}`;
      const row =
        map.get(key) ||
        ({
          voterId: vote.voterId,
          role: vote.role,
          displayName: vote.voterId,
          whois: buildRoleWhois(vote.role),
          country: undefined,
          totalVotes: 0,
          votedProposalCount: 0,
          participationRate: 0,
          yes: 0,
          no: 0,
          abstain: 0,
          proposals: []
        } as ParticipantRow);

      row.totalVotes += 1;
      if (vote.choice === "yes") {
        row.yes += 1;
      } else if (vote.choice === "no") {
        row.no += 1;
      } else if (vote.choice === "abstain") {
        row.abstain += 1;
      }

      if (!row.proposals.some((proposal) => proposal.proposalId === vote.proposalId)) {
        row.proposals.push({
          proposalId: vote.proposalId,
          title: proposalById.get(vote.proposalId)?.title || "Untitled Governance Proposal"
        });
      }

      if (vote.timestamp) {
        if (!row.lastVoteAt || new Date(vote.timestamp).getTime() > new Date(row.lastVoteAt).getTime()) {
          row.lastVoteAt = vote.timestamp;
        }
      }

      row.votedProposalCount = row.proposals.length;
      row.participationRate = proposals.length ? Number((row.votedProposalCount / proposals.length).toFixed(4)) : 0;
      map.set(key, row);
    }

    const participants = Array.from(map.values())
      .map((row) => {
        if (row.role !== "DREP") {
          return {
            ...row,
            displayName: row.role === "SPO" ? `SPO ${shortId(row.voterId, 16)}` : `CC ${shortId(row.voterId, 16)}`
          };
        }

        const profile = drepById.get(row.voterId);
        return {
          ...row,
          displayName: profile?.name || `DRep ${shortId(row.voterId, 16)}`,
          country: profile?.country || undefined
        };
      })
      .filter((row) => {
        if (!query) {
          return true;
        }
        const haystack = [row.voterId, row.displayName, row.whois, row.country || ""].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((a, b) => b.totalVotes - a.totalVotes)
      .slice(0, 200);

    return NextResponse.json({
      ok: true,
      count: participants.length,
      query: query || null,
      role: role || null,
      participants
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
