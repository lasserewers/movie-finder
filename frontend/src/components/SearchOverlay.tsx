import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { searchFiltered, searchFilteredPage, searchMovies, searchPage, type Movie, type MediaType } from "../api/movies";
import { ApiError } from "../api/client";
import { useConfig } from "../hooks/useConfig";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import MovieCard from "./MovieCard";
import Spinner from "./Spinner";

type SortKey = "relevance" | "popularity" | "newest" | "oldest";
type ContentMode = "all" | "available" | "streamable";

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "popularity", label: "Popularity" },
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

const DATE_SORTS: Set<SortKey> = new Set(["newest", "oldest"]);

const CONTENT_MODE_LABEL: Record<ContentMode, string> = {
  all: "All content",
  available: "Available",
  streamable: "Streamable",
};

interface Props {
  open: boolean;
  query: string;
  filtered: boolean;
  vpnEnabled?: boolean;
  isLoggedIn?: boolean;
  initialContentMode?: ContentMode;
  onClose: () => void;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
}

export default function SearchOverlay({
  open,
  query,
  filtered,
  vpnEnabled = false,
  isLoggedIn = false,
  initialContentMode,
  onClose,
  onSelectMovie,
}: Props) {
  const INITIAL_BATCH = 36;
  const MORE_BATCH = 30;
  const PAGE_LIMIT = 20;
  const { providerIds, countries } = useConfig();
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);
  const pageRef = useRef(1);
  const totalPagesRef = useRef<number | null>(null);
  const seenRef = useRef(new Set<string>());
  const bufferRef = useRef<Movie[]>([]);
  const resultsRef = useRef(0);
  const versionRef = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelEl, setPanelEl] = useState<HTMLDivElement | null>(null);

  // Local controls
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [localVpn, setLocalVpn] = useState(vpnEnabled);
  const [contentMode, setContentMode] = useState<ContentMode>(
    initialContentMode ?? (filtered ? "streamable" : "all")
  );
  const [localMediaType, setLocalMediaType] = useState<MediaType>("mix");

  const effectiveFiltered = contentMode !== "all";
  const effectiveIncludePaid = contentMode === "available";

  const setPanelNode = useCallback((node: HTMLDivElement | null) => {
    panelRef.current = node;
    setPanelEl(node);
  }, []);

  const resetState = useCallback(() => {
    versionRef.current += 1;
    setResults([]);
    setHasMore(true);
    setLoading(false);
    hasMoreRef.current = true;
    loadingRef.current = false;
    pageRef.current = 1;
    totalPagesRef.current = null;
    seenRef.current = new Set();
    bufferRef.current = [];
    resultsRef.current = 0;
  }, []);

  // Track whether the open effect just fired, so the controls effect can skip
  const justOpenedRef = useRef(false);

  // Reset local controls and trigger fetch when overlay opens or key props change
  useEffect(() => {
    if (!open) return;
    justOpenedRef.current = true;
    setLocalVpn(filtered ? vpnEnabled : false);
    setContentMode(initialContentMode ?? (filtered ? "streamable" : "all"));
    setSortKey("relevance");
    setLocalMediaType("mix");
    resetState();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHasMore(false);
      return;
    }
    const mode = initialContentMode ?? (filtered ? "streamable" : "all");
    if (mode !== "all" && providerIds.size === 0) {
      setHasMore(false);
      return;
    }
    loadMore();
  }, [open, query, resetState]);

  // Re-fetch when user changes local controls while overlay is already open
  useEffect(() => {
    if (!open) return;
    // Skip if the open effect just fired — it already handles the initial fetch.
    // The open effect sets contentMode/localVpn which triggers this effect on the
    // next render; we must not double-fetch.
    if (justOpenedRef.current) {
      justOpenedRef.current = false;
      return;
    }
    resetState();
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHasMore(false);
      return;
    }
    if (effectiveFiltered && providerIds.size === 0) {
      setHasMore(false);
      return;
    }
    loadMore();
  }, [contentMode, localVpn, localMediaType, countries, providerIds]);

  useEffect(() => {
    resultsRef.current = results.length;
  }, [results.length]);

  // Client-side sorting
  const sortedResults = useMemo(() => {
    if (sortKey === "relevance") return results;
    const sorted = [...results];
    switch (sortKey) {
      case "popularity":
        sorted.sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
        break;
      case "newest":
        sorted.sort((a, b) => {
          if (!a.release_date && !b.release_date) return 0;
          if (!a.release_date) return 1;
          if (!b.release_date) return -1;
          return b.release_date.localeCompare(a.release_date);
        });
        break;
      case "oldest":
        sorted.sort((a, b) => {
          if (!a.release_date && !b.release_date) return 0;
          if (!a.release_date) return 1;
          if (!b.release_date) return -1;
          return a.release_date.localeCompare(b.release_date);
        });
        break;
    }
    return sorted;
  }, [results, sortKey]);

  const loadMore = useCallback(async () => {
    if (!open || loadingRef.current) {
      console.log("[loadMore] bail: open=%s loadingRef=%s", open, loadingRef.current);
      return;
    }
    if (!hasMoreRef.current) {
      console.log("[loadMore] bail: hasMoreRef=false");
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    const version = versionRef.current;
    loadingRef.current = true;
    setLoading(true);
    try {
      const target = resultsRef.current === 0 ? INITIAL_BATCH : MORE_BATCH;
      const pageLimit = localMediaType === "mix" ? 40 : PAGE_LIMIT;
      console.log("[loadMore] start: page=%d target=%d pageLimit=%d resultsRef=%d version=%d", pageRef.current, target, pageLimit, resultsRef.current, version);
      const newlyAdded: Movie[] = [];

      if (bufferRef.current.length > 0) {
        const take = Math.min(target, bufferRef.current.length);
        newlyAdded.push(...bufferRef.current.splice(0, take));
      }

      let remaining = target - newlyAdded.length;
      let page = pageRef.current;
      let totalPages = totalPagesRef.current;
      let lastPageCount = 0;
      let fetchedPages = 0;

      const fetchPage = async (limit: number) => {
        const ids = Array.from(providerIds);
        if (localMediaType === "mix") {
          if (effectiveFiltered) {
            const [movieData, tvData] = await Promise.all([
              searchFilteredPage(trimmed, page, ids, "movie", limit, countries, localVpn, effectiveIncludePaid),
              searchFilteredPage(trimmed, page, ids, "tv", limit, countries, localVpn, effectiveIncludePaid),
            ]);
            const combined = [
              ...(movieData.results || []),
              ...(tvData.results || []),
            ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
            return {
              results: combined,
              total_pages: Math.max(movieData.total_pages || 0, tvData.total_pages || 0),
            };
          }
          const [movieData, tvData] = await Promise.all([
            searchPage(trimmed, page, "movie", limit),
            searchPage(trimmed, page, "tv", limit),
          ]);
          const combined = [
            ...(movieData.results || []),
            ...(tvData.results || []),
          ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
          return {
            results: combined,
            total_pages: Math.max(movieData.total_pages || 0, tvData.total_pages || 0),
          };
        }
        if (effectiveFiltered) {
          return await searchFilteredPage(
            trimmed,
            page,
            ids,
            localMediaType,
            limit,
            countries,
            localVpn,
            effectiveIncludePaid
          );
        }
        return await searchPage(trimmed, page, localMediaType, limit);
      };

      while (remaining > 0) {
        if (version !== versionRef.current) return;
        if (totalPages && page > totalPages) break;
        let data: { results?: Movie[]; total_pages?: number } = {};
        try {
          try {
            data = await fetchPage(pageLimit);
          } catch (err) {
            if (err instanceof ApiError && err.status === 422 && pageLimit > 20) {
              data = await fetchPage(20);
            } else {
              throw err;
            }
          }
        } catch (err) {
          if (err instanceof ApiError && err.status === 404 && page === 1) {
            try {
              const fallbackLimit = Math.min(pageLimit, 20);
              let fallbackItems: Movie[] = [];
              if (localMediaType === "mix") {
                const [movieFallback, tvFallback] = effectiveFiltered
                  ? await Promise.all([
                      searchFiltered(trimmed, Array.from(providerIds), "movie", {
                        limit: fallbackLimit,
                        countries,
                        vpn: localVpn,
                        includePaid: effectiveIncludePaid,
                      }),
                      searchFiltered(trimmed, Array.from(providerIds), "tv", {
                        limit: fallbackLimit,
                        countries,
                        vpn: localVpn,
                        includePaid: effectiveIncludePaid,
                      }),
                    ])
                  : await Promise.all([
                      searchMovies(trimmed, "movie", fallbackLimit),
                      searchMovies(trimmed, "tv", fallbackLimit),
                    ]);
                fallbackItems = [
                  ...(movieFallback.results || []),
                  ...(tvFallback.results || []),
                ].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));
              } else {
                const fallback = effectiveFiltered
                  ? await searchFiltered(trimmed, Array.from(providerIds), localMediaType, {
                      limit: fallbackLimit,
                      countries,
                      vpn: localVpn,
                      includePaid: effectiveIncludePaid,
                    })
                  : await searchMovies(trimmed, localMediaType, fallbackLimit);
                fallbackItems = fallback.results || [];
              }
              if (version !== versionRef.current) return;
              const items = fallbackItems.filter((m) => {
                const key = `${m.media_type || localMediaType}:${m.id}`;
                if (seenRef.current.has(key)) return false;
                seenRef.current.add(key);
                return true;
              });
              setResults((prev) => [...prev, ...items]);
            } catch {
              // Ignore fallback failures
            }
            if (version !== versionRef.current) return;
            hasMoreRef.current = false;
            setHasMore(false);
            return;
          }
          throw err;
        }

        fetchedPages += 1;
        const pageResults = data.results || [];
        lastPageCount = pageResults.length;
        if (typeof data.total_pages === "number") {
          totalPagesRef.current = data.total_pages;
          totalPages = data.total_pages;
        }

        for (const m of pageResults) {
          const key = `${m.media_type || localMediaType}:${m.id}`;
          if (seenRef.current.has(key)) continue;
          seenRef.current.add(key);
          if (remaining > 0) {
            newlyAdded.push(m);
            remaining -= 1;
          } else {
            bufferRef.current.push(m);
          }
        }

        page += 1;
        if (!totalPages && lastPageCount < pageLimit) break;
      }

      // If a reset happened while we were fetching, discard these results
      if (version !== versionRef.current) {
        console.log("[loadMore] stale version, discarding results");
        return;
      }

      pageRef.current = page;
      if (newlyAdded.length > 0) {
        setResults((prev) => [...prev, ...newlyAdded]);
      }

      const nextHasMore =
        bufferRef.current.length > 0 ||
        lastPageCount >= pageLimit ||
        (totalPagesRef.current
          ? page <= totalPagesRef.current
          : fetchedPages === 0
            ? hasMoreRef.current
            : lastPageCount >= pageLimit);
      console.log("[loadMore] done: added=%d buffer=%d lastPageCount=%d pageLimit=%d totalPages=%s nextPage=%d fetchedPages=%d nextHasMore=%s totalResults=%d",
        newlyAdded.length, bufferRef.current.length, lastPageCount, pageLimit,
        totalPagesRef.current, page, fetchedPages, nextHasMore,
        (resultsRef.current || 0) + newlyAdded.length);
      hasMoreRef.current = nextHasMore;
      setHasMore(nextHasMore);
    } catch (err) {
      console.error("[loadMore] error:", err);
      if (version !== versionRef.current) return;
      hasMoreRef.current = false;
      setHasMore(false);
    } finally {
      if (version === versionRef.current) {
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, [open, query, effectiveFiltered, effectiveIncludePaid, providerIds, localMediaType, countries, localVpn]);

  const handleScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const el = event.currentTarget;
      if (loadingRef.current || !hasMoreRef.current) return;
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 240) {
        loadMore();
      }
    },
    [loadMore]
  );

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loading, panelEl);

  // Auto-fill panel and continue loading when scrolled near bottom
  useEffect(() => {
    if (!panelEl) return;
    if (loadingRef.current || !hasMoreRef.current) return;
    const el = panelEl;
    if (
      el.scrollHeight <= el.clientHeight + 100 ||
      el.scrollTop + el.clientHeight >= el.scrollHeight - 300
    ) {
      loadMore();
    }
  }, [panelEl, results.length, loading, hasMore, loadMore]);

  // Auto-prefetch more results when a date sort is selected so there's a useful pool to sort from
  const SORT_PREFETCH_TARGET = 150;
  useEffect(() => {
    if (!open || !DATE_SORTS.has(sortKey)) return;
    if (loadingRef.current || !hasMoreRef.current) return;
    if (resultsRef.current < SORT_PREFETCH_TARGET) {
      loadMore();
    }
  }, [open, sortKey, results.length, loadMore]);

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
            <div className="flex items-start justify-between p-6 sm:p-8 pb-0 sm:pb-0">
              <div>
                <h3 className="font-display text-2xl">Search results</h3>
                <p className="text-sm text-muted mt-1">
                  {contentMode === "streamable"
                    ? "Streamable on your services"
                    : contentMode === "available"
                      ? "Available on your services"
                      : "All results"
                  } for &ldquo;{query.trim()}&rdquo;
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            {/* Toolbar */}
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-6 sm:px-8 pt-4 pb-2">
              {/* Media type segmented control */}
              <div className="flex h-[36px] border border-border rounded-full overflow-hidden bg-panel">
                {([["mix", "All"], ["movie", "Movies"], ["tv", "TV Shows"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    onClick={() => setLocalMediaType(value)}
                    className={`px-3 sm:px-4 text-sm transition-colors whitespace-nowrap ${
                      localMediaType === value
                        ? "bg-accent/15 text-text font-medium"
                        : "text-muted hover:text-text"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Row 1 on mobile: sort + load more | Row on desktop: sort + load more + spacer + vpn + content */}
              <div className="flex items-center gap-2 max-sm:w-full">
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="h-[36px] px-3 border border-border rounded-full bg-panel text-text text-sm outline-none appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat cursor-pointer"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, paddingRight: "32px" }}
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {DATE_SORTS.has(sortKey) && hasMore && (
                  <button
                    onClick={() => loadMore()}
                    disabled={loading}
                    className="h-[36px] px-4 border border-border rounded-full text-sm text-muted hover:text-text hover:border-accent-2 transition-colors disabled:opacity-40 whitespace-nowrap"
                  >
                    {loading ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>

              <div className="flex-1 max-sm:hidden" />

              {isLoggedIn && (
                <div className="flex items-center gap-2 max-sm:w-full">
                  <button
                    onClick={() => setLocalVpn((prev) => !prev)}
                    aria-pressed={localVpn}
                    className={`h-[36px] px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 max-sm:flex-1 ${
                      localVpn
                        ? "border-accent/60 bg-accent/10 text-text"
                        : "border-border bg-panel text-muted"
                    }`}
                  >
                    <span className="truncate">{localVpn ? "Using VPN" : "Not using VPN"}</span>
                    <span
                      className={`relative h-4 w-8 flex-shrink-0 rounded-full border transition-colors ${
                        localVpn
                          ? "bg-accent border-accent"
                          : "bg-panel-2 border-border"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white transition-transform ${
                          localVpn ? "translate-x-[14px]" : ""
                        }`}
                      />
                    </span>
                  </button>

                  <button
                    onClick={() => {
                      const next: ContentMode =
                        contentMode === "all"
                          ? "available"
                          : contentMode === "available"
                            ? "streamable"
                            : "all";
                      if (providerIds.size === 0 && next !== "all") return;
                      setContentMode(next);
                    }}
                    className={`h-[36px] px-3 border rounded-full text-sm transition-colors flex items-center justify-between gap-3 max-sm:flex-1 ${
                      contentMode === "streamable"
                        ? "border-accent/60 bg-accent/10 text-text"
                        : contentMode === "available"
                          ? "border-accent/40 bg-accent/5 text-text"
                          : "border-border bg-panel text-text"
                    }`}
                  >
                    <span className="truncate">{CONTENT_MODE_LABEL[contentMode]}</span>
                    <span
                      className={`relative h-4 w-10 flex-shrink-0 rounded-full border overflow-hidden transition-colors ${
                        contentMode === "all"
                          ? "bg-panel-2 border-border"
                          : "bg-accent border-accent"
                      }`}
                    >
                      <span className={`absolute left-[7px] top-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${contentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                      <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${contentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                      <span className={`absolute right-[7px] top-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${contentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                      <span
                        className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white transition-transform ${
                          contentMode === "available"
                            ? "translate-x-[12px]"
                            : contentMode === "streamable"
                              ? "translate-x-[24px]"
                              : ""
                        }`}
                      />
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div
              ref={setPanelNode}
              onScroll={handleScroll}
              className="flex-1 overflow-auto p-6 sm:p-8 pt-2 sm:pt-2"
            >
              {effectiveFiltered && providerIds.size === 0 ? (
                <div className="text-center text-muted py-12">
                  Select streaming services to see streamable results.
                </div>
              ) : (
                <>
                  {loading && results.length === 0 ? (
                    <div className="flex justify-center py-12">
                      <Spinner />
                    </div>
                  ) : results.length === 0 ? (
                    <div className="text-center text-muted py-12">
                      No results found.
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
                        {sortedResults.map((m, i) => (
                          <MovieCard
                            key={m.id}
                            id={m.id}
                            title={m.title}
                            posterPath={m.poster_path}
                            posterUrl={m.poster_url}
                            releaseDate={m.release_date}
                            onClick={(id, mt) => {
                              onSelectMovie(id, mt);
                              onClose();
                            }}
                            index={i}
                            fill
                            mediaType={m.media_type}
                          />
                        ))}
                      </div>

                      {(loading || hasMore) && (
                        <div ref={sentinelRef} className="flex justify-center py-6">
                          <Spinner />
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
