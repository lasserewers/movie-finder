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
  addWatchedItem,
  getWatched,
  removeWatchedItem,
  type AddWatchedItemInput,
  type WatchedItem,
  type WatchedMediaType,
} from "../api/watched";
import { useAuth } from "./useAuth";

interface WatchedContextValue {
  items: WatchedItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  isWatched: (mediaType: WatchedMediaType, tmdbId: number) => boolean;
  add: (input: AddWatchedItemInput) => Promise<boolean>;
  remove: (mediaType: WatchedMediaType, tmdbId: number) => Promise<boolean>;
  toggle: (input: AddWatchedItemInput) => Promise<boolean>;
}

const WatchedContext = createContext<WatchedContextValue | null>(null);

function watchedKey(mediaType: WatchedMediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export function WatchedProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [items, setItems] = useState<WatchedItem[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getWatched();
      setItems(next);
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401) {
        setItems([]);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      setLoading(false);
      return;
    }
    void refresh();
  }, [user?.id, refresh, user]);

  const itemMap = useMemo(() => {
    const next = new Map<string, WatchedItem>();
    for (const item of items) {
      next.set(watchedKey(item.media_type, item.tmdb_id), item);
    }
    return next;
  }, [items]);

  const isWatched = useCallback(
    (mediaType: WatchedMediaType, tmdbId: number) => itemMap.has(watchedKey(mediaType, tmdbId)),
    [itemMap]
  );

  const add = useCallback(
    async (input: AddWatchedItemInput) => {
      if (!user) return false;
      const key = watchedKey(input.media_type, input.tmdb_id);
      const result = await addWatchedItem(input);
      setItems((prev) => [result.item, ...prev.filter((entry) => watchedKey(entry.media_type, entry.tmdb_id) !== key)]);
      return true;
    },
    [user]
  );

  const remove = useCallback(
    async (mediaType: WatchedMediaType, tmdbId: number) => {
      if (!user) return false;
      const key = watchedKey(mediaType, tmdbId);
      if (!itemMap.has(key)) return false;
      await removeWatchedItem(mediaType, tmdbId);
      setItems((prev) => prev.filter((entry) => watchedKey(entry.media_type, entry.tmdb_id) !== key));
      return true;
    },
    [itemMap, user]
  );

  const toggle = useCallback(
    async (input: AddWatchedItemInput) => {
      const key = watchedKey(input.media_type, input.tmdb_id);
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
    <WatchedContext.Provider
      value={{
        items,
        loading,
        refresh,
        isWatched,
        add,
        remove,
        toggle,
      }}
    >
      {children}
    </WatchedContext.Provider>
  );
}

export function useWatched() {
  const ctx = useContext(WatchedContext);
  if (!ctx) throw new Error("useWatched must be used within WatchedProvider");
  return ctx;
}
