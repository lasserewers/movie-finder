import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { type Movie } from "../api/movies";
import { useConfig } from "../hooks/useConfig";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  onSelectMovie: (movieId: number, mediaType?: "movie" | "tv") => void;
  showFilterToggle?: boolean;
  onOpenSettings?: () => void;
  vpnEnabled?: boolean;
  onSubmitSearch?: (query: string, filtered: boolean) => void;
  onQueryChange?: (query: string) => void;
}

export default function SearchBar({
  onSelectMovie,
  showFilterToggle = true,
  onOpenSettings,
  vpnEnabled = false,
  onSubmitSearch,
  onQueryChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterOn, setFilterOn] = useState(false);
  const { providerIds, countries } = useConfig();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const autoOpenRef = useRef(true);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  function doSearch(q: string, filtered: boolean) {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (q.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timeout = window.setTimeout(() => controller.abort(), 12000);

    const canFilter = showFilterToggle;
    const ids = filtered && canFilter ? Array.from(providerIds) : [];
    const scopedCountries = filtered && canFilter && !vpnEnabled && countries.length
      ? `&countries=${encodeURIComponent(countries.join(","))}`
      : "";
    const vpnParam = filtered && canFilter && vpnEnabled ? "&vpn=1" : "";
    const limitParam = "&limit=10";
    const url = filtered && canFilter && ids.length
      ? `/api/search_filtered?q=${encodeURIComponent(q)}&provider_ids=${ids.join(",")}&media_type=mix${limitParam}${vpnParam}${scopedCountries}`
      : `/api/search?q=${encodeURIComponent(q)}&media_type=mix${limitParam}`;

    fetch(url, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        window.clearTimeout(timeout);
        if (controller.signal.aborted) return;
        setResults(data.results?.slice(0, 10) || []);
        if (autoOpenRef.current) setOpen(true);
        setLoading(false);
      })
      .catch((err) => {
        window.clearTimeout(timeout);
        if (err.name === "AbortError") {
          if (abortRef.current === controller) setLoading(false);
          return;
        }
        setResults([]);
        setLoading(false);
      });
  }

  const handleInput = (value: string) => {
    setQuery(value);
    onQueryChange?.(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      autoOpenRef.current = true;
      doSearch(value.trim(), showFilterToggle && filterOn);
    }, 300);
  };

  // Re-search when config changes - don't auto-open dropdown
  useEffect(() => {
    const q = query.trim();
    if (q.length >= 2) {
      autoOpenRef.current = false;
      doSearch(q, showFilterToggle && filterOn);
    }
  }, [showFilterToggle, filterOn, vpnEnabled, countries, providerIds]);

  const handleFilterToggle = () => {
    // If user has no services and tries to enable filter, open settings instead
    if (!filterOn && providerIds.size === 0 && onOpenSettings) {
      onOpenSettings();
      return;
    }
    const next = !filterOn;
    setFilterOn(next);
    inputRef.current?.focus();
    const q = query.trim();
    if (q.length >= 2) {
      autoOpenRef.current = true;
      doSearch(q, next);
    }
  };

  return (
    <div ref={containerRef} className="relative flex-1 min-w-0 max-w-[530px] max-sm:max-w-none max-sm:w-full">
      <div className="flex items-center gap-1.5 sm:gap-2.5 border border-border rounded-full bg-panel px-3 sm:px-5 h-[48px] sm:h-[52px] focus-within:border-accent-2 transition-colors">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const q = query.trim();
            if (q.length < 2) return;
            e.preventDefault();
            setOpen(false);
            onSubmitSearch?.(q, showFilterToggle && filterOn);
          }}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search movies & TV..."
          className="flex-1 bg-transparent text-text text-sm sm:text-base outline-none placeholder:text-muted"
        />
        {onSubmitSearch && (
          <button
            onClick={() => {
              const q = query.trim();
              if (q.length < 2) return;
              setOpen(false);
              onSubmitSearch(q, showFilterToggle && filterOn);
            }}
            className="flex-shrink-0 w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-full text-muted hover:text-text transition-colors"
            aria-label="Search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
        )}
        {showFilterToggle && (
          <button
            onClick={handleFilterToggle}
            className={`text-[0.65rem] sm:text-xs font-medium px-2 sm:px-3 py-1 sm:py-1.5 rounded-full border-2 transition-colors whitespace-nowrap ${
              filterOn
                ? "bg-accent/15 border-accent text-text"
                : "bg-panel-2/70 border-border text-muted hover:border-accent/40 hover:text-text"
            }`}
          >
            Only streamable
          </button>
        )}
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-[calc(100%+0.5rem)] left-0 w-full sm:w-[min(480px,90vw)] bg-panel border border-border rounded-xl max-h-[440px] overflow-y-auto z-[140] shadow-[0_20px_40px_rgba(0,0,0,0.5)]"
          >
            {results.map((m) => (
              <div
                key={m.id}
                onClick={() => {
                  onSelectMovie(m.id, m.media_type);
                  setOpen(false);
                }}
                className="flex items-center gap-3.5 px-4 py-3 cursor-pointer border-b border-white/5 hover:bg-white/[0.04] transition-colors"
              >
                {m.poster_path ? (
                  <img
                    src={`${TMDB_IMG}/w92${m.poster_path}`}
                    alt=""
                    className="w-11 h-16 object-cover rounded-md"
                  />
                ) : (
                  <div className="w-11 h-16 bg-panel-2 rounded-md flex items-center justify-center text-[0.6rem] text-muted">
                    N/A
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <span className="text-[0.95rem] leading-tight line-clamp-2">{m.title}</span>
                  {m.release_date && (
                    <span className="block text-xs text-muted mt-0.5">{m.release_date.slice(0, 4)}</span>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {open && !loading && results.length === 0 && query.trim().length >= 2 && (
        <div className="absolute top-[calc(100%+0.5rem)] left-0 w-full sm:w-[min(480px,90vw)] bg-panel border border-border rounded-xl p-6 text-center text-sm text-muted z-[140]">
          {showFilterToggle && filterOn ? "No streamable matches on your services" : "No results found"}
        </div>
      )}
    </div>
  );
}
