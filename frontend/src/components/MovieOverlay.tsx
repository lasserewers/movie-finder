import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getMovieProviders, getMovieLinks, type Movie, type CountryProviders, type StreamingLink, type Person, type CrewMember } from "../api/movies";
import ProviderGrid from "./ProviderGrid";
import CreditsModal from "./CreditsModal";
import Spinner from "./Spinner";

const TMDB_IMG = "https://image.tmdb.org/t/p";

function PersonCircle({ person, role }: { person: { name: string; profile_path?: string }; role?: string }) {
  return (
    <div className="flex flex-col items-center w-[70px] text-center flex-shrink-0">
      {person.profile_path ? (
        <img src={`${TMDB_IMG}/w185${person.profile_path}`} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-border" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-panel-2 border-2 border-border" />
      )}
      <span className="text-[0.7rem] text-text mt-1 leading-tight">{person.name}</span>
      {role && <span className="text-[0.6rem] text-muted leading-tight">{role}</span>}
    </div>
  );
}

interface Props {
  movieId: number | null;
  onClose: () => void;
  countryNameMap: Record<string, string>;
}

export default function MovieOverlay({ movieId, onClose, countryNameMap }: Props) {
  const [movie, setMovie] = useState<Movie | null>(null);
  const [providers, setProviders] = useState<Record<string, CountryProviders>>({});
  const [streamingLinks, setStreamingLinks] = useState<Record<string, StreamingLink[]>>({});
  const [movieInfo, setMovieInfo] = useState<{ poster?: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);

  useEffect(() => {
    if (!movieId) return;
    setLoading(true);
    setMovie(null);
    Promise.all([getMovieProviders(movieId), getMovieLinks(movieId).catch(() => ({} as Awaited<ReturnType<typeof getMovieLinks>>))])
      .then(([provData, linksData]) => {
        setMovie(provData.movie);
        setProviders(provData.providers);
        setStreamingLinks(linksData?.streaming || {});
        setMovieInfo(linksData?.movie_info || null);
      })
      .finally(() => setLoading(false));
  }, [movieId]);

  useEffect(() => {
    if (movieId) document.body.classList.add("overflow-hidden");
    else document.body.classList.remove("overflow-hidden");
    return () => document.body.classList.remove("overflow-hidden");
  }, [movieId]);

  const credits = movie?.credits;
  const cast = credits?.cast || [];
  const crew = credits?.crew || [];
  const directors = crew.filter((c) => c.job === "Director");
  const topCast = cast.slice(0, 6);

  const posterUrl = movieInfo?.poster || (movie?.poster_path ? `${TMDB_IMG}/w300${movie.poster_path}` : "");

  return (
    <>
      <AnimatePresence>
        {movieId && (
          <motion.div
            className="fixed inset-0 z-[300] grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
            <motion.div
              className="relative w-[min(980px,92vw)] max-h-[90vh] overflow-auto bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl p-6 sm:p-8 z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
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

              {loading ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : movie ? (
                <>
                  <div className="flex gap-6 mb-6 max-sm:flex-col max-sm:items-center max-sm:text-center">
                    {posterUrl && (
                      <img src={posterUrl} alt="" className="w-[150px] rounded-lg flex-shrink-0 self-start" />
                    )}
                    <div>
                      <h2 className="font-display text-2xl mb-1">{movie.title}</h2>
                      <p className="text-muted mb-2">{movie.release_date?.slice(0, 4)}</p>
                      <p className="text-sm text-[#c9d1d9] leading-relaxed">{movie.overview}</p>

                      {(directors.length > 0 || topCast.length > 0) && (
                        <div className="flex flex-nowrap gap-5 mt-4 overflow-x-auto pb-1">
                          {directors.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
                                Director{directors.length > 1 ? "s" : ""}
                              </h4>
                              <div className="flex gap-3">
                                {directors.map((d) => (
                                  <PersonCircle key={d.id} person={d} />
                                ))}
                              </div>
                            </div>
                          )}
                          {topCast.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">Cast</h4>
                              <div className="flex gap-3">
                                {topCast.map((p) => (
                                  <PersonCircle key={p.id} person={p} role={p.character} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {(cast.length > 6 || crew.length > 0) && (
                        <button
                          onClick={() => setCreditsOpen(true)}
                          className="mt-3 w-full py-2 bg-panel-2 border border-border rounded-md text-sm text-text hover:bg-white/5 transition-colors text-center"
                        >
                          Cast & Crew
                        </button>
                      )}
                    </div>
                  </div>

                  <ProviderGrid
                    providers={providers}
                    streamingLinks={streamingLinks}
                    countryNameMap={countryNameMap}
                  />
                </>
              ) : null}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CreditsModal
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        cast={cast}
        crew={crew}
      />
    </>
  );
}
