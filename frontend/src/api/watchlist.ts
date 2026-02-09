import { apiFetch } from "./client";

export type WatchlistMediaType = "movie" | "tv";

export interface WatchlistItem {
  id: string;
  tmdb_id: number;
  media_type: WatchlistMediaType;
  title: string;
  poster_path?: string | null;
  release_date?: string | null;
  created_at?: string | null;
}

export interface AddWatchlistItemInput {
  tmdb_id: number;
  media_type: WatchlistMediaType;
  title: string;
  poster_path?: string;
  release_date?: string;
}

export async function getWatchlist(limit = 500): Promise<WatchlistItem[]> {
  const data = await apiFetch<{ results?: WatchlistItem[] }>(
    `/api/watchlist?limit=${Math.max(1, Math.min(2000, limit))}`
  );
  return data.results || [];
}

export async function addWatchlistItem(
  input: AddWatchlistItemInput
): Promise<{ item: WatchlistItem; already_exists: boolean }> {
  return apiFetch("/api/watchlist", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeWatchlistItem(
  mediaType: WatchlistMediaType,
  tmdbId: number
): Promise<{ removed: boolean }> {
  return apiFetch(`/api/watchlist/${mediaType}/${tmdbId}`, {
    method: "DELETE",
  });
}
