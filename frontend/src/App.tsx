import { useState, useEffect, useCallback } from "react";
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

  const [sections, setSections] = useState<HomeSection[]>([]);
  const [homePage, setHomePage] = useState(1);
  const [homeHasMore, setHomeHasMore] = useState(true);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeInitialized, setHomeInitialized] = useState(false);

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
      setAuthModalOpen(true);
    }
  }, [user, authLoading]);

  // Load home rows when config is ready or media type changes
  useEffect(() => {
    if (!homeInitialized || !user) return;
    loadHomeRows(true);
  }, [homeInitialized, providerIds, mediaType]);

  const loadHomeRows = useCallback(
    async (reset = false) => {
      if (!reset && homeLoading) return;
      const page = reset ? 1 : homePage;
      if (!reset && !homeHasMore) return;

      setHomeLoading(true);
      try {
        const ids = Array.from(providerIds);
        const data = await getHome(page, 6, ids, mediaType);
        if (reset) {
          setSections(data.sections || []);
        } else {
          setSections((prev) => {
            const existingIds = new Set(prev.map((s) => s.id));
            const newSections = (data.sections || []).filter((s) => !existingIds.has(s.id));
            return [...prev, ...newSections];
          });
        }
        setHomeHasMore(data.has_more ?? false);
        setHomePage(data.next_page ?? page + 1);
      } catch {
        setHomeHasMore(false);
      } finally {
        setHomeLoading(false);
      }
    },
    [homeLoading, homePage, homeHasMore, providerIds, mediaType]
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
    setOnboardingOpen(false);
    await saveConfig(Array.from(providerIds), selectedCountries);
    if (isOnboarding) {
      setIsOnboarding(false);
      setSettingsOpen(true);
    }
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

  const sectionMap = new Map(sections.map((s) => [s.id, s]));

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Topbar
        onSelectMovie={handleSelectMovie}
        onLoginClick={() => setAuthModalOpen(true)}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenCountries={() => setCountriesModalOpen(true)}
        mediaType={mediaType}
        onMediaTypeChange={setMediaType}
      />

      <main className="page-container flex-1 pt-2 pb-16">
        <HeroSection />

        <section className="flex flex-col gap-10">
          {sections.map((section) => (
            <MovieRow
              key={section.id}
              section={section}
              onSelectMovie={handleSelectMovie}
              onSeeMore={(id) => setSelectedSection(sectionMap.get(id) || null)}
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
      />

      <SectionOverlay
        section={selectedSection}
        onClose={() => setSelectedSection(null)}
        onSelectMovie={handleSelectMovie}
        mediaType={mediaType}
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
