import { useState, useEffect, useCallback, useRef } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ConfigProvider, useConfig } from "./hooks/useConfig";
import Topbar from "./components/Topbar";
import HeroSection from "./components/HeroSection";
import MovieRow from "./components/MovieRow";
import MovieOverlay from "./components/MovieOverlay";
import SectionOverlay from "./components/SectionOverlay";
import AuthModal from "./components/AuthModal";
import SettingsModal from "./components/SettingsModal";
import ProfileModal from "./components/ProfileModal";
import OnboardingModal from "./components/OnboardingModal";
import { SkeletonRow } from "./components/Skeleton";
import Spinner from "./components/Spinner";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { getHome, getRegions, type HomeSection, type Region, type MediaType } from "./api/movies";

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "mix", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
];
const GUEST_COUNTRY_STORAGE_KEY = "guest_country";
const DEFAULT_ONBOARDING_COUNTRY = "US";

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { providerIds, countries, loadConfig, saveConfig } = useConfig();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [countriesModalOpen, setCountriesModalOpen] = useState(false);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<number | null>(null);
  const [selectedMovieType, setSelectedMovieType] = useState<"movie" | "tv">("movie");
  const [selectedSection, setSelectedSection] = useState<HomeSection | null>(null);
  const [mediaType, setMediaType] = useState<MediaType>("mix");
  const [rowResetToken, setRowResetToken] = useState(0);
  const [showAllForUser, setShowAllForUser] = useState(false);
  const [guestCountry, setGuestCountry] = useState(() => {
    try {
      const saved = localStorage.getItem(GUEST_COUNTRY_STORAGE_KEY);
      return saved || "US";
    } catch {
      return "US";
    }
  });

  const [sections, setSections] = useState<HomeSection[]>([]);
  const [homePage, setHomePage] = useState(1);
  const [homeHasMore, setHomeHasMore] = useState(true);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeInitialized, setHomeInitialized] = useState(false);

  // Cache for each media type to avoid refetching on toggle
  const sectionsCacheRef = useRef<Record<MediaType, { sections: HomeSection[]; page: number; hasMore: boolean } | null>>({
    mix: null,
    movie: null,
    tv: null,
  });
  // Track cache key to know when to invalidate
  const cacheKeyRef = useRef<string>("");
  // Prefetch cache for next page
  const prefetchCacheRef = useRef<Record<MediaType, { page: number; data: HomeSection[]; hasMore: boolean } | null>>({
    mix: null,
    movie: null,
    tv: null,
  });

  const [regions, setRegions] = useState<Region[]>([]);
  const [countryNameMap, setCountryNameMap] = useState<Record<string, string>>({});

  // Load regions once
  useEffect(() => {
    getRegions().then((r) => {
      r.sort((a, b) => a.english_name.localeCompare(b.english_name));
      setRegions(r);
      const map: Record<string, string> = {};
      for (const reg of r) map[reg.iso_3166_1] = reg.english_name;
      setCountryNameMap(map);
    });
  }, []);

  // After auth, load config and home
  useEffect(() => {
    if (authLoading) return;
    if (user) {
      loadConfig().then(() => setHomeInitialized(true));
    } else {
      setHomeInitialized(true);
    }
  }, [user, authLoading]);

  // Load home rows when config is ready or media type changes
  useEffect(() => {
    if (!homeInitialized) return;

    // Build cache key from config values
    const providerKey = Array.from(providerIds).sort().join(",");
    const countryKey = countries.join(",");
    const newCacheKey = `${user?.id || "guest"}:${providerKey}:${countryKey}:${guestCountry}:${showAllForUser}`;

    // Clear cache if config changed
    if (cacheKeyRef.current !== newCacheKey) {
      cacheKeyRef.current = newCacheKey;
      sectionsCacheRef.current = { mix: null, movie: null, tv: null };
      prefetchCacheRef.current = { mix: null, movie: null, tv: null };
    }

    // Check if we have cached data for this media type
    const cached = sectionsCacheRef.current[mediaType];
    if (cached) {
      setSections(cached.sections);
      setHomePage(cached.page);
      setHomeHasMore(cached.hasMore);
      return;
    }

    loadHomeRows(true);
  }, [homeInitialized, providerIds, mediaType, user, guestCountry, showAllForUser, countries]);

  // Persist guest country across refreshes; default stays US for first-time visitors.
  useEffect(() => {
    if (user) return;
    localStorage.setItem(GUEST_COUNTRY_STORAGE_KEY, guestCountry);
  }, [user, guestCountry]);

  useEffect(() => {
    if (!regions.length) return;
    if (regions.some((r) => r.iso_3166_1 === guestCountry)) return;
    const fallback = regions.some((r) => r.iso_3166_1 === "US") ? "US" : regions[0].iso_3166_1;
    setGuestCountry(fallback);
  }, [regions, guestCountry]);

  useEffect(() => {
    if (!user || countries.length === 0) return;
    if (!countries.includes(guestCountry)) {
      setGuestCountry(countries[0]);
    }
  }, [user, countries, guestCountry]);

  useEffect(() => {
    if (!user) setShowAllForUser(false);
  }, [user]);

  // Prefetch next page in background
  const prefetchNextPage = useCallback(
    async (nextPage: number, currentMediaType: MediaType) => {
      const unfiltered = !user || showAllForUser;
      const country = unfiltered ? (user ? (countries[0] || DEFAULT_ONBOARDING_COUNTRY) : guestCountry) : undefined;
      const ids = unfiltered ? [] : Array.from(providerIds);
      try {
        const data = await getHome(nextPage, 6, ids, currentMediaType, country, unfiltered);
        prefetchCacheRef.current[currentMediaType] = {
          page: nextPage,
          data: data.sections || [],
          hasMore: data.has_more ?? false,
        };
      } catch {
        // Prefetch failed, ignore
      }
    },
    [user, showAllForUser, countries, guestCountry, providerIds]
  );

  const loadHomeRows = useCallback(
    async (reset = false) => {
      if (!reset && homeLoading) return;
      const page = reset ? 1 : homePage;
      if (!reset && !homeHasMore) return;

      // Check if we have prefetched data for this page
      const prefetched = prefetchCacheRef.current[mediaType];
      if (!reset && prefetched && prefetched.page === page) {
        const prefetchedSections = prefetched.data;
        const prefetchedHasMore = prefetched.hasMore;
        prefetchCacheRef.current[mediaType] = null;

        setSections((prev) => {
          const existingIds = new Set(prev.map((s) => s.id));
          const added = prefetchedSections.filter((s) => !existingIds.has(s.id));
          const merged = [...prev, ...added];
          sectionsCacheRef.current[mediaType] = { sections: merged, page: page + 1, hasMore: prefetchedHasMore };
          return merged;
        });
        setHomeHasMore(prefetchedHasMore);
        setHomePage(page + 1);

        // Prefetch the next page
        if (prefetchedHasMore) {
          prefetchNextPage(page + 1, mediaType);
        }
        return;
      }

      setHomeLoading(true);
      try {
        const unfiltered = !user || showAllForUser;
        const country = unfiltered ? (user ? (countries[0] || DEFAULT_ONBOARDING_COUNTRY) : guestCountry) : undefined;
        const ids = unfiltered ? [] : Array.from(providerIds);
        const data = await getHome(page, 6, ids, mediaType, country, unfiltered);
        const newHasMore = data.has_more ?? false;
        const newPage = data.next_page ?? page + 1;

        if (reset) {
          const newSections = data.sections || [];
          setSections(newSections);
          setHomeHasMore(newHasMore);
          setHomePage(newPage);
          sectionsCacheRef.current[mediaType] = { sections: newSections, page: newPage, hasMore: newHasMore };

          // Prefetch the next page after initial load
          if (newHasMore) {
            prefetchNextPage(newPage, mediaType);
          }
        } else {
          setSections((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            const added = (data.sections || []).filter((s) => !existingIds.has(s.id));
            const merged = [...prev, ...added];
            sectionsCacheRef.current[mediaType] = { sections: merged, page: newPage, hasMore: newHasMore };
            return merged;
          });
          setHomeHasMore(newHasMore);
          setHomePage(newPage);

          // Prefetch the next page
          if (newHasMore) {
            prefetchNextPage(newPage, mediaType);
          }
        }
      } catch {
        setHomeHasMore(false);
      } finally {
        setHomeLoading(false);
      }
    },
    [homeLoading, homePage, homeHasMore, providerIds, mediaType, user, guestCountry, showAllForUser, countries, prefetchNextPage]
  );

  const sentinelRef = useInfiniteScroll(
    () => loadHomeRows(false),
    homeHasMore && !homeLoading
  );

  const handleAuthClose = () => {
    setAuthModalOpen(false);
  };

  const handleSignupComplete = () => {
    setIsOnboarding(true);
    setOnboardingOpen(true);
  };

  const handleOnboardingDone = async (selectedCountries: string[]) => {
    const chosenCountries = selectedCountries.length ? selectedCountries : [DEFAULT_ONBOARDING_COUNTRY];
    const shouldOpenServices = selectedCountries.length > 0;
    setOnboardingOpen(false);
    await saveConfig(Array.from(providerIds), chosenCountries);
    if (isOnboarding) {
      setIsOnboarding(false);
      if (shouldOpenServices) setSettingsOpen(true);
    }
  };

  const handleOnboardingClose = () => {
    void handleOnboardingDone([]);
  };

  const handleCountriesDone = async (selectedCountries: string[]) => {
    setCountriesModalOpen(false);
    await saveConfig(Array.from(providerIds), selectedCountries);
    loadHomeRows(true);
  };

  const handleSelectMovie = useCallback((id: number, mt?: "movie" | "tv") => {
    setSelectedMovie(id);
    setSelectedMovieType(mt || "movie");
  }, []);

  const handleMediaTypeChange = (next: MediaType) => {
    setMediaType(next);
    if (next === "mix") setRowResetToken((v) => v + 1);
  };

  const sectionMap = new Map(sections.map((s) => [s.id, s]));
  const unfilteredMode = !user || showAllForUser;
  const discoveryCountry = user ? (countries[0] || DEFAULT_ONBOARDING_COUNTRY) : guestCountry;

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <div className="sticky top-0 z-[120] bg-bg border-b border-border/70">
        <Topbar
          onSelectMovie={handleSelectMovie}
          onLoginClick={() => setAuthModalOpen(true)}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenCountries={() => setCountriesModalOpen(true)}
          mediaType={mediaType}
        />
      </div>

      <main className="page-container flex-1 pt-2 pb-16">
        <div className="flex items-start justify-between gap-6 mb-6 max-sm:flex-col max-sm:items-stretch">
          <HeroSection
            className="mb-0 flex-1"
            showGuestPrompt={!user}
            onLoginClick={() => setAuthModalOpen(true)}
          />
          <div className="flex flex-col items-end gap-2 flex-shrink-0 max-sm:items-stretch">
            {!user && regions.length > 0 && (
              <select
                value={guestCountry}
                onChange={(e) => setGuestCountry(e.target.value)}
                className="h-[42px] w-[248px] px-3 border border-border rounded-full bg-panel text-text text-sm outline-none max-sm:w-full"
              >
                {regions.map((r) => (
                  <option key={r.iso_3166_1} value={r.iso_3166_1}>
                    {countryFlag(r.iso_3166_1)} {r.english_name}
                  </option>
                ))}
              </select>
            )}
            {user && (
              <button
                onClick={() => setShowAllForUser((prev) => !prev)}
                aria-pressed={!showAllForUser}
                className={`h-[42px] w-[248px] px-3 border rounded-full text-sm transition-colors flex items-center justify-between gap-3 max-sm:w-full ${
                  !showAllForUser
                    ? "border-accent/60 bg-accent/10 text-text"
                    : "border-border bg-panel text-text"
                }`}
              >
                <span className="truncate">{showAllForUser ? "Showing everything" : "Showing only my services"}</span>
                <span
                  className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                    !showAllForUser
                      ? "bg-accent border-accent"
                      : "bg-panel-2 border-border"
                  }`}
                >
                  <span
                    className={`absolute inset-y-0 my-auto left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                      !showAllForUser ? "translate-x-4" : ""
                    }`}
                  />
                </span>
              </button>
            )}
            <div className="flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] w-[248px] max-sm:w-full">
              {MEDIA_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => handleMediaTypeChange(opt.value)}
                  className={`flex-1 h-full text-sm font-medium transition-colors ${
                    mediaType === opt.value
                      ? "bg-accent/15 text-text"
                      : "text-muted hover:text-text"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-6 sm:gap-10">
          {sections.map((section) => (
            <MovieRow
              key={`${section.id}:${rowResetToken}`}
              section={section}
              onSelectMovie={handleSelectMovie}
              onSeeMore={(id) => setSelectedSection(sectionMap.get(id) || null)}
              resetToken={rowResetToken}
              mediaType={mediaType}
            />
          ))}

          {homeLoading && sections.length === 0 && (
            <>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </>
          )}

          {(homeLoading || homeHasMore) && sections.length > 0 && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <Spinner />
            </div>
          )}

          {!homeLoading && sections.length === 0 && user && (
            <div className="text-center text-muted py-12">
              Select streaming services to see available titles.
            </div>
          )}
        </section>
      </main>

      <footer className="text-center py-6 text-muted text-sm">
        Streaming data provided by JustWatch via TMDB
      </footer>

      <MovieOverlay
        movieId={selectedMovie}
        onClose={() => setSelectedMovie(null)}
        countryNameMap={countryNameMap}
        itemMediaType={selectedMovieType}
        guestCountry={!user ? guestCountry : undefined}
      />

      <SectionOverlay
        section={selectedSection}
        onClose={() => setSelectedSection(null)}
        onSelectMovie={handleSelectMovie}
        mediaType={mediaType}
        country={unfilteredMode ? discoveryCountry : undefined}
        unfiltered={unfilteredMode}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => loadHomeRows(true)}
        countryNameMap={countryNameMap}
      />

      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
      />

      {/* Onboarding (post-signup) */}
      <OnboardingModal
        open={onboardingOpen}
        regions={regions}
        countryNameMap={countryNameMap}
        onDone={handleOnboardingDone}
        onClose={handleOnboardingClose}
      />

      {/* Edit countries from dropdown */}
      <OnboardingModal
        open={countriesModalOpen}
        regions={regions}
        countryNameMap={countryNameMap}
        initialCountries={countries}
        onDone={handleCountriesDone}
        onClose={() => setCountriesModalOpen(false)}
      />

      <AuthModal
        open={authModalOpen}
        onClose={handleAuthClose}
        onSignupComplete={handleSignupComplete}
      />
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ConfigProvider>
        <AppContent />
      </ConfigProvider>
    </AuthProvider>
  );
}
