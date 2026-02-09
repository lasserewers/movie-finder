import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { WatchlistItem } from "../api/watchlist";
import MovieCard from "./MovieCard";

interface Props {
  open: boolean;
  onClose: () => void;
  items: WatchlistItem[];
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
}

type SortMode =
  | "added_desc"
  | "added_asc"
  | "release_desc"
  | "release_asc"
  | "title_asc"
  | "title_desc";
type MediaFilter = "all" | "movie" | "tv";

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: "added_desc", label: "Recently Added" },
  { value: "added_asc", label: "Oldest Added" },
  { value: "release_desc", label: "Release Date: Newest" },
  { value: "release_asc", label: "Release Date: Oldest" },
  { value: "title_asc", label: "Title: A to Z" },
  { value: "title_desc", label: "Title: Z to A" },
];

function toTimestamp(value?: string | null): number | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export default function WatchlistOverlay({ open, onClose, items, onSelectMovie }: Props) {
  const [sortMode, setSortMode] = useState<SortMode>("added_desc");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");

  const sortedItems = useMemo(() => {
    const list = items.filter((item) => (mediaFilter === "all" ? true : item.media_type === mediaFilter));
    list.sort((a, b) => {
      if (sortMode === "title_asc" || sortMode === "title_desc") {
        const direction = sortMode === "title_asc" ? 1 : -1;
        return a.title.localeCompare(b.title) * direction;
      }

      if (sortMode === "release_desc" || sortMode === "release_asc") {
        const direction = sortMode === "release_asc" ? 1 : -1;
        const aRelease = toTimestamp(a.release_date);
        const bRelease = toTimestamp(b.release_date);
        if (aRelease === null && bRelease === null) return 0;
        if (aRelease === null) return 1;
        if (bRelease === null) return -1;
        return (aRelease - bRelease) * direction;
      }

      const direction = sortMode === "added_asc" ? 1 : -1;
      const aAdded = toTimestamp(a.created_at);
      const bAdded = toTimestamp(b.created_at);
      if (aAdded === null && bAdded === null) return 0;
      if (aAdded === null) return 1;
      if (bAdded === null) return -1;
      return (aAdded - bAdded) * direction;
    });
    return list;
  }, [items, sortMode, mediaFilter]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[290] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            className="relative w-[min(1100px,94vw)] max-h-[90vh] flex flex-col bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="flex items-start justify-between gap-3 p-6 sm:p-8 pb-0 sm:pb-0 max-sm:flex-col max-sm:items-stretch">
              <div className="min-w-0">
                <h3 className="font-display text-2xl">Your Watchlist</h3>
                <p className="text-sm text-muted mt-1">
                  {items.length} {items.length === 1 ? "title" : "titles"} saved
                </p>
              </div>
              <div className="flex items-start justify-between gap-2 max-sm:w-full">
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <label htmlFor="watchlist-sort" className="text-xs text-muted uppercase tracking-wide whitespace-nowrap">
                      Sort by
                    </label>
                    <select
                      id="watchlist-sort"
                      value={sortMode}
                      onChange={(e) => setSortMode(e.target.value as SortMode)}
                      className="h-9 px-3 border border-border rounded-full bg-panel text-text text-sm outline-none focus:border-accent-2 transition-colors"
                    >
                      {SORT_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex w-full items-center rounded-full border border-border bg-panel overflow-hidden h-9">
                    <button
                      onClick={() => setMediaFilter("all")}
                      className={`flex-1 h-full px-2 text-xs sm:text-sm transition-colors ${
                        mediaFilter === "all" ? "bg-accent/15 text-text" : "text-muted hover:text-text"
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setMediaFilter("movie")}
                      className={`flex-1 h-full px-2 text-xs sm:text-sm transition-colors ${
                        mediaFilter === "movie" ? "bg-accent/15 text-text" : "text-muted hover:text-text"
                      }`}
                    >
                      Movies
                    </button>
                    <button
                      onClick={() => setMediaFilter("tv")}
                      className={`flex-1 h-full px-2 text-xs sm:text-sm transition-colors ${
                        mediaFilter === "tv" ? "bg-accent/15 text-text" : "text-muted hover:text-text"
                      }`}
                    >
                      TV Shows
                    </button>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
                >
                  &times;
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6 sm:p-8 pt-4 sm:pt-4">
              {sortedItems.length === 0 ? (
                <div className="text-sm text-muted py-8">
                  {items.length === 0
                    ? "Your watchlist is empty."
                    : "No titles match this filter."}
                </div>
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
                  {sortedItems.map((item, i) => (
                    <MovieCard
                      key={`${item.media_type}:${item.tmdb_id}`}
                      id={item.tmdb_id}
                      title={item.title}
                      posterPath={item.poster_path || undefined}
                      releaseDate={item.release_date || undefined}
                      onClick={onSelectMovie}
                      index={i}
                      fill
                      mediaType={item.media_type}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
