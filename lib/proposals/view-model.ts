import {
  GovernanceAnalytics,
  GovernanceProposal,
  GovernanceRole,
  GovernanceSnapshot,
  GovernanceVote,
  ProposalGitHubActivity,
  ProposalMetrics
} from "@/lib/cardano/types";

export type ProposalPhase = "ongoing" | "previous" | "upcoming" | "unknown";

const ROLE_ORDER: GovernanceRole[] = ["DREP", "SPO", "CC"];

const ONGOING_KEYWORDS = ["active", "open", "voting", "ongoing", "in_progress", "current", "ratifying"];
const PREVIOUS_KEYWORDS = ["expired", "closed", "rejected", "approved", "passed", "enacted", "completed", "withdrawn"];
const UPCOMING_KEYWORDS = ["scheduled", "pending", "upcoming", "draft", "queued"];

export interface ProposalViewModel {
  metric: ProposalMetrics;
  proposal?: GovernanceProposal;
  github?: ProposalGitHubActivity;
  phase: ProposalPhase;
}

export interface RoleVoteSummary {
  role: GovernanceRole;
  total: number;
  yes: number;
  no: number;
  abstain: number;
  unknown: number;
}

export interface VoteTimelinePoint {
  label: string;
  total: number;
  yes: number;
  no: number;
  abstain: number;
}

function includesAnyKeyword(status: string, keywords: string[]): boolean {
  return keywords.some((keyword) => status.includes(keyword));
}

export function classifyProposalPhase(status: string): ProposalPhase {
  const raw = status.trim().toLowerCase();
  if (!raw) {
    return "unknown";
  }

  if (includesAnyKeyword(raw, ONGOING_KEYWORDS)) {
    return "ongoing";
  }
  if (includesAnyKeyword(raw, PREVIOUS_KEYWORDS)) {
    return "previous";
  }
  if (includesAnyKeyword(raw, UPCOMING_KEYWORDS)) {
    return "upcoming";
  }

  return "unknown";
}

function phaseRank(phase: ProposalPhase): number {
  if (phase === "ongoing") {
    return 0;
  }
  if (phase === "upcoming") {
    return 1;
  }
  if (phase === "previous") {
    return 2;
  }
  return 3;
}

function toEpoch(value?: string): number {
  if (!value) {
    return 0;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

export function buildProposalViewModels(
  analytics: GovernanceAnalytics,
  snapshot: GovernanceSnapshot | null
): ProposalViewModel[] {
  const proposalById = new Map((snapshot?.proposals || []).map((proposal) => [proposal.id, proposal]));
  const githubById = new Map((analytics.githubActivities || []).map((item) => [item.proposalId, item]));

  return (analytics.proposals || [])
    .map((metric) => {
      const proposal = proposalById.get(metric.proposalId);
      const phase = classifyProposalPhase(metric.status || proposal?.status || "");

      return {
        metric,
        proposal,
        github: githubById.get(metric.proposalId),
        phase
      };
    })
    .sort((a, b) => {
      const phaseDiff = phaseRank(a.phase) - phaseRank(b.phase);
      if (phaseDiff !== 0) {
        return phaseDiff;
      }

      const dateA = toEpoch(a.proposal?.createdAt || a.proposal?.expiresAt);
      const dateB = toEpoch(b.proposal?.createdAt || b.proposal?.expiresAt);
      if (dateA !== dateB) {
        return dateB - dateA;
      }

      return b.metric.successScore - a.metric.successScore;
    });
}

export function buildRoleVoteSummary(votes: GovernanceVote[]): RoleVoteSummary[] {
  return ROLE_ORDER.map((role) => {
    const roleVotes = votes.filter((vote) => vote.role === role);
    return {
      role,
      total: roleVotes.length,
      yes: roleVotes.filter((vote) => vote.choice === "yes").length,
      no: roleVotes.filter((vote) => vote.choice === "no").length,
      abstain: roleVotes.filter((vote) => vote.choice === "abstain").length,
      unknown: roleVotes.filter((vote) => vote.choice === "unknown").length
    };
  });
}

function dateKey(value?: string): string {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }

  return date.toISOString().slice(0, 10);
}

export function buildVoteTimeline(votes: GovernanceVote[]): VoteTimelinePoint[] {
  if (!votes.length) {
    return [];
  }

  const grouped = new Map<string, GovernanceVote[]>();

  for (const vote of votes) {
    const key = dateKey(vote.timestamp);
    grouped.set(key, [...(grouped.get(key) || []), vote]);
  }

  const keys = Array.from(grouped.keys()).sort((a, b) => {
    if (a === "unknown") {
      return 1;
    }
    if (b === "unknown") {
      return -1;
    }
    return a.localeCompare(b);
  });

  return keys.map((key) => {
    const items = grouped.get(key) || [];

    return {
      label: key,
      total: items.length,
      yes: items.filter((item) => item.choice === "yes").length,
      no: items.filter((item) => item.choice === "no").length,
      abstain: items.filter((item) => item.choice === "abstain").length
    };
  });
}
