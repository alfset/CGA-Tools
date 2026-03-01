import { GitHubRepoRef, GovernanceProposal, ProposalGitHubActivity } from "@/lib/cardano/types";

interface GitHubRepoApiResponse {
  full_name?: string;
  html_url?: string;
  stargazers_count?: number;
  forks_count?: number;
  open_issues_count?: number;
  subscribers_count?: number;
  pushed_at?: string;
}

interface GitHubCommitApiResponse {
  sha?: string;
  author?: {
    login?: string;
  } | null;
  commit?: {
    author?: {
      name?: string;
      date?: string;
    };
  };
}

const GITHUB_REPO_REGEX = /https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:[/?#]|\b)/i;
const RAW_GITHUB_REPO_REGEX = /https?:\/\/raw\.githubusercontent\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//i;
const DEFAULT_TIMEOUT_MS = 15000;
const GITHUB_ENABLED = process.env.GITHUB_SCRAPER_ENABLED !== "0";

function sanitizeRepoPart(value: string): string {
  return value.replace(/\.git$/i, "").trim();
}

function extractRepoFromText(text?: string): GitHubRepoRef | null {
  if (!text) {
    return null;
  }

  const match = text.match(GITHUB_REPO_REGEX) || text.match(RAW_GITHUB_REPO_REGEX);
  if (!match) {
    return null;
  }

  const owner = sanitizeRepoPart(match[1] || "");
  const repo = sanitizeRepoPart(match[2] || "");

  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
    url: `https://github.com/${owner}/${repo}`
  };
}

function extractRepoForProposal(proposal: GovernanceProposal): GitHubRepoRef | null {
  return (
    extractRepoFromText(proposal.url) ||
    extractRepoFromText(proposal.abstract) ||
    extractRepoFromText(proposal.body) ||
    extractRepoFromText(proposal.title)
  );
}

function safeIsoDate(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
}

function daysSince(isoDate?: string): number {
  if (!isoDate) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function inferLiveStatus(commits30d: number, lastCommitAt?: string, pushedAt?: string): { isLive: boolean; liveReason: string } {
  const lastCommitDays = daysSince(lastCommitAt);
  const pushedDays = daysSince(pushedAt);

  if (lastCommitDays <= 14 || pushedDays <= 14) {
    return {
      isLive: true,
      liveReason: "Recent development activity within 14 days"
    };
  }

  if (commits30d >= 5) {
    return {
      isLive: true,
      liveReason: "Consistent commit activity over last 30 days"
    };
  }

  return {
    isLive: false,
    liveReason: "Low recent development activity"
  };
}

function buildActivityScore(input: {
  commits30d: number;
  uniqueCommitters30d: number;
  lastCommitAt?: string;
  stars?: number;
  forks?: number;
}): number {
  const commitScore = Math.min(1, input.commits30d / 20);
  const committerScore = Math.min(1, input.uniqueCommitters30d / 8);

  const recencyDays = daysSince(input.lastCommitAt);
  const recencyScore =
    recencyDays <= 1 ? 1 : recencyDays <= 7 ? 0.8 : recencyDays <= 14 ? 0.6 : recencyDays <= 30 ? 0.3 : 0;

  const stars = input.stars || 0;
  const forks = input.forks || 0;
  const communityScore = Math.min(1, stars / 2000 + forks / 500);

  return Number((commitScore * 0.5 + committerScore * 0.2 + recencyScore * 0.2 + communityScore * 0.1).toFixed(4));
}

async function fetchGitHubJson<T>(path: string): Promise<T> {
  const token = process.env.GITHUB_TOKEN;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.github.com${path}`, {
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    });

    if (!response.ok) {
      throw new Error(`GitHub API ${response.status} for ${path}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRepoActivity(repo: GitHubRepoRef): Promise<Omit<ProposalGitHubActivity, "proposalId" | "proposalTitle" | "scannedAt">> {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [repoInfo, commits30] = await Promise.all([
    fetchGitHubJson<GitHubRepoApiResponse>(`/repos/${repo.owner}/${repo.repo}`),
    fetchGitHubJson<GitHubCommitApiResponse[]>(`/repos/${repo.owner}/${repo.repo}/commits?since=${encodeURIComponent(since30)}&per_page=100`)
  ]);

  const commitDates = commits30
    .map((commit) => safeIsoDate(commit.commit?.author?.date))
    .filter((value): value is string => !!value);

  const committers = new Set(
    commits30
      .map((commit) => commit.author?.login || commit.commit?.author?.name)
      .filter((value): value is string => !!value)
  );

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const commits7d = commitDates.filter((date) => new Date(date).getTime() >= sevenDaysAgo).length;

  const lastCommitAt = commitDates.length ? commitDates.sort().reverse()[0] : undefined;
  const pushedAt = safeIsoDate(repoInfo.pushed_at);

  const live = inferLiveStatus(commits30.length, lastCommitAt, pushedAt);
  const activityScore = buildActivityScore({
    commits30d: commits30.length,
    uniqueCommitters30d: committers.size,
    lastCommitAt,
    stars: repoInfo.stargazers_count,
    forks: repoInfo.forks_count
  });

  return {
    hasRepository: true,
    repository: {
      owner: repo.owner,
      repo: repo.repo,
      fullName: repoInfo.full_name || repo.fullName,
      url: repoInfo.html_url || repo.url
    },
    reachable: true,
    isLive: live.isLive,
    liveReason: live.liveReason,
    lastCommitAt,
    pushedAt,
    commits7d,
    commits30d: commits30.length,
    uniqueCommitters30d: committers.size,
    stars: repoInfo.stargazers_count,
    forks: repoInfo.forks_count,
    openIssues: repoInfo.open_issues_count,
    watchers: repoInfo.subscribers_count,
    activityScore
  };
}

function noRepoActivity(proposal: GovernanceProposal): ProposalGitHubActivity {
  return {
    proposalId: proposal.id,
    proposalTitle: proposal.title,
    scannedAt: new Date().toISOString(),
    hasRepository: false,
    reachable: false,
    isLive: false,
    liveReason: GITHUB_ENABLED ? "No GitHub repository linked in proposal" : "GitHub scraper disabled",
    commits7d: 0,
    commits30d: 0,
    uniqueCommitters30d: 0,
    activityScore: 0
  };
}

export async function buildProposalGithubActivity(proposals: GovernanceProposal[]): Promise<ProposalGitHubActivity[]> {
  if (!proposals.length) {
    return [];
  }

  if (!GITHUB_ENABLED) {
    return proposals.map(noRepoActivity);
  }

  const repoCache = new Map<
    string,
    Promise<Omit<ProposalGitHubActivity, "proposalId" | "proposalTitle" | "scannedAt">>
  >();

  return Promise.all(
    proposals.map(async (proposal) => {
      const scannedAt = new Date().toISOString();
      const repo = extractRepoForProposal(proposal);

      if (!repo) {
        return {
          ...noRepoActivity(proposal),
          scannedAt
        };
      }

      if (!repoCache.has(repo.fullName)) {
        repoCache.set(
          repo.fullName,
          fetchRepoActivity(repo).catch((error) => ({
            hasRepository: true,
            repository: repo,
            reachable: false,
            isLive: false,
            liveReason: "Unable to fetch GitHub repo activity",
            commits7d: 0,
            commits30d: 0,
            uniqueCommitters30d: 0,
            activityScore: 0,
            error: error instanceof Error ? error.message : "Unexpected GitHub error"
          }))
        );
      }

      const cached = await repoCache.get(repo.fullName);
      if (!cached) {
        return {
          ...noRepoActivity(proposal),
          scannedAt
        };
      }

      return {
        proposalId: proposal.id,
        proposalTitle: proposal.title,
        scannedAt,
        ...cached
      };
    })
  );
}
