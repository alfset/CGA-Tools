"use client";

import { FormEvent, useEffect, useState } from "react";
import { useWalletSession } from "@/app/components/wallet-provider";

interface ForumPost {
  id: string;
  proposalId: string;
  walletAddress: string;
  kind: "comment" | "discussion";
  message: string;
  createdAt: string;
}

interface ForumSummary {
  commentCount: number;
  discussionCount: number;
  ratingCount: number;
  averageRating: number;
}

function shortAddress(value: string): string {
  if (value.length <= 22) {
    return value;
  }
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

export function ProposalForum({
  proposalId,
  proposalTitle
}: {
  proposalId: string;
  proposalTitle: string;
}) {
  const { walletAddress } = useWalletSession();
  const [summary, setSummary] = useState<ForumSummary>({
    commentCount: 0,
    discussionCount: 0,
    ratingCount: 0,
    averageRating: 0
  });
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [kind, setKind] = useState<"comment" | "discussion">("comment");
  const [message, setMessage] = useState("");
  const [rating, setRating] = useState<number>(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setError(null);
    const response = await fetch(`/api/forum/threads?proposalId=${encodeURIComponent(proposalId)}`, {
      cache: "no-store"
    });
    const payload = (await response.json()) as {
      ok: boolean;
      posts?: ForumPost[];
      summary?: ForumSummary;
      error?: string;
    };
    if (!payload.ok) {
      setError(payload.error || "Failed to load forum data");
      return;
    }
    setPosts(payload.posts || []);
    setSummary(
      payload.summary || {
        commentCount: 0,
        discussionCount: 0,
        ratingCount: 0,
        averageRating: 0
      }
    );
  };

  useEffect(() => {
    load().catch(() => {
      setError("Failed to load forum data");
    });
  }, [proposalId]);

  const submitPost = async (event: FormEvent) => {
    event.preventDefault();
    if (!walletAddress || message.trim().length < 4) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/forum/threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          walletAddress,
          kind,
          message
        })
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!payload.ok) {
        setError(payload.error || "Failed to publish post");
        return;
      }
      setMessage("");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const submitRating = async (value: number) => {
    if (!walletAddress) {
      return;
    }
    setRating(value);
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/forum/ratings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposalId,
          walletAddress,
          rating: value
        })
      });
      const payload = (await response.json()) as { ok: boolean; error?: string };
      if (!payload.ok) {
        setError(payload.error || "Failed to submit rating");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card forum-card">
      <h2>Community Forum</h2>
      <p className="muted compact">
        Share comments/discussion for <strong>{proposalTitle}</strong> and rate project quality with connected wallet identity.
      </p>
      <div className="stats-grid">
        <article className="card stat-card">
          <p className="label">Comments</p>
          <p className="value">{summary.commentCount}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Discussions</p>
          <p className="value">{summary.discussionCount}</p>
        </article>
        <article className="card stat-card">
          <p className="label">Community Rating</p>
          <p className="value">{summary.averageRating.toFixed(2)} / 5</p>
        </article>
      </div>

      <section className="card">
        <h3>Rate This Proposal</h3>
        {!walletAddress ? (
          <p className="muted">Connect wallet first to rate.</p>
        ) : (
          <div className="actions">
            {[1, 2, 3, 4, 5].map((item) => (
              <button
                type="button"
                key={item}
                className={`btn btn-outline ${rating === item ? "btn-active" : ""}`}
                disabled={busy}
                onClick={() => submitRating(item)}
              >
                {item}★
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h3>Add Comment / Discussion</h3>
        {!walletAddress ? (
          <p className="muted">Connect wallet first to post.</p>
        ) : (
          <form className="filter-form" onSubmit={submitPost}>
            <label>
              Type
              <select value={kind} onChange={(event) => setKind(event.target.value as "comment" | "discussion")}>
                <option value="comment">Comment</option>
                <option value="discussion">Discussion</option>
              </select>
            </label>
            <label>
              Message
              <input
                type="text"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Share your thought..."
              />
            </label>
            <button type="submit" className="btn" disabled={busy || message.trim().length < 4}>
              Publish
            </button>
          </form>
        )}
      </section>

      <section className="card">
        <h3>Recent Threads</h3>
        {error ? <p className="muted">{error}</p> : null}
        {!posts.length ? (
          <p className="muted">No comment/discussion yet.</p>
        ) : (
          <div className="forum-list">
            {posts.map((post) => (
              <article className="proposal-list-item" key={post.id}>
                <div className="proposal-head">
                  <span className={`phase-pill ${post.kind === "discussion" ? "phase-upcoming" : "phase-ongoing"}`}>
                    {post.kind}
                  </span>
                  <span className="muted">{new Date(post.createdAt).toLocaleString()}</span>
                </div>
                <p className="compact"><strong>{shortAddress(post.walletAddress)}</strong></p>
                <p className="compact">{post.message}</p>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
