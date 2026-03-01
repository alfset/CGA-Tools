import { GovernanceProposal, ProposalEvidenceActivity } from "@/lib/cardano/types";
import { fetchExternalText } from "@/lib/net/external-fetch";
import { extractCandidateSourceUrls, normalizeSourceUrl } from "@/lib/proposals/source-links";

interface EvidenceScanResult {
  resolvedUrl: string;
  reachable: boolean;
  hasEvidence: boolean;
  kpiItems: string[];
  milestoneItems: string[];
  completedMilestones: number;
  totalMilestones: number;
  completionRate: number;
  evidenceScore: number;
  error?: string;
}

const EVIDENCE_ENABLED = process.env.PROPOSAL_EVIDENCE_ENABLED !== "0";
const EVIDENCE_TIMEOUT_MS = Number(process.env.PROPOSAL_EVIDENCE_TIMEOUT_MS || 15000);
const EVIDENCE_FETCH_LIMIT = Number(process.env.PROPOSAL_EVIDENCE_FETCH_LIMIT || 80);
const EVIDENCE_CONCURRENCY = Number(process.env.PROPOSAL_EVIDENCE_CONCURRENCY || 6);
const MAX_EVIDENCE_BODY_CHARS = Number(process.env.PROPOSAL_EVIDENCE_MAX_BODY_CHARS || 300000);
const MAX_EVIDENCE_ITEMS = Number(process.env.PROPOSAL_EVIDENCE_MAX_ITEMS || 12);
const MAX_SOURCE_CANDIDATES_PER_PROPOSAL = Number(process.env.PROPOSAL_EVIDENCE_MAX_SOURCE_CANDIDATES || 8);

const KPI_REGEX = /\b(kpi|target|objective|deliverable|metric|outcome|result)\b/i;
const MILESTONE_REGEX = /\b(milestone|phase|roadmap|checkpoint|release|deliverable)\b/i;
const COMPLETED_REGEX = /\b(done|complete|completed|achieved|finished|delivered|closed|100%)\b/i;

function normalizeLine(value: string): string {
  return value
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/[`*_>#-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildCandidateLines(text: string): string[] {
  const normalized = text
    .replace(/\r/g, "\n")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/([.!?;])/g, "$1\n");

  return normalized
    .split("\n")
    .map(normalizeLine)
    .filter((line) => line.length >= 8 && line.length <= 260);
}

function toFixedRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(Math.min(1, Math.max(0, value)).toFixed(4));
}

function buildEvidenceScore(input: {
  kpiCount: number;
  milestoneCount: number;
  completedMilestones: number;
}): { completionRate: number; evidenceScore: number } {
  const completionRate = input.milestoneCount
    ? input.completedMilestones / input.milestoneCount
    : input.kpiCount
      ? Math.min(0.35, input.kpiCount / 10)
      : 0;
  const evidenceDensity = Math.min(1, (input.kpiCount + input.milestoneCount) / 12);
  const evidenceScore = completionRate * 0.65 + evidenceDensity * 0.35;

  return {
    completionRate: toFixedRatio(completionRate),
    evidenceScore: toFixedRatio(evidenceScore)
  };
}

function emptyEvidence(proposal: GovernanceProposal, reason: string, sourceUrl?: string, resolvedUrl?: string): ProposalEvidenceActivity {
  return {
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    scannedAt: new Date().toISOString(),
    sourceUrl,
    resolvedUrl,
    reachable: false,
    hasEvidence: false,
    kpiItems: [],
    milestoneItems: [],
    completedMilestones: 0,
    totalMilestones: 0,
    completionRate: 0,
    evidenceScore: 0,
    error: reason
  };
}

function parseEvidence(text: string): Omit<EvidenceScanResult, "resolvedUrl" | "reachable" | "error"> {
  const kpiItems: string[] = [];
  const milestoneMap = new Map<string, { text: string; completed: boolean }>();
  const lines = buildCandidateLines(text);

  for (const line of lines) {
    const key = line.toLowerCase();
    const hasKpi = KPI_REGEX.test(line);
    const hasMilestone = MILESTONE_REGEX.test(line);
    const isCompleted = COMPLETED_REGEX.test(line);

    if (hasKpi && kpiItems.length < MAX_EVIDENCE_ITEMS && !kpiItems.some((item) => item.toLowerCase() === key)) {
      kpiItems.push(line);
    }

    if (hasMilestone) {
      const existing = milestoneMap.get(key);
      milestoneMap.set(key, {
        text: existing?.text || line,
        completed: Boolean(existing?.completed || isCompleted)
      });
    }
  }

  const milestoneItems = Array.from(milestoneMap.values()).map((item) => item.text).slice(0, MAX_EVIDENCE_ITEMS);
  const totalMilestones = milestoneItems.length;
  const completedMilestones = Array.from(milestoneMap.values()).filter((item) => item.completed).length;
  const hasEvidence = kpiItems.length > 0 || milestoneItems.length > 0;
  const score = buildEvidenceScore({
    kpiCount: kpiItems.length,
    milestoneCount: totalMilestones,
    completedMilestones
  });

  return {
    hasEvidence,
    kpiItems,
    milestoneItems,
    completedMilestones,
    totalMilestones,
    completionRate: score.completionRate,
    evidenceScore: score.evidenceScore
  };
}

async function scanEvidenceSource(resolvedUrl: string): Promise<EvidenceScanResult> {
  const { contentType, text, finalUrl } = await fetchExternalText(resolvedUrl, {
    timeoutMs: EVIDENCE_TIMEOUT_MS,
    maxBytes: Math.max(2000, MAX_EVIDENCE_BODY_CHARS),
    accept: "application/json,text/plain,text/markdown,text/html,*/*"
  });
  let sourceText = text;

  if (contentType.toLowerCase().includes("application/json")) {
    try {
      const parsed = JSON.parse(text);
      sourceText = JSON.stringify(parsed, null, 2);
    } catch {
      sourceText = text;
    }
  }

  const parsed = parseEvidence(sourceText);
  return {
    resolvedUrl: normalizeSourceUrl(finalUrl) || finalUrl || resolvedUrl,
    reachable: true,
    ...parsed
  };
}

function asScanError(resolvedUrl: string, error: unknown): EvidenceScanResult {
  return {
    resolvedUrl,
    reachable: false,
    hasEvidence: false,
    kpiItems: [],
    milestoneItems: [],
    completedMilestones: 0,
    totalMilestones: 0,
    completionRate: 0,
    evidenceScore: 0,
    error: error instanceof Error ? error.message : "Failed to fetch evidence source"
  };
}

function collectProposalSourceCandidates(proposal: GovernanceProposal): string[] {
  const candidates = new Set<string>();

  if (proposal.url?.trim()) {
    candidates.add(proposal.url.trim());
  }

  for (const value of extractCandidateSourceUrls(proposal.abstract)) {
    candidates.add(value);
  }
  for (const value of extractCandidateSourceUrls(proposal.body)) {
    candidates.add(value);
  }

  return Array.from(candidates).slice(0, Math.max(1, MAX_SOURCE_CANDIDATES_PER_PROPOSAL));
}

async function runWithConcurrency<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) {
    return [];
  }

  const safeLimit = Math.max(1, Math.floor(limit));
  const output: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      output[index] = await task(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeLimit, items.length) }, () => worker()));
  return output;
}

export async function buildProposalEvidenceActivity(proposals: GovernanceProposal[]): Promise<ProposalEvidenceActivity[]> {
  if (!proposals.length) {
    return [];
  }

  if (!EVIDENCE_ENABLED) {
    return proposals.map((proposal) => emptyEvidence(proposal, "Proposal evidence scraper disabled"));
  }

  const urlCache = new Map<string, Promise<EvidenceScanResult>>();
  const indexed = proposals.map((proposal, index) => ({ proposal, index }));

  return runWithConcurrency(indexed, EVIDENCE_CONCURRENCY, async ({ proposal, index }) => {
    const sourceCandidates = collectProposalSourceCandidates(proposal);
    if (!sourceCandidates.length) {
      return emptyEvidence(proposal, "No source URL found in proposal metadata/body");
    }

    if (index >= Math.max(1, EVIDENCE_FETCH_LIMIT)) {
      const first = sourceCandidates[0];
      return emptyEvidence(proposal, "Skipped due to evidence fetch limit", first, normalizeSourceUrl(first) || undefined);
    }

    let fallbackReachable: { sourceUrl: string; scan: EvidenceScanResult } | null = null;
    let lastFailure: { sourceUrl: string; resolvedUrl?: string; reason: string } | null = null;

    for (const sourceUrl of sourceCandidates) {
      const resolvedUrl = normalizeSourceUrl(sourceUrl);
      if (!resolvedUrl) {
        lastFailure = {
          sourceUrl,
          reason: "Unsupported proposal source URL"
        };
        continue;
      }

      if (!urlCache.has(resolvedUrl)) {
        urlCache.set(
          resolvedUrl,
          scanEvidenceSource(resolvedUrl).catch((error) => asScanError(resolvedUrl, error))
        );
      }

      const scanned = await urlCache.get(resolvedUrl);
      if (!scanned) {
        lastFailure = {
          sourceUrl,
          resolvedUrl,
          reason: "Failed to scan proposal evidence"
        };
        continue;
      }

      if (scanned.reachable && scanned.hasEvidence) {
        return {
          proposalId: proposal.id,
          proposalTitle: proposal.title,
          scannedAt: new Date().toISOString(),
          sourceUrl,
          resolvedUrl: scanned.resolvedUrl || resolvedUrl,
          reachable: true,
          hasEvidence: true,
          kpiItems: scanned.kpiItems,
          milestoneItems: scanned.milestoneItems,
          completedMilestones: scanned.completedMilestones,
          totalMilestones: scanned.totalMilestones,
          completionRate: scanned.completionRate,
          evidenceScore: scanned.evidenceScore,
          error: scanned.error
        };
      }

      if (scanned.reachable && !fallbackReachable) {
        fallbackReachable = { sourceUrl, scan: scanned };
      }

      if (!scanned.reachable) {
        lastFailure = {
          sourceUrl,
          resolvedUrl,
          reason: scanned.error || "Failed to fetch evidence source"
        };
      }
    }

    if (fallbackReachable) {
      return {
        proposalId: proposal.id,
        proposalTitle: proposal.title,
        scannedAt: new Date().toISOString(),
        sourceUrl: fallbackReachable.sourceUrl,
        resolvedUrl: fallbackReachable.scan.resolvedUrl,
        reachable: true,
        hasEvidence: false,
        kpiItems: fallbackReachable.scan.kpiItems,
        milestoneItems: fallbackReachable.scan.milestoneItems,
        completedMilestones: fallbackReachable.scan.completedMilestones,
        totalMilestones: fallbackReachable.scan.totalMilestones,
        completionRate: fallbackReachable.scan.completionRate,
        evidenceScore: fallbackReachable.scan.evidenceScore,
        error: fallbackReachable.scan.error
      };
    }

    if (lastFailure) {
      return emptyEvidence(
        proposal,
        lastFailure.reason,
        lastFailure.sourceUrl,
        lastFailure.resolvedUrl
      );
    }

    return emptyEvidence(proposal, "No supported proposal source URL", sourceCandidates[0]);
  });
}
