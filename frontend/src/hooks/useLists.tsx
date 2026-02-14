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
  addItemToList,
  createList,
  deleteList,
  getListItems,
  getLists,
  getTitleMemberships,
  reorderListItems,
  removeItemFromList,
  renameList,
  type AddListItemInput,
  type ListMediaType,
  type UserListItem,
  type UserListSummary,
} from "../api/lists";
import { useAuth } from "./useAuth";

interface ListsContextValue {
  lists: UserListSummary[];
  loading: boolean;
  refresh: () => Promise<void>;
  create: (name: string) => Promise<UserListSummary>;
  rename: (listId: string, name: string) => Promise<UserListSummary>;
  remove: (listId: string) => Promise<boolean>;
  getItems: (listId: string) => Promise<UserListItem[]>;
  refreshItems: (listId: string) => Promise<UserListItem[]>;
  addToList: (listId: string, input: AddListItemInput) => Promise<boolean>;
  removeFromList: (listId: string, mediaType: ListMediaType, tmdbId: number) => Promise<boolean>;
  reorderItems: (listId: string, itemIds: string[]) => Promise<boolean>;
  membershipsFor: (mediaType: ListMediaType, tmdbId: number) => Set<string>;
  loadMemberships: (mediaType: ListMediaType, tmdbId: number) => Promise<Set<string>>;
  toggleMembership: (listId: string, input: AddListItemInput) => Promise<boolean>;
}

const ListsContext = createContext<ListsContextValue | null>(null);

function listItemKey(mediaType: ListMediaType, tmdbId: number): string {
  return `${mediaType}:${tmdbId}`;
}

export function ListsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const isPremiumUser = !!user && (user.subscription_tier === "premium" || user.subscription_tier === "free_premium");
  const [lists, setLists] = useState<UserListSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [itemsByList, setItemsByList] = useState<Record<string, UserListItem[]>>({});
  const [membershipsByKey, setMembershipsByKey] = useState<Record<string, string[]>>({});

  const touchList = useCallback((listId: string, countDelta: number | null = null) => {
    const now = new Date().toISOString();
    setLists((prev) => {
      const next = prev.map((entry) => {
        if (entry.id !== listId) return entry;
        const nextCount =
          countDelta === null
            ? entry.item_count
            : Math.max(0, (entry.item_count || 0) + countDelta);
        return {
          ...entry,
          item_count: nextCount,
          updated_at: now,
        };
      });
      next.sort((a, b) => (Date.parse(b.updated_at || "") || 0) - (Date.parse(a.updated_at || "") || 0));
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!user || !isPremiumUser) {
      setLists([]);
      setItemsByList({});
      setMembershipsByKey({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const next = await getLists();
      setLists(next);
      setItemsByList((prev) => {
        const nextKeys = new Set(next.map((entry) => entry.id));
        const trimmed: Record<string, UserListItem[]> = {};
        for (const [listId, items] of Object.entries(prev)) {
          if (nextKeys.has(listId)) trimmed[listId] = items;
        }
        return trimmed;
      });
      setMembershipsByKey((prev) => {
        if (!next.length) return {};
        const nextListIds = new Set(next.map((entry) => entry.id));
        const trimmed: Record<string, string[]> = {};
        for (const [key, memberships] of Object.entries(prev)) {
          const filtered = memberships.filter((listId) => nextListIds.has(listId));
          if (filtered.length) trimmed[key] = filtered;
        }
        return trimmed;
      });
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 401 || apiError.status === 403) {
        setLists([]);
        setItemsByList({});
        setMembershipsByKey({});
      }
    } finally {
      setLoading(false);
    }
  }, [isPremiumUser, user]);

  useEffect(() => {
    if (!user || !isPremiumUser) {
      setLists([]);
      setItemsByList({});
      setMembershipsByKey({});
      setLoading(false);
      return;
    }
    void refresh();
  }, [user?.id, isPremiumUser, refresh, user]);

  const create = useCallback(
    async (name: string) => {
      const result = await createList(name);
      setLists((prev) => [result.list, ...prev.filter((entry) => entry.id !== result.list.id)]);
      return result.list;
    },
    []
  );

  const rename = useCallback(async (listId: string, name: string) => {
    const result = await renameList(listId, name);
    setLists((prev) => prev.map((entry) => (entry.id === listId ? result.list : entry)));
    return result.list;
  }, []);

  const remove = useCallback(async (listId: string) => {
    const result = await deleteList(listId);
    if (!result.removed) return false;
    setLists((prev) => prev.filter((entry) => entry.id !== listId));
    setItemsByList((prev) => {
      const next = { ...prev };
      delete next[listId];
      return next;
    });
    setMembershipsByKey((prev) => {
      const next: Record<string, string[]> = {};
      for (const [key, memberships] of Object.entries(prev)) {
        const filtered = memberships.filter((entry) => entry !== listId);
        if (filtered.length) next[key] = filtered;
      }
      return next;
    });
    return true;
  }, []);

  const mergeListSummary = useCallback((summary: UserListSummary) => {
    setLists((prev) => {
      const next = prev.map((entry) => (entry.id === summary.id ? summary : entry));
      if (!next.some((entry) => entry.id === summary.id)) next.push(summary);
      next.sort((a, b) => (Date.parse(b.updated_at || "") || 0) - (Date.parse(a.updated_at || "") || 0));
      return next;
    });
  }, []);

  const refreshItems = useCallback(
    async (listId: string) => {
      const data = await getListItems(listId);
      setItemsByList((prev) => ({ ...prev, [listId]: data.results || [] }));
      mergeListSummary(data.list);
      return data.results || [];
    },
    [mergeListSummary]
  );

  const getItems = useCallback(
    async (listId: string) => {
      const cached = itemsByList[listId];
      if (cached) return cached;
      return refreshItems(listId);
    },
    [itemsByList, refreshItems]
  );

  const addToList = useCallback(
    async (listId: string, input: AddListItemInput) => {
      const key = listItemKey(input.media_type, input.tmdb_id);
      const result = await addItemToList(listId, input);
      setItemsByList((prev) => {
        if (!(listId in prev)) return prev;
        const existing = prev[listId] || [];
        const nextItems = [
          ...existing.filter(
            (entry) => listItemKey(entry.media_type, entry.tmdb_id) !== key
          ),
          result.item,
        ];
        return { ...prev, [listId]: nextItems };
      });
      setMembershipsByKey((prev) => {
        const current = new Set(prev[key] || []);
        current.add(listId);
        return { ...prev, [key]: Array.from(current) };
      });
      touchList(listId, result.already_exists ? null : 1);
      return true;
    },
    [touchList]
  );

  const reorderItems = useCallback(
    async (listId: string, itemIds: string[]) => {
      const normalizedIds = Array.from(new Set(itemIds.map((value) => String(value))));
      if (!normalizedIds.length) return false;
      const previous = itemsByList[listId] || [];
      if (!previous.length) return false;

      const byId = new Map(previous.map((item) => [item.id, item]));
      const ordered: UserListItem[] = [];
      for (let idx = 0; idx < normalizedIds.length; idx += 1) {
        const item = byId.get(normalizedIds[idx]);
        if (!item) continue;
        ordered.push({ ...item, sort_index: idx + 1 });
      }

      if (ordered.length !== previous.length) {
        throw new Error("Reorder payload does not match cached list items");
      }

      setItemsByList((prev) => ({ ...prev, [listId]: ordered }));
      touchList(listId, null);

      try {
        await reorderListItems(listId, normalizedIds);
        return true;
      } catch (err) {
        setItemsByList((prev) => ({ ...prev, [listId]: previous }));
        throw err;
      }
    },
    [itemsByList, touchList]
  );

  const removeFromList = useCallback(
    async (listId: string, mediaType: ListMediaType, tmdbId: number) => {
      const key = listItemKey(mediaType, tmdbId);
      const result = await removeItemFromList(listId, mediaType, tmdbId);
      if (!result.removed) return false;
      setItemsByList((prev) => {
        if (!(listId in prev)) return prev;
        return {
          ...prev,
          [listId]: (prev[listId] || []).filter(
            (entry) => listItemKey(entry.media_type, entry.tmdb_id) !== key
          ),
        };
      });
      setMembershipsByKey((prev) => {
        const current = new Set(prev[key] || []);
        current.delete(listId);
        if (current.size === 0) {
          const next = { ...prev };
          delete next[key];
          return next;
        }
        return { ...prev, [key]: Array.from(current) };
      });
      touchList(listId, -1);
      return true;
    },
    [touchList]
  );

  const membershipsFor = useCallback(
    (mediaType: ListMediaType, tmdbId: number) => {
      const key = listItemKey(mediaType, tmdbId);
      return new Set(membershipsByKey[key] || []);
    },
    [membershipsByKey]
  );

  const loadMemberships = useCallback(async (mediaType: ListMediaType, tmdbId: number) => {
    const key = listItemKey(mediaType, tmdbId);
    const memberships = await getTitleMemberships(mediaType, tmdbId);
    setMembershipsByKey((prev) => ({ ...prev, [key]: Array.from(memberships) }));
    return memberships;
  }, []);

  const toggleMembership = useCallback(
    async (listId: string, input: AddListItemInput) => {
      const current = membershipsFor(input.media_type, input.tmdb_id);
      if (current.has(listId)) {
        await removeFromList(listId, input.media_type, input.tmdb_id);
        return false;
      }
      await addToList(listId, input);
      return true;
    },
    [addToList, membershipsFor, removeFromList]
  );

  const value = useMemo(
    () => ({
      lists,
      loading,
      refresh,
      create,
      rename,
      remove,
      getItems,
      refreshItems,
      addToList,
      removeFromList,
      reorderItems,
      membershipsFor,
      loadMemberships,
      toggleMembership,
    }),
    [
      lists,
      loading,
      refresh,
      create,
      rename,
      remove,
      getItems,
      refreshItems,
      addToList,
      removeFromList,
      reorderItems,
      membershipsFor,
      loadMemberships,
      toggleMembership,
    ]
  );

  return <ListsContext.Provider value={value}>{children}</ListsContext.Provider>;
}

export function useLists() {
  const ctx = useContext(ListsContext);
  if (!ctx) throw new Error("useLists must be used within ListsProvider");
  return ctx;
}
