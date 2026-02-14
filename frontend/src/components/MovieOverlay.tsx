import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { getMovieProviders, getMovieScores, getMovieLinks, getTvProviders, getTvScores, getTvLinks, type Movie, type CountryProviders, type StreamingLink, type Person, type CrewMember, type ExternalScores } from "../api/movies";
import { useConfig } from "../hooks/useConfig";
import { useAuth } from "../hooks/useAuth";
import { useWatchlist } from "../hooks/useWatchlist";
import { useWatched } from "../hooks/useWatched";
import { useLists } from "../hooks/useLists";
import { useNotifications } from "../hooks/useNotifications";
import { ApiError } from "../api/client";
import {
  cancelNotificationSubscription,
  createNotificationSubscription,
  getNotificationOptions,
  type NotificationConditionType,
  type NotificationOptionsResponse,
} from "../api/notifications";
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

function ExternalScoresBlock({ scores, loading }: { scores?: ExternalScores; loading?: boolean }) {
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

  if (loading && !scores) {
    return (
      <div className="mt-3 sm:mt-4 min-h-[28px] flex items-center">
        <span className="text-[0.76rem] sm:text-[0.86rem] text-muted font-medium">Loading scores...</span>
      </div>
    );
  }

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
  const clickable = typeof onClick === "function";
  const className = `flex flex-col items-center w-[70px] text-center flex-shrink-0 ${
    clickable ? "cursor-pointer" : "cursor-default"
  }`;

  const content = (
    <>
      {person.profile_path ? (
        <img src={`${TMDB_IMG}/w185${person.profile_path}`} alt="" className="w-14 h-14 rounded-full object-cover border-2 border-border" />
      ) : (
        <div className="w-14 h-14 rounded-full bg-panel-2 border-2 border-border" />
      )}
      <span className="text-[0.7rem] text-text mt-1 leading-tight line-clamp-2">{person.name}</span>
      {role && <span className="text-[0.6rem] text-muted leading-tight">{role}</span>}
    </>
  );

  if (!clickable) {
    return <div className={className}>{content}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onClick?.(person.id)}
      className={className}
    >
      {content}
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
  allowPersonClicks?: boolean;
}

export default function MovieOverlay({
  movieId,
  onClose,
  onSelectMovie,
  countryNameMap,
  itemMediaType,
  guestCountry,
  allowPersonClicks = true,
}: Props) {
  const { user } = useAuth();
  const isPremiumUser = !!user && (user.subscription_tier === "premium" || user.subscription_tier === "free_premium");
  const { refresh: refreshNotifications } = useNotifications();
  const { isInWatchlist, toggle } = useWatchlist();
  const { isWatched, toggle: toggleWatched } = useWatched();
  const {
    lists,
    loading: listsLoading,
    refresh: refreshLists,
    create: createList,
    loadMemberships,
    membershipsFor,
    toggleMembership,
  } = useLists();
  const { countries } = useConfig();
  const [movie, setMovie] = useState<Movie | null>(null);
  const [providers, setProviders] = useState<Record<string, CountryProviders>>({});
  const [streamingLinks, setStreamingLinks] = useState<Record<string, StreamingLink[]>>({});
  const [loading, setLoading] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const [selectedPersonId, setSelectedPersonId] = useState<number | null>(null);
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [watchlistErr, setWatchlistErr] = useState("");
  const [watchedBusy, setWatchedBusy] = useState(false);
  const [watchedErr, setWatchedErr] = useState("");
  const [scoresLoading, setScoresLoading] = useState(false);
  const [alertOptions, setAlertOptions] = useState<NotificationOptionsResponse | null>(null);
  const [alertOptionsLoading, setAlertOptionsLoading] = useState(false);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [alertBusyCondition, setAlertBusyCondition] = useState<NotificationConditionType | null>(null);
  const [alertErr, setAlertErr] = useState("");
  const [listPanelOpen, setListPanelOpen] = useState(false);
  const [listPanelLoading, setListPanelLoading] = useState(false);
  const [listBusyId, setListBusyId] = useState("");
  const [listErr, setListErr] = useState("");
  const [newListName, setNewListName] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);

  useEffect(() => {
    if (!movieId) {
      setScoresLoading(false);
      return;
    }
    let cancelled = false;
    let resolvedScores: ExternalScores | undefined;
    setLoading(true);
    setMovie(null);
    setProviders({});
    setStreamingLinks({});
    const isTV = itemMediaType === "tv";
    const provFn = isTV ? getTvProviders : getMovieProviders;
    const scoreFn = isTV ? getTvScores : getMovieScores;
    const linksFn = isTV ? getTvLinks : getMovieLinks;
    const linkCountries = guestCountry ? [guestCountry] : countries;
    provFn(movieId)
      .then((provData) => {
        if (cancelled) return;
        setMovie(resolvedScores ? { ...provData.movie, external_scores: resolvedScores } : provData.movie);
        setProviders(provData.providers);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    setScoresLoading(true);
    scoreFn(movieId)
      .then((scoreData) => {
        if (cancelled) return;
        resolvedScores = scoreData?.external_scores;
        if (!resolvedScores) return;
        setMovie((prev) => (prev ? { ...prev, external_scores: resolvedScores } : prev));
      })
      .catch(() => {
        // Non-critical for initial overlay render.
      })
      .finally(() => {
        if (!cancelled) {
          setScoresLoading(false);
        }
      });

    linksFn(movieId, linkCountries)
      .then((linksData) => {
        if (!cancelled) {
          setStreamingLinks(linksData?.streaming || {});
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStreamingLinks({});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [movieId, itemMediaType, guestCountry, countries]);

  useEffect(() => {
    if (!movieId || !user || !isPremiumUser) {
      setAlertOptions(null);
      setAlertOptionsLoading(false);
      setAlertPanelOpen(false);
      setAlertBusyCondition(null);
      setAlertErr("");
      return;
    }
    let cancelled = false;
    setAlertOptionsLoading(true);
    setAlertOptions(null);
    setAlertPanelOpen(false);
    setAlertBusyCondition(null);
    setAlertErr("");
    const mediaType: "movie" | "tv" = itemMediaType === "tv" ? "tv" : "movie";
    getNotificationOptions(mediaType, movieId)
      .then((data) => {
        if (!cancelled) setAlertOptions(data);
      })
      .catch(() => {
        if (!cancelled) setAlertOptions(null);
      })
      .finally(() => {
        if (!cancelled) setAlertOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [movieId, itemMediaType, isPremiumUser, user]);

  useEffect(() => {
    if (!movieId) {
      setCreditsOpen(false);
      setSelectedPersonId(null);
      setListPanelOpen(false);
      setListPanelLoading(false);
      setListBusyId("");
      setListErr("");
      setNewListName("");
      setNewListBusy(false);
      return;
    }
    setListPanelOpen(false);
    setListPanelLoading(false);
    setListBusyId("");
    setListErr("");
    setNewListName("");
    setNewListBusy(false);
  }, [movieId]);

  const credits = movie?.credits;
  const cast = credits?.cast || [];
  const crew = credits?.crew || [];
  const directors = crew.filter((c) => c.job === "Director");
  const topCast = cast.slice(0, 6);
  const hasCredits = cast.length > 0 || crew.length > 0;
  const hideCreditsButtonOnDesktop = cast.length <= 6 && crew.length === 0;
  const mediaTypeSafe: "movie" | "tv" = itemMediaType || (movie?.number_of_seasons != null ? "tv" : "movie");
  const watchlisted = !!(movie && user && isPremiumUser && isInWatchlist(mediaTypeSafe, movie.id));
  const watched = !!(movie && user && isPremiumUser && isWatched(mediaTypeSafe, movie.id));
  const listMemberships = movie && user && isPremiumUser ? membershipsFor(mediaTypeSafe, movie.id) : new Set<string>();
  const listMembershipCount = listMemberships.size;
  const listButtonActive = listPanelOpen || listMembershipCount > 0;

  const posterUrl = movie?.poster_path ? `${TMDB_IMG}/w300${movie.poster_path}` : "";
  const handleToggleWatchlist = async () => {
    if (!movie || !user || !isPremiumUser || watchlistBusy) return;
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

  const handleToggleWatched = async () => {
    if (!movie || !user || !isPremiumUser || watchedBusy) return;
    setWatchedBusy(true);
    setWatchedErr("");
    try {
      await toggleWatched({
        tmdb_id: movie.id,
        media_type: mediaTypeSafe,
        title: movie.title,
        poster_path: movie.poster_path,
        release_date: movie.release_date,
      });
    } catch (err) {
      const e = err as ApiError;
      console.error("Watched toggle failed", e.message || err);
      setWatchedErr(
        err instanceof ApiError
          ? e.status === 401
            ? "Please log in again."
            : e.message || "Could not update watched status."
          : "Could not update watched status."
      );
    } finally {
      setWatchedBusy(false);
    }
  };

  const handleToggleListPanel = async () => {
    if (!movie || !user || !isPremiumUser || newListBusy || !!listBusyId) return;
    if (listPanelOpen) {
      setListPanelOpen(false);
      return;
    }
    setListPanelOpen(true);
    setListErr("");
    setListPanelLoading(true);
    try {
      await refreshLists();
      await loadMemberships(mediaTypeSafe, movie.id);
    } catch (err) {
      const e = err as ApiError;
      setListErr(err instanceof ApiError ? e.message : "Could not load your lists.");
    } finally {
      setListPanelLoading(false);
    }
  };

  const handleToggleListMembership = async (listId: string) => {
    if (!movie || !user || !isPremiumUser || !!listBusyId || newListBusy) return;
    setListBusyId(listId);
    setListErr("");
    try {
      await toggleMembership(listId, {
        tmdb_id: movie.id,
        media_type: mediaTypeSafe,
        title: movie.title,
        poster_path: movie.poster_path || undefined,
        release_date: movie.release_date || undefined,
      });
    } catch (err) {
      const e = err as ApiError;
      setListErr(err instanceof ApiError ? e.message : "Could not update list.");
    } finally {
      setListBusyId("");
    }
  };

  const handleCreateListAndAdd = async () => {
    if (!movie || !user || !isPremiumUser || !newListName.trim() || newListBusy || !!listBusyId) return;
    setNewListBusy(true);
    setListErr("");
    try {
      const created = await createList(newListName.trim());
      await toggleMembership(created.id, {
        tmdb_id: movie.id,
        media_type: mediaTypeSafe,
        title: movie.title,
        poster_path: movie.poster_path || undefined,
        release_date: movie.release_date || undefined,
      });
      setNewListName("");
    } catch (err) {
      const e = err as ApiError;
      setListErr(err instanceof ApiError ? e.message : "Could not create list.");
    } finally {
      setNewListBusy(false);
    }
  };

  const pendingAlertOptions = (alertOptions?.options || []).filter((option) => !option.currently_met);
  const hasRegisteredAlert = !!alertOptions?.options?.some((option) => option.already_subscribed);
  const showAlertCta = !!user && isPremiumUser && !!alertOptions?.show_button && pendingAlertOptions.length > 0;

  const handleCreateAlert = async (conditionType: NotificationConditionType) => {
    if (!movie || !user || !isPremiumUser || alertBusyCondition) return;
    setAlertBusyCondition(conditionType);
    setAlertErr("");
    try {
      const result = await createNotificationSubscription({
        media_type: mediaTypeSafe,
        tmdb_id: movie.id,
        title: movie.title,
        poster_path: movie.poster_path || null,
        condition_type: conditionType,
      });
      setAlertOptions((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          options: prev.options.map((option) =>
            option.condition_type === conditionType
              ? {
                  ...option,
                  already_subscribed: true,
                  active_subscription_id: result.subscription.id,
                }
              : {
                  ...option,
                  already_subscribed: false,
                  active_subscription_id: null,
                }
          ),
        };
      });
      void refreshNotifications(false);
    } catch (err) {
      const e = err as ApiError;
      setAlertErr(err instanceof ApiError ? e.message : "Could not create alert.");
    } finally {
      setAlertBusyCondition(null);
    }
  };

  const handleRemoveAlert = async (conditionType: NotificationConditionType) => {
    if (alertBusyCondition) return;
    const subscriptionId = alertOptions?.options.find(
      (option) => option.condition_type === conditionType
    )?.active_subscription_id;
    if (!subscriptionId) return;
    setAlertBusyCondition(conditionType);
    setAlertErr("");
    try {
      await cancelNotificationSubscription(subscriptionId);
      setAlertOptions((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          options: prev.options.map((option) => ({ ...option, already_subscribed: false, active_subscription_id: null })),
        };
      });
      void refreshNotifications(false);
    } catch (err) {
      const e = err as ApiError;
      setAlertErr(err instanceof ApiError ? e.message : "Could not remove alert.");
    } finally {
      setAlertBusyCondition(null);
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
                      {isPremiumUser && (
                        <>
                          <div className="mb-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={handleToggleWatchlist}
                              disabled={watchlistBusy}
                              className={`h-[34px] px-3 border rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                                watchlisted
                                  ? "border-accent/70 bg-accent/15 text-text"
                                  : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                              } disabled:opacity-55 disabled:cursor-not-allowed`}
                            >
                              <svg
                                width="12"
                                height="12"
                                className="w-3 h-3 shrink-0"
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
                            <button
                              type="button"
                              onClick={handleToggleWatched}
                              disabled={watchedBusy}
                              className={`h-[34px] px-3 border rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                                watched
                                  ? "border-accent/70 bg-accent/15 text-text"
                                  : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                              } disabled:opacity-55 disabled:cursor-not-allowed`}
                            >
                              <svg
                                width="12"
                                height="12"
                                className="w-3 h-3 shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.1"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M20 6 9 17l-5-5" />
                              </svg>
                              <span>{watchedBusy ? "Updating..." : watched ? "Watched" : "Mark as watched"}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleListPanel()}
                              disabled={listPanelLoading || !!listBusyId || newListBusy}
                              className={`h-[34px] px-3 border rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                                listButtonActive
                                  ? "border-accent/70 bg-accent/15 text-text"
                                  : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                              } disabled:opacity-55 disabled:cursor-not-allowed`}
                            >
                              <svg
                                width="12"
                                height="12"
                                className="w-3 h-3 shrink-0"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <line x1="8" y1="6" x2="21" y2="6" />
                                <line x1="8" y1="12" x2="21" y2="12" />
                                <line x1="8" y1="18" x2="21" y2="18" />
                                <circle cx="4" cy="6" r="1.5" />
                                <circle cx="4" cy="12" r="1.5" />
                                <circle cx="4" cy="18" r="1.5" />
                              </svg>
                              <span>
                                {listPanelLoading
                                  ? "Loading lists..."
                                  : listMembershipCount > 0
                                    ? `In ${listMembershipCount} list${listMembershipCount === 1 ? "" : "s"}`
                                    : "Add to lists"}
                              </span>
                            </button>
                          </div>
                          {(watchlistErr || watchedErr) && (
                            <div className="mb-2 flex flex-wrap gap-2">
                              {watchlistErr && (
                                <div className="text-xs text-red-300 bg-red-400/10 rounded-md px-2 py-1 inline-block">
                                  {watchlistErr}
                                </div>
                              )}
                              {watchedErr && (
                                <div className="text-xs text-red-300 bg-red-400/10 rounded-md px-2 py-1 inline-block">
                                  {watchedErr}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                      <p className="text-xs sm:text-sm text-muted leading-relaxed">{movie.overview}</p>
                      <ExternalScoresBlock scores={movie.external_scores} loading={scoresLoading} />

                      {(directors.length > 0 || topCast.length > 0) && (
                        <div className="hidden sm:flex flex-nowrap gap-5 mt-4 overflow-x-auto pb-1">
                          {directors.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
                                Director{directors.length > 1 ? "s" : ""}
                              </h4>
                              <div className="flex gap-3">
                                {directors.map((d) => (
                                  <PersonCircle
                                    key={d.id}
                                    person={d}
                                    onClick={allowPersonClicks ? setSelectedPersonId : undefined}
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                          {topCast.length > 0 && (
                            <div className="flex-shrink-0">
                              <h4 className="text-xs text-muted uppercase tracking-wider mb-2">Cast</h4>
                              <div className="flex gap-3">
                                {topCast.map((p) => (
                                  <PersonCircle
                                    key={p.id}
                                    person={p}
                                    role={p.character}
                                    onClick={allowPersonClicks ? setSelectedPersonId : undefined}
                                  />
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

                  {isPremiumUser && (
                    <div className="mb-4 sm:mb-5">
                      {alertOptionsLoading && (
                        <div className="text-xs text-muted">Checking alert options...</div>
                      )}
                      {showAlertCta && (
                        <div>
                          <button
                            type="button"
                            onClick={() => {
                              setAlertPanelOpen((prev) => !prev);
                              setAlertErr("");
                            }}
                            className={`h-[34px] px-3 border rounded-full text-xs sm:text-sm transition-colors inline-flex items-center gap-1.5 ${
                              hasRegisteredAlert
                                ? "border-accent/70 bg-accent/15 text-text"
                                : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                            }`}
                          >
                            <svg
                              width="12"
                              height="12"
                              className="w-3 h-3 shrink-0"
                              viewBox="0 0 24 24"
                              fill={hasRegisteredAlert ? "currentColor" : "none"}
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                            </svg>
                            <span>{alertOptions?.cta_text || "Set an availability alert"}</span>
                          </button>
                          {alertPanelOpen && (
                            <div className="mt-2 rounded-xl border border-border bg-panel-2/70 p-3 max-w-[540px]">
                              <div className="space-y-2">
                                {pendingAlertOptions.map((option) => (
                                  <div
                                    key={option.condition_type}
                                    className={`rounded-lg border p-2.5 ${
                                      option.already_subscribed
                                        ? "border-2 border-accent/80 bg-panel/70"
                                        : "border-border/80 bg-panel/70"
                                    }`}
                                  >
                                    <div className="text-xs text-text">{option.label}</div>
                                    <div className="text-[0.7rem] text-muted mt-1">{option.description}</div>
                                    <div className="mt-2 flex justify-end">
                                      <button
                                        type="button"
                                        disabled={
                                          !!alertBusyCondition ||
                                          (option.already_subscribed && !option.active_subscription_id)
                                        }
                                        onClick={() => {
                                          if (option.already_subscribed) {
                                            void handleRemoveAlert(option.condition_type);
                                          } else {
                                            void handleCreateAlert(option.condition_type);
                                          }
                                        }}
                                        className={`h-7 px-2.5 rounded-full border text-[0.68rem] transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
                                          option.already_subscribed
                                            ? "border-red-500/60 bg-red-500/10 text-red-200 hover:border-red-400"
                                            : "border-accent/70 bg-accent/15 text-text hover:border-accent-2"
                                        }`}
                                      >
                                        {option.already_subscribed
                                          ? alertBusyCondition === option.condition_type
                                            ? "Removing..."
                                            : "Remove"
                                          : alertBusyCondition === option.condition_type
                                            ? "Adding..."
                                            : "Notify me"}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              {alertErr && (
                                <div className="mt-2 text-xs text-red-300 bg-red-400/10 rounded-md px-2 py-1">
                                  {alertErr}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

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

            <AnimatePresence>
              {listPanelOpen && user && isPremiumUser && movie && (
                <motion.div
                  className="fixed inset-0 z-[330] grid place-items-center p-3 sm:p-5"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={(event) => event.target === event.currentTarget && setListPanelOpen(false)}
                >
                  <div
                    className="absolute inset-0 bg-[rgba(6,7,10,0.58)] backdrop-blur-[1px]"
                    onClick={() => setListPanelOpen(false)}
                  />
                  <motion.div
                    className="relative w-[min(560px,94vw)] max-h-[80dvh] flex flex-col rounded-2xl border border-border bg-panel shadow-[0_34px_70px_rgba(0,0,0,0.45)]"
                    initial={{ y: 24, scale: 0.97 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: 24, scale: 0.97 }}
                    transition={{ type: "spring", damping: 26, stiffness: 320 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <div className="flex items-start justify-between gap-3 p-4 sm:p-5 pb-0">
                      <div className="min-w-0">
                        <h3 className="font-display text-lg sm:text-xl truncate">Add To Lists</h3>
                        <p className="text-xs sm:text-sm text-muted mt-1 truncate">{movie.title}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setListPanelOpen(false)}
                        className="w-8 h-8 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
                      >
                        &times;
                      </button>
                    </div>

                    <div className="p-4 sm:p-5">
                      <form
                        onSubmit={(event) => {
                          event.preventDefault();
                          void handleCreateListAndAdd();
                        }}
                        className="flex gap-2"
                      >
                        <input
                          type="text"
                          value={newListName}
                          onChange={(event) => setNewListName(event.target.value)}
                          placeholder="Create list and add title..."
                          className="h-9 flex-1 min-w-0 px-3 border border-border rounded-lg bg-bg-2 text-sm text-text outline-none focus:border-accent-2 transition-colors"
                        />
                        <button
                          type="submit"
                          disabled={!newListName.trim() || newListBusy || !!listBusyId}
                          className="h-9 px-3 rounded-full border border-accent/70 bg-accent/15 text-xs text-text hover:bg-accent/25 transition-colors disabled:opacity-55 disabled:cursor-not-allowed"
                        >
                          {newListBusy ? "Creating..." : "Create"}
                        </button>
                      </form>
                    </div>

                    <div className="px-4 sm:px-5 pb-4 sm:pb-5 flex-1 min-h-0 overflow-y-auto">
                      {listPanelLoading || (listsLoading && lists.length === 0) ? (
                        <div className="text-sm text-muted">Loading your lists...</div>
                      ) : lists.length === 0 ? (
                        <div className="text-sm text-muted">No lists yet. Create one above.</div>
                      ) : (
                        <div className="space-y-2">
                          {lists.map((entry) => {
                            const inList = listMemberships.has(entry.id);
                            return (
                              <div
                                key={entry.id}
                                className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${
                                  inList
                                    ? "border-2 border-accent/80 bg-panel/70"
                                    : "border-border/80 bg-panel/70"
                                }`}
                              >
                                <div className="min-w-0">
                                  <div className="text-sm text-text truncate">{entry.name}</div>
                                  <div className="text-[0.72rem] text-muted mt-0.5">
                                    {entry.item_count} {entry.item_count === 1 ? "title" : "titles"}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  disabled={!!listBusyId || newListBusy}
                                  onClick={() => void handleToggleListMembership(entry.id)}
                                  className={`h-8 px-3 rounded-full border text-xs transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
                                    inList
                                      ? "border-accent/70 bg-accent/15 text-text"
                                      : "border-border bg-panel-2 text-muted hover:text-text hover:border-accent-2"
                                  }`}
                                >
                                  {listBusyId === entry.id ? "Updating..." : inList ? "Added" : "Add"}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {listErr && (
                        <div className="mt-3 text-xs text-red-300 bg-red-400/10 rounded-md px-2 py-1">
                          {listErr}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      <CreditsModal
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        cast={cast}
        crew={crew}
        onPersonClick={allowPersonClicks ? setSelectedPersonId : undefined}
        allowPersonClicks={allowPersonClicks}
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
