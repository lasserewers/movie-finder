import { apiFetch } from "./client";

export type WatchedMediaType = "movie" | "tv";

export interface WatchedItem {
  id: string;
  tmdb_id: number;
  media_type: WatchedMediaType;
  title: string;
  poster_path?: string | null;
  release_date?: string | null;
  watched_at?: string | null;
  created_at?: string | null;
}

export interface AddWatchedItemInput {
  tmdb_id: number;
  media_type: WatchedMediaType;
  title: string;
  poster_path?: string;
  release_date?: string;
}

export async function getWatched(limit = 500): Promise<WatchedItem[]> {
  const data = await apiFetch<{ results?: WatchedItem[] }>(
    `/api/watched?limit=${Math.max(1, Math.min(2000, limit))}`
  );
  return data.results || [];
}

export async function addWatchedItem(
  input: AddWatchedItemInput
): Promise<{ item: WatchedItem; already_exists: boolean }> {
  return apiFetch("/api/watched", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeWatchedItem(
  mediaType: WatchedMediaType,
  tmdbId: number
): Promise<{ removed: boolean }> {
  return apiFetch(`/api/watched/${mediaType}/${tmdbId}`, {
    method: "DELETE",
  });
}
