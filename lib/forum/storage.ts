import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type ForumPostKind = "comment" | "discussion";

export interface ForumPost {
  id: string;
  proposalId: string;
  walletAddress: string;
  kind: ForumPostKind;
  message: string;
  createdAt: string;
}

export interface ForumRating {
  id: string;
  proposalId: string;
  walletAddress: string;
  rating: number;
  createdAt: string;
  updatedAt: string;
}

interface ForumDb {
  posts: ForumPost[];
  ratings: ForumRating[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const FORUM_FILE = path.join(DATA_DIR, "forum.json");

function sanitizeWallet(value: string): string {
  return value.trim();
}

function sanitizeMessage(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function readForumDb(): Promise<ForumDb> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(FORUM_FILE, "utf8");
    const parsed = JSON.parse(raw) as ForumDb;
    return {
      posts: Array.isArray(parsed.posts) ? parsed.posts : [],
      ratings: Array.isArray(parsed.ratings) ? parsed.ratings : []
    };
  } catch {
    return { posts: [], ratings: [] };
  }
}

async function writeForumDb(db: ForumDb): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(FORUM_FILE, JSON.stringify(db, null, 2), "utf8");
}

export async function listForumPosts(proposalId: string): Promise<ForumPost[]> {
  const db = await readForumDb();
  return db.posts
    .filter((item) => item.proposalId === proposalId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function listRatings(proposalId: string): Promise<ForumRating[]> {
  const db = await readForumDb();
  return db.ratings
    .filter((item) => item.proposalId === proposalId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function addForumPost(input: {
  proposalId: string;
  walletAddress: string;
  kind: ForumPostKind;
  message: string;
}): Promise<ForumPost> {
  const db = await readForumDb();
  const now = new Date().toISOString();
  const post: ForumPost = {
    id: crypto.randomUUID(),
    proposalId: input.proposalId,
    walletAddress: sanitizeWallet(input.walletAddress),
    kind: input.kind,
    message: sanitizeMessage(input.message),
    createdAt: now
  };

  db.posts.push(post);
  await writeForumDb(db);
  return post;
}

export async function upsertRating(input: {
  proposalId: string;
  walletAddress: string;
  rating: number;
}): Promise<ForumRating> {
  const db = await readForumDb();
  const now = new Date().toISOString();
  const walletAddress = sanitizeWallet(input.walletAddress);
  const existing = db.ratings.find(
    (item) => item.proposalId === input.proposalId && item.walletAddress === walletAddress
  );

  if (existing) {
    existing.rating = input.rating;
    existing.updatedAt = now;
    await writeForumDb(db);
    return existing;
  }

  const rating: ForumRating = {
    id: crypto.randomUUID(),
    proposalId: input.proposalId,
    walletAddress,
    rating: input.rating,
    createdAt: now,
    updatedAt: now
  };
  db.ratings.push(rating);
  await writeForumDb(db);
  return rating;
}
