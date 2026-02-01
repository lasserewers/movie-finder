import SearchBar from "./SearchBar";
import UserMenu from "./UserMenu";
import { useAuth } from "../hooks/useAuth";

interface Props {
  onSelectMovie: (id: number) => void;
  onLoginClick: () => void;
}

export default function Topbar({ onSelectMovie, onLoginClick }: Props) {
  const { user } = useAuth();

  return (
    <header className="page-container flex items-center justify-between pt-6 pb-4 gap-4 relative z-[90] max-sm:flex-col max-sm:items-start max-sm:gap-3">
      <div className="flex items-center gap-3">
        <img src="/logo-text-white.svg" alt="FullStreamer" className="h-28" />
      </div>
      <div className="flex items-center gap-3 max-sm:w-full max-sm:flex-col max-sm:items-stretch">
        <SearchBar onSelectMovie={onSelectMovie} />
        {user ? (
          <UserMenu />
        ) : (
          <button
            onClick={onLoginClick}
            className="px-4 py-2 border border-border rounded-full font-semibold text-sm text-text hover:border-accent-2 transition-colors flex-shrink-0"
          >
            Log in
          </button>
        )}
      </div>
    </header>
  );
}
