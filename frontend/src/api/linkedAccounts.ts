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

export type LetterboxdListSyncStatus = Exclude<LetterboxdSyncStatus, null> | "conflict";

export interface LetterboxdSyncState {
  username: string | null;
  status: LetterboxdSyncStatus;
  message: string | null;
  last_sync_at: string | null;
}

export interface LetterboxdSyncResult {
  ok: boolean;
  status: Exclude<LetterboxdSyncStatus, null>;
  username: string | null;
  message: string;
  total_items: number;
  added_count: number;
  already_exists_count: number;
  unmatched_count: number;
}

export interface LetterboxdExportListSummary {
  name: string;
  item_count: number;
}

export interface LetterboxdListPreviewResult {
  ok: boolean;
  username: string | null;
  total_lists: number;
  total_items: number;
  lists: LetterboxdExportListSummary[];
}

export type LetterboxdListSyncScope = "all" | "selected";
export type LetterboxdListConflictMode = "skip" | "merge" | "overwrite";

export interface LetterboxdListSyncResult {
  ok: boolean;
  status: LetterboxdListSyncStatus;
  username: string | null;
  message: string;
  scope: LetterboxdListSyncScope;
  conflict_mode: LetterboxdListConflictMode | null;
  conflict_names: string[];
  total_lists: number;
  created_lists_count: number;
  merged_lists_count: number;
  overwritten_lists_count: number;
  skipped_conflicts_count: number;
  total_items: number;
  added_count: number;
  already_exists_count: number;
  unmatched_count: number;
}

export async function getLetterboxdSyncState(): Promise<LetterboxdSyncState> {
  return apiFetch<LetterboxdSyncState>("/api/watchlist/sync/letterboxd/status");
}

function buildLetterboxdExportForm(zipFile: File, extra?: Record<string, string>): FormData {
  const form = new FormData();
  form.append("file", zipFile, zipFile.name || "letterboxd-export.zip");
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      form.append(key, value);
    }
  }
  return form;
}

export async function previewLetterboxdLists(zipFile: File): Promise<LetterboxdListPreviewResult> {
  return apiFetch<LetterboxdListPreviewResult>("/api/lists/sync/letterboxd/preview", {
    method: "POST",
    body: buildLetterboxdExportForm(zipFile),
    timeoutMs: 120000,
  });
}

export async function syncLetterboxdWatchlist(zipFile: File): Promise<LetterboxdSyncResult> {
  return apiFetch<LetterboxdSyncResult>("/api/watchlist/sync/letterboxd", {
    method: "POST",
    body: buildLetterboxdExportForm(zipFile),
    // Large watchlists can take longer due to TMDB title matching.
    timeoutMs: 600000,
  });
}

export async function syncLetterboxdWatchedTitles(zipFile: File): Promise<LetterboxdSyncResult> {
  return apiFetch<LetterboxdSyncResult>("/api/watched/sync/letterboxd", {
    method: "POST",
    body: buildLetterboxdExportForm(zipFile),
    // Watched histories can be very large.
    timeoutMs: 1200000,
  });
}

export async function syncLetterboxdLists(
  zipFile: File,
  options: {
    scope: LetterboxdListSyncScope;
    selectedListNames?: string[];
    conflictMode?: LetterboxdListConflictMode | null;
  }
): Promise<LetterboxdListSyncResult> {
  const form = buildLetterboxdExportForm(zipFile, {
    list_scope: options.scope,
    selected_lists: JSON.stringify(options.selectedListNames || []),
    ...(options.conflictMode ? { conflict_mode: options.conflictMode } : {}),
  });
  return apiFetch<LetterboxdListSyncResult>("/api/lists/sync/letterboxd", {
    method: "POST",
    body: form,
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
