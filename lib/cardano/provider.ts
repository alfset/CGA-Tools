import {
  GovernanceDrep,
  OnchainMetrics,
  GovernanceProposal,
  GovernanceRole,
  GovernanceVote,
  VoteChoice
} from "@/lib/cardano/types";
import { fetchExternalText } from "@/lib/net/external-fetch";
import { crawlProposalSource } from "@/lib/proposals/source-crawler";
import { normalizeSourceUrl } from "@/lib/proposals/source-links";

export interface GovernanceProvider {
  name: string;
  fetchProposals(network: string): Promise<GovernanceProposal[]>;
  fetchVotes(network: string): Promise<GovernanceVote[]>;
  fetchDreps(network: string): Promise<GovernanceDrep[]>;
  fetchOnchainMetrics(network: string): Promise<OnchainMetrics>;
}

interface UnknownRecord {
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_FETCH_RETRIES = Number(process.env.GOVERNANCE_FETCH_RETRIES || 1);
const DEFAULT_RETRY_DELAY_MS = Number(process.env.GOVERNANCE_RETRY_DELAY_MS || 350);
const DEFAULT_FAILURE_COOLDOWN_MS = Number(process.env.GOVERNANCE_FAILURE_COOLDOWN_MS || 15000);
const DEFAULT_PROVIDER = (process.env.GOVERNANCE_PROVIDER || "blockfrost").toLowerCase();

const DEFAULT_KOIOS_PROPOSAL_PATHS = ["/api/v1/proposal_list"];
const DEFAULT_KOIOS_VOTE_PATHS = [
  "/api/v1/proposal_votes",
  "/api/v1/voting_procedure_list",
  "/api/v1/voter_proposal_list",
  "/api/v1/proposal_vote_list"
];

const MAX_BLOCKFROST_PAGES = Number(process.env.BLOCKFROST_MAX_PAGES || 20);
const BLOCKFROST_PAGE_SIZE = Number(process.env.BLOCKFROST_PAGE_SIZE || 100);
const BLOCKFROST_VOTE_CONCURRENCY = Number(process.env.BLOCKFROST_VOTE_CONCURRENCY || 4);
const BLOCKFROST_PROPOSAL_VOTE_FETCH_LIMIT = Number(process.env.BLOCKFROST_PROPOSAL_VOTE_FETCH_LIMIT || 120);
const BLOCKFROST_PROPOSAL_METADATA_CONCURRENCY = Number(process.env.BLOCKFROST_PROPOSAL_METADATA_CONCURRENCY || 6);
const BLOCKFROST_PROPOSAL_METADATA_LIMIT = Number(process.env.BLOCKFROST_PROPOSAL_METADATA_LIMIT || 160);
const BLOCKFROST_DREP_ENRICH_CONCURRENCY = Number(process.env.BLOCKFROST_DREP_ENRICH_CONCURRENCY || 4);
const BLOCKFROST_DREP_ENRICH_LIMIT = Number(process.env.BLOCKFROST_DREP_ENRICH_LIMIT || 80);
const BLOCKFROST_DREP_METADATA_TIMEOUT_MS = Number(process.env.BLOCKFROST_DREP_METADATA_TIMEOUT_MS || 10000);
const BLOCKFROST_DREP_METADATA_MAX_BODY_CHARS = Number(process.env.BLOCKFROST_DREP_METADATA_MAX_BODY_CHARS || 90000);
const BLOCKFROST_PROPOSAL_CACHE_TTL_MS = Number(process.env.BLOCKFROST_PROPOSAL_CACHE_TTL_MS || 45000);
const BLOCKFROST_PROPOSAL_SOURCE_TITLE_CONCURRENCY = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_TITLE_CONCURRENCY || 4);
const BLOCKFROST_PROPOSAL_SOURCE_TITLE_LIMIT = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_TITLE_LIMIT || 60);
const BLOCKFROST_PROPOSAL_SOURCE_TITLE_TIMEOUT_MS = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_TITLE_TIMEOUT_MS || 8000);
const BLOCKFROST_PROPOSAL_SOURCE_TITLE_MAX_BODY_CHARS = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_TITLE_MAX_BODY_CHARS || 120000);
const BLOCKFROST_PROPOSAL_SOURCE_CRAWL_CONCURRENCY = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_CRAWL_CONCURRENCY || 3);
const BLOCKFROST_PROPOSAL_SOURCE_CRAWL_LIMIT = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_CRAWL_LIMIT || 80);
const BLOCKFROST_PROPOSAL_SOURCE_CRAWL_TIMEOUT_MS = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_CRAWL_TIMEOUT_MS || 10000);
const BLOCKFROST_PROPOSAL_SOURCE_CRAWL_MAX_BYTES = Number(process.env.BLOCKFROST_PROPOSAL_SOURCE_CRAWL_MAX_BYTES || 180000);

const TITLE_KEYS = ["title", "proposal_title", "name", "headline", "subject"];
const ABSTRACT_KEYS = ["abstract", "summary", "description", "motivation", "rationale"];
const BODY_KEYS = ["body", "details", "content", "text", "proposal", "statement"];
const URL_KEYS = ["url", "source_url", "project_url", "metadata_url", "link", "href"];
const CREATED_KEYS = ["created_at", "created", "submitted_at", "submitted", "submitted_on", "start_at", "start_date", "date"];
const EXPIRES_KEYS = ["expires_at", "expiry", "expiration", "deadline", "end_at", "end_date", "close_at"];
const DREP_NAME_KEYS = [
  "given_name",
  "display_name",
  "name",
  "full_name",
  "legal_name",
  "title",
  "nickname",
  "label"
];
const DREP_COUNTRY_KEYS = [
  "country",
  "country_code",
  "country_name",
  "location",
  "region",
  "nation",
  "nationality",
  "residence",
  "country_of_residence",
  "countryofresidence",
  "jurisdiction"
];

const requestFailureCooldownByOrigin = new Map<string, number>();

class HttpError extends Error {
  status: number;
  url: string;

  constructor(status: number, url: string) {
    super(`Fetch failed ${status} for ${url}`);
    this.status = status;
    this.url = url;
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toStringValue(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

function toNumberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function lovelaceToAda(value: unknown): number | undefined {
  const num = toNumberValue(value);
  if (num === undefined) {
    return undefined;
  }
  return Number((num / 1_000_000).toFixed(6));
}

function unixToIso(value: unknown): string | undefined {
  const numeric = toNumberValue(value);
  if (numeric === undefined) {
    return undefined;
  }

  const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function parseDateInput(value: unknown): string | undefined {
  const asUnix = unixToIso(value);
  if (asUnix) {
    return asUnix;
  }

  const text = normalizeWhitespace(toStringValue(value));
  if (!text) {
    return undefined;
  }

  if (/^epoch:/i.test(text)) {
    return undefined;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function normalizeRole(value: unknown): GovernanceRole {
  const raw = toStringValue(value).toLowerCase();
  if (raw.includes("drep") || raw.includes("delegate")) {
    return "DREP";
  }
  if (raw.includes("spo") || raw.includes("pool")) {
    return "SPO";
  }
  return "CC";
}

function normalizeVoteChoice(value: unknown): VoteChoice {
  const raw = toStringValue(value).toLowerCase();
  if (raw === "yes" || raw === "1" || raw.includes("approve")) {
    return "yes";
  }
  if (raw === "no" || raw === "0" || raw.includes("reject")) {
    return "no";
  }
  if (raw.includes("abstain") || raw === "2") {
    return "abstain";
  }
  return "unknown";
}

function parsePathCandidates(raw: string | undefined, defaults: string[]): string[] {
  if (!raw?.trim()) {
    return defaults;
  }

  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .map((item) => {
      if (!item) {
        return item;
      }
      if (item.startsWith("http://") || item.startsWith("https://") || item.startsWith("/")) {
        return item;
      }
      return `/${item}`;
    })
    .filter(Boolean);

  return parsed.length ? parsed : defaults;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryRequest(error: unknown): boolean {
  if (error instanceof HttpError) {
    return error.status >= 500 || error.status === 429;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("timedout") ||
      message.includes("timeout") ||
      message.includes("etimedout") ||
      message.includes("econnreset") ||
      message.includes("network") ||
      message.includes("aborted")
    );
  }

  return false;
}

async function fetchJson(url: string, headers?: Record<string, string>): Promise<unknown> {
  const origin = (() => {
    try {
      return new URL(url).origin;
    } catch {
      return url;
    }
  })();
  const cooldownUntil = requestFailureCooldownByOrigin.get(origin) || 0;
  if (cooldownUntil > Date.now()) {
    throw new Error(`Fetch cooldown active for ${origin}`);
  }

  const retryCount = Math.max(0, DEFAULT_FETCH_RETRIES);
  let lastError: unknown;

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: "application/json",
          ...(headers || {})
        }
      });

      if (!response.ok) {
        throw new HttpError(response.status, url);
      }

      requestFailureCooldownByOrigin.delete(origin);
      return response.json();
    } catch (error) {
      lastError = error;
      if (shouldRetryRequest(error)) {
        requestFailureCooldownByOrigin.set(origin, Date.now() + Math.max(1000, DEFAULT_FAILURE_COOLDOWN_MS));
      }
      if (attempt >= retryCount || !shouldRetryRequest(error)) {
        throw error;
      }
      await delay(DEFAULT_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Fetch failed");
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function startCase(value: string): string {
  return normalizeWhitespace(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

function humanizeProposalType(value?: string): string | undefined {
  const raw = normalizeWhitespace(value || "");
  if (!raw) {
    return undefined;
  }
  return `${startCase(raw)} Proposal`;
}

function extractPlainString(value: unknown): string | undefined {
  const text = normalizeWhitespace(toStringValue(value));
  return text || undefined;
}

function tryParseJsonString(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || (!trimmed.startsWith("{") && !trimmed.startsWith("["))) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function looksLikeTechnicalProposalTitle(value: string): boolean {
  const text = normalizeWhitespace(value);
  if (!text) {
    return true;
  }

  if (/\bgov_action[0-9a-z]{16,}\b/i.test(text)) {
    return true;
  }

  const compact = text.replace(/\s+/g, "");
  if (!text.includes(" ") && /^[a-z0-9_-]{30,}$/i.test(compact)) {
    return true;
  }

  if (/^proposal\s+[a-z0-9_-]{20,}$/i.test(text)) {
    return true;
  }

  if (/^[a-f0-9]{48,}$/i.test(compact)) {
    return true;
  }

  return false;
}

function chooseReadableTitle(...candidates: Array<string | undefined>): string | undefined {
  const normalized = candidates
    .map((value) => normalizeWhitespace(value || ""))
    .filter(Boolean);

  const readable = normalized.find((value) => !looksLikeTechnicalProposalTitle(value));
  return readable || normalized[0];
}

function looksLikePlaceholderName(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) {
    return true;
  }
  return text === "unknown drep" || text === "unknown" || text === "n/a";
}

function shortDrepAlias(id: string): string {
  const normalized = normalizeWhitespace(id);
  if (!normalized) {
    return "DRep";
  }
  return `DRep ${normalized}`;
}

function parseDrepVotingPower(record: UnknownRecord): number | undefined {
  const direct =
    toNumberValue(record.voting_power) ||
    toNumberValue(record.active_voting_power) ||
    toNumberValue(record.drep_voting_power) ||
    toNumberValue(record.amount) ||
    toNumberValue(record.stake) ||
    toNumberValue(record.active_stake) ||
    toNumberValue(record.delegated_stake) ||
    toNumberValue(record.total_stake);

  if (direct !== undefined) {
    return direct;
  }

  const lovelace =
    lovelaceToAda(record.voting_power_lovelace) ||
    lovelaceToAda(record.amount_lovelace) ||
    lovelaceToAda(record.active_stake_lovelace) ||
    lovelaceToAda(record.delegated_stake_lovelace);

  return lovelace;
}

interface StringEntry {
  path: string;
  value: string;
}

function collectStringEntries(
  value: unknown,
  path: string[] = [],
  depth = 0,
  out: StringEntry[] = [],
  visited = new Set<unknown>()
): StringEntry[] {
  if (depth > 7 || value === null || value === undefined) {
    return out;
  }

  if (typeof value === "string") {
    const parsed = tryParseJsonString(value);
    if (parsed !== null) {
      collectStringEntries(parsed, path, depth + 1, out, visited);
      return out;
    }

    const normalized = normalizeWhitespace(value);
    if (normalized) {
      out.push({ path: path.join(".").toLowerCase(), value: normalized });
    }
    return out;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    out.push({ path: path.join(".").toLowerCase(), value: String(value) });
    return out;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      collectStringEntries(value[index], [...path, String(index)], depth + 1, out, visited);
    }
    return out;
  }

  if (!isRecord(value) || visited.has(value)) {
    return out;
  }

  visited.add(value);
  for (const [key, nested] of Object.entries(value)) {
    collectStringEntries(nested, [...path, key], depth + 1, out, visited);
  }
  return out;
}

function findEntryByKeys(entries: StringEntry[], keys: string[]): string | undefined {
  if (!entries.length) {
    return undefined;
  }

  const normalizedKeys = keys.map((key) => key.toLowerCase());
  const matched = entries.find((entry) => {
    const path = entry.path;
    return normalizedKeys.some((key) => path.endsWith(`.${key}`) || path === key || path.includes(`.${key}.`));
  });

  return matched?.value;
}

function findEntriesByKeys(entries: StringEntry[], keys: string[]): StringEntry[] {
  if (!entries.length) {
    return [];
  }
  const normalizedKeys = keys.map((key) => key.toLowerCase());
  return entries.filter((entry) => {
    const path = entry.path;
    return normalizedKeys.some((key) => path.endsWith(`.${key}`) || path === key || path.includes(`.${key}.`));
  });
}

function looksLikeUrlValue(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) {
    return false;
  }
  return text.startsWith("http://") || text.startsWith("https://") || text.startsWith("urn:");
}

function looksLikeOntologyIdentifier(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) {
    return false;
  }
  return (
    text.includes("xmlns.com/foaf/") ||
    text.includes("schema.org/") ||
    text.includes("w3.org/") ||
    text.includes("rdf-syntax-ns")
  );
}

function looksLikeGenericDrepName(value: string): boolean {
  const text = normalizeWhitespace(value).toLowerCase();
  if (!text) {
    return true;
  }

  if (
    text === "label" ||
    text === "name" ||
    text === "title" ||
    text === "github" ||
    text === "website" ||
    text === "web site" ||
    text === "url" ||
    text === "link" ||
    text === "profile" ||
    text === "handle" ||
    text === "description" ||
    text === "metadata"
  ) {
    return true;
  }

  if (
    text.startsWith("cip") ||
    text.includes("reference-label") ||
    text.includes("reference label") ||
    text.includes("github.com") ||
    text.includes("twitter.com") ||
    text.includes("x.com") ||
    text.includes("discord.gg") ||
    text.includes("t.me/")
  ) {
    return true;
  }

  return false;
}

function toHumanName(value?: string): string | undefined {
  const text = normalizeWhitespace(value || "");
  if (
    !text ||
    looksLikePlaceholderName(text) ||
    looksLikeUrlValue(text) ||
    looksLikeOntologyIdentifier(text) ||
    looksLikeGenericDrepName(text)
  ) {
    return undefined;
  }
  if (text.length < 2 || text.length > 140) {
    return undefined;
  }
  if (!/\p{L}/u.test(text)) {
    return undefined;
  }
  return text;
}

function toCountryValue(value?: string): string | undefined {
  const text = normalizeWhitespace(value || "");
  if (!text || looksLikeUrlValue(text) || looksLikeOntologyIdentifier(text)) {
    return undefined;
  }
  if (text.toLowerCase() === "unknown" || text.toLowerCase() === "n/a") {
    return undefined;
  }
  if (text.length > 64) {
    return undefined;
  }
  if (/^[a-z]{2,3}$/i.test(text)) {
    return text.toUpperCase();
  }
  return text;
}

function chooseDrepName(entries: StringEntry[], keys: string[], fallbackValues: Array<string | undefined>): string | undefined {
  const scored = findEntriesByKeys(entries, keys)
    .map((entry) => {
      const name = toHumanName(entry.value);
      if (!name) {
        return null;
      }
      let score = 0;
      if (entry.path.endsWith(".@value") || entry.path.endsWith(".value")) {
        score += 5;
      }
      if (entry.path.endsWith(".name") || entry.path.endsWith(".given_name") || entry.path.endsWith(".display_name")) {
        score += 3;
      }
      if (entry.path.endsWith(".label") || entry.path.endsWith(".title")) {
        score -= 2;
      }
      if (entry.path.includes(".social") || entry.path.includes(".links") || entry.path.includes(".contact")) {
        score -= 2;
      }
      if (entry.path.includes(".@id")) {
        score -= 4;
      }
      return { name, score };
    })
    .filter((item): item is { name: string; score: number } => !!item)
    .sort((a, b) => b.score - a.score);

  if (scored.length) {
    return scored[0].name;
  }

  for (const value of fallbackValues) {
    const normalized = toHumanName(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function chooseDrepCountry(entries: StringEntry[], keys: string[], fallbackValues: Array<string | undefined>): string | undefined {
  const candidates = findEntriesByKeys(entries, keys)
    .map((entry) => toCountryValue(entry.value))
    .filter((value): value is string => !!value);

  if (candidates.length) {
    return candidates[0];
  }

  for (const value of fallbackValues) {
    const normalized = toCountryValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function extractHtmlTitle(text: string): string | undefined {
  const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch?.[1]) {
    return normalizeWhitespace(titleMatch[1]);
  }

  const h1Match = text.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match?.[1]) {
    return normalizeWhitespace(h1Match[1]);
  }

  return undefined;
}

function extractMarkdownTitle(text: string): string | undefined {
  const heading = text.match(/^\s{0,3}#{1,3}\s+(.+)$/m);
  if (heading?.[1]) {
    return normalizeWhitespace(heading[1]);
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .find((line) => line.length >= 6 && line.length <= 140);

  return firstLine || undefined;
}

function dedupeProposals(proposals: GovernanceProposal[]): GovernanceProposal[] {
  const map = new Map<string, GovernanceProposal>();

  for (const proposal of proposals) {
    const key = proposal.govActionId || proposal.id || `${proposal.txHash || "tx"}:${proposal.certIndex ?? "idx"}`;
    if (!key) {
      continue;
    }

    if (!map.has(key)) {
      map.set(key, proposal);
    }
  }

  return Array.from(map.values());
}

function dedupeVotes(votes: GovernanceVote[]): GovernanceVote[] {
  const map = new Map<string, GovernanceVote>();

  for (const vote of votes) {
    const key = [
      vote.proposalId,
      vote.voterId,
      vote.role,
      vote.choice,
      vote.txHash || "no_tx",
      vote.slot ?? "no_slot"
    ].join("|");

    if (!map.has(key)) {
      map.set(key, vote);
    }
  }

  return Array.from(map.values());
}

function emptyOnchainMetrics(): OnchainMetrics {
  return {
    fetchedAt: new Date().toISOString(),
    onchainHealthScore: 0
  };
}

class KoiosGovernanceProvider implements GovernanceProvider {
  name = "koios";

  private readonly baseUrl: string;
  private readonly proposalPaths: string[];
  private readonly votePaths: string[];

  constructor() {
    this.baseUrl = process.env.KOIOS_BASE_URL || "https://api.koios.rest";
    this.proposalPaths = parsePathCandidates(process.env.KOIOS_PROPOSALS_PATH, DEFAULT_KOIOS_PROPOSAL_PATHS);
    this.votePaths = parsePathCandidates(process.env.KOIOS_VOTES_PATH, DEFAULT_KOIOS_VOTE_PATHS);
  }

  private async fetchArrayFromCandidatePaths(paths: string[], label: string): Promise<unknown[]> {
    const errors: Error[] = [];

    for (const path of paths) {
      const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${this.baseUrl}${path}`;

      try {
        const payload = await fetchJson(url);
        if (Array.isArray(payload)) {
          return payload;
        }
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          continue;
        }
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }

    if (errors.length) {
      throw errors[0];
    }

    console.warn(`[koios] no ${label} endpoint available`, paths);
    return [];
  }

  async fetchProposals(_network: string): Promise<GovernanceProposal[]> {
    const payload = await this.fetchArrayFromCandidatePaths(this.proposalPaths, "proposal");

    const mapped = payload.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const id =
        toStringValue(item.proposal_id) ||
        toStringValue(item.gov_action_id) ||
        toStringValue(item.id);

      if (!id) {
        return [];
      }

      return [
        {
          id,
          govActionId: toStringValue(item.gov_action_id) || id,
          txHash: toStringValue(item.tx_hash),
          certIndex: toNumberValue(item.cert_index),
          title:
            chooseReadableTitle(
              extractPlainString(item.proposal_title),
              extractPlainString(item.title),
              extractPlainString(item.proposal_name),
              extractPlainString(item.name)
            ) ||
            "Untitled Governance Proposal",
          body:
            toStringValue(item.proposal_body) ||
            toStringValue(item.body) ||
            toStringValue(item.rationale),
          abstract: toStringValue(item.proposal_description) || toStringValue(item.description),
          status: toStringValue(item.proposal_status) || toStringValue(item.status) || "unknown",
          createdAt: toStringValue(item.created_at) || toStringValue(item.submitted_at),
          expiresAt: toStringValue(item.expiry_time) || toStringValue(item.expires_at),
          url: toStringValue(item.proposal_url) || toStringValue(item.url)
        }
      ];
    });

    return dedupeProposals(mapped);
  }

  async fetchVotes(_network: string): Promise<GovernanceVote[]> {
    const payload = await this.fetchArrayFromCandidatePaths(this.votePaths, "vote");

    const mapped = payload.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const proposalId =
        toStringValue(item.proposal_id) ||
        toStringValue(item.gov_action_id) ||
        toStringValue(item.id);

      if (!proposalId) {
        return [];
      }

      const voterId =
        toStringValue(item.voter_id) ||
        toStringValue(item.voter_key) ||
        toStringValue(item.voter) ||
        "unknown-voter";

      return [
        {
          proposalId,
          role: normalizeRole(item.voter_role || item.voter_type || item.role),
          voterId,
          choice: normalizeVoteChoice(item.vote || item.vote_choice || item.choice),
          votingPower: toNumberValue(item.voting_power || item.stake || item.power),
          txHash: toStringValue(item.tx_hash),
          slot: toNumberValue(item.abs_slot || item.slot),
          timestamp: toStringValue(item.block_time || item.timestamp)
        }
      ];
    });

    return dedupeVotes(mapped);
  }

  async fetchDreps(_network: string): Promise<GovernanceDrep[]> {
    return [];
  }

  async fetchOnchainMetrics(_network: string): Promise<OnchainMetrics> {
    return emptyOnchainMetrics();
  }
}

class BlockfrostGovernanceProvider implements GovernanceProvider {
  name = "blockfrost";

  private readonly baseUrl: string;
  private readonly projectId: string;
  private proposalsCache: GovernanceProposal[] = [];
  private proposalsCacheAt = 0;
  private proposalsInFlight: Promise<GovernanceProposal[]> | null = null;

  constructor(network: string) {
    this.baseUrl = process.env.BLOCKFROST_BASE_URL || this.resolveBaseUrl(network);
    this.projectId = process.env.BLOCKFROST_PROJECT_ID || process.env.BLOCKFROST_API_KEY || "";
  }

  private resolveBaseUrl(network: string): string {
    const normalized = (network || "mainnet").toLowerCase();

    if (normalized === "preview") {
      return "https://cardano-preview.blockfrost.io/api/v0";
    }
    if (normalized === "preprod") {
      return "https://cardano-preprod.blockfrost.io/api/v0";
    }
    return "https://cardano-mainnet.blockfrost.io/api/v0";
  }

  private headers(): Record<string, string> {
    if (!this.projectId) {
      throw new Error("Missing Blockfrost project id. Set BLOCKFROST_PROJECT_ID or BLOCKFROST_API_KEY.");
    }

    return {
      project_id: this.projectId
    };
  }

  private async fetchPaginated(path: string): Promise<unknown[]> {
    const rows: unknown[] = [];

    for (let page = 1; page <= Math.max(1, MAX_BLOCKFROST_PAGES); page += 1) {
      const sep = path.includes("?") ? "&" : "?";
      const preferred = `${this.baseUrl}${path}${sep}count=${BLOCKFROST_PAGE_SIZE}&page=${page}&order=desc`;
      const fallback = `${this.baseUrl}${path}${sep}count=${BLOCKFROST_PAGE_SIZE}&page=${page}`;

      let payload: unknown;
      try {
        payload = await fetchJson(preferred, this.headers());
      } catch (error) {
        if (error instanceof HttpError && error.status === 400) {
          payload = await fetchJson(fallback, this.headers());
        } else {
          throw error;
        }
      }

      if (!Array.isArray(payload) || payload.length === 0) {
        break;
      }

      rows.push(...payload);

      if (payload.length < BLOCKFROST_PAGE_SIZE) {
        break;
      }
    }

    return rows;
  }

  private async fetchCollectionCount(path: string): Promise<number | undefined> {
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}${path}${sep}count=1&page=1`;
    const origin = (() => {
      try {
        return new URL(url).origin;
      } catch {
        return url;
      }
    })();
    const cooldownUntil = requestFailureCooldownByOrigin.get(origin) || 0;
    if (cooldownUntil > Date.now()) {
      return undefined;
    }
    const retryCount = Math.max(0, DEFAULT_FETCH_RETRIES);

    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: {
            accept: "application/json",
            ...this.headers()
          }
        });

        if (!response.ok) {
          return undefined;
        }

        const xTotal = response.headers.get("x-total-count");
        const contentRange = response.headers.get("content-range");

        if (xTotal) {
          const parsed = Number(xTotal);
          if (Number.isFinite(parsed)) {
            return parsed;
          }
        }

        if (contentRange) {
          const match = contentRange.match(/\/([0-9]+)$/);
          if (match?.[1]) {
            const parsed = Number(match[1]);
            if (Number.isFinite(parsed)) {
              return parsed;
            }
          }
        }

        return undefined;
      } catch (error) {
        if (shouldRetryRequest(error)) {
          requestFailureCooldownByOrigin.set(origin, Date.now() + Math.max(1000, DEFAULT_FAILURE_COOLDOWN_MS));
        }
        if (attempt >= retryCount || !shouldRetryRequest(error)) {
          return undefined;
        }
        await delay(DEFAULT_RETRY_DELAY_MS * (attempt + 1));
      } finally {
        clearTimeout(timeout);
      }
    }

    return undefined;
  }

  private deriveProposalStatus(record: UnknownRecord): string {
    if (toNumberValue(record.dropped_epoch) !== undefined) {
      return "dropped";
    }
    if (toNumberValue(record.expired_epoch) !== undefined) {
      return "expired";
    }
    if (toNumberValue(record.enacted_epoch) !== undefined) {
      return "enacted";
    }
    if (toNumberValue(record.ratified_epoch) !== undefined) {
      return "ratified";
    }
    return "ongoing";
  }

  private mapProposal(record: UnknownRecord): GovernanceProposal | null {
    const id =
      toStringValue(record.id) ||
      toStringValue(record.proposal_id) ||
      toStringValue(record.gov_action_id) ||
      toStringValue(record.tx_hash);

    if (!id) {
      return null;
    }

    const txHash = toStringValue(record.tx_hash);
    const certIndex = toNumberValue(record.cert_index);
    const type = toStringValue(record.type) || toStringValue(record.proposal_type);
    const rawUrl = toStringValue(record.url) || toStringValue(record.metadata_url);
    const normalizedUrl = rawUrl ? normalizeSourceUrl(rawUrl) || rawUrl : undefined;
    const baseTitle = chooseReadableTitle(
      extractPlainString(record.title),
      extractPlainString(record.proposal_title),
      extractPlainString(record.name)
    );

    return {
      id,
      govActionId: toStringValue(record.gov_action_id) || id,
      txHash,
      certIndex,
      title: baseTitle || humanizeProposalType(type) || "Untitled Governance Proposal",
      body: toStringValue(record.body),
      abstract: toStringValue(record.abstract) || toStringValue(record.description),
      status: this.deriveProposalStatus(record),
      createdAt: unixToIso(record.block_time) || toStringValue(record.created_at),
      expiresAt:
        toStringValue(record.expires_at) ||
        (toNumberValue(record.expiration) !== undefined ? `epoch:${toNumberValue(record.expiration)}` : undefined),
      url: normalizedUrl
    };
  }

  private async fetchProposalsInternal(): Promise<GovernanceProposal[]> {
    const payload = await this.fetchPaginated("/governance/proposals");

    const mapped = payload.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      const mapped = this.mapProposal(item);
      return mapped ? [mapped] : [];
    });

    const deduped = dedupeProposals(mapped);
    return this.enrichProposalsWithMetadata(deduped);
  }

  async fetchProposals(_network: string): Promise<GovernanceProposal[]> {
    const now = Date.now();
    if (this.proposalsCache.length && now - this.proposalsCacheAt <= BLOCKFROST_PROPOSAL_CACHE_TTL_MS) {
      return this.proposalsCache;
    }

    if (this.proposalsInFlight) {
      return this.proposalsInFlight;
    }

    this.proposalsInFlight = this.fetchProposalsInternal()
      .then((rows) => {
        this.proposalsCache = rows;
        this.proposalsCacheAt = Date.now();
        return rows;
      })
      .finally(() => {
        this.proposalsInFlight = null;
      });

    return this.proposalsInFlight;
  }

  private parseMetadataPayload(payload: unknown): Partial<GovernanceProposal> {
    const root = isRecord(payload) ? payload : {};
    const candidates: unknown[] = [root];
    if (isRecord(root.json_metadata)) {
      candidates.unshift(root.json_metadata);
    }
    if (isRecord(root.metadata)) {
      candidates.unshift(root.metadata);
    }
    if (isRecord(root.proposal)) {
      candidates.unshift(root.proposal);
    }

    const entries = collectStringEntries(candidates);

    const title = chooseReadableTitle(findEntryByKeys(entries, TITLE_KEYS), extractPlainString(root.title));
    const abstract = findEntryByKeys(entries, ABSTRACT_KEYS) || extractPlainString(root.abstract);
    const body = findEntryByKeys(entries, BODY_KEYS) || extractPlainString(root.body) || abstract;
    const rawUrl = findEntryByKeys(entries, URL_KEYS) || extractPlainString(root.url) || extractPlainString(root.metadata_url);
    const url = rawUrl ? normalizeSourceUrl(rawUrl) || rawUrl : undefined;
    const createdAt = parseDateInput(findEntryByKeys(entries, CREATED_KEYS) || root.created_at || root.submitted_at || root.date);
    const expiresAt = parseDateInput(findEntryByKeys(entries, EXPIRES_KEYS) || root.expires_at || root.expiration || root.deadline);

    return {
      title: title || undefined,
      abstract: abstract || undefined,
      body: body || undefined,
      url,
      createdAt,
      expiresAt
    };
  }

  private parseTitleFromSource(contentType: string, text: string): string | undefined {
    const type = contentType.toLowerCase();

    if (type.includes("application/json")) {
      try {
        const parsed = JSON.parse(text);
        const entries = collectStringEntries(parsed);
        return chooseReadableTitle(
          findEntryByKeys(entries, TITLE_KEYS),
          findEntryByKeys(entries, ["proposal", "topic", "subject"])
        );
      } catch {
        return undefined;
      }
    }

    if (type.includes("text/html")) {
      return chooseReadableTitle(extractHtmlTitle(text));
    }

    return chooseReadableTitle(extractMarkdownTitle(text));
  }

  private async fetchProposalSourceTitle(sourceUrl: string): Promise<string | undefined> {
    const resolvedUrl = normalizeSourceUrl(sourceUrl);
    if (!resolvedUrl) {
      return undefined;
    }

    try {
      const { contentType, text } = await fetchExternalText(resolvedUrl, {
        timeoutMs: BLOCKFROST_PROPOSAL_SOURCE_TITLE_TIMEOUT_MS,
        maxBytes: Math.max(2000, BLOCKFROST_PROPOSAL_SOURCE_TITLE_MAX_BODY_CHARS),
        accept: "application/json,text/plain,text/markdown,text/html,*/*"
      });
      const sourceTitle = this.parseTitleFromSource(contentType, text);
      return chooseReadableTitle(sourceTitle);
    } catch {
      return undefined;
    }
  }

  private async fetchProposalMetadata(proposal: GovernanceProposal): Promise<Partial<GovernanceProposal>> {
    const paths: string[] = [];
    if (proposal.govActionId || proposal.id) {
      paths.push(`/governance/proposals/${encodeURIComponent(proposal.govActionId || proposal.id)}/metadata`);
    }
    if (proposal.txHash && proposal.certIndex !== undefined) {
      paths.push(`/governance/proposals/${proposal.txHash}/${proposal.certIndex}/metadata`);
    }

    for (const path of paths) {
      try {
        const payload = await fetchJson(`${this.baseUrl}${path}`, this.headers());
        return this.parseMetadataPayload(payload);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          continue;
        }
        return {};
      }
    }

    return {};
  }

  private needsSourceCrawl(proposal: GovernanceProposal): boolean {
    if (!proposal.url) {
      return false;
    }

    if (looksLikeTechnicalProposalTitle(proposal.title)) {
      return true;
    }

    const abstract = normalizeWhitespace(proposal.abstract || "");
    const body = normalizeWhitespace(proposal.body || "");

    if (!proposal.createdAt || !proposal.expiresAt) {
      return true;
    }
    if (!abstract || abstract.length < 24) {
      return true;
    }
    if (!body || body.length < 48) {
      return true;
    }

    return false;
  }

  private mergeGithubHint(text: string | undefined, githubUrl: string | undefined): string | undefined {
    if (!githubUrl) {
      return text;
    }

    const current = normalizeWhitespace(text || "");
    if (
      /https?:\/\/github\.com\//i.test(current) ||
      /https?:\/\/raw\.githubusercontent\.com\//i.test(current)
    ) {
      return text;
    }

    const merged = current ? `${current}\nGitHub: ${githubUrl}` : `GitHub: ${githubUrl}`;
    return merged;
  }

  private mergeProposalFromCrawl(proposal: GovernanceProposal, crawl: Awaited<ReturnType<typeof crawlProposalSource>>): GovernanceProposal {
    if (!crawl.reachable) {
      return proposal;
    }

    const mergedTitle = chooseReadableTitle(crawl.title, proposal.title) || proposal.title;
    const mergedUrlRaw = crawl.resolvedUrl || proposal.url;
    const mergedUrl = mergedUrlRaw ? normalizeSourceUrl(mergedUrlRaw) || mergedUrlRaw : proposal.url;
    const mergedAbstract = crawl.abstract || proposal.abstract;
    const shouldReplaceBody = !normalizeWhitespace(proposal.body || "") || looksLikeTechnicalProposalTitle(proposal.body || "");
    const mergedBody = shouldReplaceBody ? crawl.body || proposal.body || mergedAbstract : proposal.body;
    const abstractWithGithub = this.mergeGithubHint(mergedAbstract, crawl.githubUrl);
    const bodyWithGithub = this.mergeGithubHint(mergedBody, crawl.githubUrl);

    return {
      ...proposal,
      title: mergedTitle,
      abstract: abstractWithGithub,
      body: bodyWithGithub,
      createdAt: proposal.createdAt || crawl.createdAt,
      expiresAt: proposal.expiresAt || crawl.expiresAt,
      url: mergedUrl
    };
  }

  private async enrichProposalsWithMetadata(proposals: GovernanceProposal[]): Promise<GovernanceProposal[]> {
    if (!proposals.length) {
      return proposals;
    }

    const max = Math.max(1, BLOCKFROST_PROPOSAL_METADATA_LIMIT);
    const target = proposals.slice(0, max);

    const metadataRows = await runWithConcurrency(
      target,
      BLOCKFROST_PROPOSAL_METADATA_CONCURRENCY,
      (proposal) => this.fetchProposalMetadata(proposal)
    );

    const metadataById = new Map<string, Partial<GovernanceProposal>>();
    target.forEach((proposal, index) => {
      metadataById.set(proposal.id, metadataRows[index] || {});
    });

    const merged = proposals.map((proposal) => {
      const meta = metadataById.get(proposal.id) || {};
      const mergedTitle = chooseReadableTitle(meta.title, proposal.title);
      const mergedUrlRaw = meta.url || proposal.url;
      const mergedUrl = mergedUrlRaw ? normalizeSourceUrl(mergedUrlRaw) || mergedUrlRaw : undefined;

      return {
        ...proposal,
        title: mergedTitle || "Untitled Governance Proposal",
        abstract: meta.abstract || proposal.abstract,
        body: meta.body || proposal.body || proposal.abstract,
        createdAt: meta.createdAt || proposal.createdAt,
        expiresAt: meta.expiresAt || proposal.expiresAt,
        url: mergedUrl
      };
    });
    const withSourceTitle = merged;
    const sourceTitleTargets = withSourceTitle
      .filter((proposal) => !!proposal.url && looksLikeTechnicalProposalTitle(proposal.title))
      .slice(0, Math.max(1, BLOCKFROST_PROPOSAL_SOURCE_TITLE_LIMIT));

    let titled = withSourceTitle;
    if (sourceTitleTargets.length) {
      const sourceTitles = await runWithConcurrency(
        sourceTitleTargets,
        BLOCKFROST_PROPOSAL_SOURCE_TITLE_CONCURRENCY,
        async (proposal) => this.fetchProposalSourceTitle(proposal.url || "")
      );

      const sourceTitleById = new Map<string, string>();
      sourceTitleTargets.forEach((proposal, index) => {
        const title = chooseReadableTitle(sourceTitles[index]);
        if (title) {
          sourceTitleById.set(proposal.id, title);
        }
      });

      titled = withSourceTitle.map((proposal) => ({
        ...proposal,
        title: chooseReadableTitle(sourceTitleById.get(proposal.id), proposal.title) || "Untitled Governance Proposal"
      }));
    }

    const sourceCrawlTargets = titled
      .filter((proposal) => this.needsSourceCrawl(proposal))
      .slice(0, Math.max(1, BLOCKFROST_PROPOSAL_SOURCE_CRAWL_LIMIT));

    if (!sourceCrawlTargets.length) {
      return titled;
    }

    const crawledRows = await runWithConcurrency(
      sourceCrawlTargets,
      BLOCKFROST_PROPOSAL_SOURCE_CRAWL_CONCURRENCY,
      (proposal) =>
        crawlProposalSource(proposal.url || "", {
          timeoutMs: BLOCKFROST_PROPOSAL_SOURCE_CRAWL_TIMEOUT_MS,
          maxBytes: BLOCKFROST_PROPOSAL_SOURCE_CRAWL_MAX_BYTES
        })
    );

    const crawlById = new Map<string, Awaited<ReturnType<typeof crawlProposalSource>>>();
    sourceCrawlTargets.forEach((proposal, index) => {
      const crawled = crawledRows[index];
      if (crawled) {
        crawlById.set(proposal.id, crawled);
      }
    });

    return titled.map((proposal) => {
      const crawled = crawlById.get(proposal.id);
      if (!crawled) {
        return proposal;
      }

      const mergedFromCrawl = this.mergeProposalFromCrawl(proposal, crawled);
      return {
        ...mergedFromCrawl,
        title: chooseReadableTitle(mergedFromCrawl.title, proposal.title) || "Untitled Governance Proposal"
      };
    });
  }

  private async fetchVotesByProposalRef(ref: {
    id?: string;
    txHash?: string;
    certIndex?: number;
  }): Promise<unknown[]> {
    const paths: string[] = [];

    if (ref.id) {
      paths.push(`/governance/proposals/${encodeURIComponent(ref.id)}/votes`);
    }
    if (ref.txHash && ref.certIndex !== undefined) {
      paths.push(`/governance/proposals/${ref.txHash}/${ref.certIndex}/votes`);
    }

    for (const path of paths) {
      try {
        return await this.fetchPaginated(path);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          continue;
        }
        throw error;
      }
    }

    return [];
  }

  private mapVote(record: UnknownRecord, fallbackProposalId: string): GovernanceVote | null {
    const proposalId = toStringValue(record.proposal_id) || fallbackProposalId;
    if (!proposalId) {
      return null;
    }

    const voterId =
      toStringValue(record.voter) ||
      toStringValue(record.voter_id) ||
      toStringValue(record.voter_hash) ||
      "unknown-voter";

    return {
      proposalId,
      role: normalizeRole(record.voter_role || record.role),
      voterId,
      choice: normalizeVoteChoice(record.vote || record.vote_choice),
      votingPower: toNumberValue(record.voting_power) || toNumberValue(record.stake),
      txHash: toStringValue(record.tx_hash),
      slot: toNumberValue(record.slot),
      timestamp: unixToIso(record.block_time) || toStringValue(record.timestamp)
    };
  }

  async fetchVotes(network: string): Promise<GovernanceVote[]> {
    const proposals = await this.fetchProposals(network);
    const proposalRefs = proposals
      .filter((proposal) => !!proposal.id)
      .slice(0, Math.max(1, BLOCKFROST_PROPOSAL_VOTE_FETCH_LIMIT));

    const proposalVotes = await runWithConcurrency(proposalRefs, BLOCKFROST_VOTE_CONCURRENCY, async (proposal) => {
      const payload = await this.fetchVotesByProposalRef({
        id: proposal.govActionId || proposal.id,
        txHash: proposal.txHash,
        certIndex: proposal.certIndex
      });

      return payload.flatMap((item) => {
        if (!isRecord(item)) {
          return [];
        }

        const mapped = this.mapVote(item, proposal.id);
        return mapped ? [mapped] : [];
      });
    });

    return dedupeVotes(proposalVotes.flat());
  }

  private mapDrep(record: UnknownRecord): GovernanceDrep | null {
    const id = toStringValue(record.drep_id) || toStringValue(record.id);
    if (!id) {
      return null;
    }

    const status = toStringValue(record.active) || toStringValue(record.status);
    const active = typeof record.active === "boolean"
      ? record.active
      : status
        ? ["active", "registered", "true", "1"].includes(status.toLowerCase())
        : undefined;

    const metadata = isRecord(record.metadata)
      ? record.metadata
      : isRecord(record.drep_metadata)
        ? record.drep_metadata
        : {};
    const entries = collectStringEntries([metadata, record]);
    const rawName = chooseDrepName(
      entries,
      DREP_NAME_KEYS,
      [
        extractPlainString(metadata.given_name),
        extractPlainString(metadata.name),
        extractPlainString(record.given_name),
        extractPlainString(record.name)
      ]
    );
    const rawCountry = chooseDrepCountry(
      entries,
      DREP_COUNTRY_KEYS,
      [
        extractPlainString(metadata.country),
        extractPlainString(metadata.country_code),
        extractPlainString(metadata.location),
        extractPlainString(record.country),
        extractPlainString(record.country_code)
      ]
    );
    const rawMetadataUrl = toStringValue(record.metadata_url);
    const metadataUrl = rawMetadataUrl ? normalizeSourceUrl(rawMetadataUrl) || rawMetadataUrl : undefined;

    return {
      id,
      name: rawName,
      country: rawCountry,
      votingPower: parseDrepVotingPower(record),
      active,
      txHash: toStringValue(record.tx_hash),
      metadataUrl
    };
  }

  private parseDrepMetadataPayload(payload: unknown): Partial<GovernanceDrep> {
    const entries = collectStringEntries(payload);
    const name = chooseDrepName(entries, DREP_NAME_KEYS, []);
    const country = chooseDrepCountry(entries, DREP_COUNTRY_KEYS, []);
    const metadataUrl = findEntryByKeys(entries, URL_KEYS);

    return {
      name,
      country,
      metadataUrl: metadataUrl ? normalizeSourceUrl(metadataUrl) || metadataUrl : undefined
    };
  }

  private async fetchDrepMetadataByUrl(url: string): Promise<Partial<GovernanceDrep>> {
    const resolvedUrl = normalizeSourceUrl(url);
    if (!resolvedUrl) {
      return {};
    }

    try {
      const { contentType, text } = await fetchExternalText(resolvedUrl, {
        timeoutMs: BLOCKFROST_DREP_METADATA_TIMEOUT_MS,
        maxBytes: Math.max(2000, BLOCKFROST_DREP_METADATA_MAX_BODY_CHARS),
        accept: "application/json,text/plain,text/markdown,text/html,*/*"
      });
      const loweredType = contentType.toLowerCase();

      if (loweredType.includes("application/json")) {
        try {
          const parsed = JSON.parse(text);
          return this.parseDrepMetadataPayload(parsed);
        } catch {
          return {};
        }
      }

      if (loweredType.includes("text/html")) {
        const htmlName = toHumanName(extractHtmlTitle(text));
        return {
          name: htmlName
        };
      }

      const plainName = toHumanName(extractMarkdownTitle(text));
      return {
        name: plainName
      };
    } catch {
      return {};
    }
  }

  private async fetchDrepDetail(id: string): Promise<UnknownRecord | null> {
    try {
      const payload = await fetchJson(`${this.baseUrl}/governance/dreps/${encodeURIComponent(id)}`, this.headers());
      return isRecord(payload) ? payload : null;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) {
        return null;
      }
      return null;
    }
  }

  private async fetchDrepMetadataByApi(drepId: string): Promise<Partial<GovernanceDrep>> {
    const paths = [
      `/governance/dreps/${encodeURIComponent(drepId)}/metadata`,
      `/governance/dreps/${encodeURIComponent(drepId)}/meta`
    ];

    for (const path of paths) {
      try {
        const payload = await fetchJson(`${this.baseUrl}${path}`, this.headers());
        return this.parseDrepMetadataPayload(payload);
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) {
          continue;
        }
        return {};
      }
    }

    return {};
  }

  private async enrichDreps(dreps: GovernanceDrep[]): Promise<GovernanceDrep[]> {
    if (!dreps.length) {
      return dreps;
    }

    const target = dreps
      .filter((drep) => !drep.name || !drep.country || drep.votingPower === undefined || !!drep.metadataUrl)
      .slice(0, Math.max(1, BLOCKFROST_DREP_ENRICH_LIMIT));

    if (!target.length) {
      return dreps;
    }

    const enrichedRows = await runWithConcurrency(target, BLOCKFROST_DREP_ENRICH_CONCURRENCY, async (drep) => {
      const detail = await this.fetchDrepDetail(drep.id);
      const detailMapped = detail ? this.mapDrep(detail) : null;
      const detailMetadataUrl = detail ? toStringValue(detail.metadata_url) : "";
      const candidateMetadataUrl =
        detailMapped?.metadataUrl ||
        (detailMetadataUrl ? normalizeSourceUrl(detailMetadataUrl) || detailMetadataUrl : undefined) ||
        drep.metadataUrl;
      const metadataFromApi = await this.fetchDrepMetadataByApi(drep.id);

      const metadataFromUrl = candidateMetadataUrl
        ? await this.fetchDrepMetadataByUrl(candidateMetadataUrl)
        : {};

      const mergedName = chooseDrepName([], DREP_NAME_KEYS, [metadataFromApi.name, metadataFromUrl.name, detailMapped?.name, drep.name]);
      const mergedCountry =
        metadataFromApi.country ||
        metadataFromUrl.country ||
        detailMapped?.country ||
        drep.country;
      const mergedVotingPower = detailMapped?.votingPower ?? drep.votingPower;

      return {
        id: drep.id,
        name: mergedName && !looksLikePlaceholderName(mergedName) ? mergedName : undefined,
        country: mergedCountry || undefined,
        votingPower: mergedVotingPower,
        active: detailMapped?.active ?? drep.active,
        txHash: detailMapped?.txHash || drep.txHash,
        metadataUrl:
          metadataFromApi.metadataUrl ||
          metadataFromUrl.metadataUrl ||
          candidateMetadataUrl ||
          drep.metadataUrl
      } as GovernanceDrep;
    });

    const byId = new Map(enrichedRows.map((row) => [row.id, row]));
    return dreps.map((drep) => byId.get(drep.id) || drep);
  }

  async fetchDreps(_network: string): Promise<GovernanceDrep[]> {
    const payload = await this.fetchPaginated("/governance/dreps");
    const mapped = payload.flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }
      const row = this.mapDrep(item);
      return row ? [row] : [];
    });
    const deduped = mapped.filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index);
    const enriched = await this.enrichDreps(deduped);
    return enriched.map((drep) => ({
      ...drep,
      name: drep.name || shortDrepAlias(drep.id)
    }));
  }

  async fetchOnchainMetrics(_network: string): Promise<OnchainMetrics> {
    const [networkPayload, epochPayload, blockPayload, mempoolPayload, proposalCountFallback, drepCountFallback, poolCountFallback] = await Promise.all([
      fetchJson(`${this.baseUrl}/network`, this.headers()).catch(() => ({})),
      fetchJson(`${this.baseUrl}/epochs/latest`, this.headers()).catch(() => ({})),
      fetchJson(`${this.baseUrl}/blocks/latest`, this.headers()).catch(() => ({})),
      fetchJson(`${this.baseUrl}/mempool`, this.headers()).catch(() => ({})),
      this.fetchCollectionCount("/governance/proposals").catch(() => undefined),
      this.fetchCollectionCount("/governance/dreps").catch(() => undefined),
      this.fetchCollectionCount("/pools").catch(() => undefined)
    ]);

    const networkObj = isRecord(networkPayload) ? networkPayload : {};
    const epochObj = isRecord(epochPayload) ? epochPayload : {};
    const blockObj = isRecord(blockPayload) ? blockPayload : {};
    const mempoolObj = isRecord(mempoolPayload) ? mempoolPayload : {};
    const supply = isRecord(networkObj.supply) ? networkObj.supply : {};
    const stake = isRecord(networkObj.stake) ? networkObj.stake : {};
    const stakePool = isRecord(networkObj.stake_pool)
      ? networkObj.stake_pool
      : isRecord(networkObj.stakepool)
        ? networkObj.stakepool
        : {};

    const latestBlockAt = unixToIso(blockObj.time);
    const recencySeconds = latestBlockAt
      ? Math.max(0, (Date.now() - new Date(latestBlockAt).getTime()) / 1000)
      : Number.POSITIVE_INFINITY;

    const syncScore = recencySeconds <= 300 ? 1 : recencySeconds <= 1200 ? 0.6 : 0.25;
    const mempoolTxCount = toNumberValue(mempoolObj.tx_count) || 0;
    const mempoolScore = mempoolTxCount <= 2500 ? 1 : mempoolTxCount <= 10000 ? 0.7 : 0.4;

    const liveStakeAda = lovelaceToAda(stake.live) || 0;
    const circulatingSupplyAda = lovelaceToAda(supply.circulating) || 0;
    const stakeRatio = circulatingSupplyAda > 0 ? liveStakeAda / circulatingSupplyAda : 0;
    const stakeScore = stakeRatio >= 0.6 ? 1 : stakeRatio >= 0.45 ? 0.7 : 0.4;

    const activePools =
      toNumberValue(stakePool.active) ||
      toNumberValue(stakePool.count) ||
      toNumberValue(networkObj.stake_pool_count) ||
      toNumberValue(networkObj.stakepool_count) ||
      toNumberValue(networkObj.active_pools) ||
      poolCountFallback;
    const poolScore = activePools === undefined ? 0.7 : activePools >= 1000 ? 1 : activePools >= 500 ? 0.7 : 0.4;
    const totalDrepCount =
      toNumberValue(networkObj.total_drep_count) ||
      toNumberValue(networkObj.drep_count) ||
      drepCountFallback;
    const activeDrepCount =
      toNumberValue(networkObj.active_drep_count) ||
      toNumberValue(networkObj.active_dreps);
    const drepParticipation = totalDrepCount && activeDrepCount !== undefined
      ? activeDrepCount / totalDrepCount
      : totalDrepCount
        ? 0.5
        : 0;
    const drepScore = drepParticipation >= 0.65 ? 1 : drepParticipation >= 0.4 ? 0.7 : 0.4;

    const onchainHealthScore = Number(
      (syncScore * 0.22 + mempoolScore * 0.18 + stakeScore * 0.2 + poolScore * 0.2 + drepScore * 0.2).toFixed(4)
    );

    return {
      fetchedAt: new Date().toISOString(),
      latestEpoch: toNumberValue(epochObj.epoch),
      latestBlockHeight: toNumberValue(blockObj.height),
      latestSlot: toNumberValue(blockObj.slot),
      latestBlockAt,
      epochTxCount: toNumberValue(epochObj.tx_count),
      epochBlockCount: toNumberValue(epochObj.block_count),
      mempoolTxCount,
      mempoolBytes: toNumberValue(mempoolObj.total_size),
      mempoolFeesAda: lovelaceToAda(mempoolObj.total_fees),
      circulatingSupplyAda: lovelaceToAda(supply.circulating),
      totalSupplyAda: lovelaceToAda(supply.total),
      liveStakeAda: lovelaceToAda(stake.live),
      activeStakePoolCount: activePools,
      retiringStakePoolCount:
        toNumberValue(stakePool.retiring) ||
        toNumberValue(networkObj.stake_pool_retiring) ||
        toNumberValue(networkObj.retiring_pools),
      proposalCount: proposalCountFallback,
      totalDrepCount,
      activeDrepCount,
      onchainHealthScore
    };
  }
}

export function getGovernanceProvider(network = process.env.CARDANO_NETWORK || "mainnet"): GovernanceProvider {
  if (DEFAULT_PROVIDER === "koios") {
    return new KoiosGovernanceProvider();
  }

  return new BlockfrostGovernanceProvider(network);
}
