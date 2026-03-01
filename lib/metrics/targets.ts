import { GovernanceProposal, ProposalKpiTargets } from "@/lib/cardano/types";

function parsePercent(value: string): number | undefined {
  const normalized = value.trim().replace("%", "");
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  if (parsed > 1) {
    return parsed / 100;
  }
  if (parsed < 0) {
    return undefined;
  }
  return parsed;
}

function parseInteger(value: string): number | undefined {
  const parsed = Number(value.trim());
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }
  return parsed;
}

function matchTarget(text: string, key: string): string | undefined {
  const regex = new RegExp(`(?:${key})\\s*[:=]\\s*([0-9]+(?:\\.[0-9]+)?%?)`, "i");
  const match = text.match(regex);
  return match?.[1];
}

export function inferKpiTargets(proposal: GovernanceProposal): ProposalKpiTargets | undefined {
  const source = `${proposal.title} ${proposal.abstract || ""}`;
  if (!source.trim()) {
    return undefined;
  }

  const participation = matchTarget(source, "participation|turnout");
  const approval = matchTarget(source, "approval|pass[_\\s-]?rate|quorum");
  const voters = matchTarget(source, "voters|unique[_\\s-]?voters|min[_\\s-]?voters");

  const output: ProposalKpiTargets = {};

  if (participation) {
    const value = parsePercent(participation);
    if (value !== undefined) {
      output.participationTarget = value;
    }
  }

  if (approval) {
    const value = parsePercent(approval);
    if (value !== undefined) {
      output.approvalTarget = value;
    }
  }

  if (voters) {
    const value = parseInteger(voters);
    if (value !== undefined) {
      output.minUniqueVoters = value;
    }
  }

  if (!Object.keys(output).length) {
    return undefined;
  }

  return output;
}
