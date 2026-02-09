import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getMovieProviders, getMovieLinks, getTvProviders, getTvLinks, type Movie, type CountryProviders, type StreamingLink, type Person, type CrewMember, type ExternalScores } from "../api/movies";
import { useConfig } from "../hooks/useConfig";
import { useAuth } from "../hooks/useAuth";
import { useWatchlist } from "../hooks/useWatchlist";
import { ApiError } from "../api/client";
import ProviderGrid from "./ProviderGrid";
import CreditsModal from "./CreditsModal";
import PersonWorksModal from "./PersonWorksModal";
import Spinner from "./Spinner";

const TMDB_IMG = "https://image.tmdb.org/t/p";

function parseScoreValue(display?: string | null): number | null {
  if (!display) return null;
  const match = display.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? value : null;
}

function compactFractionScore(display?: string | null): string {
  if (!display) return "tbd";
  const parsed = parseScoreValue(display);
  if (parsed == null) return "tbd";
  const value = display.split("/")[0]?.trim();
  return value || "tbd";
}

function ScoreSurface({
  url,
  title,
  className,
  children,
}: {
  url?: string | null;
  title: string;
  className: string;
  children: React.ReactNode;
}) {
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={`${className} hover:opacity-85 transition-opacity`}
      >
        {children}
      </a>
    );
  }
  return (
    <div title={title} className={className}>
      {children}
    </div>
  );
}

function LetterboxdLogo() {
  return (
    <img
      src="/ratings/letterboxd-logo.svg"
      alt="Letterboxd"
      className="h-[12px] w-auto flex-shrink-0"
      loading="lazy"
    />
  );
}

function IMDbLogo() {
  return (
    <img
      src="/ratings/imdb-logo.svg"
      alt="IMDb"
      className="h-[13px] w-auto flex-shrink-0"
      loading="lazy"
    />
  );
}

type RottenIconState = "fresh" | "rotten" | "na";

function TomatoIcon({ state }: { state: RottenIconState }) {
  const isFresh = state === "fresh";
  const isUnknown = state === "na";
  const src = state === "rotten" ? "/ratings/rt-critics-rotten.svg" : "/ratings/rt-critics-fresh.svg";
  return (
    <img
      src={src}
      alt={isUnknown ? "No Tomatometer" : isFresh ? "Fresh" : "Rotten"}
      className={`w-3.5 h-3.5 flex-shrink-0 ${isUnknown ? "grayscale opacity-60" : ""}`}
      loading="lazy"
    />
  );
}

function PopcornIcon({ state }: { state: RottenIconState }) {
  const isFresh = state === "fresh";
  const isUnknown = state === "na";
  const src = state === "rotten" ? "/ratings/rt-audience-rotten.svg" : "/ratings/rt-audience-fresh.svg";
  return (
    <img
      src={src}
      alt={isUnknown ? "No Popcornmeter" : isFresh ? "Upright" : "Spilled"}
      className={`w-3.5 h-3.5 flex-shrink-0 ${isUnknown ? "grayscale opacity-60" : ""}`}
      loading="lazy"
    />
  );
}

function MetacriticWordmark() {
  return (
    <img
      src="/ratings/metacritic-logo.svg"
      alt="Metacritic"
      className="w-4 h-4 rounded-full flex-shrink-0"
      loading="lazy"
    />
  );
}

function metacriticCriticTone(score: number | null): { bg: string; text: string } {
  if (score == null) return { bg: "#FFFFFF", text: "#111111" };
  // Metacritic critic bands: 61-100 positive, 40-60 mixed, 0-39 negative.
  if (score >= 61) return { bg: "#66CC33", text: "#10210A" };
  if (score >= 40) return { bg: "#FFCC33", text: "#241B05" };
  return { bg: "#FF4E50", text: "#2A0B0C" };
}

function metacriticAudienceTone(score: number | null): { bg: string; text: string } {
  if (score == null) return { bg: "#FFFFFF", text: "#111111" };
  // User score bands aligned to Metacritic style (10-point scale): 6.1-10 positive, 4.0-6.0 mixed.
  if (score >= 6.1) return { bg: "#66CC33", text: "#10210A" };
  if (score >= 4.0) return { bg: "#FFCC33", text: "#241B05" };
  return { bg: "#FF4E50", text: "#2A0B0C" };
}

function ExternalScoresBlock({ scores }: { scores?: ExternalScores }) {
  const lbd = scores?.letterboxd;
  const imdb = scores?.imdb;
  const rtCritics = scores?.rotten_tomatoes_critics;
  const rtAudience = scores?.rotten_tomatoes_audience;
  const mcCritics = scores?.metacritic;
  const mcAudience = scores?.metacritic_audience;

  const lbdValue = parseScoreValue(lbd?.display);
  const imdbValue = parseScoreValue(imdb?.display);
  const rtCriticsValue = parseScoreValue(rtCritics?.display);
  const rtAudienceValue = parseScoreValue(rtAudience?.display);
  const rtCriticsState: RottenIconState =
    rtCriticsValue == null ? "na" : rtCriticsValue >= 60 ? "fresh" : "rotten";
  const rtAudienceState: RottenIconState =
    rtAudienceValue == null ? "na" : rtAudienceValue >= 60 ? "fresh" : "rotten";
  const rtUrl = rtCritics?.url || rtAudience?.url || null;

  const mcCriticsValue = parseScoreValue(mcCritics?.display);
  const mcAudienceValue = parseScoreValue(mcAudience?.display);
  const mcUrl = mcCritics?.url || mcAudience?.url || null;
  const criticTone = metacriticCriticTone(mcCriticsValue);
  const audienceTone = metacriticAudienceTone(mcAudienceValue);
  const hasLetterboxd = lbdValue != null;
  const hasImdb = imdbValue != null;
  const hasRotten = rtCriticsValue != null || rtAudienceValue != null;
  const hasMetacritic = mcCriticsValue != null || mcAudienceValue != null;

  if (!hasLetterboxd && !hasImdb && !hasRotten && !hasMetacritic) {
    return null;
  }

  return (
    <div className="mt-3 sm:mt-4">
      <div className="flex flex-wrap items-center gap-x-6 sm:gap-x-7 gap-y-2.5">
      {hasLetterboxd && (
        <ScoreSurface
          url={lbd?.url}
          title="Letterboxd"
          className="inline-flex items-center gap-1 text-[0.76rem] sm:text-[0.86rem] text-text font-semibold leading-none"
        >
          <LetterboxdLogo />
          <span className="whitespace-nowrap">{lbd?.display || "N/A"}</span>
        </ScoreSurface>
      )}

      {hasImdb && (
        <ScoreSurface
          url={imdb?.url}
          title="IMDb"
          className="inline-flex items-center gap-1 text-[0.76rem] sm:text-[0.86rem] text-text font-semibold leading-none"
        >
          <IMDbLogo />
          <span className="whitespace-nowrap">{imdb?.display || "N/A"}</span>
        </ScoreSurface>
      )}

      {hasRotten && (
        <ScoreSurface
          url={rtUrl}
          title="Rotten Tomatoes"
          className="inline-flex items-center gap-2.5 text-[0.76rem] sm:text-[0.86rem] text-text font-semibold leading-none"
        >
          <span className="inline-flex items-center gap-1">
            <TomatoIcon state={rtCriticsState} />
            <span className="whitespace-nowrap">{rtCritics?.display || "--"}</span>
          </span>
          <span className="inline-flex items-center gap-1">
            <PopcornIcon state={rtAudienceState} />
            <span className="whitespace-nowrap">{rtAudience?.display || "--"}</span>
          </span>
        </ScoreSurface>
      )}

      {hasMetacritic && (
        <ScoreSurface
          url={mcUrl}
          title="Metacritic"
          className="inline-flex items-center gap-2.5 text-[0.76rem] sm:text-[0.86rem] text-text font-semibold leading-none"
        >
          <MetacriticWordmark />
          <div className="flex items-center gap-1">
            <div
              className={`w-[26px] h-[26px] rounded-[5px] border flex items-center justify-center ${mcCriticsValue == null ? "border-black" : "border-black/20"}`}
              style={{ backgroundColor: criticTone.bg, color: criticTone.text }}
            >
              <span className="text-[0.64rem] font-black leading-none">
                {compactFractionScore(mcCritics?.display)}
              </span>
            </div>
            <div
              className={`w-[26px] h-[26px] rounded-full border flex items-center justify-center ${mcAudienceValue == null ? "border-black" : "border-black/20"}`}
              style={{ backgroundColor: audienceTone.bg, color: audienceTone.text }}
            >
              <span className="text-[0.64rem] font-black leading-none">
                {compactFractionScore(mcAudience?.display)}
              </span>
            </div>
          </div>
        </ScoreSurface>
      )}
      </div>
    </div>
  );
}

function PersonCircle({
  person,
  role,
  onClick,
}: {
  person: { id: number; name: string; profile_path?: string };
  role?: string;
  onClick?: (personId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick?.(person.id)}
      className="flex flex-col items-center w-[70px] text-center flex-shrink-0 cursor-pointer"
    >
      {person.profile_path ? (
        <img src={`${TMDB_IMG}/w185${person.profile_path}`} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-border" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-panel-2 border-2 border-border" />
      )}
      <span className="text-[0.7rem] text-text mt-1 leading-tight line-clamp-2">{person.name}</span>
      {role && <span className="text-[0.6rem] text-muted leading-tight">{role}</span>}
    </button>
  );
}

interface Props {
  movieId: number | null;
  onClose: () => void;
  onSelectMovie?: (id: number, mediaType?: "movie" | "tv") => void;
  countryNameMap: Record<string, string>;
  itemMediaType?: "movie" | "tv";
  guestCountry?: string;
}

export default function MovieOverlay({
  movieId,
  onClose,
  onSelectMovie,
  countryNameMap,
  itemMediaType,
  guestCountry,
}: Props) {
  const { user } = useAuth();
  const { isInWatchlist, toggle } = useWatchlist();
  const { countries } = useConfig();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [providers, setProviders] = useState<Record<string, CountryProviders>>({});
  const [streamingLinks, setStreamingLinks] = useState<Record<string, StreamingLink[]>>({});
  const [loading, setLoading] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [watchlistErr, setWatchlistErr] = useState("");

  useEffect(() => {
    if (!movieId) return;
    setLoading(true);
    setMovie(null);
    const isTV = itemMediaType === "tv";
    const provFn = isTV ? getTvProviders : getMovieProviders;
    const linksFn = isTV ? getTvLinks : getMovieLinks;
    const linkCountries = guestCountry ? [guestCountry] : countries;
    Promise.all([provFn(movieId), linksFn(movieId, linkCountries).catch(() => ({} as Awaited<ReturnType<typeof getMovieLinks>>))])
      .then(([provData, linksData]) => {
        setMovie(provData.movie);
        setProviders(provData.providers);
        setStreamingLinks(linksData?.streaming || {});
      })
      .finally(() => setLoading(false));
  }, [movieId, itemMediaType, guestCountry, countries]);

  useEffect(() => {
    if (!movieId) {
      setCreditsOpen(false);
      setSelectedPersonId(null);
    }
  }, [movieId]);

  const credits = movie?.credits;
  const cast = credits?.cast || [];
  const crew = credits?.crew || [];
  const directors = crew.filter((c) => c.job === "Director");
  const topCast = cast.slice(0, 6);
  const hasCredits = cast.length > 0 || crew.length > 0;
  const hideCreditsButtonOnDesktop = cast.length <= 6 && crew.length === 0;
  const mediaTypeSafe: "movie" | "tv" = itemMediaType || (movie?.number_of_seasons != null ? "tv" : "movie");
  const watchlisted = !!(movie && user && isInWatchlist(mediaTypeSafe, movie.id));

  const posterUrl = movie?.poster_path ? `${TMDB_IMG}/w300${movie.poster_path}` : "";
  const handleToggleWatchlist = async () => {
    if (!movie || !user || watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistErr("");
    try {
      await toggle({
        tmdb_id: movie.id,
        media_type: mediaTypeSafe,
        title: movie.title,
        poster_path: movie.poster_path,
        release_date: movie.release_date,
      });
    } catch (err) {
      const e = err as ApiError;
      console.error("Watchlist toggle failed", e.message || err);
      setWatchlistErr(
        err instanceof ApiError
          ? e.status === 401
            ? "Please log in again."
            : e.message || "Could not update watchlist."
          : "Could not update watchlist."
      );
    } finally {
      setWatchlistBusy(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {movieId && (
          <motion.div
            className="fixed inset-0 z-[320] grid place-items-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
            <motion.div
              className="relative w-[min(980px,92vw)] max-h-[90vh] flex flex-col bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
              initial={{ y: 40, scale: 0.97 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 40, scale: 0.97 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
            >
              <div className="flex justify-between items-center p-4 sm:p-8 pb-0 sm:pb-0">
                <h2 className="font-display text-xl sm:text-2xl">{movie?.title || ""}</h2>
                <button
                  onClick={onClose}
                  className="w-8 h-8 sm:w-9 sm:h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
                >
                  &times;
                </button>
              </div>

              <div className="flex-1 overflow-auto p-4 sm:p-8 pt-3 sm:pt-4">
              {loading ? (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              ) : movie ? (
                <>
                  <div className="flex items-start gap-3 sm:gap-6 mb-5 sm:mb-6">
                    <div className="w-[96px] sm:w-[150px] flex-shrink-0 self-start">
                      {posterUrl ? (
                        <img src={posterUrl} alt="" className="w-[96px] sm:w-[150px] rounded-lg" />
                      ) : (
                        <div className="w-[96px] sm:w-[150px] aspect-[2/3] rounded-lg bg-panel-2 border border-border" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-muted text-sm sm:text-base mb-2">
                        {movie.release_date?.slice(0, 4)}
                        {movie.number_of_seasons != null && (
                          <span className="ml-2">&middot; {movie.number_of_seasons} season{movie.number_of_seasons !== 1 ? "s" : ""}</span>
                        )}
                      </p>
                      {user && (
                        <>
                          <button
                            type="button"
                            onClick={handleToggleWatchlist}
                            disabled={watchlistBusy}
                            className={`mb-2 h-[34px] px-3 border rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                              watchlisted
                                ? "border-accent/70 bg-accent/15 text-text"
                                : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                            } disabled:opacity-55 disabled:cursor-not-allowed`}
                          >
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill={watchlisted ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="2.1"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                            </svg>
                            <span>{watchlistBusy ? "Updating..." : watchlisted ? "Remove from watchlist" : "Add to watchlist"}</span>
                          </button>
                          {watchlistErr && (
                            <div className="mb-2 text-xs text-red-300 bg-red-400/10 rounded-md px-2 py-1 inline-block">
                              {watchlistErr}
                            </div>
                          )}
                        </>
                      )}
                      <p className="text-xs sm:text-sm text-muted leading-relaxed">{movie.overview}</p>
                      <ExternalScoresBlock scores={movie.external_scores} />

                      {(directors.length > 0 || topCast.length > 0) && (
                        <div className="hidden sm:flex flex-nowrap gap-5 mt-4 overflow-x-auto pb-1">
                          {directors.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
                                Director{directors.length > 1 ? "s" : ""}
                              </h4>
                              <div className="flex gap-3">
                                {directors.map((d) => (
                                  <PersonCircle key={d.id} person={d} onClick={setSelectedPersonId} />
                                ))}
                              </div>
                            </div>
                          )}
                          {topCast.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">Cast</h4>
                              <div className="flex gap-3">
                                {topCast.map((p) => (
                                  <PersonCircle key={p.id} person={p} role={p.character} onClick={setSelectedPersonId} />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {hasCredits && (
                        <button
                          onClick={() => setCreditsOpen(true)}
                          className={`mt-3 w-full py-2 bg-panel-2 border border-border rounded-md text-xs sm:text-sm text-text hover:bg-white/5 transition-colors text-center ${hideCreditsButtonOnDesktop ? "sm:hidden" : ""}`}
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
                    guestCountry={guestCountry}
                  />
                </>
              ) : null}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <CreditsModal
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        cast={cast}
        crew={crew}
        onPersonClick={setSelectedPersonId}
      />

      <PersonWorksModal
        open={selectedPersonId !== null}
        personId={selectedPersonId}
        onClose={() => setSelectedPersonId(null)}
        onSelectWork={(id, mediaType) => {
          setSelectedPersonId(null);
          setCreditsOpen(false);
          onSelectMovie?.(id, mediaType);
        }}
      />
    </>
  );
}
