import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getSection, type HomeSection, type Movie } from "../api/movies";
import { useConfig } from "../hooks/useConfig";
import { useInfiniteScroll } from "../hooks/useInfiniteScroll";
import MovieCard from "./MovieCard";
import Spinner from "./Spinner";

interface Props {
  section: HomeSection | null;
  onClose: () => void;
  onSelectMovie: (id: number) => void;
}

export default function SectionOverlay({ section, onClose, onSelectMovie }: Props) {
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
  }, [section?.id]);

  const loadMore = useCallback(async () => {
    if (!section || loading) return;
    const s = stateRef.current;
    if (s.useCursor && !s.nextCursor && results.length > 0) return;
    if (!s.useCursor && !s.nextPage) return;

    setLoading(true);
    try {
      const ids = Array.from(providerIds);
      const data = await getSection(
        section.id,
        s.useCursor ? 1 : (s.nextPage || 1),
        3,
        ids,
        s.nextCursor || undefined
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
  }, [section, loading, providerIds, results.length]);

  const sentinelRef = useInfiniteScroll(loadMore, hasMore && !loading, panelRef.current);

  useEffect(() => {
    if (section) document.body.classList.add("overflow-hidden");
    else document.body.classList.remove("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [section]);

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
            ref={panelRef}
            className="relative w-[min(1100px,94vw)] max-h-[90vh] overflow-auto bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl p-6 sm:p-8 z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors"
            >
              &times;
            </button>

            <div className="mb-4">
              <h3 className="font-display text-2xl">{section.title}</h3>
              <p className="text-sm text-muted mt-1">Available on your services</p>
            </div>

            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4">
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
                />
              ))}
            </div>

            {(loading || hasMore) && (
              <div ref={sentinelRef} className="flex justify-center py-6">
                <Spinner />
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
