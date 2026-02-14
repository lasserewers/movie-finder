import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  getGenres,
  searchAdvanced,
  searchPeople,
  type AdvancedSearchResponse,
  type ContentMode,
  type GenreOption,
  type MediaType,
  type Movie,
  type PersonOption,
  type Region,
} from "../api/movies";
import { useConfig } from "../hooks/useConfig";
import MovieCard from "./MovieCard";
import Spinner from "./Spinner";

type SortBy =
  | "popularity.desc"
  | "popularity.asc"
  | "release.desc"
  | "release.asc";

interface AdvancedFilters {
  query: string;
  mediaType: MediaType;
  country: string;
  language: string;
  releaseYear: string;
  useYearSpan: boolean;
  yearSpanStart: number;
  yearSpanEnd: number;
  runtimeMin: string;
  runtimeMax: string;
  sortBy: SortBy;
  includeGenreIds: number[];
  excludeGenreIds: number[];
  actors: PersonOption[];
  directors: PersonOption[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  regions: Region[];
  initialQuery?: string;
  isLoggedIn?: boolean;
  lockStreamable?: boolean;
}

const LANGUAGE_OPTIONS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "da", label: "Danish" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "th", label: "Thai" },
  { code: "ru", label: "Russian" },
  { code: "nl", label: "Dutch" },
];

const SORT_OPTIONS: { value: SortBy; label: string }[] = [
  { value: "popularity.desc", label: "Popularity (High to low)" },
  { value: "popularity.asc", label: "Popularity (Low to high)" },
  { value: "release.desc", label: "Release date (Newest)" },
  { value: "release.asc", label: "Release date (Oldest)" },
];
const CONTENT_MODE_LABEL: Record<ContentMode, string> = {
  all: "All content",
  available: "Available",
  streamable: "Streamable",
};
const YEAR_MIN = 1874;
const YEAR_MAX = new Date().getFullYear();
const TMDB_IMG = "https://image.tmdb.org/t/p";
const TIMELINE_THUMB_PX = 16;
const PERSON_AVATAR_SIZE_CLASSES = {
  chip: "w-5 h-5 text-[10px]",
  suggestion: "w-8 h-8 text-xs",
} as const;

function buildDefaultFilters(initialQuery?: string): AdvancedFilters {
  return {
    query: initialQuery || "",
    mediaType: "mix",
    country: "",
    language: "",
    releaseYear: "",
    useYearSpan: false,
    yearSpanStart: YEAR_MIN,
    yearSpanEnd: YEAR_MAX,
    runtimeMin: "",
    runtimeMax: "",
    sortBy: "popularity.desc",
    includeGenreIds: [],
    excludeGenreIds: [],
    actors: [],
    directors: [],
  };
}

function toOptionalInt(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function sanitizeYearDraft(value: string): string {
  return value.replace(/\D/g, "").slice(0, 4);
}

function yearToPercent(year: number, min: number, max: number): number {
  const span = Math.max(1, max - min);
  return ((year - min) / span) * 100;
}

function sliderCenterLeftFromPercent(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const half = TIMELINE_THUMB_PX / 2;
  const deltaPx = half - (TIMELINE_THUMB_PX * clamped) / 100;
  return `calc(${clamped}% + ${deltaPx.toFixed(3)}px)`;
}

function sliderCenterRightFromPercent(percent: number): string {
  const clamped = Math.max(0, Math.min(100, percent));
  const half = TIMELINE_THUMB_PX / 2;
  const deltaPx = -half + (TIMELINE_THUMB_PX * clamped) / 100;
  return `calc(${100 - clamped}% + ${deltaPx.toFixed(3)}px)`;
}

function getTimelineMajorYears(min: number, max: number): number[] {
  const candidates = [min, 1900, 1950, 2000, max];
  const years: number[] = [];
  for (const year of candidates) {
    if (year < min || year > max) continue;
    if (years.includes(year)) continue;
    years.push(year);
  }
  return years;
}

function getTimelineTickYears(min: number, max: number): number[] {
  const ticks: number[] = [min];
  const firstDecade = Math.ceil(min / 10) * 10;
  for (let year = firstDecade; year < max; year += 10) {
    if (year > min) ticks.push(year);
  }
  if (max !== min) ticks.push(max);
  return ticks;
}

function mergeUniqueResults(existing: Movie[], incoming: Movie[]): Movie[] {
  const seen = new Set(existing.map((item) => `${item.media_type || "movie"}:${item.id}`));
  const merged = [...existing];
  for (const item of incoming) {
    const key = `${item.media_type || "movie"}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged;
}

interface PeopleFieldProps {
  label: string;
  selected: PersonOption[];
  inputValue: string;
  onInputChange: (next: string) => void;
  onAdd: (person: PersonOption) => void;
  onRemove: (personId: number) => void;
  suggestions: PersonOption[];
  loading: boolean;
  placeholder: string;
}

function PersonAvatar({
  person,
  size,
}: {
  person: PersonOption;
  size: keyof typeof PERSON_AVATAR_SIZE_CLASSES;
}) {
  const sizeClass = PERSON_AVATAR_SIZE_CLASSES[size];
  const initial = person.name.trim().charAt(0).toUpperCase() || "?";

  if (person.profile_path) {
    return (
      <img
        src={`${TMDB_IMG}/w92${person.profile_path}`}
        alt=""
        className={`${sizeClass} rounded-full object-cover border border-border/70 flex-shrink-0`}
      />
    );
  }

  return (
    <span
      className={`${sizeClass} rounded-full bg-panel-2 border border-border/70 text-muted font-semibold inline-flex items-center justify-center flex-shrink-0`}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

function PeopleField({
  label,
  selected,
  inputValue,
  onInputChange,
  onAdd,
  onRemove,
  suggestions,
  loading,
  placeholder,
}: PeopleFieldProps) {
  return (
    <div className="space-y-2">
      <label className="text-xs uppercase tracking-wide text-muted">{label}</label>
      <div className="flex flex-wrap gap-2 min-h-[34px]">
        {selected.map((person) => (
          <button
            key={person.id}
            onClick={() => onRemove(person.id)}
            className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-accent/40 bg-accent/10 text-xs text-text hover:border-accent transition-colors"
            title="Remove"
          >
            <PersonAvatar person={person} size="chip" />
            <span>{person.name}</span>
            <span className="text-muted">&times;</span>
          </button>
        ))}
      </div>
      <div className="relative">
        <input
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          placeholder={placeholder}
          className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
        />
        {(loading || suggestions.length > 0) && (
          <div className="absolute left-0 right-0 top-[calc(100%+0.35rem)] border border-border rounded-xl bg-panel shadow-[0_12px_30px_rgba(0,0,0,0.45)] z-20 max-h-48 overflow-auto">
            {loading ? (
              <div className="py-3 text-center text-xs text-muted">Searching...</div>
            ) : (
              suggestions.map((person) => (
                <button
                  key={person.id}
                  onClick={() => onAdd(person)}
                  className="w-full text-left px-3 py-2.5 hover:bg-white/[0.04] transition-colors flex items-center gap-2.5"
                >
                  <PersonAvatar person={person} size="suggestion" />
                  <span className="min-w-0">
                    <span className="block text-sm text-text truncate">{person.name}</span>
                    {person.known_for_department && (
                      <span className="block text-xs text-muted mt-0.5">{person.known_for_department}</span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdvancedSearchModal({
  open,
  onClose,
  onSelectMovie,
  regions,
  initialQuery,
  isLoggedIn = false,
  lockStreamable = false,
}: Props) {
  const { providerIds, countries } = useConfig();
  const [filters, setFilters] = useState<AdvancedFilters>(() => buildDefaultFilters(initialQuery));
  const [genres, setGenres] = useState<GenreOption[]>([]);
  const [genresLoading, setGenresLoading] = useState(false);
  const [results, setResults] = useState<Movie[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [actorInput, setActorInput] = useState("");
  const [directorInput, setDirectorInput] = useState("");
  const [actorSuggestions, setActorSuggestions] = useState<PersonOption[]>([]);
  const [directorSuggestions, setDirectorSuggestions] = useState<PersonOption[]>([]);
  const [actorLookupLoading, setActorLookupLoading] = useState(false);
  const [directorLookupLoading, setDirectorLookupLoading] = useState(false);
  const [localVpn, setLocalVpn] = useState(false);
  const [contentMode, setContentMode] = useState<ContentMode>(lockStreamable ? "streamable" : "all");
  const [yearSpanStartDraft, setYearSpanStartDraft] = useState(String(YEAR_MIN));
  const [yearSpanEndDraft, setYearSpanEndDraft] = useState(String(YEAR_MAX));
  const didInitializeRef = useRef(false);

  const selectedActorIds = useMemo(() => new Set(filters.actors.map((person) => person.id)), [filters.actors]);
  const selectedDirectorIds = useMemo(() => new Set(filters.directors.map((person) => person.id)), [filters.directors]);
  const yearSpanStart = Math.min(filters.yearSpanStart, filters.yearSpanEnd);
  const yearSpanEnd = Math.max(filters.yearSpanStart, filters.yearSpanEnd);
  const yearSpanLeft = yearToPercent(yearSpanStart, YEAR_MIN, YEAR_MAX);
  const yearSpanRight = yearToPercent(yearSpanEnd, YEAR_MIN, YEAR_MAX);
  const timelineMajorYears = getTimelineMajorYears(YEAR_MIN, YEAR_MAX);
  const timelineTickYears = getTimelineTickYears(YEAR_MIN, YEAR_MAX);
  const exactYearChosen = filters.releaseYear.trim().length > 0;
  const releaseYearDisabled = filters.useYearSpan;
  const timelineDisabled = !filters.useYearSpan || exactYearChosen;
  const filteredMode = isLoggedIn && (lockStreamable || contentMode !== "all");
  const missingProvidersForFilteredMode = filteredMode && providerIds.size === 0;

  const commitYearSpanStart = useCallback((rawValue: string) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) {
      setYearSpanStartDraft(String(yearSpanStart));
      return;
    }
    const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parsed));
    const nextStart = Math.min(clamped, yearSpanEnd);
    setFilters((prev) => ({ ...prev, yearSpanStart: nextStart, yearSpanEnd }));
    setYearSpanStartDraft(String(nextStart));
  }, [yearSpanStart, yearSpanEnd]);

  const commitYearSpanEnd = useCallback((rawValue: string) => {
    const parsed = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(parsed)) {
      setYearSpanEndDraft(String(yearSpanEnd));
      return;
    }
    const clamped = Math.max(YEAR_MIN, Math.min(YEAR_MAX, parsed));
    const nextEnd = Math.max(clamped, yearSpanStart);
    setFilters((prev) => ({ ...prev, yearSpanStart, yearSpanEnd: nextEnd }));
    setYearSpanEndDraft(String(nextEnd));
  }, [yearSpanStart, yearSpanEnd]);

  const loadGenres = useCallback(async () => {
    setGenresLoading(true);
    try {
      const genreMedia = filters.mediaType === "mix" ? "mix" : filters.mediaType;
      const items = await getGenres(genreMedia);
      setGenres(items);
    } catch {
      setGenres([]);
    } finally {
      setGenresLoading(false);
    }
  }, [filters.mediaType]);

  const executeSearch = useCallback(
    async (
      page: number,
      append: boolean,
      overrides?: { vpn?: boolean; contentMode?: ContentMode }
    ) => {
      const effectiveContentMode = overrides?.contentMode ?? contentMode;
      const effectiveVpn = overrides?.vpn ?? localVpn;
      const effectiveFilteredMode = isLoggedIn && (lockStreamable || effectiveContentMode !== "all");
      const effectiveIncludePaidMode = !lockStreamable && effectiveContentMode === "available";
      const effectiveMissingProviders = effectiveFilteredMode && providerIds.size === 0;

      if (effectiveMissingProviders) {
        setResults([]);
        setSearched(true);
        setHasMore(false);
        setNextPage(null);
        setError("");
        return;
      }
      if (loading || loadingMore) return;
      setError("");
      if (append) setLoadingMore(true);
      else {
        setLoading(true);
        // For fresh searches (including toggle changes), clear stale posters
        // so the spinner is shown immediately.
        setResults([]);
        setHasMore(false);
        setNextPage(null);
      }

      try {
        const spanStart = Math.min(filters.yearSpanStart, filters.yearSpanEnd);
        const spanEnd = Math.max(filters.yearSpanStart, filters.yearSpanEnd);
        const exactYearRaw = filters.useYearSpan ? undefined : toOptionalInt(filters.releaseYear);
        const exactYear = typeof exactYearRaw === "number"
          ? Math.max(YEAR_MIN, Math.min(YEAR_MAX, exactYearRaw))
          : undefined;
        const yearFrom = exactYear ?? (filters.useYearSpan ? spanStart : undefined);
        const yearTo = exactYear ?? (filters.useYearSpan ? spanEnd : undefined);
        const response: AdvancedSearchResponse = await searchAdvanced({
          page,
          limit: 24,
          mediaType: filters.mediaType,
          query: filters.query.trim() || undefined,
          country: filters.country || undefined,
          language: filters.language || undefined,
          yearFrom,
          yearTo,
          genreIds: filters.includeGenreIds,
          excludeGenreIds: filters.excludeGenreIds,
          actorIds: filters.actors.map((person) => person.id),
          directorIds: filters.directors.map((person) => person.id),
          runtimeMin: filters.mediaType === "movie" ? toOptionalInt(filters.runtimeMin) : undefined,
          runtimeMax: filters.mediaType === "movie" ? toOptionalInt(filters.runtimeMax) : undefined,
          sortBy: filters.sortBy,
          contentMode: effectiveFilteredMode ? effectiveContentMode : "all",
          providerIds: effectiveFilteredMode ? Array.from(providerIds) : undefined,
          countries: effectiveFilteredMode && !effectiveVpn ? countries : undefined,
          vpn: effectiveFilteredMode ? effectiveVpn : false,
          includePaid: effectiveFilteredMode && effectiveIncludePaidMode,
        });
        const incoming = response.results || [];
        const resolvedNextPage =
          typeof response.next_page === "number" && response.next_page > page
            ? response.next_page
            : null;
        const canLoadMore = resolvedNextPage !== null && incoming.length > 0;
        setResults((prev) => (append ? mergeUniqueResults(prev, incoming) : incoming));
        setNextPage(canLoadMore ? resolvedNextPage : null);
        setHasMore(canLoadMore);
        setSearched(true);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not run advanced search.";
        setError(message);
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [
      loading,
      loadingMore,
      filters,
      isLoggedIn,
      contentMode,
      providerIds,
      localVpn,
      countries,
      lockStreamable,
    ]
  );

  const resetFilters = useCallback(() => {
    setFilters(buildDefaultFilters(initialQuery));
    setLocalVpn(false);
    setContentMode(lockStreamable ? "streamable" : "all");
    setActorInput("");
    setDirectorInput("");
    setActorSuggestions([]);
    setDirectorSuggestions([]);
    setResults([]);
    setSearched(false);
    setHasMore(false);
    setNextPage(null);
    setError("");
  }, [initialQuery, lockStreamable]);

  useEffect(() => {
    if (!open) return;
    if (!didInitializeRef.current) {
      setFilters(buildDefaultFilters(initialQuery));
      didInitializeRef.current = true;
    } else if (initialQuery && !filters.query.trim()) {
      setFilters((prev) => ({ ...prev, query: initialQuery }));
    }
  }, [open, initialQuery, filters.query]);

  useEffect(() => {
    if (!open) return;
    setLocalVpn(false);
    setContentMode(lockStreamable ? "streamable" : "all");
  }, [open, lockStreamable]);

  useEffect(() => {
    setYearSpanStartDraft(String(yearSpanStart));
    setYearSpanEndDraft(String(yearSpanEnd));
  }, [yearSpanStart, yearSpanEnd]);

  useEffect(() => {
    if (!open) return;
    loadGenres();
  }, [open, loadGenres]);

  useEffect(() => {
    if (!open) return;
    const term = actorInput.trim();
    if (term.length < 2) {
      setActorSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setActorLookupLoading(true);
      try {
        const people = await searchPeople(term, 8);
        if (!active) return;
        setActorSuggestions(people.filter((person) => !selectedActorIds.has(person.id)));
      } catch {
        if (!active) return;
        setActorSuggestions([]);
      } finally {
        if (active) setActorLookupLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [actorInput, open, selectedActorIds]);

  useEffect(() => {
    if (!open) return;
    const term = directorInput.trim();
    if (term.length < 2) {
      setDirectorSuggestions([]);
      return;
    }
    let active = true;
    const timer = window.setTimeout(async () => {
      setDirectorLookupLoading(true);
      try {
        const people = await searchPeople(term, 8);
        if (!active) return;
        setDirectorSuggestions(people.filter((person) => !selectedDirectorIds.has(person.id)));
      } catch {
        if (!active) return;
        setDirectorSuggestions([]);
      } finally {
        if (active) setDirectorLookupLoading(false);
      }
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [directorInput, open, selectedDirectorIds]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.78)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            initial={{ y: 34, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 34, scale: 0.98 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="relative z-10 w-[min(1180px,96vw)] max-h-[92vh] flex flex-col bg-gradient-to-b from-panel/[0.99] to-bg/[0.98] border border-border rounded-2xl shadow-[0_40px_90px_rgba(0,0,0,0.5)]"
          >
            <div className="flex items-start justify-between gap-4 p-6 sm:p-8 pb-3">
              <div>
                <h3 className="font-display text-2xl">Advanced Search</h3>
                <p className="text-sm text-muted mt-1">Filter by country, language, release year, year span timeline, cast, director, genres, and more.</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div className="overflow-auto px-6 sm:px-8 pb-6">
              <div className="grid grid-cols-1 lg:grid-cols-[1.05fr_0.95fr] gap-5">
                <section className="border border-border rounded-2xl bg-panel/80 p-4 sm:p-5 space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="sm:col-span-2 space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted">Title Keywords</span>
                      <input
                        value={filters.query}
                        onChange={(event) => setFilters((prev) => ({ ...prev, query: event.target.value }))}
                        placeholder="e.g. detective, space, mission"
                        className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                      />
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted">Media Type</span>
                      <select
                        value={filters.mediaType}
                        onChange={(event) => setFilters((prev) => ({ ...prev, mediaType: event.target.value as MediaType }))}
                        className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                      >
                        <option value="mix">All</option>
                        <option value="movie">Movies</option>
                        <option value="tv">TV Shows</option>
                      </select>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted">Origin Country</span>
                      <select
                        value={filters.country}
                        onChange={(event) => setFilters((prev) => ({ ...prev, country: event.target.value }))}
                        className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                      >
                        <option value="">Any country</option>
                        {regions.map((region) => (
                          <option key={region.iso_3166_1} value={region.iso_3166_1}>
                            {region.english_name}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted">Original Language</span>
                      <select
                        value={filters.language}
                        onChange={(event) => setFilters((prev) => ({ ...prev, language: event.target.value }))}
                        className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                      >
                        <option value="">Any language</option>
                        {LANGUAGE_OPTIONS.map((language) => (
                          <option key={language.code} value={language.code}>
                            {language.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="space-y-1.5">
                      <label className="text-xs uppercase tracking-wide text-muted" htmlFor="advanced-release-year">
                        Release Year (Exact)
                      </label>
                      <input
                        id="advanced-release-year"
                        value={filters.releaseYear}
                        onChange={(event) =>
                          setFilters((prev) => ({
                            ...prev,
                            releaseYear: event.target.value,
                          }))
                        }
                        placeholder="e.g. 2019"
                        inputMode="numeric"
                        disabled={releaseYearDisabled}
                        className={`w-full h-[40px] px-3 border rounded-xl text-sm outline-none ${
                          releaseYearDisabled
                            ? "bg-panel-2/70 border-border/60 text-muted cursor-not-allowed opacity-60"
                            : "bg-panel border-border text-text focus:border-accent-2"
                        }`}
                      />
                      <label className="mt-2 inline-flex items-center gap-2 cursor-pointer" htmlFor="advanced-year-span-toggle">
                        <input
                          id="advanced-year-span-toggle"
                          type="checkbox"
                          checked={filters.useYearSpan}
                          onChange={(event) =>
                            setFilters((prev) => ({
                              ...prev,
                              useYearSpan: event.target.checked,
                              releaseYear: event.target.checked ? "" : prev.releaseYear,
                            }))
                          }
                          className="sr-only advanced-year-span-toggle-input"
                        />
                        <span className="advanced-year-span-toggle-track" aria-hidden="true">
                          <span className="advanced-year-span-toggle-knob" />
                        </span>
                        <span className="text-[11px] text-muted uppercase tracking-wide">Search in year span</span>
                      </label>
                    </div>

                    {filters.useYearSpan && (
                      <div
                        className={`sm:col-span-2 space-y-2 border rounded-xl p-3 transition-opacity ${
                          timelineDisabled
                            ? "border-border/60 bg-panel-2/60 opacity-55"
                            : "border-border/70 bg-panel/70"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs uppercase tracking-wide text-muted">Release Year Span Timeline</span>
                          <span className="text-[11px] text-muted">1874 to {YEAR_MAX}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <label className="space-y-1">
                            <span className="text-[11px] uppercase tracking-wide text-muted">From</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={yearSpanStartDraft}
                              disabled={timelineDisabled}
                              onChange={(event) => setYearSpanStartDraft(sanitizeYearDraft(event.target.value))}
                              onBlur={() => commitYearSpanStart(yearSpanStartDraft)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                commitYearSpanStart(yearSpanStartDraft);
                              }}
                              className={`advanced-year-input w-full h-[38px] px-3 border rounded-lg text-sm outline-none ${
                                timelineDisabled
                                  ? "bg-panel-2 border-border/60 text-muted cursor-not-allowed"
                                  : "bg-panel border-border text-text focus:border-accent-2"
                              }`}
                            />
                          </label>
                          <label className="space-y-1">
                            <span className="text-[11px] uppercase tracking-wide text-muted">To</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={yearSpanEndDraft}
                              disabled={timelineDisabled}
                              onChange={(event) => setYearSpanEndDraft(sanitizeYearDraft(event.target.value))}
                              onBlur={() => commitYearSpanEnd(yearSpanEndDraft)}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter") return;
                                event.preventDefault();
                                commitYearSpanEnd(yearSpanEndDraft);
                              }}
                              className={`advanced-year-input w-full h-[38px] px-3 border rounded-lg text-sm outline-none ${
                                timelineDisabled
                                  ? "bg-panel-2 border-border/60 text-muted cursor-not-allowed"
                                  : "bg-panel border-border text-text focus:border-accent-2"
                              }`}
                            />
                          </label>
                        </div>
                        <div className="relative h-9 mt-8">
                          <div className="absolute inset-x-0 -top-6 h-4 text-[10px] text-muted/90 pointer-events-none">
                            {timelineMajorYears.map((year, index) => {
                              const isFirst = index === 0;
                              const isLast = index === timelineMajorYears.length - 1;
                              const leftPercent = yearToPercent(year, YEAR_MIN, YEAR_MAX);
                              return (
                                <span
                                  key={`label-${year}`}
                                  className={`absolute top-0 whitespace-nowrap ${
                                    isFirst
                                      ? "left-0 text-left"
                                      : isLast
                                        ? "right-0 text-right"
                                        : "-translate-x-1/2"
                                  }`}
                                  style={!isFirst && !isLast ? { left: sliderCenterLeftFromPercent(leftPercent) } : undefined}
                                >
                                  {year}
                                </span>
                              );
                            })}
                          </div>
                          {timelineTickYears.map((year) => {
                            const leftPercent = yearToPercent(year, YEAR_MIN, YEAR_MAX);
                            const isMajor = timelineMajorYears.includes(year);
                            return (
                              <span
                                key={`tick-${year}`}
                                className={`absolute -translate-x-1/2 ${
                                  isMajor
                                    ? "-top-2 h-7 border-l-[3px] border-border/90"
                                    : "top-1 h-[8px] border-l-2 border-border/70"
                                }`}
                                style={{ left: sliderCenterLeftFromPercent(leftPercent) }}
                                aria-hidden="true"
                              />
                            );
                          })}
                          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-panel-2 border border-border/70" />
                          <div
                            className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-accent/80"
                            style={{
                              left: sliderCenterLeftFromPercent(yearSpanLeft),
                              right: sliderCenterRightFromPercent(yearSpanRight),
                            }}
                          />
                          <input
                            type="range"
                            min={YEAR_MIN}
                            max={YEAR_MAX}
                            value={yearSpanStart}
                            disabled={timelineDisabled}
                            onChange={(event) =>
                              setFilters((prev) => {
                                const next = Number.parseInt(event.target.value, 10);
                                const end = Math.max(prev.yearSpanStart, prev.yearSpanEnd);
                                return { ...prev, yearSpanStart: Math.min(next, end) };
                              })
                            }
                            className="advanced-year-range"
                          />
                          <input
                            type="range"
                            min={YEAR_MIN}
                            max={YEAR_MAX}
                            value={yearSpanEnd}
                            disabled={timelineDisabled}
                            onChange={(event) =>
                              setFilters((prev) => {
                                const next = Number.parseInt(event.target.value, 10);
                                const start = Math.min(prev.yearSpanStart, prev.yearSpanEnd);
                                return { ...prev, yearSpanEnd: Math.max(next, start) };
                              })
                            }
                            className="advanced-year-range"
                          />
                        </div>
                      </div>
                    )}

                    <label className="sm:col-span-2 space-y-1.5">
                      <span className="text-xs uppercase tracking-wide text-muted">Sort</span>
                      <select
                        value={filters.sortBy}
                        onChange={(event) => setFilters((prev) => ({ ...prev, sortBy: event.target.value as SortBy }))}
                        className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    {filters.mediaType === "movie" && (
                      <>
                        <label className="space-y-1.5">
                          <span className="text-xs uppercase tracking-wide text-muted">Runtime Min (min)</span>
                          <input
                            value={filters.runtimeMin}
                            onChange={(event) => setFilters((prev) => ({ ...prev, runtimeMin: event.target.value }))}
                            placeholder="e.g. 80"
                            inputMode="numeric"
                            className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                          />
                        </label>
                        <label className="space-y-1.5">
                          <span className="text-xs uppercase tracking-wide text-muted">Runtime Max (min)</span>
                          <input
                            value={filters.runtimeMax}
                            onChange={(event) => setFilters((prev) => ({ ...prev, runtimeMax: event.target.value }))}
                            placeholder="e.g. 180"
                            inputMode="numeric"
                            className="w-full h-[40px] px-3 border border-border rounded-xl bg-panel text-text text-sm outline-none focus:border-accent-2"
                          />
                        </label>
                      </>
                    )}
                  </div>
                </section>

                <section className="border border-border rounded-2xl bg-panel/80 p-4 sm:p-5 space-y-4">
                  <PeopleField
                    label="Actors"
                    selected={filters.actors}
                    inputValue={actorInput}
                    onInputChange={setActorInput}
                    onAdd={(person) => {
                      setFilters((prev) => ({ ...prev, actors: [...prev.actors, person] }));
                      setActorInput("");
                      setActorSuggestions([]);
                    }}
                    onRemove={(personId) =>
                      setFilters((prev) => ({ ...prev, actors: prev.actors.filter((person) => person.id !== personId) }))
                    }
                    suggestions={actorSuggestions}
                    loading={actorLookupLoading}
                    placeholder="Search actors..."
                  />

                  <PeopleField
                    label="Directors"
                    selected={filters.directors}
                    inputValue={directorInput}
                    onInputChange={setDirectorInput}
                    onAdd={(person) => {
                      setFilters((prev) => ({ ...prev, directors: [...prev.directors, person] }));
                      setDirectorInput("");
                      setDirectorSuggestions([]);
                    }}
                    onRemove={(personId) =>
                      setFilters((prev) => ({ ...prev, directors: prev.directors.filter((person) => person.id !== personId) }))
                    }
                    suggestions={directorSuggestions}
                    loading={directorLookupLoading}
                    placeholder="Search directors..."
                  />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs uppercase tracking-wide text-muted">Include Genres</label>
                      {genresLoading && <span className="text-xs text-muted">Loading genres...</span>}
                    </div>
                    <div className="max-h-[124px] overflow-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                      {genres.map((genre) => {
                        const active = filters.includeGenreIds.includes(genre.id);
                        return (
                          <button
                            key={`inc-${genre.id}`}
                            onClick={() =>
                              setFilters((prev) => {
                                const isActive = prev.includeGenreIds.includes(genre.id);
                                const includeGenreIds = isActive
                                  ? prev.includeGenreIds.filter((id) => id !== genre.id)
                                  : [...prev.includeGenreIds, genre.id];
                                const excludeGenreIds = prev.excludeGenreIds.filter((id) => id !== genre.id);
                                return { ...prev, includeGenreIds, excludeGenreIds };
                              })
                            }
                            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                              active
                                ? "border-accent/60 bg-accent/12 text-text"
                                : "border-border bg-panel text-muted hover:text-text"
                            }`}
                          >
                            {genre.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs uppercase tracking-wide text-muted">Exclude Genres</label>
                    <div className="max-h-[124px] overflow-auto grid grid-cols-1 sm:grid-cols-2 gap-2 pr-1">
                      {genres.map((genre) => {
                        const active = filters.excludeGenreIds.includes(genre.id);
                        return (
                          <button
                            key={`exc-${genre.id}`}
                            onClick={() =>
                              setFilters((prev) => {
                                const isActive = prev.excludeGenreIds.includes(genre.id);
                                const excludeGenreIds = isActive
                                  ? prev.excludeGenreIds.filter((id) => id !== genre.id)
                                  : [...prev.excludeGenreIds, genre.id];
                                const includeGenreIds = prev.includeGenreIds.filter((id) => id !== genre.id);
                                return { ...prev, excludeGenreIds, includeGenreIds };
                              })
                            }
                            className={`text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                              active
                                ? "border-[#ba4c4c]/70 bg-[#ba4c4c]/15 text-text"
                                : "border-border bg-panel text-muted hover:text-text"
                            }`}
                          >
                            {genre.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </section>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 mt-5">
                <div className="flex flex-wrap items-center gap-2 max-sm:w-full max-sm:justify-center">
                  {isLoggedIn && (
                    <>
                      <button
                        onClick={() => {
                          const next = !localVpn;
                          setLocalVpn(next);
                          if (searched) void executeSearch(1, false, { vpn: next });
                        }}
                        aria-pressed={localVpn}
                        className={`h-[40px] px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
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

                      {!lockStreamable && (
                        <button
                          onClick={() => {
                            const next: ContentMode =
                              contentMode === "all"
                                ? "available"
                                : contentMode === "available"
                                  ? "streamable"
                                  : "all";
                            setContentMode(next);
                            if (searched) void executeSearch(1, false, { contentMode: next });
                          }}
                          className={`h-[40px] px-3 border rounded-full text-sm transition-colors flex items-center justify-between gap-3 ${
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
                      )}
                    </>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 justify-end max-sm:w-full max-sm:justify-center">
                  <button
                    onClick={resetFilters}
                    className="h-[40px] px-4 border border-border rounded-full text-sm text-muted hover:text-text hover:border-accent-2 transition-colors"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => executeSearch(1, false)}
                    disabled={loading}
                    className="h-[40px] px-5 border border-accent/60 rounded-full text-sm font-medium bg-accent/15 text-text hover:border-accent transition-colors disabled:opacity-50"
                  >
                    {loading ? "Searching..." : "Run Advanced Search"}
                  </button>
                </div>
              </div>

              {error && (
                <div className="mt-3 rounded-xl border border-[#ba4c4c]/70 bg-[#ba4c4c]/12 px-3 py-2 text-sm text-[#ffb9b9]">
                  {error}
                </div>
              )}

              <div className="mt-5 pt-5 border-t border-border/80">
                {missingProvidersForFilteredMode ? (
                  <div className="text-center text-muted py-10">
                    Select streaming services to see {contentMode === "available" ? "available" : "streamable"} results.
                  </div>
                ) : loading && results.length === 0 ? (
                  <div className="py-12 flex justify-center">
                    <Spinner />
                  </div>
                ) : results.length === 0 ? (
                  <div className="text-center text-muted py-10">
                    {searched ? "No matches for those filters." : "No results yet. Click “Run Advanced Search” to begin."}
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
                      {results.map((movie, index) => (
                        <MovieCard
                          key={`${movie.media_type || "movie"}:${movie.id}`}
                          id={movie.id}
                          title={movie.title}
                          posterPath={movie.poster_path}
                          posterUrl={movie.poster_url}
                          releaseDate={movie.release_date}
                          onClick={(id, mediaType) => {
                            onSelectMovie(id, mediaType);
                          }}
                          index={index}
                          fill
                          mediaType={movie.media_type}
                        />
                      ))}
                    </div>

                    {(loadingMore || !!nextPage) && (
                      <div className="flex justify-center pt-6">
                        <button
                          onClick={() => {
                            if (!nextPage) return;
                            executeSearch(nextPage, true);
                          }}
                          disabled={!nextPage || loadingMore}
                          className="h-[40px] px-5 border border-border rounded-full text-sm text-muted hover:text-text hover:border-accent-2 transition-colors disabled:opacity-45"
                        >
                          {loadingMore ? "Loading..." : "Load More"}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
