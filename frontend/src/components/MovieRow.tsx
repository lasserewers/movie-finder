import { memo, useLayoutEffect, useRef } from "react";
import type { HomeSection } from "../api/movies";
import MovieCard from "./MovieCard";

interface Props {
  section: HomeSection;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  onSeeMore: (sectionId: string) => void;
  resetToken?: number;
  mediaType?: "movie" | "tv" | "mix";
}

function MovieRow({ section, onSelectMovie, onSeeMore, resetToken = 0, mediaType = "mix" }: Props) {
  const hasMore = !!(section.next_cursor || section.next_page || (section.total_pages && section.total_pages > 1));
  const rowRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (mediaType !== "mix") return;
    const el = rowRef.current;
    if (!el) return;
    const reset = () => {
      el.scrollLeft = 0;
      el.scrollTo({ left: 0, behavior: "auto" });
    };
    reset();
    const raf = requestAnimationFrame(reset);
    const t1 = window.setTimeout(reset, 80);
    const t2 = window.setTimeout(reset, 220);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [resetToken, mediaType]);

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5 sm:mb-4">
        <h3 className="min-w-0 pr-2 text-lg sm:text-xl font-semibold leading-tight line-clamp-2">{section.title}</h3>
        {hasMore && (
          <button
            onClick={() => onSeeMore(section.id)}
            className="flex-shrink-0 whitespace-nowrap bg-accent/[0.18] border border-accent/60 text-text px-2.5 sm:px-3 py-1 rounded-full text-[0.68rem] sm:text-xs font-bold tracking-wide hover:border-accent hover:bg-accent/[0.32] transition-all hover:-translate-y-0.5"
          >
            See more
          </button>
        )}
      </div>
      <div
        ref={rowRef}
        className="flex gap-2.5 sm:gap-4 overflow-x-auto overflow-y-visible pt-1 sm:pt-2 -mt-1 sm:-mt-2 pb-2 sm:pb-3 pl-1 pr-1 -ml-1 -mr-1 snap-x snap-mandatory scrollbar-thin"
      >
        {section.results.slice(0, 24).map((m, i) => (
          <MovieCard
            key={m.id}
            id={m.id}
            title={m.title}
            posterPath={m.poster_path}
            posterUrl={m.poster_url}
            releaseDate={m.release_date}
            onClick={onSelectMovie}
            index={i}
            mediaType={m.media_type}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(MovieRow);
