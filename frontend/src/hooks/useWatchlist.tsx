import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../api/client";
import {
  addWatchlistItem,
  getWatchlist,
  removeWatchlistItem,
  type AddWatchlistItemInput,
  type WatchlistItem,
  type WatchlistMediaType,
} from "../api/watchlist";
import { useAuth } from "./useAuth";

interface WatchlistContextValue {
  items: WatchlistItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  isInWatchlist: (mediaType: WatchlistMediaType, tmdbId: number) => boolean;
  add: (input: AddWatchlistItemInput) => Promise<boolean>;
  remove: (mediaType: WatchlistMediaType, tmdbId: number) => Promise<boolean>;
  toggle: (input: AddWatchlistItemInput) => Promise<boolean>;
}

const WatchlistContext = createContext<WatchlistContextValue | null>(null);

function watchlistKey(mediaType: WatchlistMediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export function WatchlistProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isPremiumUser = !!user && (user.subscription_tier === "premium" || user.subscription_tier === "free_premium");
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user || !isPremiumUser) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getWatchlist();
      setItems(next);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [isPremiumUser, user]);

  useEffect(() => {
    if (!user || !isPremiumUser) {
      setItems([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [user?.id, isPremiumUser, refresh, user]);

  const itemMap = useMemo(() => {
    const next = new Map<string, WatchlistItem>();
    for (const item of items) {
      next.set(watchlistKey(item.media_type, item.tmdb_id), item);
    }
    return next;
  }, [items]);

  const isInWatchlist = useCallback(
    (mediaType: WatchlistMediaType, tmdbId: number) => itemMap.has(watchlistKey(mediaType, tmdbId)),
    [itemMap]
  );

  const add = useCallback(
    async (input: AddWatchlistItemInput) => {
      if (!user) return false;
      const key = watchlistKey(input.media_type, input.tmdb_id);
      if (itemMap.has(key)) return true;
      const result = await addWatchlistItem(input);
      setItems((prev) => [result.item, ...prev.filter((entry) => watchlistKey(entry.media_type, entry.tmdb_id) !== key)]);
      return true;
    },
    [itemMap, user]
  );

  const remove = useCallback(
    async (mediaType: WatchlistMediaType, tmdbId: number) => {
      if (!user) return false;
      const key = watchlistKey(mediaType, tmdbId);
      if (!itemMap.has(key)) return false;
      await removeWatchlistItem(mediaType, tmdbId);
      setItems((prev) => prev.filter((entry) => watchlistKey(entry.media_type, entry.tmdb_id) !== key));
      return true;
    },
    [itemMap, user]
  );

  const toggle = useCallback(
    async (input: AddWatchlistItemInput) => {
      const key = watchlistKey(input.media_type, input.tmdb_id);
      if (itemMap.has(key)) {
        await remove(input.media_type, input.tmdb_id);
        return false;
      }
      await add(input);
      return true;
    },
    [add, itemMap, remove]
  );

  return (
    <WatchlistContext.Provider
      value={{
        items,
        loading,
        refresh,
        isInWatchlist,
        add,
        remove,
        toggle,
      }}
    >
      {children}
    </WatchlistContext.Provider>
  );
}

export function useWatchlist() {
  const ctx = useContext(WatchlistContext);
  if (!ctx) throw new Error("useWatchlist must be used within WatchlistProvider");
  return ctx;
}
