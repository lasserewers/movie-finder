import { useState, useRef, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { useNotifications } from "../hooks/useNotifications";

interface Props {
  onOpenSettingsCenter: () => void;
  onOpenNotifications: () => void;
  onOpenWatchlist: () => void;
  onOpenWatched: () => void;
}

export default function UserMenu({
  onOpenSettingsCenter,
  onOpenNotifications,
  onOpenWatchlist,
  onOpenWatched,
}: Props) {
  const { user, logout } = useAuth();
  const { theme, setTheme } = useConfig();
  const { hasUnreadIndicator, clearUnreadIndicator, refresh } = useNotifications();
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
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) void refresh(true);
            return next;
          });
        }}
        className="relative w-[44px] h-[44px] sm:w-[52px] sm:h-[52px] border border-border rounded-full flex items-center justify-center hover:border-accent-2 transition-colors"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text sm:w-[22px] sm:h-[22px]">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
        {hasUnreadIndicator && (
          <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-300/70" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-panel border border-border rounded-xl shadow-2xl py-1 min-w-[280px] max-w-[320px] max-h-[80vh] overflow-y-auto z-50">
          <button
            onClick={() => {
              setOpen(false);
              onOpenSettingsCenter();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 0 1 0 2.8 2 2 0 0 1-2.8 0l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.2a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 0 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h.1a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v.1a1.6 1.6 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" />
            </svg>
            Settings
          </button>
          <button
            onClick={() => {
              setOpen(false);
              clearUnreadIndicator();
              onOpenNotifications();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="flex-1">Notifications</span>
            {hasUnreadIndicator && <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-amber-300/70" />}
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onOpenWatchlist();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
            Watchlist
          </button>
          <button
            onClick={() => {
              setOpen(false);
              onOpenWatched();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            Watched
          </button>
          {user.is_admin && (
            <button
              onClick={() => {
                setOpen(false);
                window.location.href = "/admin";
              }}
              className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text flex items-center gap-2.5"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3h18v18H3z" />
                <path d="M8 8h8v8H8z" />
              </svg>
              Admin center
            </button>
          )}
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
