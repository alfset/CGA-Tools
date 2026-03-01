/**
 * normalizeProposals.ts
 *
 * Call this in GovernanceScraper.runOnce() RIGHT AFTER the provider returns
 * rawProposals — before buildGovernanceAnalytics and before building the snapshot.
 *
 * It fixes two known data-quality bugs:
 *   1. title = "CIP108:title"  (JSON-LD key leaked through instead of value)
 *   2. status = "ongoing"       (needs mapping to "Active")
 */

import { resolveProposalTitle, resolveProposalDisplayStatus } from "./proposal-metadata";

export interface RawProposal {
  id?: string;
  proposalId?: string;
  title?: unknown;
  status?: string;
  // Possible metadata blobs from different providers
  metadata?: unknown;
  anchorData?: unknown;
  anchorUrl?: unknown;
  [key: string]: unknown;
}

export function normalizeProposals<T extends RawProposal>(proposals: T[]): T[] {
  return proposals.map((proposal) => {
    const id = (proposal.proposalId || proposal.id || "") as string;

    // ── Fix title ──────────────────────────────────────────────────────────────
    const rawTitle = proposal.title;
    const fallbackBlob = proposal.metadata ?? proposal.anchorData ?? null;
    const resolvedTitle = resolveProposalTitle(rawTitle, id, fallbackBlob);

    // ── Fix status ─────────────────────────────────────────────────────────────
    const resolvedStatus = resolveProposalDisplayStatus(proposal.status);

    return {
      ...proposal,
      title: resolvedTitle,
      status: resolvedStatus,
      // Keep originals for debugging
      _rawTitle: rawTitle,
      _rawStatus: proposal.status,
    } as T;
  });
}