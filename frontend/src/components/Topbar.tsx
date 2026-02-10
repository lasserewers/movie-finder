import { useEffect, useRef, useState } from "react";
import SearchBar from "./SearchBar";
import UserMenu from "./UserMenu";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { IOS_BRAVE } from "../utils/platform";
interface Props {
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  onLoginClick: () => void;
  onOpenSettingsCenter: () => void;
  onOpenNotifications: () => void;
  onOpenLists: () => void;
  onOpenWatchlist: () => void;
  onOpenWatched: () => void;
  onOpenSettings: () => void;
  vpnEnabled?: boolean;
  onSearchSubmit?: (query: string, filtered: boolean) => void;
  onOpenAdvancedSearch?: (initialQuery: string) => void;
  scrollContainer?: HTMLElement | null;
}

export default function Topbar({
  onSelectMovie,
  onLoginClick,
  onOpenSettingsCenter,
  onOpenNotifications,
  onOpenLists,
  onOpenWatchlist,
  onOpenWatched,
  onOpenSettings,
  vpnEnabled = false,
  onSearchSubmit,
  onOpenAdvancedSearch,
  scrollContainer,
}: Props) {
  const { user } = useAuth();
  const { theme } = useConfig();
  const [compact, setCompact] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const transitionLockUntilRef = useRef(0);

  useEffect(() => {
    if (IOS_BRAVE) {
      setCompact(false);
      return;
    }
    const ENTER_COMPACT_Y = 96;
    const EXIT_COMPACT_Y = 8;
    const TRANSITION_LOCK_MS = 320;
    const MOBILE_BREAKPOINT = 640;

    const getScrollY = () => (scrollContainer ? scrollContainer.scrollTop : window.scrollY);

    const onScroll = () => {
      if (window.innerWidth < MOBILE_BREAKPOINT) {
        setCompact(false);
        return;
      }
      const now = performance.now();
      if (now < transitionLockUntilRef.current) return;
      const y = getScrollY();
      setCompact((prev) => {
        const next = prev ? y > EXIT_COMPACT_Y : y > ENTER_COMPACT_Y;
        if (next !== prev) transitionLockUntilRef.current = now + TRANSITION_LOCK_MS;
        return next;
      });
    };
    onScroll();
    if (scrollContainer) {
      scrollContainer.addEventListener("scroll", onScroll, { passive: true });
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
    }
    window.addEventListener("resize", onScroll);
    return () => {
      if (scrollContainer) {
        scrollContainer.removeEventListener("scroll", onScroll);
      } else {
        window.removeEventListener("scroll", onScroll);
      }
      window.removeEventListener("resize", onScroll);
    };
  }, [scrollContainer]);

  return (
    <header className={`page-container flex items-center justify-between gap-4 relative z-[90] transition-[padding] duration-300 max-sm:flex-wrap max-sm:items-center max-sm:gap-x-1.5 max-sm:gap-y-2 ${compact ? "pt-2 pb-2" : "pt-6 pb-4"}`}>
      <div className={`relative overflow-hidden transition-[width,height] duration-300 ${compact ? "h-11 w-[34px]" : "h-28 w-[542px]"} max-sm:h-10 max-sm:w-[195px]`}>
        <img
          src={theme === "light" ? "/logo-text-black.svg" : "/logo-text-white.svg"}
          alt="FullStreamer"
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-auto transition-all duration-300 select-none pointer-events-none ${compact ? "h-24 opacity-0 scale-95" : "h-28 opacity-100 scale-100"} max-sm:h-10 max-sm:opacity-100 max-sm:scale-100`}
        />
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          className={`absolute left-0 top-1/2 -translate-y-1/2 w-auto transition-all duration-300 select-none pointer-events-none ${compact ? "h-11 opacity-100 scale-100" : "h-10 opacity-0 scale-95"} max-sm:opacity-0`}
        />
      </div>
      <div className="flex flex-1 justify-end max-sm:order-3 max-sm:basis-full">
        <SearchBar
          onSelectMovie={onSelectMovie}
          showFilterToggle={!!user}
          onOpenSettings={onOpenSettings}
          vpnEnabled={vpnEnabled}
          onSubmitSearch={onSearchSubmit}
          onQueryChange={setSearchDraft}
        />
      </div>
      <div className="relative z-[2] flex-shrink-0 flex items-center gap-2 max-sm:gap-1.5 max-sm:order-2 max-sm:ml-auto">
        {user && onOpenAdvancedSearch && (
          <button
            onClick={() => onOpenAdvancedSearch(searchDraft.trim())}
            className="h-[44px] sm:h-[52px] px-2.5 sm:px-3.5 border border-border rounded-full flex items-center justify-center gap-1.5 sm:gap-2 hover:border-accent-2 transition-colors text-muted hover:text-text"
            aria-label="Open advanced search"
            title="Advanced Search"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="sm:w-[18px] sm:h-[18px]">
              <circle cx="11" cy="11" r="7" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <span className="h-4 w-px bg-border/80" aria-hidden="true" />
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="sm:w-[18px] sm:h-[18px]">
              <line x1="4" y1="6" x2="20" y2="6" />
              <circle cx="9" cy="6" r="2" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <circle cx="15" cy="12" r="2" />
              <line x1="4" y1="18" x2="20" y2="18" />
              <circle cx="11" cy="18" r="2" />
            </svg>
          </button>
        )}
        {user ? (
          <UserMenu
            onOpenSettingsCenter={onOpenSettingsCenter}
            onOpenNotifications={onOpenNotifications}
            onOpenLists={onOpenLists}
            onOpenWatchlist={onOpenWatchlist}
            onOpenWatched={onOpenWatched}
          />
        ) : (
          <button
            onClick={onLoginClick}
            className="px-2 h-[42px] sm:px-5 sm:h-[52px] border border-border rounded-full font-semibold text-[0.68rem] sm:text-sm text-text hover:border-accent-2 transition-colors flex-shrink-0 touch-manipulation whitespace-nowrap"
          >
            <span className="sm:hidden">Log in</span>
            <span className="hidden sm:inline">Log in / Sign up</span>
          </button>
        )}
      </div>
    </header>
  );
}
