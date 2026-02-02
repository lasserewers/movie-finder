import SearchBar from "./SearchBar";
import UserMenu from "./UserMenu";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import type { MediaType } from "../api/movies";

const MEDIA_OPTIONS: { value: MediaType; label: string }[] = [
  { value: "mix", label: "All" },
  { value: "movie", label: "Movies" },
  { value: "tv", label: "TV Shows" },
];

interface Props {
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  onLoginClick: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenCountries: () => void;
  mediaType: MediaType;
  onMediaTypeChange: (mt: MediaType) => void;
}

export default function Topbar({ onSelectMovie, onLoginClick, onOpenProfile, onOpenSettings, onOpenCountries, mediaType, onMediaTypeChange }: Props) {
  const { user } = useAuth();
  const { theme } = useConfig();

  return (
    <header className="page-container flex items-center justify-between pt-6 pb-4 gap-4 relative z-[90] max-sm:flex-col max-sm:items-start max-sm:gap-3">
      <div className="flex items-center gap-3">
        <img
          src={theme === "light" ? "/logo-text-black.svg" : "/logo-text-white.svg"}
          alt="FullStreamer"
          className="h-28"
        />
      </div>
      <div className="flex items-center gap-3 flex-1 justify-end max-sm:w-full max-sm:flex-col max-sm:items-stretch">
        <div className="flex items-center rounded-full border border-border bg-panel overflow-hidden h-[42px] flex-shrink-0">
          {MEDIA_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => onMediaTypeChange(opt.value)}
              className={`px-4 h-full text-sm font-medium transition-colors ${
                mediaType === opt.value
                  ? "bg-accent/15 text-text"
                  : "text-muted hover:text-text"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <SearchBar onSelectMovie={onSelectMovie} mediaType={mediaType} />
        {user ? (
          <UserMenu onOpenProfile={onOpenProfile} onOpenSettings={onOpenSettings} onOpenCountries={onOpenCountries} />
        ) : (
          <button
            onClick={onLoginClick}
            className="px-5 h-[52px] border border-border rounded-full font-semibold text-sm text-text hover:border-accent-2 transition-colors flex-shrink-0"
          >
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
