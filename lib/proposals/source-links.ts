const DEFAULT_IPFS_GATEWAY = (process.env.IPFS_GATEWAY || "https://ipfs.io").replace(/\/+$/, "");

const URL_REGEX = /(?:https?:\/\/|ipfs:\/\/|ipns:\/\/|www\.)[^\s<>"'`]+/gi;
const MARKDOWN_LINK_REGEX = /\[[^\]]+\]\(([^)\s]+)\)/g;
const IPFS_PATH_REGEX = /\b\/?(?:ipfs|ipns)\/[A-Za-z0-9._~:/?#\-[\]@!$&'()*+,;=%]+/gi;
const CID_REGEX = /^(?:Qm[1-9A-HJ-NP-Za-km-z]{44}|bafy[a-z2-7]{20,})$/i;

function cleanUrlCandidate(value: string): string {
  return value
    .trim()
    .replace(/^<+|>+$/g, "")
    .replace(/[),.;]+$/g, "");
}

function tryParseAbsoluteUrl(value: string): string | null {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}

function toRawGithubUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return url;
    }

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      const owner = parts[0];
      const repo = parts[1];
      const branch = parts[3];
      const filePath = parts.slice(4).join("/");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function normalizeSourceUrl(rawUrl: string): string | null {
  const trimmed = cleanUrlCandidate(rawUrl);
  if (!trimmed) {
    return null;
  }

  if (/^ipfs:\/\//i.test(trimmed)) {
    const cidPath = trimmed.replace(/^ipfs:\/\//i, "").replace(/^\/+/, "");
    return `${DEFAULT_IPFS_GATEWAY}/ipfs/${cidPath}`;
  }

  if (/^ipns:\/\//i.test(trimmed)) {
    const path = trimmed.replace(/^ipns:\/\//i, "").replace(/^\/+/, "");
    return `${DEFAULT_IPFS_GATEWAY}/ipns/${path}`;
  }

  if (/^\/ipfs\//i.test(trimmed) || /^\/ipns\//i.test(trimmed)) {
    return `${DEFAULT_IPFS_GATEWAY}${trimmed}`;
  }

  if (/^(?:ipfs|ipns)\//i.test(trimmed)) {
    return `${DEFAULT_IPFS_GATEWAY}/${trimmed.replace(/^\/+/, "")}`;
  }

  if (CID_REGEX.test(trimmed)) {
    return `${DEFAULT_IPFS_GATEWAY}/ipfs/${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const parsed = tryParseAbsoluteUrl(trimmed);
    return parsed ? toRawGithubUrl(parsed) : null;
  }

  if (/^www\./i.test(trimmed)) {
    const parsed = tryParseAbsoluteUrl(`https://${trimmed}`);
    return parsed ? toRawGithubUrl(parsed) : null;
  }

  if (/^[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i.test(trimmed)) {
    const parsed = tryParseAbsoluteUrl(`https://${trimmed}`);
    return parsed ? toRawGithubUrl(parsed) : null;
  }

  return null;
}

export function extractCandidateSourceUrls(text?: string): string[] {
  if (!text?.trim()) {
    return [];
  }

  const candidates: string[] = [];

  for (const match of text.matchAll(MARKDOWN_LINK_REGEX)) {
    const url = cleanUrlCandidate(match[1] || "");
    if (url) {
      candidates.push(url);
    }
  }

  for (const match of text.match(URL_REGEX) || []) {
    const url = cleanUrlCandidate(match);
    if (url) {
      candidates.push(url);
    }
  }

  for (const match of text.match(IPFS_PATH_REGEX) || []) {
    const url = cleanUrlCandidate(match);
    if (url) {
      candidates.push(url);
    }
  }

  return Array.from(new Set(candidates));
}
