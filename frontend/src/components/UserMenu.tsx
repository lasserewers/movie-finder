import { useState, useRef, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";

interface Props {
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onOpenCountries: () => void;
}

export default function UserMenu({ onOpenProfile, onOpenSettings, onOpenCountries }: Props) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useConfig();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  if (!user) return null;

  const isLight = theme === "light";

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="w-[44px] h-[44px] sm:w-[52px] sm:h-[52px] border border-border rounded-full flex items-center justify-center hover:border-accent-2 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text sm:w-[22px] sm:h-[22px]">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-panel border border-border rounded-xl shadow-2xl py-1 min-w-[200px] z-50">
          <button
            onClick={() => {
              setOpen(false);
              onOpenProfile();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Profile
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onOpenCountries();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
            Manage countries
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onOpenSettings();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <path d="M8 21h8" />
              <path d="M12 17v4" />
            </svg>
            Manage services
          </button>
          <div className="px-4 py-2.5 flex items-center justify-between">
            <span className="text-sm text-muted flex items-center gap-2.5">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {isLight ? (
                  <>
                    <circle cx="12" cy="12" r="5" />
                    <line x1="12" y1="1" x2="12" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="23" />
                    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                    <line x1="1" y1="12" x2="3" y2="12" />
                    <line x1="21" y1="12" x2="23" y2="12" />
                    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
                  </>
                ) : (
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                )}
              </svg>
              {isLight ? "Light" : "Dark"} mode
            </span>
            <button
              onClick={() => setTheme(isLight ? "dark" : "light")}
              className={`relative w-9 h-5 rounded-full transition-colors ${
                isLight ? "bg-accent" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform duration-200 ${
                  isLight ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
          <div className="border-t border-border my-1" />
          <button
            onClick={async () => {
              await logout();
              window.location.reload();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
