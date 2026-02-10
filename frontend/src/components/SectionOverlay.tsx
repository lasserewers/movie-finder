import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getSection, type HomeSection, type Movie, type MediaType } from "../api/movies";
import { useConfig } from "../hooks/useConfig";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import MovieCard from "./MovieCard";
import Spinner from "./Spinner";

interface Props {
  section: HomeSection | null;
  onClose: () => void;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  mediaType?: MediaType;
  country?: string;
  countries?: string[];
  unfiltered?: boolean;
  vpn?: boolean;
  includePaid?: boolean;
  hideWatched?: boolean;
}

export default function SectionOverlay({
  section,
  onClose,
  onSelectMovie,
  mediaType = "mix",
  country,
  countries,
  unfiltered = false,
  vpn = false,
  includePaid = false,
  hideWatched = false,
}: Props) {
  const { providerIds } = useConfig();
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const seenRef = useRef(new Set<number>());
  const stateRef = useRef<{
    nextPage: number | null;
    nextCursor: string | null;
    useCursor: boolean;
  }>({ nextPage: 1, nextCursor: null, useCursor: false });
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!section) return;
    seenRef.current = new Set();
    stateRef.current = {
      nextPage: 1,
      nextCursor: null,
      useCursor: "next_cursor" in section,
    };
    setResults([]);
    setHasMore(true);
    loadMore();
  }, [section?.id, country, countries, unfiltered, vpn, includePaid, hideWatched]);

  const loadMore = useCallback(async () => {
    if (!section || loading) return;
    const s = stateRef.current;
    if (s.useCursor && !s.nextCursor && results.length > 0) return;
    if (!s.useCursor && !s.nextPage) return;

    setLoading(true);
    try {
      const ids = unfiltered ? [] : Array.from(providerIds);
      const data = await getSection(
        section.id,
        s.useCursor ? 1 : (s.nextPage || 1),
        2,
        ids,
        s.nextCursor || undefined,
        mediaType,
        country,
        unfiltered,
        vpn,
        includePaid,
        countries,
        hideWatched
      );
      const items = (data.results || []).filter((m) => {
        if (seenRef.current.has(m.id)) return false;
        seenRef.current.add(m.id);
        return true;
      });
      setResults((prev) => [...prev, ...items]);

      if (s.useCursor) {
        s.nextCursor = data.next_cursor || null;
        setHasMore(!!s.nextCursor);
      } else {
        s.nextPage = data.next_page || null;
        setHasMore(!!s.nextPage);
      }
    } catch {
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [section, loading, providerIds, results.length, mediaType, country, countries, unfiltered, vpn, includePaid, hideWatched]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loading, panelRef.current);

  return (
    <AnimatePresence>
      {section && (
        <motion.div
          className="fixed inset-0 z-[280] grid place-items-center"
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
                <h3 className="font-display text-2xl">{section.title}</h3>
                <p className="text-sm text-muted mt-1">
                  {unfiltered
                    ? `Popular in ${country || "US"}`
                    : includePaid
                      ? vpn
                        ? "Available on your services (stream, rent, or buy) worldwide"
                        : "Available on your services (stream, rent, or buy) in your countries"
                      : vpn
                        ? "Streamable on your services worldwide"
                        : "Streamable on your services in your countries"}
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div ref={panelRef} className="flex-1 overflow-auto p-6 sm:p-8 pt-4 sm:pt-4">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
              {results.map((m, i) => (
                <MovieCard
                  key={m.id}
                  id={m.id}
                  title={m.title}
                  posterPath={m.poster_path}
                  posterUrl={m.poster_url}
                  releaseDate={m.release_date}
                  onClick={onSelectMovie}
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
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
