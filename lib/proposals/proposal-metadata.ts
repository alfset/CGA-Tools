/**
 * Resolves the human-readable title from raw Cardano governance proposal metadata.
 *
 * On-chain proposals store metadata as CIP-100/CIP-108 JSON-LD. The raw fetch
 * can return:
 *  - A plain string: "My Proposal"
 *  - A JSON-LD key reference: "CIP108:title"  ← the BUG we're fixing
 *  - A stringified JSON object with the title inside body.title or title
 *  - An object with { body: { title: "..." } }
 *
 * This module normalises all of those into a single readable string.
 */

/** Characters that indicate the string is a JSON-LD key / namespace, not a real title */
const JSON_LD_KEY_RE = /^[A-Za-z0-9_]+:[A-Za-z0-9_]+$/;

/** Attempt to parse a stringified JSON blob and extract the title */
function extractFromJson(raw: string): string | null {
  try {
    const obj = JSON.parse(raw);
    return extractFromObject(obj);
  } catch {
    return null;
  }
}

/** Walk a parsed metadata object and return the first plausible title string */
function extractFromObject(obj: unknown): string | null {
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  // CIP-108 canonical path: body.title
  if (o.body && typeof o.body === "object") {
    const body = o.body as Record<string, unknown>;
    if (typeof body.title === "string" && body.title.trim()) return body.title.trim();
    // Sometimes nested: body["CIP108:title"]
    for (const [k, v] of Object.entries(body)) {
      if (k.toLowerCase().includes("title") && typeof v === "string" && v.trim()) {
        return v.trim();
      }
    }
  }

  // Top-level title
  if (typeof o.title === "string" && o.title.trim()) return o.title.trim();

  // JSON-LD "@graph" array
  if (Array.isArray(o["@graph"])) {
    for (const node of o["@graph"]) {
      const t = extractFromObject(node);
      if (t) return t;
    }
  }

  // Any key containing "title"
  for (const [k, v] of Object.entries(o)) {
    if (k.toLowerCase().includes("title") && typeof v === "string" && v.trim()) {
      const candidate = v.trim();
      if (!JSON_LD_KEY_RE.test(candidate)) return candidate;
    }
  }

  return null;
}

/**
 * Public API: given any raw `title` value coming from the on-chain scraper,
 * return a human-readable title string.
 *
 * Falls back to a sanitised version of `proposalId` so the UI never shows blank.
 */
export function resolveProposalTitle(
  raw: unknown,
  proposalId: string,
  fallbackMetadata?: unknown
): string {
  // 1. Raw is already a plain, human-readable string
  if (typeof raw === "string") {
    const trimmed = raw.trim();

    // Not a JSON-LD key reference → use as-is
    if (trimmed && !JSON_LD_KEY_RE.test(trimmed)) {
      return trimmed;
    }

    // Looks like raw JSON → try to parse it
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      const extracted = extractFromJson(trimmed);
      if (extracted) return extracted;
    }

    // It IS a JSON-LD key like "CIP108:title" → fall through to metadata
  }

  // 2. Raw is already a parsed object
  if (raw && typeof raw === "object") {
    const extracted = extractFromObject(raw);
    if (extracted) return extracted;
  }

  // 3. Try the optional fallbackMetadata (full anchor/metadata blob)
  if (fallbackMetadata) {
    if (typeof fallbackMetadata === "string") {
      const extracted = extractFromJson(fallbackMetadata);
      if (extracted) return extracted;
    } else if (typeof fallbackMetadata === "object") {
      const extracted = extractFromObject(fallbackMetadata);
      if (extracted) return extracted;
    }
  }

  // 4. Last resort: shorten the governance action ID
  if (proposalId) {
    const short = proposalId.replace(/^gov_action1?/, "").slice(0, 20);
    return `Proposal ${short}…`;
  }

  return "Untitled Proposal";
}

/**
 * Resolves the display status from raw on-chain status strings.
 * Extends the previous simple version with all real Cardano governance states.
 */
export function resolveProposalDisplayStatus(raw: string | undefined | null): string {
  if (!raw) return "Unknown";
  const v = raw.toLowerCase().trim();

  // Canonical on-chain terminal states
  if (v === "enacted" || v.includes("enacted")) return "Enacted";
  if (v === "ratified" || v.includes("ratified")) return "Ratified";
  if (v === "expired" || v.includes("expired")) return "Expired";
  if (v === "dropped" || v.includes("dropped")) return "Dropped";

  // Canonical on-chain active states
  if (
    v === "active" ||
    v === "ongoing" ||           // ← THE BUG: "ongoing" must map to Active
    v === "voting" ||
    v === "open" ||
    v.includes("active") ||
    v.includes("ongoing") ||
    v.includes("voting") ||
    v.includes("open")
  )
    return "Active";

  // Off-chain / KPI states
  if (
    v.includes("passed") ||
    v.includes("approved") ||
    v.includes("funded") ||
    v.includes("completed")
  )
    return "Passed";

  if (v.includes("failed") || v.includes("rejected") || v.includes("notpassed")) return "Not Passed";

  return "Unknown";
}