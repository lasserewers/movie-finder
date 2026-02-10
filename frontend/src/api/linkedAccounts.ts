import { apiFetch } from "./client";

export type LetterboxdSyncStatus =
  | "ok"
  | "empty"
  | "no_matches"
  | "private"
  | "not_found"
  | "blocked"
  | "unreachable"
  | null;

export interface LetterboxdSyncState {
  username: string | null;
  status: LetterboxdSyncStatus;
  message: string | null;
  last_sync_at: string | null;
}

export interface LetterboxdSyncResult {
  ok: boolean;
  status: Exclude<LetterboxdSyncStatus, null>;
  username: string;
  message: string;
  total_items: number;
  added_count: number;
  already_exists_count: number;
  unmatched_count: number;
}

export async function getLetterboxdSyncState(): Promise<LetterboxdSyncState> {
  return apiFetch<LetterboxdSyncState>("/api/watchlist/sync/letterboxd/status");
}

export async function syncLetterboxdWatchlist(username: string): Promise<LetterboxdSyncResult> {
  return apiFetch<LetterboxdSyncResult>("/api/watchlist/sync/letterboxd", {
    method: "POST",
    body: JSON.stringify({ username }),
    // Large watchlists can take longer due to TMDB title matching.
    timeoutMs: 600000,
  });
}

export async function syncLetterboxdWatchedTitles(username: string): Promise<LetterboxdSyncResult> {
  return apiFetch<LetterboxdSyncResult>("/api/watched/sync/letterboxd", {
    method: "POST",
    body: JSON.stringify({ username }),
    // Watched histories can be very large.
    timeoutMs: 1200000,
  });
}

export interface LetterboxdUnlinkResult extends LetterboxdSyncState {
  ok: boolean;
}

export async function unlinkLetterboxdWatchlist(): Promise<LetterboxdUnlinkResult> {
  return apiFetch<LetterboxdUnlinkResult>("/api/watchlist/sync/letterboxd", {
    method: "DELETE",
  });
}
