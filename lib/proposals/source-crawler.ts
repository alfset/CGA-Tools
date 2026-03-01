import { fetchExternalText } from "@/lib/net/external-fetch";
import { extractCandidateSourceUrls, normalizeSourceUrl } from "@/lib/proposals/source-links";

interface StringEntry {
  path: string;
  value: string;
}

export interface ProposalSourceCrawlResult {
  sourceUrl: string;
  resolvedUrl: string;
  reachable: boolean;
  title?: string;
  abstract?: string;
  body?: string;
  createdAt?: string;
  expiresAt?: string;
  githubUrl?: string;
  urls: string[];
  error?: string;
}

const TITLE_KEYS = ["title", "proposal_title", "name", "headline", "subject"];
const ABSTRACT_KEYS = ["abstract", "summary", "description", "motivation", "rationale"];
const BODY_KEYS = ["body", "details", "content", "text", "proposal", "statement"];
const CREATED_KEYS = ["created_at", "created", "submitted_at", "submitted", "submitted_on", "start_at", "start_date", "date"];
const EXPIRES_KEYS = ["expires_at", "expiry", "expiration", "deadline", "end_at", "end_date", "close_at"];
const GITHUB_REPO_REGEX = /https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:[/?#]|\b)/i;
const MAX_BODY_CHARS = Number(process.env.PROPOSAL_SOURCE_CRAWLER_MAX_BODY_CHARS || 80000);

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function collectStringEntries(
  value: unknown,
  path: string[] = [],
  depth = 0,
  out: StringEntry[] = [],
  visited = new Set<unknown>()
): StringEntry[] {
  if (depth > 8 || value === null || value === undefined) {
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

  if (typeof value !== "object" || visited.has(value)) {
    return out;
  }

  visited.add(value);
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    collectStringEntries(nested, [...path, key], depth + 1, out, visited);
  }
  return out;
}

function findByKeys(entries: StringEntry[], keys: string[]): string | undefined {
  if (!entries.length) {
    return undefined;
  }

  const normalized = keys.map((key) => key.toLowerCase());
  const matched = entries.find((entry) => {
    const path = entry.path;
    return normalized.some((key) => path.endsWith(`.${key}`) || path === key || path.includes(`.${key}.`));
  });
  return matched?.value;
}

function parseDateValue(value?: string): string | undefined {
  const raw = normalizeWhitespace(value || "");
  if (!raw) {
    return undefined;
  }

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) {
    const ms = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  const cleaned = raw.replace(/^epoch:\s*/i, "").trim();
  const date = new Date(cleaned);
  if (!Number.isNaN(date.getTime())) {
    return date.toISOString();
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

function extractDateByLabel(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const regex = new RegExp(`${label}\\s*[:=-]\\s*([^\\n\\r]+)`, "i");
    const matched = text.match(regex);
    if (matched?.[1]) {
      const parsed = parseDateValue(matched[1]);
      if (parsed) {
        return parsed;
      }
    }
  }
  return undefined;
}

function normalizeOutputUrl(url: string): string {
  return normalizeSourceUrl(url) || url;
}

export async function crawlProposalSource(
  sourceUrl: string,
  options?: { timeoutMs?: number; maxBytes?: number }
): Promise<ProposalSourceCrawlResult> {
  const resolved = normalizeOutputUrl(sourceUrl);

  try {
    const payload = await fetchExternalText(resolved, {
      timeoutMs: options?.timeoutMs || 12000,
      maxBytes: Math.min(Math.max(options?.maxBytes || MAX_BODY_CHARS, 2000), 2_000_000),
      accept: "application/json,text/plain,text/markdown,text/html,*/*"
    });

    const finalUrl = normalizeOutputUrl(payload.finalUrl);
    const contentType = payload.contentType.toLowerCase();
    const urls = Array.from(new Set(extractCandidateSourceUrls(payload.text).map(normalizeOutputUrl)));
    const githubUrl = urls.find((item) => GITHUB_REPO_REGEX.test(item));

    if (contentType.includes("application/json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.text);
      } catch {
        parsed = payload.text;
      }

      const entries = collectStringEntries(parsed);
      const title = findByKeys(entries, TITLE_KEYS);
      const abstract = findByKeys(entries, ABSTRACT_KEYS);
      const body = findByKeys(entries, BODY_KEYS) || abstract || payload.text.slice(0, Math.min(MAX_BODY_CHARS, 16000));
      const createdAt = parseDateValue(findByKeys(entries, CREATED_KEYS));
      const expiresAt = parseDateValue(findByKeys(entries, EXPIRES_KEYS));

      return {
        sourceUrl,
        resolvedUrl: finalUrl,
        reachable: true,
        title,
        abstract,
        body: body ? body.slice(0, MAX_BODY_CHARS) : undefined,
        createdAt,
        expiresAt,
        githubUrl,
        urls
      };
    }

    const title = contentType.includes("text/html")
      ? extractHtmlTitle(payload.text)
      : extractMarkdownTitle(payload.text);
    const lines = payload.text
      .split(/\r?\n/)
      .map((line) => normalizeWhitespace(line))
      .filter((line) => line.length > 20 && line.length < 500);
    const abstract = lines[0] || undefined;
    const body = payload.text.slice(0, MAX_BODY_CHARS);
    const createdAt = extractDateByLabel(payload.text, ["created", "submitted", "start", "date"]);
    const expiresAt = extractDateByLabel(payload.text, ["expires", "expiry", "deadline", "end"]);

    return {
      sourceUrl,
      resolvedUrl: finalUrl,
      reachable: true,
      title,
      abstract,
      body,
      createdAt,
      expiresAt,
      githubUrl,
      urls
    };
  } catch (error) {
    return {
      sourceUrl,
      resolvedUrl: resolved,
      reachable: false,
      urls: [],
      error: error instanceof Error ? error.message : "Failed to crawl source"
    };
  }
}

