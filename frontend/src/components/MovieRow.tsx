import type { HomeSection } from "../api/movies";
import MovieCard from "./MovieCard";

interface Props {
  section: HomeSection;
  onSelectMovie: (id: number) => void;
  onSeeMore: (sectionId: string) => void;
}

export default function MovieRow({ section, onSelectMovie, onSeeMore }: Props) {
  const hasMore = !!(section.next_cursor || section.next_page || (section.total_pages && section.total_pages > 1));

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-xl font-semibold">{section.title}</h3>
        {hasMore && (
          <button
            onClick={() => onSeeMore(section.id)}
            className="bg-accent/[0.18] border border-accent/60 text-text px-3 py-1 rounded-full text-xs font-bold tracking-wide hover:border-accent hover:bg-accent/[0.32] transition-all hover:-translate-y-0.5"
          >
            See more
          </button>
        )}
      </div>
      <div className="flex gap-4 overflow-x-auto overflow-y-visible pt-2 -mt-2 pb-3 snap-x snap-mandatory scrollbar-thin">
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
          />
        ))}
      </div>
    </div>
  );
}
