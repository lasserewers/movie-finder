import { useEffect, useRef, useState } from "react";
import SearchBar from "./SearchBar";
import UserMenu from "./UserMenu";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import type { MediaType } from "../api/movies";

interface Props {
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  onLoginClick: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenCountries: () => void;
  mediaType: MediaType;
  vpnEnabled?: boolean;
}

export default function Topbar({
  onSelectMovie,
  onLoginClick,
  onOpenProfile,
  onOpenSettings,
  onOpenCountries,
  mediaType,
  vpnEnabled = false,
}: Props) {
  const { user } = useAuth();
  const { theme } = useConfig();
  const [compact, setCompact] = useState(false);
  const transitionLockUntilRef = useRef(0);

  useEffect(() => {
    const ENTER_COMPACT_Y = 96;
    const EXIT_COMPACT_Y = 8;
    const TRANSITION_LOCK_MS = 320;

    const onScroll = () => {
      const now = performance.now();
      if (now < transitionLockUntilRef.current) return;
      const y = window.scrollY;
      setCompact((prev) => {
        const next = prev ? y > EXIT_COMPACT_Y : y > ENTER_COMPACT_Y;
        if (next !== prev) transitionLockUntilRef.current = now + TRANSITION_LOCK_MS;
        return next;
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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
          mediaType={mediaType}
          showFilterToggle={!!user}
          onOpenSettings={onOpenSettings}
          vpnEnabled={vpnEnabled}
        />
      </div>
      <div className="flex-shrink-0 max-sm:order-2 max-sm:ml-auto">
        {user ? (
          <UserMenu onOpenProfile={onOpenProfile} onOpenSettings={onOpenSettings} onOpenCountries={onOpenCountries} />
        ) : (
          <button
            onClick={onLoginClick}
            className="px-2.5 h-[42px] sm:px-5 sm:h-[52px] border border-border rounded-full font-semibold text-[0.7rem] sm:text-sm text-text hover:border-accent-2 transition-colors flex-shrink-0"
          >
            Log in / Sign up
          </button>
        )}
      </div>
    </header>
  );
}
