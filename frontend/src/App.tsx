import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ConfigProvider, useConfig } from "./hooks/useConfig";
import { WatchlistProvider, useWatchlist } from "./hooks/useWatchlist";
import { WatchedProvider } from "./hooks/useWatched";
import { useWatched } from "./hooks/useWatched";
import { ListsProvider, useLists } from "./hooks/useLists";
import { NotificationsProvider, useNotifications } from "./hooks/useNotifications";
import Topbar from "./components/Topbar";
import HeroSection from "./components/HeroSection";
import MovieRow from "./components/MovieRow";
import MovieOverlay from "./components/MovieOverlay";
import SectionOverlay from "./components/SectionOverlay";
import WatchlistOverlay from "./components/WatchlistOverlay";
import WatchedOverlay from "./components/WatchedOverlay";
import ListsOverlay from "./components/ListsOverlay";
import NotificationsOverlay from "./components/NotificationsOverlay";
import NotificationAlertsOverlay from "./components/NotificationAlertsOverlay";
import SearchOverlay from "./components/SearchOverlay";
import AdvancedSearchModal from "./components/AdvancedSearchModal";
import AuthModal from "./components/AuthModal";
import PremiumShowcaseModal from "./components/PremiumShowcaseModal";
import SettingsCenterModal, {
  type SettingsCenterSection,
  type HomeContentMode,
} from "./components/SettingsCenterModal";
import OnboardingModal from "./components/OnboardingModal";
import VpnPromptModal from "./components/VpnPromptModal";
import { SkeletonRow } from "./components/Skeleton";
import Spinner from "./components/Spinner";
import { useInfiniteScroll } from "./hooks/useInfiniteScroll";
import { getHome, getRegions, getGeoCountry, type HomeSection, type Region, type MediaType } from "./api/movies";
import type { UserListItem } from "./api/lists";
import { checkAuth } from "./api/auth";
import { getBillingStatus } from "./api/billing";
import { IOS_BRAVE } from "./utils/platform";

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "mix", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
];
const GUEST_COUNTRY_STORAGE_KEY = "guest_country";
const USER_VIEW_PREFS_STORAGE_PREFIX = "user_view_prefs:";
const DEFAULT_ONBOARDING_COUNTRY = "US";
type UserContentMode = HomeContentMode;
const USER_CONTENT_LABEL: Record<UserContentMode, string> = {
  all: "All content",
  available: "Available",
  streamable: "Streamable",
};
const SIGNUP_ONBOARDING_STORAGE_KEY = "signup_onboarding_pending";
const USER_LIST_HOME_SECTION_PREFIX = "__userlist__:";
const HOME_SECTION_WATCHLIST_ID = "__home_watchlist__";
const BILLING_RETURN_QUERY_KEY = "billing";
const BILLING_RETURN_QUERY_VALUE = "return";
const BILLING_PLAN_QUERY_KEY = "billing_plan";
type BillingReturnPlan = "monthly" | "yearly" | null;
type PremiumPlanChoice = "monthly" | "yearly";
const PREMIUM_ONLY_SETTINGS_SECTIONS = new Set<SettingsCenterSection>([
  "notifications",
  "home",
  "linked",
]);
interface PremiumFeatureDescriptor {
  id: string;
  title: string;
  detail: string;
}

const PREMIUM_FEATURE_DETAILS: PremiumFeatureDescriptor[] = [
  {
    id: "advanced_search",
    title: "Advanced search filters",
    detail: "Filter by rating, year, genres, runtime, language, and sort options to find the right title faster.",
  },
  {
    id: "multi_country",
    title: "Multiple countries",
    detail: "Track availability across multiple countries at once instead of checking one region at a time.",
  },
  {
    id: "vpn_toggle",
    title: "VPN-aware browsing",
    detail: "Use VPN mode to expand discovery and surface titles available in other regions instantly.",
  },
  {
    id: "streamable_only",
    title: "Streamable-only mode",
    detail: "Focus on titles you can actually watch now on your services instead of endless unavailable results.",
  },
  {
    id: "all_country_services",
    title: "Cross-country service catalog",
    detail: "See services from additional countries to uncover more licensed content you can reach with VPN.",
  },
  {
    id: "watchlist",
    title: "Watchlist",
    detail: "Save titles for later and keep your next picks organized in one place.",
  },
  {
    id: "lists",
    title: "Custom lists",
    detail: "Build and manage themed lists for weekend plans, franchises, favorites, and more.",
  },
  {
    id: "notifications",
    title: "Availability notifications",
    detail: "Get notified when something you care about becomes available on your selected services.",
  },
  {
    id: "no_ads",
    title: "No ads ever",
    detail: "Premium keeps your discovery flow clean and focused with no ads interrupting browsing.",
  },
  {
    id: "upcoming_features",
    title: "Access upcoming features",
    detail: "Get early access to new discovery tools and premium improvements as they roll out.",
  },
  {
    id: "account_sync",
    title: "Sync accounts",
    detail: "Sync external watch history and list data so FullStreamer reflects what you already track elsewhere.",
  },
  {
    id: "support_solo_dev",
    title: "Support solo developer",
    detail: "Help cover the real costs of running FullStreamer and still leave me enough for a cup of coffee.",
  },
];
const PREMIUM_MONTHLY_PRICE_LABEL = "DKK 19.99 / month";
const PREMIUM_YEARLY_PRICE_LABEL = "DKK 199.99 / year";

function userViewPrefsKey(email: string) {
  return `${USER_VIEW_PREFS_STORAGE_PREFIX}${email.trim().toLowerCase()}`;
}

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function normalizeBillingReturnPlan(value: string | null): BillingReturnPlan {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "monthly") return "monthly";
  if (normalized === "yearly") return "yearly";
  return null;
}

function AppContent() {
  const { user, loading: authLoading, updateUser } = useAuth();
  const isPremiumUser = !!user && (user.subscription_tier === "premium" || user.subscription_tier === "free_premium");
  const isNonPremiumUser = !!user && !isPremiumUser;
  const { providerIds, countries, loadConfig, saveConfig } = useConfig();
  const { items: watchlistItems, loading: watchlistLoading, refresh: refreshWatchlist } = useWatchlist();
  const { items: watchedItems, loading: watchedLoading } = useWatched();
  const { lists, getItems } = useLists();
  const {
    notifications,
    activeAlerts,
    clearUnreadIndicator,
    loading: notificationsLoading,
    markRead,
    markLatestUnreadForTitle,
    removeNotification,
    markAllRead,
    refresh: refreshNotifications,
  } = useNotifications();

  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<"login" | "signup">("login");
  const [settingsCenterOpen, setSettingsCenterOpen] = useState(false);
  const [settingsCenterSection, setSettingsCenterSection] = useState<SettingsCenterSection>("account");
  const [billingReturnSyncing, setBillingReturnSyncing] = useState(false);
  const [billingReturnPlan, setBillingReturnPlan] = useState<BillingReturnPlan>(null);
  const [homeFeatureInfoOpen, setHomeFeatureInfoOpen] = useState<Set<string>>(new Set());
  const [premiumShowcaseOpen, setPremiumShowcaseOpen] = useState(false);
  const [premiumShowcasePlan, setPremiumShowcasePlan] = useState<PremiumPlanChoice | null>(null);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [vpnPromptOpen, setVpnPromptOpen] = useState(false);
  const [vpnPromptCountryCount, setVpnPromptCountryCount] = useState(1);
  const [isOnboarding, setIsOnboarding] = useState(false);
  const [pendingVpnPrompt, setPendingVpnPrompt] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<number | null>(null);
  const [selectedMovieType, setSelectedMovieType] = useState<"movie" | "tv">("movie");
  const [selectedSection, setSelectedSection] = useState<HomeSection | null>(null);
  const [watchlistOverlayOpen, setWatchlistOverlayOpen] = useState(false);
  const [watchedOverlayOpen, setWatchedOverlayOpen] = useState(false);
  const [listsOverlayOpen, setListsOverlayOpen] = useState(false);
  const [listsOverlayInitialListId, setListsOverlayInitialListId] = useState<string | null>(null);
  const [notificationsOverlayOpen, setNotificationsOverlayOpen] = useState(false);
  const [notificationAlertsOverlayOpen, setNotificationAlertsOverlayOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFiltered, setSearchFiltered] = useState(false);
  const [advancedSearchOpen, setAdvancedSearchOpen] = useState(false);
  const [advancedSearchInitialQuery, setAdvancedSearchInitialQuery] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("mix");
  const [rowResetToken, setRowResetToken] = useState(0);
  const [userContentMode, setUserContentMode] = useState<UserContentMode>("all");
  const [usingVpn, setUsingVpn] = useState(false);
  const [hideWatchedOnHome, setHideWatchedOnHome] = useState(false);
  const [showWatchlistOnHome, setShowWatchlistOnHome] = useState(true);
  const [homeListIds, setHomeListIds] = useState<string[]>([]);
  const [homeSectionOrder, setHomeSectionOrder] = useState<string[]>([HOME_SECTION_WATCHLIST_ID]);
  const [homeListItemsById, setHomeListItemsById] = useState<Record<string, UserListItem[]>>({});
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
  const handledTitleDeepLinkRef = useRef(false);
  const handledBillingReturnRef = useRef(false);
  const pendingNotificationReadRef = useRef<string | null>(null);
  const pendingTitleReadRef = useRef<{ tmdbId: number; mediaType: "movie" | "tv" } | null>(null);

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
    const newCacheKey = `${user?.email || "guest"}:${providerKey}:${countryKey}:${guestCountry}:${userContentMode}:${usingVpn}:${hideWatchedOnHome}`;

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
  }, [homeInitialized, providerIds, mediaType, user, guestCountry, userContentMode, usingVpn, hideWatchedOnHome, countries]);

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
      setUserContentMode("all");
      setHideWatchedOnHome(false);
      setShowWatchlistOnHome(true);
      setHomeListIds([]);
      setHomeSectionOrder([HOME_SECTION_WATCHLIST_ID]);
      setHomeListItemsById({});
      return;
    }

    if (!isPremiumUser) {
      hasStoredContentModePrefRef.current = false;
      setViewPrefsReady(true);
      setUsingVpn(false);
      setUserContentMode("available");
      setHideWatchedOnHome(false);
      setShowWatchlistOnHome(false);
      setHomeListIds([]);
      setHomeSectionOrder([]);
      setHomeListItemsById({});
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
          hideWatchedOnHome?: unknown;
          showWatchlistOnHome?: unknown;
          homeListIds?: unknown;
          homeSectionOrder?: unknown;
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
        if (typeof parsed.hideWatchedOnHome === "boolean") {
          setHideWatchedOnHome(parsed.hideWatchedOnHome);
        } else {
          setHideWatchedOnHome(false);
        }
        if (typeof parsed.showWatchlistOnHome === "boolean") {
          setShowWatchlistOnHome(parsed.showWatchlistOnHome);
        } else {
          setShowWatchlistOnHome(true);
        }
        if (Array.isArray(parsed.homeListIds)) {
          const normalized = parsed.homeListIds
            .map((value) => String(value).trim())
            .filter((value, index, arr) => value && arr.indexOf(value) === index);
          setHomeListIds(normalized);
        } else {
          setHomeListIds([]);
        }
        if (Array.isArray(parsed.homeSectionOrder)) {
          const normalized = parsed.homeSectionOrder
            .map((value) => String(value).trim())
            .filter((value, index, arr) => value && arr.indexOf(value) === index);
          setHomeSectionOrder(normalized.length ? normalized : [HOME_SECTION_WATCHLIST_ID]);
        } else {
          setHomeSectionOrder([HOME_SECTION_WATCHLIST_ID]);
        }
      } else {
        setHideWatchedOnHome(false);
        setShowWatchlistOnHome(true);
        setHomeListIds([]);
        setHomeSectionOrder([HOME_SECTION_WATCHLIST_ID]);
      }
    } catch {
      // Ignore malformed localStorage values.
      setHideWatchedOnHome(false);
      setShowWatchlistOnHome(true);
      setHomeListIds([]);
      setHomeSectionOrder([HOME_SECTION_WATCHLIST_ID]);
    }

    setUsingVpn(nextUsingVpn);
    if (nextMode !== null) setUserContentMode(nextMode);
    setViewPrefsReady(true);
  }, [user?.email, isPremiumUser]);

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
      setUserContentMode("all");
      setUsingVpn(false);
      return;
    }
    if (!isPremiumUser) {
      setUsingVpn(false);
      setUserContentMode((prev) => {
        if (prev === "streamable") {
          return providerIds.size === 0 ? "all" : "available";
        }
        if (providerIds.size === 0 && prev !== "all") {
          return "all";
        }
        return prev;
      });
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
  }, [user, isPremiumUser, providerIds.size, viewPrefsReady]);

  // Persist VPN + content mode across logout/login.
  useEffect(() => {
    if (!user?.email || !viewPrefsReady || !isPremiumUser) return;
    try {
      localStorage.setItem(
        userViewPrefsKey(user.email),
        JSON.stringify({
          usingVpn,
          contentMode: userContentMode,
          hideWatchedOnHome,
          showWatchlistOnHome,
          homeListIds,
          homeSectionOrder,
        })
      );
    } catch {
      // Ignore localStorage write failures.
    }
  }, [user?.email, viewPrefsReady, isPremiumUser, usingVpn, userContentMode, hideWatchedOnHome, showWatchlistOnHome, homeListIds, homeSectionOrder]);

  useEffect(() => {
    if (!user || !isPremiumUser) {
      setHomeListIds([]);
      return;
    }
    const validListIds = new Set(lists.map((entry) => entry.id));
    setHomeListIds((prev) => {
      const filtered = prev.filter((listId) => validListIds.has(listId));
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [user, isPremiumUser, lists]);

  useEffect(() => {
    if (!user) {
      setHomeSectionOrder([HOME_SECTION_WATCHLIST_ID]);
      return;
    }
    if (!isPremiumUser) {
      setHomeSectionOrder([]);
      return;
    }
    const defaultOrder = [
      ...(showWatchlistOnHome ? [HOME_SECTION_WATCHLIST_ID] : []),
      ...homeListIds,
    ];
    const allowed = new Set<string>(defaultOrder);
    setHomeSectionOrder((prev) => {
      const next: string[] = [];
      const seen = new Set<string>();
      for (const key of prev) {
        if (!allowed.has(key) || seen.has(key)) continue;
        seen.add(key);
        next.push(key);
      }
      for (const key of defaultOrder) {
        if (seen.has(key)) continue;
        seen.add(key);
        next.push(key);
      }
      return next.length === prev.length && next.every((value, index) => value === prev[index]) ? prev : next;
    });
  }, [user, isPremiumUser, homeListIds, showWatchlistOnHome]);

  useEffect(() => {
    if (!user || !isPremiumUser) {
      setHomeListItemsById({});
      return;
    }
    const validListIds = new Set(lists.map((entry) => entry.id));
    const targetIds = homeListIds.filter((listId) => validListIds.has(listId));
    if (!targetIds.length) {
      setHomeListItemsById({});
      return;
    }
    let cancelled = false;
    void (async () => {
      const loaded = await Promise.all(
        targetIds.map(async (listId) => {
          try {
            const items = await getItems(listId);
            return [listId, items] as const;
          } catch {
            return [listId, [] as UserListItem[]] as const;
          }
        })
      );
      if (cancelled) return;
      const next: Record<string, UserListItem[]> = {};
      for (const [listId, items] of loaded) {
        next[listId] = items;
      }
      setHomeListItemsById(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isPremiumUser, lists, homeListIds, getItems]);

  // Prefetch next page in background
  const prefetchNextPage = useCallback(
    async (nextPage: number, currentMediaType: MediaType) => {
      if (IOS_BRAVE) return;
      const isGuest = !user;
      const unfiltered = isGuest || userContentMode === "all";
      const includePaid = !!user && userContentMode === "available";
      const country = unfiltered ? guestCountry : undefined;
      const scopedCountries = user && (!isPremiumUser || !usingVpn) ? countries : undefined;
      const ids = unfiltered ? [] : Array.from(providerIds);
      try {
        const data = await getHome(nextPage, 6, ids, currentMediaType, country, unfiltered, usingVpn, includePaid, scopedCountries, hideWatchedOnHome);
        prefetchCacheRef.current[currentMediaType] = {
          page: nextPage,
          data: data.sections || [],
          hasMore: data.has_more ?? false,
        };
      } catch {
        // Prefetch failed, ignore
      }
    },
    [user, isPremiumUser, userContentMode, countries, guestCountry, providerIds, usingVpn, hideWatchedOnHome]
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
        const scopedCountries = user && (!isPremiumUser || !usingVpn) ? countries : undefined;
        const ids = unfiltered ? [] : Array.from(providerIds);
        const data = await getHome(page, homePageSize, ids, mediaType, country, unfiltered, usingVpn, includePaid, scopedCountries, hideWatchedOnHome);
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
    [homeLoading, homePage, homeHasMore, providerIds, mediaType, user, isPremiumUser, guestCountry, userContentMode, countries, usingVpn, hideWatchedOnHome, prefetchNextPage]
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

  const openPremiumShowcase = useCallback((plan: PremiumPlanChoice | null = null) => {
    setPremiumShowcasePlan(plan);
    setPremiumShowcaseOpen(true);
  }, []);

  const closePremiumShowcase = useCallback(() => {
    setPremiumShowcaseOpen(false);
    setPremiumShowcasePlan(null);
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

  useEffect(() => {
    if (authLoading) return;
    if (handledTitleDeepLinkRef.current) return;
    let targetId: number | null = null;
    let targetType: "movie" | "tv" = "movie";
    let notificationId: string | null = null;
    let fromPath = false;
    try {
      const params = new URLSearchParams(window.location.search);
      const rawNotificationId = (params.get("notification_id") || "").trim();
      if (rawNotificationId) {
        notificationId = rawNotificationId;
      }
      const idRaw = params.get("tmdb_id");
      const parsedId = Number(idRaw || "");
      if (idRaw && Number.isInteger(parsedId) && parsedId > 0) {
        const mediaTypeRaw = (params.get("media_type") || "").toLowerCase();
        if (mediaTypeRaw === "tv") targetType = "tv";
        targetId = parsedId;
      } else {
        const pathMatch = window.location.pathname.match(/^\/title\/(movie|tv)\/(\d+)\/?$/i);
        if (!pathMatch) return;
        targetType = pathMatch[1].toLowerCase() === "tv" ? "tv" : "movie";
        targetId = Number(pathMatch[2]);
        if (!Number.isInteger(targetId) || targetId <= 0) {
          targetId = null;
          return;
        }
        fromPath = true;
      }
    } catch {
      return;
    }
    if (!targetId) return;
    handledTitleDeepLinkRef.current = true;
    if (notificationId) {
      pendingNotificationReadRef.current = notificationId;
      pendingTitleReadRef.current = null;
    } else {
      pendingTitleReadRef.current = { tmdbId: targetId, mediaType: targetType };
    }
    setSelectedMovie(targetId);
    setSelectedMovieType(targetType);
    if (notificationId && user) {
      void markRead(notificationId);
      pendingNotificationReadRef.current = null;
    } else if (user) {
      void markLatestUnreadForTitle(targetId, targetType);
      pendingTitleReadRef.current = null;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("tmdb_id");
      url.searchParams.delete("media_type");
      url.searchParams.delete("notification_id");
      if (fromPath) {
        url.pathname = "/";
      }
      const nextSearch = url.searchParams.toString();
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`
      );
    } catch {
      // Ignore URL rewrite failures.
    }
  }, [authLoading, markRead, user]);

  useEffect(() => {
    if (authLoading || !user) return;
    const pendingNotificationId = pendingNotificationReadRef.current;
    if (pendingNotificationId) {
      pendingNotificationReadRef.current = null;
      void markRead(pendingNotificationId);
      return;
    }
    const pendingTitle = pendingTitleReadRef.current;
    if (!pendingTitle) return;
    pendingTitleReadRef.current = null;
    void markLatestUnreadForTitle(pendingTitle.tmdbId, pendingTitle.mediaType);
  }, [authLoading, markLatestUnreadForTitle, markRead, user]);

  useEffect(() => {
    if (authLoading || !user || onboardingOpen) return;
    let shouldResumeSignup = false;
    try {
      shouldResumeSignup = localStorage.getItem(SIGNUP_ONBOARDING_STORAGE_KEY) === "1";
      if (shouldResumeSignup) {
        localStorage.removeItem(SIGNUP_ONBOARDING_STORAGE_KEY);
      }
    } catch {
      shouldResumeSignup = false;
    }
    if (!shouldResumeSignup) return;
    setIsOnboarding(true);
    setOnboardingOpen(true);
  }, [authLoading, user, onboardingOpen]);

  const handleSignupComplete = () => {
    setIsOnboarding(true);
    setOnboardingOpen(true);
  };

  const openSettingsCenter = useCallback(
    (section: SettingsCenterSection = "account") => {
      const nextSection =
        !isPremiumUser && PREMIUM_ONLY_SETTINGS_SECTIONS.has(section)
          ? "subscription"
          : section;
      setSettingsCenterSection(nextSection);
      setSettingsCenterOpen(true);
    },
    [isPremiumUser]
  );

  const handlePremiumPlanSelect = useCallback(
    (_plan: PremiumPlanChoice) => {
      closePremiumShowcase();
      if (!user) {
        openAuthModal("signup");
        return;
      }
      openSettingsCenter("subscription");
    },
    [closePremiumShowcase, openAuthModal, openSettingsCenter, user]
  );

  const clearBillingReturnParams = useCallback(() => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete(BILLING_RETURN_QUERY_KEY);
      url.searchParams.delete(BILLING_PLAN_QUERY_KEY);
      const nextSearch = url.searchParams.toString();
      window.history.replaceState(
        {},
        "",
        `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`
      );
    } catch {
      // Ignore URL rewrite failures.
    }
  }, []);

  const finishBillingReturnSync = useCallback(() => {
    setBillingReturnSyncing(false);
    setBillingReturnPlan(null);
    clearBillingReturnParams();
  }, [clearBillingReturnParams]);

  useEffect(() => {
    if (authLoading) return;
    if (handledBillingReturnRef.current) return;
    let isBillingReturn = false;
    let detectedPlan: BillingReturnPlan = null;
    try {
      const params = new URLSearchParams(window.location.search);
      isBillingReturn =
        (params.get(BILLING_RETURN_QUERY_KEY) || "").trim().toLowerCase() === BILLING_RETURN_QUERY_VALUE;
      detectedPlan = normalizeBillingReturnPlan(params.get(BILLING_PLAN_QUERY_KEY));
    } catch {
      isBillingReturn = false;
      detectedPlan = null;
    }
    if (!isBillingReturn) return;
    handledBillingReturnRef.current = true;
    setBillingReturnPlan(detectedPlan);
    setBillingReturnSyncing(true);

    if (!user) {
      finishBillingReturnSync();
      return;
    }

    openSettingsCenter("subscription");

    let cancelled = false;
    const MAX_ATTEMPTS = 12;
    const RETRY_DELAY_MS = 2500;

    const pollForUpgrade = async () => {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;
        try {
          const [billingStatus, refreshedUser] = await Promise.all([getBillingStatus(), checkAuth()]);
          if (cancelled) return;
          if (refreshedUser) {
            updateUser(refreshedUser);
            if (refreshedUser.subscription_tier === "premium") {
              finishBillingReturnSync();
              return;
            }
          }
          if (billingStatus.has_paid_subscription) {
            finishBillingReturnSync();
            return;
          }
        } catch {
          // Retry until webhook syncs subscription status or we time out.
        }
        await new Promise((resolve) => window.setTimeout(resolve, RETRY_DELAY_MS));
      }
      if (!cancelled) {
        finishBillingReturnSync();
      }
    };

    void pollForUpgrade();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, finishBillingReturnSync, openSettingsCenter, updateUser]);

  const handleOnboardingDone = async (selectedCountries: string[]) => {
    const normalizedSelectedCountries = isPremiumUser
      ? selectedCountries
      : selectedCountries.slice(0, 1);
    const chosenCountries = normalizedSelectedCountries.length
      ? normalizedSelectedCountries
      : [DEFAULT_ONBOARDING_COUNTRY];
    const shouldOpenServices = normalizedSelectedCountries.length > 0;
    setOnboardingOpen(false);
    await saveConfig(Array.from(providerIds), chosenCountries);
    if (isOnboarding) {
      setIsOnboarding(false);
      setPendingVpnPrompt(isPremiumUser && shouldOpenServices);
      setVpnPromptCountryCount(Math.max(1, chosenCountries.length));
      if (shouldOpenServices) openSettingsCenter("services");
    }
  };

  const handleOnboardingClose = () => {
    void handleOnboardingDone([]);
  };

  const handleSettingsCenterSaved = () => {
    if (isPremiumUser) {
      void refreshWatchlist();
    }
    void loadHomeRows(true);
    if (isPremiumUser && pendingVpnPrompt) {
      setPendingVpnPrompt(false);
      setVpnPromptOpen(true);
    }
  };

  const handleSettingsCenterClose = () => {
    setSettingsCenterOpen(false);
    if (pendingVpnPrompt) setPendingVpnPrompt(false);
  };

  const handleSelectMovie = useCallback((id: number, mt?: "movie" | "tv") => {
    setSelectedMovie(id);
    setSelectedMovieType(mt || "movie");
  }, []);

  const handleSearchSubmit = useCallback(
    (q: string, filtered: boolean) => {
      setSearchQuery(q);
      setSearchFiltered(filtered);
      setSearchOpen(true);
    },
    []
  );

  const handleOpenAdvancedSearch = useCallback((initialQuery: string) => {
    if (!user) {
      openAuthModal("login");
      return;
    }
    if (!isPremiumUser) {
      openPremiumShowcase();
      return;
    }
    setAdvancedSearchInitialQuery(initialQuery);
    setAdvancedSearchOpen(true);
  }, [isPremiumUser, openAuthModal, openPremiumShowcase, user]);

  useEffect(() => {
    if ((!user || !isPremiumUser) && advancedSearchOpen) {
      setAdvancedSearchOpen(false);
    }
  }, [user, isPremiumUser, advancedSearchOpen]);

  useEffect(() => {
    if (!isPremiumUser && watchlistOverlayOpen) {
      setWatchlistOverlayOpen(false);
    }
  }, [isPremiumUser, watchlistOverlayOpen]);

  useEffect(() => {
    if (!isPremiumUser && watchedOverlayOpen) {
      setWatchedOverlayOpen(false);
    }
  }, [isPremiumUser, watchedOverlayOpen]);

  useEffect(() => {
    if (!isPremiumUser && listsOverlayOpen) {
      setListsOverlayOpen(false);
      setListsOverlayInitialListId(null);
    }
  }, [isPremiumUser, listsOverlayOpen]);

  useEffect(() => {
    if (!user || !isPremiumUser) {
      if (notificationsOverlayOpen) setNotificationsOverlayOpen(false);
      if (notificationAlertsOverlayOpen) setNotificationAlertsOverlayOpen(false);
      if (!user && settingsCenterOpen) setSettingsCenterOpen(false);
    }
  }, [user, isPremiumUser, notificationsOverlayOpen, notificationAlertsOverlayOpen, settingsCenterOpen]);

  useEffect(() => {
    if (isPremiumUser) return;
    if (!PREMIUM_ONLY_SETTINGS_SECTIONS.has(settingsCenterSection)) return;
    setSettingsCenterSection("subscription");
  }, [isPremiumUser, settingsCenterSection]);

  const handleMediaTypeChange = (next: MediaType) => {
    setMediaType(next);
    if (next === "mix") setRowResetToken((v) => v + 1);
  };
  const handleUserContentModeChange = useCallback(
    (nextMode: UserContentMode) => {
      if (!isPremiumUser) {
        const normalizedMode: UserContentMode = nextMode === "streamable" ? "available" : nextMode;
        if (providerIds.size === 0 && normalizedMode !== "all") {
          openSettingsCenter("services");
          return;
        }
        setUserContentMode(normalizedMode);
        return;
      }
      if (providerIds.size === 0 && nextMode !== "all") {
        openSettingsCenter("services");
        return;
      }
      setUserContentMode(nextMode);
    },
    [isPremiumUser, openSettingsCenter, providerIds.size]
  );

  const sectionMap = useMemo(() => new Map(sections.map((s) => [s.id, s])), [sections]);
  const watchedItemKeys = useMemo(
    () => new Set(watchedItems.map((item) => `${item.media_type}:${item.tmdb_id}`)),
    [watchedItems]
  );
  const homeListSections = useMemo<HomeSection[]>(() => {
    if (!user || !isPremiumUser || !homeListIds.length) return [];
    const summariesById = new Map(lists.map((entry) => [entry.id, entry]));
    return homeListIds.flatMap((listId) => {
      const listSummary = summariesById.get(listId);
      if (!listSummary) return [];
      let items = homeListItemsById[listId] || [];
      if (mediaType === "movie" || mediaType === "tv") {
        items = items.filter((entry) => entry.media_type === mediaType);
      }
      if (hideWatchedOnHome) {
        items = items.filter((entry) => !watchedItemKeys.has(`${entry.media_type}:${entry.tmdb_id}`));
      }
      if (!items.length) return [];
      return [
        {
          id: `${USER_LIST_HOME_SECTION_PREFIX}${listId}`,
          title: listSummary.name,
          results: items.map((entry) => ({
            id: entry.tmdb_id,
            title: entry.title,
            poster_path: entry.poster_path || undefined,
            release_date: entry.release_date || undefined,
            media_type: entry.media_type,
          })),
        },
      ];
    });
  }, [user, isPremiumUser, homeListIds, lists, homeListItemsById, mediaType, hideWatchedOnHome, watchedItemKeys]);
  const homeListSectionByListId = useMemo(() => {
    const map = new Map<string, HomeSection>();
    for (const section of homeListSections) {
      if (!section.id.startsWith(USER_LIST_HOME_SECTION_PREFIX)) continue;
      const listId = section.id.slice(USER_LIST_HOME_SECTION_PREFIX.length);
      if (!listId) continue;
      map.set(listId, section);
    }
    return map;
  }, [homeListSections]);
  const homeSectionOrderItems = useMemo(() => {
    if (!user || !isPremiumUser) return [];
    const listNameById = new Map(lists.map((entry) => [entry.id, entry.name]));
    return [
      ...(showWatchlistOnHome ? [{ id: HOME_SECTION_WATCHLIST_ID, label: "Watchlist" }] : []),
      ...homeListIds.flatMap((listId) => {
        const label = listNameById.get(listId);
        return label ? [{ id: listId, label }] : [];
      }),
    ];
  }, [user, isPremiumUser, lists, homeListIds, showWatchlistOnHome]);
  const watchlistItemsForHome = useMemo(() => {
    if (!isPremiumUser) return [];
    if (!hideWatchedOnHome) return watchlistItems;
    return watchlistItems.filter((entry) => !watchedItemKeys.has(`${entry.media_type}:${entry.tmdb_id}`));
  }, [isPremiumUser, hideWatchedOnHome, watchlistItems, watchedItemKeys]);
  const watchlistFullyWatchedHidden = hideWatchedOnHome && watchlistItems.length > 0 && watchlistItemsForHome.length === 0;
  const watchlistSection = useMemo<HomeSection | null>(() => {
    if (!user || !isPremiumUser || !watchlistItemsForHome.length) return null;
    return {
      id: "__watchlist__",
      title: "Your Watchlist",
      results: watchlistItemsForHome.map((entry) => ({
        id: entry.tmdb_id,
        title: entry.title,
        poster_path: entry.poster_path || undefined,
        release_date: entry.release_date || undefined,
        media_type: entry.media_type,
      })),
    };
  }, [user, isPremiumUser, watchlistItemsForHome]);
  const handleSeeMore = useCallback(
    (id: string) => {
      if (id === "__watchlist__") {
        if (!isPremiumUser) {
          openPremiumShowcase();
          return;
        }
        setWatchlistOverlayOpen(true);
        return;
      }
      if (id.startsWith(USER_LIST_HOME_SECTION_PREFIX)) {
        if (!isPremiumUser) {
          openPremiumShowcase();
          return;
        }
        const listId = id.slice(USER_LIST_HOME_SECTION_PREFIX.length);
        if (listId) {
          setListsOverlayInitialListId(listId);
          setListsOverlayOpen(true);
        }
        return;
      }
      setSelectedSection(sectionMap.get(id) || null);
    },
    [sectionMap, isPremiumUser, openPremiumShowcase]
  );
  const watchlistHomeBlock = user && isPremiumUser ? (
    watchlistLoading ? (
      <SkeletonRow />
    ) : watchlistSection ? (
      <MovieRow
        key={`${watchlistSection.id}:${rowResetToken}`}
        section={watchlistSection}
        onSelectMovie={handleSelectMovie}
        onSeeMore={handleSeeMore}
        resetToken={rowResetToken}
        mediaType={mediaType}
        forceSeeMore
      />
    ) : (
      <div className="rounded-2xl border border-border bg-panel/65 p-4 sm:p-5">
        <h3 className="text-lg sm:text-xl font-semibold text-text">Your Watchlist</h3>
        <p className="text-sm text-muted mt-1">
          {watchlistFullyWatchedHidden
            ? "You've watched everything in your watchlist."
            : "Your watchlist is empty. Tap the bookmark icon on any title to add it here."}
        </p>
      </div>
    )
  ) : null;
  const personalHomeBlocks = useMemo(() => {
    if (!user || !isPremiumUser) return [];
    const orderedKeys = [...homeSectionOrder];
    for (const item of homeSectionOrderItems) {
      if (orderedKeys.includes(item.id)) continue;
      orderedKeys.push(item.id);
    }
    const blocks: React.ReactNode[] = [];
    const used = new Set<string>();
    for (const key of orderedKeys) {
      if (used.has(key)) continue;
      used.add(key);
      if (key === HOME_SECTION_WATCHLIST_ID) {
        if (showWatchlistOnHome && watchlistHomeBlock) {
          blocks.push(<Fragment key={`${HOME_SECTION_WATCHLIST_ID}:${rowResetToken}`}>{watchlistHomeBlock}</Fragment>);
        }
        continue;
      }
      const section = homeListSectionByListId.get(key);
      if (!section) continue;
      blocks.push(
        <MovieRow
          key={`${section.id}:${rowResetToken}`}
          section={section}
          onSelectMovie={handleSelectMovie}
          onSeeMore={handleSeeMore}
          resetToken={rowResetToken}
          mediaType={mediaType}
          forceSeeMore
        />
      );
    }
    return blocks;
  }, [
    user,
    isPremiumUser,
    homeSectionOrder,
    homeSectionOrderItems,
    showWatchlistOnHome,
    watchlistHomeBlock,
    homeListSectionByListId,
    rowResetToken,
    handleSelectMovie,
    handleSeeMore,
    mediaType,
  ]);
  const watchlistAnchorIndex = useMemo(() => {
    const trendingIndex = sections.findIndex(
      (section) => section.id === "trending_day" || section.title.trim().toLowerCase() === "trending today"
    );
    if (trendingIndex >= 0) return trendingIndex;
    return sections.length > 0 ? 0 : -1;
  }, [sections]);
  const handleOpenWatchlist = useCallback(() => {
    if (!user) {
      openAuthModal("login");
      return;
    }
    if (!isPremiumUser) {
      openPremiumShowcase();
      return;
    }
    setWatchlistOverlayOpen(true);
  }, [isPremiumUser, openAuthModal, openPremiumShowcase, user]);
  const handleOpenWatched = useCallback(() => {
    if (!user) {
      openAuthModal("login");
      return;
    }
    if (!isPremiumUser) {
      openPremiumShowcase();
      return;
    }
    setWatchedOverlayOpen(true);
  }, [isPremiumUser, openAuthModal, openPremiumShowcase, user]);
  const handleOpenLists = useCallback(() => {
    if (!user) {
      openAuthModal("login");
      return;
    }
    if (!isPremiumUser) {
      openPremiumShowcase();
      return;
    }
    setListsOverlayInitialListId(null);
    setListsOverlayOpen(true);
  }, [isPremiumUser, openAuthModal, openPremiumShowcase, user]);
  const handleOpenListsFromSettings = useCallback(() => {
    setSettingsCenterOpen(false);
    handleOpenLists();
  }, [handleOpenLists]);
  const handleToggleListOnHome = useCallback((listId: string) => {
    setHomeListIds((prev) => (prev.includes(listId) ? prev.filter((entry) => entry !== listId) : [...prev, listId]));
  }, []);
  const handleHomeShowWatchlistChange = useCallback((next: boolean) => {
    setShowWatchlistOnHome(next);
    setHomeSectionOrder((prev) => {
      if (!next) return prev.filter((entry) => entry !== HOME_SECTION_WATCHLIST_ID);
      const without = prev.filter((entry) => entry !== HOME_SECTION_WATCHLIST_ID);
      return [HOME_SECTION_WATCHLIST_ID, ...without];
    });
  }, []);
  const handleHomeRemoveSection = useCallback(
    (sectionId: string) => {
      if (sectionId === HOME_SECTION_WATCHLIST_ID) {
        handleHomeShowWatchlistChange(false);
        return;
      }
      setHomeListIds((prev) => prev.filter((entry) => entry !== sectionId));
      setHomeSectionOrder((prev) => prev.filter((entry) => entry !== sectionId));
    },
    [handleHomeShowWatchlistChange]
  );
  const handleHomeSectionOrderChange = useCallback((next: string[]) => {
    setHomeSectionOrder(next);
  }, []);
  const handleOpenNotifications = useCallback(() => {
    if (!user) {
      openAuthModal("login");
      return;
    }
    if (!isPremiumUser) {
      openPremiumShowcase();
      return;
    }
    clearUnreadIndicator();
    void refreshNotifications(true);
    setNotificationsOverlayOpen(true);
  }, [clearUnreadIndicator, isPremiumUser, openAuthModal, openPremiumShowcase, refreshNotifications, user]);
  const handleCloseNotifications = useCallback(() => {
    setNotificationsOverlayOpen(false);
    void markAllRead();
  }, [markAllRead]);
  const unfilteredMode = !user || userContentMode === "all";
  const includePaidMode = !!user && userContentMode === "available";
  const discoveryCountry = user
    ? (countries[0] || DEFAULT_ONBOARDING_COUNTRY)
    : (guestCountry || DEFAULT_ONBOARDING_COUNTRY);
  const hasBlockingOverlay =
    selectedMovie !== null ||
    selectedSection !== null ||
    watchlistOverlayOpen ||
    watchedOverlayOpen ||
    listsOverlayOpen ||
    notificationsOverlayOpen ||
    notificationAlertsOverlayOpen ||
    searchOpen ||
    advancedSearchOpen ||
    settingsCenterOpen ||
    premiumShowcaseOpen ||
    onboardingOpen ||
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
          onOpenSettingsCenter={() => openSettingsCenter("account")}
          onOpenNotifications={handleOpenNotifications}
          onOpenLists={handleOpenLists}
          onOpenWatchlist={handleOpenWatchlist}
          onOpenWatched={handleOpenWatched}
          onOpenSettings={() => openSettingsCenter("services")}
          vpnEnabled={usingVpn}
          isPremiumUser={isPremiumUser}
          onOpenSubscription={() => openPremiumShowcase()}
          onSearchSubmit={handleSearchSubmit}
          onOpenAdvancedSearch={handleOpenAdvancedSearch}
          scrollContainer={useScopedMainScroll ? mainScrollEl : null}
        />
      </div>
      {billingReturnSyncing && (
        <div className="page-container pt-3">
          <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-4 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-text">
              <span
                className="inline-block h-3 w-3 rounded-full border-2 border-emerald-300 border-t-transparent animate-spin"
                aria-hidden="true"
              />
              Finalizing your premium subscription...
            </div>
            <p className="text-xs text-muted mt-1">
              {billingReturnPlan === "monthly"
                ? "Monthly plan detected. "
                : billingReturnPlan === "yearly"
                  ? "Yearly plan detected. "
                  : ""}
              This usually completes within a few seconds after checkout.
            </p>
          </div>
        </div>
      )}

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
            {isPremiumUser && (
              <div className="flex items-center gap-2 max-sm:w-full">
                {userContentMode === "streamable" && (
                  <button
                    onClick={() => setUsingVpn((prev) => !prev)}
                    aria-pressed={usingVpn}
                    className={`h-[42px] w-[220px] px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 max-sm:flex-1 max-sm:w-0 ${
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
                )}
                <button
                  onClick={() => {
                    const nextMode: UserContentMode =
                      userContentMode === "all"
                        ? "available"
                        : userContentMode === "available"
                          ? "streamable"
                          : "all";
                    handleUserContentModeChange(nextMode);
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
            {isPremiumUser && (
              <>
                {/* Desktop: watched toggle + media toggle in same row */}
                <div className="flex items-center gap-2 max-sm:hidden">
                  <button
                    onClick={() => setHideWatchedOnHome((prev) => !prev)}
                    aria-pressed={hideWatchedOnHome}
                    aria-label={hideWatchedOnHome ? "Hiding watched titles" : "Showing watched titles"}
                    className={`h-[42px] w-[220px] px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                      hideWatchedOnHome
                        ? "border-accent/60 bg-accent/10 text-text"
                        : "border-border bg-panel text-muted"
                    }`}
                  >
                    <span className="truncate">{hideWatchedOnHome ? "Hiding watched" : "Showing watched"}</span>
                    <span
                      className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                        hideWatchedOnHome
                          ? "bg-accent border-accent"
                          : "bg-panel-2 border-border"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                          hideWatchedOnHome ? "translate-x-4" : ""
                        }`}
                      />
                    </span>
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
                {/* Mobile: watched toggle */}
                <div className="hidden max-sm:flex items-center w-full">
                  <button
                    onClick={() => setHideWatchedOnHome((prev) => !prev)}
                    aria-pressed={hideWatchedOnHome}
                    aria-label={hideWatchedOnHome ? "Hiding watched titles" : "Showing watched titles"}
                    className={`h-[42px] w-full px-3 border rounded-full text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                      hideWatchedOnHome
                        ? "border-accent/60 bg-accent/10 text-text"
                        : "border-border bg-panel text-muted"
                    }`}
                  >
                    <span className="truncate">{hideWatchedOnHome ? "Hiding watched" : "Showing watched"}</span>
                    <span
                      className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                        hideWatchedOnHome
                          ? "bg-accent border-accent"
                          : "bg-panel-2 border-border"
                      }`}
                    >
                      <span
                        className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                          hideWatchedOnHome ? "translate-x-4" : ""
                        }`}
                      />
                    </span>
                  </button>
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
            {!isPremiumUser && (
              <>
                {user && (
                  <div className="flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] w-[270px] max-sm:w-full">
                    {(["all", "available"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => handleUserContentModeChange(mode)}
                        className={`flex-1 h-full text-sm font-medium transition-colors ${
                          userContentMode === mode
                            ? "bg-accent/15 text-text"
                            : "text-muted hover:text-text"
                        }`}
                      >
                        {USER_CONTENT_LABEL[mode]}
                      </button>
                    ))}
                  </div>
                )}
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
                <div className="rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/90 max-sm:w-full">
                  Premium unlocks advanced search, multiple countries, VPN toggle, and streamable-only power tools.
                  <button
                    type="button"
                    onClick={() => openPremiumShowcase()}
                    className="ml-2 underline decoration-amber-200/70 underline-offset-2 hover:text-text"
                  >
                    See premium
                  </button>
                </div>
              </>
            )}
          </div>
          </div>

          {!isPremiumUser && (
            <section className="mb-6 sm:mb-8 rounded-2xl border border-amber-300/35 bg-gradient-to-br from-amber-300/16 via-amber-200/8 to-orange-500/18 p-4 sm:p-6 shadow-[0_14px_50px_-28px_rgba(245,158,11,0.65)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="inline-flex items-center gap-2 rounded-full border border-amber-200/45 bg-amber-200/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-amber-100">
                  Premium Upgrade
                </div>
                <div className="text-xs text-amber-100/90">
                  Cheap upgrade, big gain across all your paid services.
                </div>
              </div>
              <h2 className="mt-3 text-xl sm:text-2xl font-display text-text">
                Get more from every subscription and VPN region you already pay for.
              </h2>
              <p className="mt-2 text-sm text-amber-100/85 max-w-3xl">
                FullStreamer Premium helps you browse smarter and find more of what is already available to you.
                Stop wasting time jumping between apps and regions. Search once, filter fast, and stream more.
              </p>
              <div className="mt-4 grid items-start gap-2 sm:grid-cols-2">
                {PREMIUM_FEATURE_DETAILS.map((feature) => (
                  <div
                    key={feature.id}
                    className="self-start rounded-xl border border-amber-200/30 bg-black/15 px-3 py-2.5 text-sm text-amber-50/95"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-amber-50">{feature.title}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setHomeFeatureInfoOpen((prev) => {
                            const next = new Set(prev);
                            if (next.has(feature.id)) {
                              next.delete(feature.id);
                            } else {
                              next.add(feature.id);
                            }
                            return next;
                          })
                        }
                        className="h-5 w-5 flex-shrink-0 rounded-full border border-amber-100/45 bg-amber-100/20 text-[11px] font-semibold text-amber-50 hover:bg-amber-100/30 transition-colors"
                        aria-label={`More info about ${feature.title}`}
                        title={`More info about ${feature.title}`}
                      >
                        i
                      </button>
                    </div>
                    {homeFeatureInfoOpen.has(feature.id) && (
                      <p className="mt-2 text-xs text-amber-100/90 leading-relaxed">{feature.detail}</p>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => openPremiumShowcase("monthly")}
                  className="rounded-xl border border-amber-100/45 bg-gradient-to-br from-amber-200/30 to-orange-400/25 px-4 py-3 text-left hover:from-amber-200/40 hover:to-orange-400/35 transition-colors"
                >
                  <div className="text-xs uppercase tracking-[0.07em] text-amber-100/85">Monthly Plan</div>
                  <div className="mt-1 text-lg font-semibold text-text">{PREMIUM_MONTHLY_PRICE_LABEL}</div>
                  <div className="mt-1 text-xs text-amber-50/90">Perfect if you want flexibility.</div>
                </button>
                <button
                  type="button"
                  onClick={() => openPremiumShowcase("yearly")}
                  className="relative rounded-xl border border-amber-100/60 bg-gradient-to-br from-amber-300/35 to-orange-500/30 px-4 py-3 text-left hover:from-amber-300/45 hover:to-orange-500/40 transition-colors"
                >
                  <span className="absolute right-3 top-2 inline-flex rounded-full border border-amber-100/50 bg-amber-100/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-amber-50">
                    Best Value
                  </span>
                  <div className="text-xs uppercase tracking-[0.07em] text-amber-100/85">Yearly Plan</div>
                  <div className="mt-1 text-lg font-semibold text-text">{PREMIUM_YEARLY_PRICE_LABEL}</div>
                  <div className="mt-1 text-xs text-amber-50/90">Save money and keep discovery always on.</div>
                </button>
              </div>
            </section>
          )}

          <section className="flex flex-col gap-6 sm:gap-10">
          {sections.map((section, index) => (
            <Fragment key={`${section.id}:${rowResetToken}`}>
              <MovieRow
                section={section}
                onSelectMovie={handleSelectMovie}
                onSeeMore={handleSeeMore}
                resetToken={rowResetToken}
                mediaType={mediaType}
              />
              {personalHomeBlocks.length > 0 && index === watchlistAnchorIndex && personalHomeBlocks}
            </Fragment>
          ))}

          {personalHomeBlocks.length > 0 && sections.length === 0 && !homeLoading && personalHomeBlocks}

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

          {!homeLoading && sections.length === 0 && personalHomeBlocks.length === 0 && user && userContentMode !== "all" && (
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
        allowPersonClicks={isPremiumUser}
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
        hideWatched={!!user && hideWatchedOnHome}
      />

      {isPremiumUser && (
        <WatchlistOverlay
          open={watchlistOverlayOpen}
          onClose={() => setWatchlistOverlayOpen(false)}
          items={watchlistItems}
          onSelectMovie={handleSelectMovie}
        />
      )}

      {isPremiumUser && (
        <WatchedOverlay
          open={watchedOverlayOpen}
          onClose={() => setWatchedOverlayOpen(false)}
          items={watchedItems}
          loading={watchedLoading}
          onSelectMovie={handleSelectMovie}
        />
      )}

      {isPremiumUser && (
        <ListsOverlay
          open={listsOverlayOpen}
          onClose={() => {
            setListsOverlayOpen(false);
            setListsOverlayInitialListId(null);
          }}
          onSelectMovie={handleSelectMovie}
          initialListId={listsOverlayInitialListId}
          homeListIds={homeListIds}
          onToggleHomeList={handleToggleListOnHome}
        />
      )}

      {isPremiumUser && (
        <NotificationsOverlay
          open={notificationsOverlayOpen}
          onClose={handleCloseNotifications}
          notifications={notifications}
          loading={notificationsLoading}
          activeAlerts={activeAlerts}
          onMarkRead={markRead}
          onRemoveNotification={removeNotification}
          onSelectMovie={handleSelectMovie}
          onOpenAlerts={() => {
            setNotificationAlertsOverlayOpen(true);
          }}
          onOpenSettings={() => {
            openSettingsCenter("notifications");
          }}
        />
      )}

      {isPremiumUser && (
        <NotificationAlertsOverlay
          open={notificationAlertsOverlayOpen}
          onClose={() => setNotificationAlertsOverlayOpen(false)}
          onSelectMovie={handleSelectMovie}
        />
      )}

      <SearchOverlay
        open={searchOpen}
        query={searchQuery}
        filtered={searchFiltered}
        vpnEnabled={isPremiumUser ? usingVpn : false}
        isLoggedIn={isPremiumUser}
        initialContentMode={searchFiltered ? "streamable" : "all"}
        lockStreamable={false}
        onOpenUpgrade={() => {
          openPremiumShowcase();
        }}
        onClose={() => setSearchOpen(false)}
        onSelectMovie={handleSelectMovie}
      />

      {isPremiumUser && (
        <AdvancedSearchModal
          open={advancedSearchOpen}
          initialQuery={advancedSearchInitialQuery}
          onClose={() => setAdvancedSearchOpen(false)}
          onSelectMovie={handleSelectMovie}
          regions={regions}
          isLoggedIn={true}
          lockStreamable
        />
      )}

      <PremiumShowcaseModal
        open={premiumShowcaseOpen}
        isLoggedIn={!!user}
        features={PREMIUM_FEATURE_DETAILS}
        monthlyPriceLabel={PREMIUM_MONTHLY_PRICE_LABEL}
        yearlyPriceLabel={PREMIUM_YEARLY_PRICE_LABEL}
        preferredPlan={premiumShowcasePlan}
        onClose={closePremiumShowcase}
        onChoosePlan={handlePremiumPlanSelect}
        onSignup={() => {
          closePremiumShowcase();
          openAuthModal("signup");
        }}
        onLogin={() => {
          closePremiumShowcase();
          openAuthModal("login");
        }}
      />

      <SettingsCenterModal
        open={settingsCenterOpen}
        onClose={handleSettingsCenterClose}
        onSaved={handleSettingsCenterSaved}
        regions={regions}
        countryNameMap={countryNameMap}
        initialSection={settingsCenterSection}
        isPremiumUser={isPremiumUser}
        subscriptionTier={user?.subscription_tier}
        homeContentMode={userContentMode}
        homeUsingVpn={usingVpn}
        homeShowWatchlist={showWatchlistOnHome}
        homeSectionOrder={homeSectionOrder}
        homeSectionOrderItems={homeSectionOrderItems}
        onHomeContentModeChange={handleUserContentModeChange}
        onHomeUsingVpnChange={setUsingVpn}
        onHomeShowWatchlistChange={handleHomeShowWatchlistChange}
        onHomeRemoveSection={handleHomeRemoveSection}
        onHomeSectionOrderChange={handleHomeSectionOrderChange}
        onOpenLists={handleOpenListsFromSettings}
      />

      {/* Onboarding (post-signup) */}
      <OnboardingModal
        open={onboardingOpen}
        regions={regions}
        countryNameMap={countryNameMap}
        singleSelect={isNonPremiumUser}
        onDone={handleOnboardingDone}
        onClose={handleOnboardingClose}
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
      <NotificationsProvider>
        <ListsProvider>
          <WatchedProvider>
            <WatchlistProvider>
              <ConfigProvider>
                <AppContent />
              </ConfigProvider>
            </WatchlistProvider>
          </WatchedProvider>
        </ListsProvider>
      </NotificationsProvider>
    </AuthProvider>
  );
}
