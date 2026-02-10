import { ApiError, apiFetch } from "./client";

export type ListMediaType = "movie" | "tv";

export interface UserListSummary {
  id: string;
  name: string;
  item_count: number;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface UserListItem {
  id: string;
  tmdb_id: number;
  media_type: ListMediaType;
  title: string;
  poster_path?: string | null;
  release_date?: string | null;
  sort_index?: number;
  created_at?: string | null;
}

export interface AddListItemInput {
  tmdb_id: number;
  media_type: ListMediaType;
  title: string;
  poster_path?: string;
  release_date?: string;
}

export async function getLists(): Promise<UserListSummary[]> {
  const data = await apiFetch<{ results?: UserListSummary[] }>("/api/lists");
  return data.results || [];
}

export async function createList(name: string): Promise<{ list: UserListSummary }> {
  return apiFetch("/api/lists", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function renameList(listId: string, name: string): Promise<{ list: UserListSummary }> {
  return apiFetch(`/api/lists/${encodeURIComponent(listId)}`, {
    method: "PUT",
    body: JSON.stringify({ name }),
  });
}

export async function deleteList(listId: string): Promise<{ removed: boolean }> {
  return apiFetch(`/api/lists/${encodeURIComponent(listId)}`, {
    method: "DELETE",
  });
}

export async function getListItems(
  listId: string,
  limit = 500
): Promise<{ list: UserListSummary; results: UserListItem[] }> {
  const safeLimit = Math.max(1, Math.min(2000, limit));
  return apiFetch(`/api/lists/${encodeURIComponent(listId)}/items?limit=${safeLimit}`);
}

export async function addItemToList(
  listId: string,
  input: AddListItemInput
): Promise<{ item: UserListItem; already_exists: boolean }> {
  return apiFetch(`/api/lists/${encodeURIComponent(listId)}/items`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function removeItemFromList(
  listId: string,
  mediaType: ListMediaType,
  tmdbId: number
): Promise<{ removed: boolean }> {
  return apiFetch(`/api/lists/${encodeURIComponent(listId)}/items/${mediaType}/${tmdbId}`, {
    method: "DELETE",
  });
}

export async function reorderListItems(
  listId: string,
  itemIds: string[]
): Promise<{ ok: boolean }> {
  const path = `/api/lists/${encodeURIComponent(listId)}/items/reorder`;
  const payload = JSON.stringify({ item_ids: itemIds });
  try {
    return await apiFetch(path, {
      method: "PUT",
      body: payload,
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 405) {
      return apiFetch(path, {
        method: "POST",
        body: payload,
      });
    }
    throw err;
  }
}

export async function getTitleMemberships(
  mediaType: ListMediaType,
  tmdbId: number
): Promise<Set<string>> {
  const data = await apiFetch<{ list_ids?: string[] }>(
    `/api/lists/memberships?media_type=${mediaType}&tmdb_id=${tmdbId}`
  );
  return new Set((data.list_ids || []).map((value) => String(value)));
}
