import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { searchMovies, searchFiltered, type Movie } from "../api/movies";
import { useConfig } from "../hooks/useConfig";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  onSelectMovie: (movieId: number) => void;
}

export default function SearchBar({ onSelectMovie }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Movie[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [filterOn, setFilterOn] = useState(false);
  const { expandedProviderIds } = useConfig();
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

    const ids = filtered ? Array.from(expandedProviderIds()) : [];
    const url = filtered && ids.length
      ? `/api/search_filtered?q=${encodeURIComponent(q)}&provider_ids=${ids.join(",")}`
      : `/api/search?q=${encodeURIComponent(q)}`;

    fetch(url, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (controller.signal.aborted) return;
        setResults(data.results?.slice(0, 10) || []);
        setOpen(true);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === "AbortError") return;
        setResults([]);
        setLoading(false);
      });
  }

  const handleInput = (value: string) => {
    setQuery(value);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(value.trim(), filterOn), 300);
  };

  const handleFilterToggle = () => {
    const next = !filterOn;
    setFilterOn(next);
    const q = query.trim();
    if (q.length >= 2) doSearch(q, next);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-[420px]">
      <div className="flex items-center gap-2 border border-border rounded-full bg-panel px-4 py-2.5 focus-within:border-accent-2 transition-colors">
        <input
          type="text"
          value={query}
          onChange={(e) => handleInput(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Search for a movie..."
          className="flex-1 bg-transparent text-text text-[0.95rem] outline-none placeholder:text-muted"
        />
        <button
          onClick={handleFilterToggle}
          className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
            filterOn
              ? "bg-white/10 border-white/30 text-text"
              : "bg-transparent border-border text-muted hover:border-white/20"
          }`}
        >
          My services
        </button>
      </div>

      <AnimatePresence>
        {open && results.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="absolute top-[calc(100%+0.5rem)] left-0 w-[min(480px,90vw)] bg-panel border border-border rounded-xl max-h-[440px] overflow-y-auto z-[140] shadow-[0_20px_40px_rgba(0,0,0,0.5)]"
          >
            {results.map((m) => (
              <div
                key={m.id}
                onClick={() => {
                  onSelectMovie(m.id);
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
        <div className="absolute top-[calc(100%+0.5rem)] left-0 w-[min(480px,90vw)] bg-panel border border-border rounded-xl p-6 text-center text-sm text-muted z-[140]">
          {filterOn ? "No matches on your services" : "No movies found"}
        </div>
      )}
    </div>
  );
}
