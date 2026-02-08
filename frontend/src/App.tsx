import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ConfigProvider, useConfig } from "./hooks/useConfig";
import Topbar from "./components/Topbar";
import HeroSection from "./components/HeroSection";
import MovieRow from "./components/MovieRow";
import MovieOverlay from "./components/MovieOverlay";
import SectionOverlay from "./components/SectionOverlay";
import SearchOverlay from "./components/SearchOverlay";
import AdvancedSearchModal from "./components/AdvancedSearchModal";
import AuthModal from "./components/AuthModal";
import SettingsModal from "./components/SettingsModal";
import ProfileModal from "./components/ProfileModal";
import OnboardingModal from "./components/OnboardingModal";
import VpnPromptModal from "./components/VpnPromptModal";
import { SkeletonRow } from "./components/Skeleton";
import Spinner from "./components/Spinner";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { getHome, getRegions, getGeoCountry, type HomeSection, type Region, type MediaType } from "./api/movies";
import { IOS_BRAVE } from "./utils/platform";

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "mix", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
];
const GUEST_COUNTRY_STORAGE_KEY = "guest_country";
const USER_VIEW_PREFS_STORAGE_PREFIX = "user_view_prefs:";
const DEFAULT_ONBOARDING_COUNTRY = "US";
type UserContentMode = "all" | "available" | "streamable";
const USER_CONTENT_LABEL: Record<UserContentMode, string> = {
  all: "All content",
  available: "Available",
  streamable: "Streamable",
};

function userViewPrefsKey(email: string) {
  return `${USER_VIEW_PREFS_STORAGE_PREFIX}${email.trim().toLowerCase()}`;
}

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function AppContent() {
  const { user, loading: authLoading } = useAuth();
  const { providerIds, countries, loadConfig, saveConfig } = useConfig();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<"login" | "signup">("login");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [countriesModalOpen, setCountriesModalOpen] = useState(false);
  const [vpnPromptOpen, setVpnPromptOpen] = useState(false);
  const [vpnPromptCountryCount, setVpnPromptCountryCount] = useState(1);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [pendingVpnPrompt, setPendingVpnPrompt] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<number | null>(null);
  const [selectedMovieType, setSelectedMovieType] = useState<"movie" | "tv">("movie");
  const [selectedSection, setSelectedSection] = useState<HomeSection | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFiltered, setSearchFiltered] = useState(false);
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedSearchInitialQuery, setAdvancedSearchInitialQuery] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("mix");
  const [rowResetToken, setRowResetToken] = useState(0);
  const [userContentMode, setUserContentMode] = useState<UserContentMode>("streamable");
  const [usingVpn, setUsingVpn] = useState(false);
  const [viewPrefsReady, setViewPrefsReady] = useState(false);
  const [guestCountry, setGuestCountry] = useState(() => {
    try {
      return localStorage.getItem(GUEST_COUNTRY_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  });

  const [sections, setSections] = useState<HomeSection[]>([]);
  const [homePage, setHomePage] = useState(1);
  const [homeHasMore, setHomeHasMore] = useState(true);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeInitialized, setHomeInitialized] = useState(false);
  const [mainScrollEl, setMainScrollEl] = useState<HTMLElement | null>(null);
  const useScopedMainScroll = !IOS_BRAVE;
  const autoLoadCategories = !IOS_BRAVE;

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
  // Track if user was previously logged in (to detect logout)
  const wasLoggedInRef = useRef(false);
  const previousUserKeyRef = useRef<string | null>(null);
  const hasStoredContentModePrefRef = useRef(false);

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

  // Ensure post-login starts at the top instead of retaining previous scroll.
  useEffect(() => {
    if (authLoading) return;
    const currentUserKey = user?.email?.trim().toLowerCase() || (user ? "__logged_in__" : null);
    if (previousUserKeyRef.current === null && currentUserKey !== null) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (useScopedMainScroll) {
        mainScrollEl?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
    }
    previousUserKeyRef.current = currentUserKey;
  }, [authLoading, user?.email, user, mainScrollEl, useScopedMainScroll]);

  // Load home rows when config is ready or media type changes
  useEffect(() => {
    if (!homeInitialized) return;
    // Wait for guest country detection before loading
    if (!user && !guestCountry) return;

    // Build cache key from config values
    const providerKey = Array.from(providerIds).sort().join(",");
    const countryKey = countries.join(",");
    const newCacheKey = `${user?.email || "guest"}:${providerKey}:${countryKey}:${guestCountry}:${userContentMode}:${usingVpn}`;

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

    // Clear sections immediately to show loading spinner
    setSections([]);
    loadHomeRows(true);
  }, [homeInitialized, providerIds, mediaType, user, guestCountry, userContentMode, usingVpn, countries]);

  // Clear guest country on logout so geo-detection runs again
  useEffect(() => {
    if (user) {
      wasLoggedInRef.current = true;
    } else if (wasLoggedInRef.current) {
      // User just logged out - clear guest country to trigger geo-detection
      wasLoggedInRef.current = false;
      localStorage.removeItem(GUEST_COUNTRY_STORAGE_KEY);
      setGuestCountry("");
    }
  }, [user]);

  // Detect country from IP on first visit (no saved country)
  useEffect(() => {
    if (user) return;
    if (guestCountry) return; // Already have a country
    getGeoCountry().then((country) => {
      setGuestCountry(country);
    });
  }, [user, guestCountry]);

  // Persist guest country across refreshes
  useEffect(() => {
    if (user) return;
    if (!guestCountry) return; // Don't persist empty
    localStorage.setItem(GUEST_COUNTRY_STORAGE_KEY, guestCountry);
  }, [user, guestCountry]);

  // Load persisted user view prefs (VPN + content mode).
  useEffect(() => {
    if (!user?.email) {
      hasStoredContentModePrefRef.current = false;
      setViewPrefsReady(false);
      setUsingVpn(false);
      setUserContentMode("streamable");
      return;
    }

    hasStoredContentModePrefRef.current = false;
    let nextUsingVpn = false;
    let nextMode: UserContentMode | null = null;

    try {
      const raw = localStorage.getItem(userViewPrefsKey(user.email));
      if (raw) {
        const parsed = JSON.parse(raw) as {
          usingVpn?: unknown;
          contentMode?: unknown;
          showAllForUser?: unknown;
        };
        if (typeof parsed.usingVpn === "boolean") nextUsingVpn = parsed.usingVpn;
        if (parsed.contentMode === "all" || parsed.contentMode === "available" || parsed.contentMode === "streamable") {
          nextMode = parsed.contentMode;
          hasStoredContentModePrefRef.current = true;
        } else if (typeof parsed.showAllForUser === "boolean") {
          // Backward compatibility with previous boolean setting.
          nextMode = parsed.showAllForUser ? "available" : "streamable";
          hasStoredContentModePrefRef.current = true;
        }
      }
    } catch {
      // Ignore malformed localStorage values.
    }

    setUsingVpn(nextUsingVpn);
    if (nextMode !== null) setUserContentMode(nextMode);
    setViewPrefsReady(true);
  }, [user?.email]);

  // Fallback if detected country isn't in available regions
  useEffect(() => {
    if (!regions.length) return;
    if (!guestCountry) return;
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
    if (!user) {
      setUserContentMode("streamable");
      return;
    }
    if (!viewPrefsReady) return;
    if (hasStoredContentModePrefRef.current) return;
    if (providerIds.size === 0) {
      // With no services, default to fully unfiltered content.
      setUserContentMode("all");
    } else {
      // With services, default to stream-only.
      setUserContentMode("streamable");
    }
  }, [user, providerIds.size, viewPrefsReady]);

  // Persist VPN + content mode across logout/login.
  useEffect(() => {
    if (!user?.email || !viewPrefsReady) return;
    try {
      localStorage.setItem(
        userViewPrefsKey(user.email),
        JSON.stringify({
          usingVpn,
          contentMode: userContentMode,
        })
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [user?.email, viewPrefsReady, usingVpn, userContentMode]);

  // Prefetch next page in background
  const prefetchNextPage = useCallback(
    async (nextPage: number, currentMediaType: MediaType) => {
      if (IOS_BRAVE) return;
      const isGuest = !user;
      const unfiltered = isGuest || userContentMode === "all";
      const includePaid = !!user && userContentMode === "available";
      const country = unfiltered ? guestCountry : undefined;
      const scopedCountries = user && !usingVpn ? countries : undefined;
      const ids = unfiltered ? [] : Array.from(providerIds);
      try {
        const data = await getHome(nextPage, 6, ids, currentMediaType, country, unfiltered, usingVpn, includePaid, scopedCountries);
        prefetchCacheRef.current[currentMediaType] = {
          page: nextPage,
          data: data.sections || [],
          hasMore: data.has_more ?? false,
        };
      } catch {
        // Prefetch failed, ignore
      }
    },
    [user, userContentMode, countries, guestCountry, providerIds, usingVpn]
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
        const homePageSize = IOS_BRAVE ? 4 : 6;
        const isGuest = !user;
        const unfiltered = isGuest || userContentMode === "all";
        const includePaid = !!user && userContentMode === "available";
        const country = unfiltered ? guestCountry : undefined;
        const scopedCountries = user && !usingVpn ? countries : undefined;
        const ids = unfiltered ? [] : Array.from(providerIds);
        const data = await getHome(page, homePageSize, ids, mediaType, country, unfiltered, usingVpn, includePaid, scopedCountries);
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
    [homeLoading, homePage, homeHasMore, providerIds, mediaType, user, guestCountry, userContentMode, countries, usingVpn, prefetchNextPage]
  );

  const sentinelRef = useInfiniteScroll(
    () => loadHomeRows(false),
    autoLoadCategories && homeHasMore && !homeLoading,
    useScopedMainScroll ? mainScrollEl : undefined
  );

  const handleAuthClose = () => {
    setAuthModalOpen(false);
  };

  const openAuthModal = useCallback((mode: "login" | "signup" = "login") => {
    setAuthInitialMode(mode);
    setAuthModalOpen(true);
  }, []);

  useEffect(() => {
    if (authLoading || user) return;
    let mode: "login" | "signup" | null = null;
    try {
      const params = new URLSearchParams(window.location.search);
      const authParam = params.get("auth");
      if (authParam === "login" || authParam === "signup") {
        mode = authParam;
      }
    } catch {
      mode = null;
    }
    if (!mode) return;
    openAuthModal(mode);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("auth");
      const nextSearch = url.searchParams.toString();
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`
      );
    } catch {
      // Ignore URL rewrite failures.
    }
  }, [authLoading, user, openAuthModal]);

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
      setPendingVpnPrompt(shouldOpenServices);
      setVpnPromptCountryCount(Math.max(1, chosenCountries.length));
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

  const handleSettingsSaved = () => {
    loadHomeRows(true);
    if (pendingVpnPrompt) {
      setPendingVpnPrompt(false);
      setVpnPromptOpen(true);
    }
  };

  const handleSettingsClose = () => {
    setSettingsOpen(false);
    if (pendingVpnPrompt) setPendingVpnPrompt(false);
  };

  const handleSelectMovie = useCallback((id: number, mt?: "movie" | "tv") => {
    setSelectedMovie(id);
    setSelectedMovieType(mt || "movie");
  }, []);

  const handleSearchSubmit = useCallback((q: string, filtered: boolean) => {
    setSearchQuery(q);
    setSearchFiltered(filtered);
    setSearchOpen(true);
  }, []);

  const handleOpenAdvancedSearch = useCallback((initialQuery: string) => {
    setAdvancedSearchInitialQuery(initialQuery);
    setAdvancedSearchOpen(true);
  }, []);

  const handleMediaTypeChange = (next: MediaType) => {
    setMediaType(next);
    if (next === "mix") setRowResetToken((v) => v + 1);
  };

  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const handleSeeMore = useCallback(
    (id: string) => {
      setSelectedSection(sectionMap.get(id) || null);
    },
    [sectionMap]
  );
  const unfilteredMode = !user || userContentMode === "all";
  const includePaidMode = !!user && userContentMode === "available";
  const discoveryCountry = user
    ? (countries[0] || DEFAULT_ONBOARDING_COUNTRY)
    : (guestCountry || DEFAULT_ONBOARDING_COUNTRY);
  const hasBlockingOverlay =
    selectedMovie !== null ||
    selectedSection !== null ||
    searchOpen ||
    advancedSearchOpen ||
    settingsOpen ||
    profileOpen ||
    onboardingOpen ||
    countriesModalOpen ||
    authModalOpen ||
    vpnPromptOpen;

  useEffect(() => {
    if (hasBlockingOverlay) {
      document.documentElement.classList.add("overflow-hidden");
      document.body.classList.add("overflow-hidden");
    } else {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    }
    return () => {
      document.documentElement.classList.remove("overflow-hidden");
      document.body.classList.remove("overflow-hidden");
    };
  }, [hasBlockingOverlay]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className={useScopedMainScroll ? "h-[100dvh] overflow-hidden flex flex-col" : "min-h-screen flex flex-col"}>
      <div className={`z-[120] bg-bg border-b border-border/70 ${useScopedMainScroll ? "flex-shrink-0" : "sticky top-0"}`}>
        <Topbar
          onSelectMovie={handleSelectMovie}
          onLoginClick={() => openAuthModal("login")}
          onOpenProfile={() => setProfileOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenCountries={() => setCountriesModalOpen(true)}
          vpnEnabled={usingVpn}
          onSearchSubmit={handleSearchSubmit}
          onOpenAdvancedSearch={handleOpenAdvancedSearch}
          scrollContainer={useScopedMainScroll ? mainScrollEl : null}
        />
      </div>

      <main
        ref={useScopedMainScroll ? setMainScrollEl : undefined}
        className={`flex-1 ${useScopedMainScroll ? "min-h-0" : ""} ${
          useScopedMainScroll
            ? hasBlockingOverlay
              ? "overflow-hidden"
              : "overflow-y-auto"
            : ""
        }`}
      >
        <div className="page-container pt-2 pb-16">
          <div className="flex items-stretch justify-between gap-6 mb-6 max-sm:flex-col max-sm:gap-3">
          <HeroSection
            className="!mb-0 flex-1"
            showGuestPrompt={!user}
            onLoginClick={() => openAuthModal("login")}
            onSignupClick={() => openAuthModal("signup")}
          />
          <div className="flex flex-col items-end justify-end gap-2 flex-shrink-0 max-sm:items-stretch max-sm:justify-start">
            {!user && regions.length > 0 && guestCountry && (
              <select
                value={guestCountry}
                onChange={(e) => setGuestCountry(e.target.value)}
                className="h-[42px] w-[270px] px-3 border border-border rounded-full bg-panel text-text text-sm outline-none max-sm:w-full"
              >
                {regions.map((r) => (
                  <option key={r.iso_3166_1} value={r.iso_3166_1}>
                    {countryFlag(r.iso_3166_1)} {r.english_name}
                  </option>
                ))}
              </select>
            )}
            {user && (
              <div className="flex items-center gap-2 max-sm:w-full">
                {/* VPN toggle - same width as two icon buttons + gap (80 + 8 + 80 = 168px) */}
                <button
                  onClick={() => setUsingVpn((prev) => !prev)}
                  aria-pressed={usingVpn}
                  className={`h-[42px] w-[168px] px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 max-sm:flex-1 max-sm:w-0 ${
                    usingVpn
                      ? "border-accent/60 bg-accent/10 text-text"
                      : "border-border bg-panel text-muted"
                  }`}
                >
                  <span className="truncate">{usingVpn ? "Using VPN" : "Not using VPN"}</span>
                  <span
                    className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                      usingVpn
                        ? "bg-accent border-accent"
                        : "bg-panel-2 border-border"
                    }`}
                  >
                    <span
                      className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                        usingVpn ? "translate-x-4" : ""
                      }`}
                    />
                  </span>
                </button>
                <button
                  onClick={() => {
                    const nextMode: UserContentMode =
                      userContentMode === "all"
                        ? "available"
                        : userContentMode === "available"
                          ? "streamable"
                          : "all";
                    if (providerIds.size === 0 && nextMode !== "all") {
                      setSettingsOpen(true);
                      return;
                    }
                    setUserContentMode(nextMode);
                  }}
                  aria-label={`Content mode: ${USER_CONTENT_LABEL[userContentMode]}`}
                  className={`h-[42px] w-[270px] px-3 border rounded-full text-sm transition-colors flex items-center justify-between gap-3 max-sm:flex-1 max-sm:w-0 ${
                    userContentMode === "streamable"
                      ? "border-accent/60 bg-accent/10 text-text"
                      : userContentMode === "available"
                        ? "border-accent/40 bg-accent/5 text-text"
                        : "border-border bg-panel text-text"
                  }`}
                >
                  <span className="truncate">{USER_CONTENT_LABEL[userContentMode]}</span>
                  <span
                    className={`relative h-5 w-12 flex-shrink-0 rounded-full border overflow-hidden transition-colors ${
                      userContentMode === "all"
                        ? "bg-panel-2 border-border"
                        : "bg-accent border-accent"
                    }`}
                  >
                    <span className={`absolute left-[9px] top-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${userContentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                    <span className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${userContentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                    <span className={`absolute right-[9px] top-1/2 -translate-y-1/2 h-1 w-1 rounded-full pointer-events-none ${userContentMode === "all" ? "bg-white/35" : "bg-black/35"}`} />
                    <span
                      className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                        userContentMode === "available"
                          ? "translate-x-[14px]"
                          : userContentMode === "streamable"
                            ? "translate-x-[28px]"
                            : ""
                      }`}
                    />
                  </span>
                </button>
              </div>
            )}
            {user && (
              <>
                {/* Icon buttons - own row on mobile with text */}
                <div className="hidden max-sm:flex items-center gap-2 w-full">
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="h-[42px] flex-1 border border-border rounded-full flex items-center justify-center gap-2 hover:border-accent-2 transition-colors bg-panel text-sm text-muted"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8" />
                      <path d="M12 17v4" />
                    </svg>
                    Services
                  </button>
                  <button
                    onClick={() => setCountriesModalOpen(true)}
                    className="h-[42px] flex-1 border border-border rounded-full flex items-center justify-center gap-2 hover:border-accent-2 transition-colors bg-panel text-sm text-muted"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                    Countries
                  </button>
                </div>
                {/* Desktop: icon buttons + media toggle in same row */}
                <div className="flex items-center gap-2 max-sm:hidden">
                  <button
                    onClick={() => setSettingsOpen(true)}
                    className="h-[42px] w-[80px] border border-border rounded-full flex items-center justify-center hover:border-accent-2 transition-colors bg-panel"
                    title="Manage services"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8" />
                      <path d="M12 17v4" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setCountriesModalOpen(true)}
                    className="h-[42px] w-[80px] border border-border rounded-full flex items-center justify-center hover:border-accent-2 transition-colors bg-panel"
                    title="Manage countries"
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="2" y1="12" x2="22" y2="12" />
                      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                    </svg>
                  </button>
                  <div className="flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] w-[270px]">
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
                {/* Mobile: media toggle on its own row */}
                <div className="hidden max-sm:flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] w-full">
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
              </>
            )}
            {!user && (
              <div className="flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] w-[270px] max-sm:w-full">
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
            )}
          </div>
          </div>

          <section className="flex flex-col gap-6 sm:gap-10">
          {sections.map((section) => (
            <MovieRow
              key={`${section.id}:${rowResetToken}`}
              section={section}
              onSelectMovie={handleSelectMovie}
              onSeeMore={handleSeeMore}
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

          {autoLoadCategories && (homeLoading || homeHasMore) && sections.length > 0 && (
            <div ref={sentinelRef} className="flex justify-center py-6">
              <Spinner />
            </div>
          )}

          {!autoLoadCategories && sections.length > 0 && homeHasMore && (
            <div className="flex justify-center py-6">
              <button
                onClick={() => void loadHomeRows(false)}
                disabled={homeLoading}
                className="h-[42px] px-5 border border-border rounded-full text-sm text-muted hover:text-text hover:border-accent-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
              >
                {homeLoading ? "Loading..." : "Load More Categories"}
              </button>
            </div>
          )}

          {!homeLoading && sections.length === 0 && user && userContentMode !== "all" && (
            <div className="text-center text-muted py-12">
              Select streaming services to see available titles.
            </div>
          )}
          </section>

          <footer className="text-center py-6 text-muted text-sm">
            Streaming data provided by JustWatch via TMDB
          </footer>
        </div>
      </main>

      <MovieOverlay
        movieId={selectedMovie}
        onClose={() => setSelectedMovie(null)}
        onSelectMovie={handleSelectMovie}
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
        countries={!unfilteredMode && !usingVpn ? countries : undefined}
        unfiltered={unfilteredMode}
        vpn={usingVpn}
        includePaid={includePaidMode}
      />

      <SearchOverlay
        open={searchOpen}
        query={searchQuery}
        filtered={searchFiltered}
        vpnEnabled={usingVpn}
        isLoggedIn={!!user}
        initialContentMode={searchFiltered ? "streamable" : "all"}
        onClose={() => setSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
      />

      <AdvancedSearchModal
        open={advancedSearchOpen}
        initialQuery={advancedSearchInitialQuery}
        onClose={() => setAdvancedSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
        regions={regions}
        isLoggedIn={!!user}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={handleSettingsClose}
        onSaved={handleSettingsSaved}
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
        initialMode={authInitialMode}
      />

      <VpnPromptModal
        open={vpnPromptOpen}
        onClose={() => setVpnPromptOpen(false)}
        countryCount={vpnPromptCountryCount}
        onSelect={(enabled) => {
          setUsingVpn(enabled);
          setVpnPromptOpen(false);
        }}
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
