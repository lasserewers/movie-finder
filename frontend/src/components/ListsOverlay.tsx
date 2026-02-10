import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { searchMovies, type Movie as SearchMovie } from "../api/movies";
import MovieCard from "./MovieCard";
import Spinner from "./Spinner";
import { useLists } from "../hooks/useLists";
import { ApiError } from "../api/client";
import type { UserListItem } from "../api/lists";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  initialListId?: string | null;
  homeListIds?: string[];
  onToggleHomeList?: (listId: string) => void;
}

export default function ListsOverlay({
  open,
  onClose,
  onSelectMovie,
  initialListId,
  homeListIds = [],
  onToggleHomeList,
}: Props) {
  const {
    lists,
    loading,
    refresh,
    create,
    rename,
    remove,
    getItems,
    addToList,
    removeFromList,
    reorderItems,
  } = useLists();
  const [selectedListId, setSelectedListId] = useState("");
  const [listItems, setListItems] = useState<Record<string, UserListItem[]>>({});
  const [itemsLoading, setItemsLoading] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListBusy, setNewListBusy] = useState(false);
  const [newListErr, setNewListErr] = useState("");
  const [editingListId, setEditingListId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameErr, setRenameErr] = useState("");
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{ id: string; name: string } | null>(null);
  const [removingListId, setRemovingListId] = useState("");
  const [removeItemBusyKey, setRemoveItemBusyKey] = useState("");
  const [itemsErr, setItemsErr] = useState("");
  const [quickSearchQuery, setQuickSearchQuery] = useState("");
  const [quickSearchResults, setQuickSearchResults] = useState<SearchMovie[]>([]);
  const [quickSearchLoading, setQuickSearchLoading] = useState(false);
  const [quickSearchErr, setQuickSearchErr] = useState("");
  const [quickAddBusyKey, setQuickAddBusyKey] = useState("");
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);
  const quickSearchRef = useRef<HTMLDivElement | null>(null);
  const listContentRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const dragPointerYRef = useRef<number | null>(null);
  const [gridColumns, setGridColumns] = useState(1);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [reorderBusy, setReorderBusy] = useState(false);
  const [reorderErr, setReorderErr] = useState("");
  const [positionDrafts, setPositionDrafts] = useState<Record<string, string>>({});
  const [contentEditMode, setContentEditMode] = useState(false);
  const homeListIdSet = useMemo(() => new Set(homeListIds), [homeListIds]);

  useEffect(() => {
    if (!open) return;
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (open) return;
    setSelectedListId("");
    setQuickSearchQuery("");
    setQuickSearchResults([]);
    setQuickSearchLoading(false);
    setQuickSearchErr("");
    setQuickAddBusyKey("");
    setQuickSearchOpen(false);
    setDragIndex(null);
    setDragOverIndex(null);
    setReorderBusy(false);
    setReorderErr("");
    setPositionDrafts({});
    setContentEditMode(false);
    setDeleteConfirmTarget(null);
    dragPointerYRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open || !quickSearchOpen || !contentEditMode) return;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const targetNode = event.target as Node | null;
      if (!targetNode) return;
      if (quickSearchRef.current?.contains(targetNode)) return;
      setQuickSearchOpen(false);
      setQuickSearchQuery("");
      setQuickSearchResults([]);
      setQuickSearchLoading(false);
      setQuickSearchErr("");
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [open, quickSearchOpen, contentEditMode]);

  useEffect(() => {
    if (!open || !gridRef.current) return;
    const el = gridRef.current;
    const measure = () => {
      const width = el.clientWidth || 1;
      const minCardWidth = window.innerWidth < 640 ? 100 : 140;
      const gap = window.innerWidth < 640 ? 12 : 16;
      const columns = Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
      setGridColumns(columns);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [open, selectedListId, listItems]);

  useEffect(() => {
    if (!open) return;
    if (lists.length === 0) {
      setSelectedListId("");
      setContentEditMode(false);
      return;
    }
    const preferredListId =
      initialListId && lists.some((entry) => entry.id === initialListId)
        ? initialListId
        : lists[0].id;
    if (!selectedListId || !lists.some((entry) => entry.id === selectedListId)) {
      setSelectedListId(preferredListId);
      setContentEditMode(false);
    }
  }, [open, lists, selectedListId, initialListId]);

  useEffect(() => {
    if (!open || !selectedListId) return;
    let cancelled = false;
    setItemsErr("");
    setItemsLoading(true);
    getItems(selectedListId)
      .then((items) => {
        if (cancelled) return;
        setListItems((prev) => ({ ...prev, [selectedListId]: items }));
      })
      .catch((err) => {
        if (cancelled) return;
        setItemsErr(err instanceof ApiError ? err.message : "Could not load list items.");
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedListId, getItems]);

  const selectedList = useMemo(
    () => lists.find((entry) => entry.id === selectedListId) || null,
    [lists, selectedListId]
  );
  const selectedItems = selectedList ? (listItems[selectedList.id] || []) : [];
  const selectedItemKeys = useMemo(
    () => new Set(selectedItems.map((item) => `${item.media_type}:${item.tmdb_id}`)),
    [selectedItems]
  );
  const orderInputWidthRem = useMemo(() => {
    const digits = Math.max(2, String(Math.max(1, selectedItems.length)).length);
    return Math.max(3.5, 2.15 + digits * 0.72);
  }, [selectedItems.length]);

  useEffect(() => {
    setPositionDrafts({});
  }, [selectedListId, selectedItems.length]);

  useEffect(() => {
    if (!open || !selectedList || !quickSearchOpen || !contentEditMode) {
      setQuickSearchLoading(false);
      setQuickSearchResults([]);
      setQuickSearchErr("");
      return;
    }
    const term = quickSearchQuery.trim();
    if (term.length < 2) {
      setQuickSearchLoading(false);
      setQuickSearchResults([]);
      setQuickSearchErr("");
      return;
    }
    let cancelled = false;
    const timerId = window.setTimeout(() => {
      setQuickSearchLoading(true);
      setQuickSearchErr("");
      searchMovies(term, "mix", 14)
        .then((data) => {
          if (cancelled) return;
          setQuickSearchResults(data.results || []);
        })
        .catch((err) => {
          if (cancelled) return;
          setQuickSearchErr(err instanceof ApiError ? err.message : "Could not search titles.");
          setQuickSearchResults([]);
        })
        .finally(() => {
          if (!cancelled) setQuickSearchLoading(false);
        });
    }, 260);
    return () => {
      cancelled = true;
      window.clearTimeout(timerId);
    };
  }, [open, quickSearchOpen, quickSearchQuery, selectedList, contentEditMode]);

  useEffect(() => {
    if (!open || !contentEditMode || dragIndex == null) return;
    const container = listContentRef.current;
    if (!container) return;

    const edgeThreshold = window.innerWidth < 640 ? 78 : 96;
    const maxScrollSpeed = window.innerWidth < 640 ? 18 : 24;
    let frameId = 0;

    const tick = () => {
      const pointerY = dragPointerYRef.current;
      if (pointerY != null && container.scrollHeight > container.clientHeight) {
        const rect = container.getBoundingClientRect();
        const upperEdge = rect.top + edgeThreshold;
        const lowerEdge = rect.bottom - edgeThreshold;
        let delta = 0;

        if (pointerY < upperEdge) {
          const strength = Math.min(1, (upperEdge - pointerY) / edgeThreshold);
          delta = -Math.max(2, strength * maxScrollSpeed);
        } else if (pointerY > lowerEdge) {
          const strength = Math.min(1, (pointerY - lowerEdge) / edgeThreshold);
          delta = Math.max(2, strength * maxScrollSpeed);
        }

        if (delta !== 0) {
          container.scrollTop += delta;
        }
      }

      frameId = window.requestAnimationFrame(tick);
    };

    frameId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [open, contentEditMode, dragIndex]);

  const handleCreateList = async (event: React.FormEvent) => {
    event.preventDefault();
    if (newListBusy) return;
    setNewListErr("");
    setNewListBusy(true);
    try {
      const created = await create(newListName);
      setSelectedListId(created.id);
      setNewListName("");
      setEditingListId("");
      setEditingName("");
      setQuickSearchErr("");
    } catch (err) {
      setNewListErr(err instanceof ApiError ? err.message : "Could not create list.");
    } finally {
      setNewListBusy(false);
    }
  };

  const handleStartRename = () => {
    if (!selectedList) return;
    setEditingListId(selectedList.id);
    setEditingName(selectedList.name);
    setRenameErr("");
  };

  const handleRenameList = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedList || renameBusy) return;
    setRenameErr("");
    setRenameBusy(true);
    try {
      await rename(selectedList.id, editingName);
      setEditingListId("");
      setEditingName("");
    } catch (err) {
      setRenameErr(err instanceof ApiError ? err.message : "Could not rename list.");
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDeleteList = async () => {
    if (!selectedList || removingListId) return;
    setDeleteConfirmTarget({ id: selectedList.id, name: selectedList.name });
  };

  const handleConfirmDeleteList = async () => {
    if (!deleteConfirmTarget || removingListId) return;
    const target = deleteConfirmTarget;
    setRemovingListId(target.id);
    try {
      const removed = await remove(target.id);
      if (removed) {
        setListItems((prev) => {
          const next = { ...prev };
          delete next[target.id];
          return next;
        });
      }
    } catch {
      // Keep UI state unchanged; fetch will re-sync.
    } finally {
      setRemovingListId("");
      setDeleteConfirmTarget(null);
    }
  };

  const handleRemoveItem = async (mediaType: "movie" | "tv", tmdbId: number) => {
    if (!selectedList) return;
    const busyKey = `${selectedList.id}:${mediaType}:${tmdbId}`;
    if (removeItemBusyKey === busyKey) return;
    setRemoveItemBusyKey(busyKey);
    try {
      const removed = await removeFromList(selectedList.id, mediaType, tmdbId);
      if (removed) {
        setReorderErr("");
        setListItems((prev) => ({
          ...prev,
          [selectedList.id]: (prev[selectedList.id] || []).filter(
            (entry) => !(entry.media_type === mediaType && entry.tmdb_id === tmdbId)
          ),
        }));
      }
    } finally {
      setRemoveItemBusyKey("");
    }
  };

  const resolveMediaType = (entry: SearchMovie): "movie" | "tv" => {
    if (entry.media_type === "tv") return "tv";
    if (entry.media_type === "movie") return "movie";
    return entry.number_of_seasons != null ? "tv" : "movie";
  };

  const handleAddQuickSearchResult = async (entry: SearchMovie) => {
    if (!selectedList) return;
    const mediaType = resolveMediaType(entry);
    const busyKey = `${mediaType}:${entry.id}`;
    if (!entry.id || quickAddBusyKey === busyKey) return;
    setQuickAddBusyKey(busyKey);
    setQuickSearchErr("");
    try {
      await addToList(selectedList.id, {
        tmdb_id: entry.id,
        media_type: mediaType,
        title: entry.title,
        poster_path: entry.poster_path || undefined,
        release_date: entry.release_date || undefined,
      });
      const updated = await getItems(selectedList.id);
      setListItems((prev) => ({ ...prev, [selectedList.id]: updated }));
      setPositionDrafts({});
    } catch (err) {
      setQuickSearchErr(err instanceof ApiError ? err.message : "Could not add title to list.");
    } finally {
      setQuickAddBusyKey("");
    }
  };

  const moveItemToIndex = async (fromIndex: number, toIndex: number) => {
    if (!selectedList) return;
    if (!contentEditMode) return;
    if (fromIndex === toIndex) return;
    if (reorderBusy) return;
    const clampedTo = Math.max(0, Math.min(selectedItems.length - 1, toIndex));
    if (fromIndex === clampedTo) return;

    const ordered = [...selectedItems];
    const [moved] = ordered.splice(fromIndex, 1);
    if (!moved) return;
    ordered.splice(clampedTo, 0, moved);

    setReorderErr("");
    setReorderBusy(true);
    setListItems((prev) => ({ ...prev, [selectedList.id]: ordered }));
    setPositionDrafts({});
    try {
      const ok = await reorderItems(selectedList.id, ordered.map((item) => item.id));
      if (!ok) throw new Error("Reorder failed");
    } catch (err) {
      setReorderErr(err instanceof ApiError ? err.message : "Could not save new order.");
      try {
        const refreshed = await getItems(selectedList.id);
        setListItems((prev) => ({ ...prev, [selectedList.id]: refreshed }));
      } catch {
        // Keep local optimistic order if a refresh is unavailable.
      }
    } finally {
      setReorderBusy(false);
    }
  };

  const handleDragStart = (
    event: React.DragEvent<HTMLDivElement>,
    index: number
  ) => {
    if (!contentEditMode) return;
    if (reorderBusy) return;
    setDragIndex(index);
    setDragOverIndex(index);
    dragPointerYRef.current = event.clientY || null;

    const previewSource =
      event.currentTarget.querySelector<HTMLElement>('[data-drag-preview-card="1"]') ||
      event.currentTarget;
    const rect = previewSource.getBoundingClientRect();
    const offsetX = Math.max(16, Math.min(24, rect.width / 2));
    const offsetY = Math.max(16, Math.min(24, rect.height / 2));
    event.dataTransfer.setDragImage(previewSource, offsetX, offsetY);
  };

  const handleDropAt = async (targetIndex: number) => {
    if (!contentEditMode) return;
    if (dragIndex == null) return;
    const from = dragIndex;
    setDragIndex(null);
    setDragOverIndex(null);
    dragPointerYRef.current = null;
    await moveItemToIndex(from, targetIndex);
  };

  const handleManualPositionCommit = async (itemId: string, raw: string) => {
    if (!contentEditMode) return;
    const currentIndex = selectedItems.findIndex((item) => item.id === itemId);
    if (currentIndex < 0) return;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) {
      setPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      return;
    }
    const targetIndex = Math.max(0, Math.min(selectedItems.length - 1, parsed - 1));
    setPositionDrafts((prev) => {
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
    await moveItemToIndex(currentIndex, targetIndex);
  };

  const toggleContentEditMode = () => {
    setContentEditMode((prev) => {
      const next = !prev;
      if (!next) {
        setQuickSearchOpen(false);
        setQuickSearchQuery("");
        setQuickSearchResults([]);
        setQuickSearchLoading(false);
        setQuickSearchErr("");
        setQuickAddBusyKey("");
        setDragIndex(null);
        setDragOverIndex(null);
        setPositionDrafts({});
        dragPointerYRef.current = null;
      }
      return next;
    });
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl w-full max-w-[1180px] h-[calc(100dvh-1.5rem)] sm:h-[92dvh] flex flex-col overflow-hidden z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 sm:top-8 sm:right-8 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors z-10"
            >
              &times;
            </button>

            <AnimatePresence>
              {deleteConfirmTarget && (
                <motion.div
                  className="absolute inset-0 z-20 flex items-center justify-center p-4"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                >
                  <div
                    className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
                    onClick={() => {
                      if (removingListId) return;
                      setDeleteConfirmTarget(null);
                    }}
                  />
                  <motion.div
                    className="relative w-full max-w-md rounded-2xl border border-border bg-panel shadow-[0_20px_60px_rgba(0,0,0,0.45)] p-5 sm:p-6"
                    initial={{ y: 12, scale: 0.98 }}
                    animate={{ y: 0, scale: 1 }}
                    exit={{ y: 12, scale: 0.98 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <h4 className="text-lg font-semibold text-text">Delete this list?</h4>
                    <p className="text-sm text-muted mt-2">
                      "{deleteConfirmTarget.name}" will be permanently deleted. This cannot be undone.
                    </p>
                    <div className="mt-5 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleteConfirmTarget(null)}
                        disabled={!!removingListId}
                        className="h-9 px-3 rounded-full border border-border text-sm text-muted hover:text-text hover:border-accent-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleConfirmDeleteList()}
                        disabled={!!removingListId}
                        className="h-9 px-3 rounded-full border border-red-500/70 bg-red-500/15 text-sm text-red-200 hover:border-red-400 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        {removingListId ? "Deleting..." : "Delete list"}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="p-6 sm:p-8 pb-0 sm:pb-0 pr-14">
              <h3 className="font-display text-2xl">Your Lists</h3>
              <p className="text-sm text-muted mt-1">Create custom lists and manage the titles inside them.</p>
            </div>

            <div className="flex-1 min-h-0 p-4 sm:p-6 pt-3 sm:pt-4 overflow-hidden">
              <div className="h-full min-h-0 rounded-xl border border-border/80 bg-bg/40 overflow-hidden grid grid-cols-[280px_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[auto_minmax(0,1fr)]">
                <aside className="min-h-0 border-r border-border/80 max-sm:border-r-0 max-sm:border-b max-sm:border-border/80 bg-panel-2/60 p-3 sm:p-4 flex flex-col overflow-hidden">
                  <div className="flex-shrink-0">
                    <form onSubmit={handleCreateList} className="space-y-2">
                      <input
                        type="text"
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="Create a new list..."
                        className="w-full h-9 px-3 border border-border rounded-lg bg-bg-2 text-text text-sm outline-none focus:border-accent-2 transition-colors"
                      />
                      <button
                        type="submit"
                        disabled={newListBusy || !newListName.trim()}
                        className="w-full h-9 rounded-lg border border-accent/60 bg-accent/15 text-sm text-text hover:bg-accent/25 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                      >
                        {newListBusy ? "Creating..." : "Create list"}
                      </button>
                      {newListErr && (
                        <div className="text-xs text-red-300 bg-red-500/10 rounded-md px-2 py-1">
                          {newListErr}
                        </div>
                      )}
                    </form>
                  </div>

                  <div className="mt-4 flex-1 min-h-0 overflow-y-auto pr-1 space-y-1 max-sm:flex-none max-sm:space-y-0 max-sm:flex max-sm:gap-2 max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:pr-0 max-sm:pb-1">
                    {loading ? (
                      <div className="text-sm text-muted py-2 max-sm:py-0 max-sm:px-1">Loading lists...</div>
                    ) : lists.length === 0 ? (
                      <div className="text-sm text-muted py-2 max-sm:py-0 max-sm:px-1">No lists yet.</div>
                    ) : (
                      lists.map((entry) => {
                        const selected = selectedListId === entry.id;
                        const onHome = homeListIdSet.has(entry.id);
                        return (
                          <div
                            key={entry.id}
                            className={`rounded-lg border transition-colors ${
                              selected
                                ? "border-accent/60 bg-accent/12 text-text"
                                : "border-border text-muted hover:text-text hover:border-accent-2"
                            } max-sm:min-w-[220px] max-sm:w-[220px] max-sm:flex-shrink-0`}
                          >
                            <button
                              onClick={() => {
                                setSelectedListId(entry.id);
                                setEditingListId("");
                                setRenameErr("");
                                setQuickSearchErr("");
                                setContentEditMode(false);
                              }}
                              className="w-full text-left px-3 pt-2 pb-1.5"
                            >
                              <div className="text-sm truncate">{entry.name}</div>
                              <div className="text-[0.7rem] mt-0.5 text-muted">
                                {entry.item_count} {entry.item_count === 1 ? "title" : "titles"}
                              </div>
                            </button>
                            {onToggleHomeList && selected && (
                              <div className="px-3 pb-2">
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    onToggleHomeList(entry.id);
                                  }}
                                  className={`h-7 w-full rounded-md border text-[0.68rem] font-semibold transition-colors ${
                                    onHome
                                      ? "border-accent/70 bg-accent/14 text-text"
                                      : "border-border/80 bg-panel-2/70 text-muted hover:text-text hover:border-accent-2"
                                  }`}
                                >
                                  {onHome ? "Remove from Home Screen" : "Add to Home Screen"}
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </aside>

                <main
                  ref={listContentRef}
                  className="min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 pb-8"
                  style={{ WebkitOverflowScrolling: "touch" }}
                  onDragOver={(event) => {
                    if (!contentEditMode) return;
                    if (reorderBusy || dragIndex == null) return;
                    event.preventDefault();
                    dragPointerYRef.current = event.clientY;
                  }}
                >
                  {!selectedList ? (
                    <div className="text-sm text-muted py-8">Select a list to view and manage titles.</div>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
                        <div>
                          {editingListId === selectedList.id ? (
                            <form onSubmit={handleRenameList} className="space-y-2">
                              <input
                                type="text"
                                value={editingName}
                                onChange={(e) => setEditingName(e.target.value)}
                                className="h-9 w-[min(100%,320px)] px-3 border border-border rounded-lg bg-bg-2 text-text text-sm outline-none focus:border-accent-2 transition-colors"
                              />
                              <div className="flex gap-2">
                                <button
                                  type="submit"
                                  disabled={renameBusy || !editingName.trim()}
                                  className="h-8 px-3 rounded-full border border-accent/60 bg-accent/15 text-xs text-text hover:bg-accent/25 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                                >
                                  {renameBusy ? "Saving..." : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingListId("");
                                    setEditingName("");
                                    setRenameErr("");
                                  }}
                                  className="h-8 px-3 rounded-full border border-border text-xs text-muted hover:text-text hover:border-accent-2 transition-colors"
                                >
                                  Cancel
                                </button>
                              </div>
                              {renameErr && (
                                <div className="text-xs text-red-300 bg-red-500/10 rounded-md px-2 py-1">
                                  {renameErr}
                                </div>
                              )}
                            </form>
                          ) : (
                            <>
                              <h4 className="font-display text-xl">{selectedList.name}</h4>
                              <p className="text-sm text-muted mt-0.5">
                                {selectedList.item_count} {selectedList.item_count === 1 ? "title" : "titles"}
                              </p>
                            </>
                          )}
                        </div>

                        {editingListId !== selectedList.id && (
                          <div className="flex gap-2">
                            <button
                              onClick={toggleContentEditMode}
                              className={`h-8 px-3 rounded-full border text-xs transition-colors ${
                                contentEditMode
                                  ? "border-accent/70 bg-accent/15 text-text"
                                  : "border-border text-muted hover:text-text hover:border-accent-2"
                              }`}
                            >
                              {contentEditMode ? "Done editing" : "Edit"}
                            </button>
                            <button
                              onClick={handleStartRename}
                              className="h-8 px-3 rounded-full border border-border text-xs text-muted hover:text-text hover:border-accent-2 transition-colors"
                            >
                              Rename
                            </button>
                            <button
                              onClick={handleDeleteList}
                              disabled={removingListId === selectedList.id}
                              className="h-8 px-3 rounded-full border border-red-500/60 bg-red-500/10 text-xs text-red-200 hover:border-red-400 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                            >
                              {removingListId === selectedList.id ? "Deleting..." : "Delete"}
                            </button>
                          </div>
                        )}
                      </div>

                      {contentEditMode && (
                        <div
                          ref={quickSearchRef}
                          className="mb-4 rounded-xl border border-border/80 bg-panel-2/50 p-3"
                        >
                          <div className="text-[0.7rem] uppercase tracking-wider text-muted mb-2">Quick add to list</div>
                          <input
                            type="text"
                            value={quickSearchQuery}
                            onChange={(event) => {
                              setQuickSearchOpen(true);
                              setQuickSearchQuery(event.target.value);
                            }}
                            onFocus={() => setQuickSearchOpen(true)}
                            onKeyDown={(event) => {
                              if (event.key === "Escape") {
                                setQuickSearchOpen(false);
                                setQuickSearchQuery("");
                                setQuickSearchResults([]);
                                setQuickSearchErr("");
                                event.currentTarget.blur();
                              }
                            }}
                            placeholder={`Search titles to add to "${selectedList.name}"...`}
                            className="w-full h-9 px-3 border border-border rounded-lg bg-bg-2 text-text text-sm outline-none focus:border-accent-2 transition-colors"
                          />
                          {quickSearchOpen && (
                            <>
                              {quickSearchQuery.trim().length < 2 ? (
                                <div className="text-xs text-muted mt-2">Type at least 2 characters to search.</div>
                              ) : quickSearchLoading ? (
                                <div className="text-xs text-muted mt-2">Searching titles...</div>
                              ) : quickSearchResults.length === 0 && !quickSearchErr ? (
                                <div className="text-xs text-muted mt-2">No matches found.</div>
                              ) : null}
                              {quickSearchErr && (
                                <div className="mt-2 text-xs text-red-300 bg-red-500/10 rounded-md px-2 py-1">
                                  {quickSearchErr}
                                </div>
                              )}
                              {quickSearchResults.length > 0 && (
                                <div className="mt-2 max-h-56 overflow-y-auto pr-1 space-y-1.5">
                                  {quickSearchResults.map((result) => {
                                    const mediaType = resolveMediaType(result);
                                    const resultKey = `${mediaType}:${result.id}`;
                                    const alreadyAdded = selectedItemKeys.has(resultKey);
                                    const busy = quickAddBusyKey === resultKey;
                                    return (
                                      <div
                                        key={resultKey}
                                        className="rounded-lg border border-border/80 bg-panel/65 px-2.5 py-2 flex items-center gap-2.5"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => onSelectMovie(result.id, mediaType)}
                                          className="w-10 h-14 rounded overflow-hidden bg-panel-2 border border-border flex-shrink-0"
                                        >
                                          {result.poster_path ? (
                                            <img
                                              src={`https://image.tmdb.org/t/p/w92${result.poster_path}`}
                                              alt=""
                                              className="w-full h-full object-cover"
                                              loading="lazy"
                                            />
                                          ) : (
                                            <div className="w-full h-full bg-panel-2" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => onSelectMovie(result.id, mediaType)}
                                          className="min-w-0 text-left flex-1"
                                        >
                                          <div className="text-xs text-text truncate">{result.title}</div>
                                          <div className="text-[0.68rem] text-muted mt-0.5">
                                            {(result.release_date || "").slice(0, 4) || "Unknown year"} &middot;{" "}
                                            {mediaType === "tv" ? "TV Show" : "Movie"}
                                          </div>
                                        </button>
                                        <button
                                          type="button"
                                          disabled={busy || alreadyAdded}
                                          onClick={() => void handleAddQuickSearchResult(result)}
                                          className={`h-9 min-w-[4.8rem] px-3.5 rounded-full border text-xs font-semibold transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
                                            alreadyAdded
                                              ? "border-accent/80 bg-accent/18 text-text"
                                              : "border-accent/45 bg-accent/10 text-text hover:bg-accent/18 hover:border-accent"
                                          }`}
                                        >
                                          {busy ? "Adding..." : alreadyAdded ? "Added" : "Add"}
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}

                      {itemsErr && (
                        <div className="mb-3 text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">
                          {itemsErr}
                        </div>
                      )}
                      {contentEditMode && (
                        <>
                          <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.72rem] text-muted">
                            <span className="hidden sm:inline px-2 py-1 rounded-full border border-border/70 bg-panel-2/70">
                              Drag posters to reorder, or change the number above each poster.
                            </span>
                            <span className="inline sm:hidden px-2 py-1 rounded-full border border-border/70 bg-panel-2/70">
                              Change the number above each poster to reorder.
                            </span>
                            {reorderBusy && (
                              <span className="px-2 py-1 rounded-full border border-accent/50 bg-accent/10 text-text">
                                Saving order...
                              </span>
                            )}
                          </div>
                          {reorderErr && (
                            <div className="mb-3 text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">
                              {reorderErr}
                            </div>
                          )}
                        </>
                      )}

                      {itemsLoading ? (
                        <div className="py-10 flex justify-center">
                          <Spinner />
                        </div>
                      ) : selectedItems.length === 0 ? (
                        <div className="text-sm text-muted py-8">This list is empty.</div>
                      ) : (
                        <div
                          ref={gridRef}
                          className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4"
                        >
                          {selectedItems.map((item, index) => {
                            const busyKey = `${selectedList.id}:${item.media_type}:${item.tmdb_id}`;
                            const rowBorder = index >= gridColumns;
                            const isDragTarget = dragOverIndex === index && dragIndex !== null;
                            const isDragging = dragIndex === index;
                            return (
                              <div
                                key={item.id || `${item.media_type}:${item.tmdb_id}`}
                                className={`relative ${rowBorder ? "pt-3 border-t border-border/35" : ""}`}
                                draggable={contentEditMode && !reorderBusy}
                                onDragStart={(event) => {
                                  if (!contentEditMode || reorderBusy) return;
                                  event.dataTransfer.effectAllowed = "move";
                                  handleDragStart(event, index);
                                }}
                                onDragOver={(event) => {
                                  if (!contentEditMode) return;
                                  event.preventDefault();
                                  if (reorderBusy || dragIndex == null) return;
                                  dragPointerYRef.current = event.clientY;
                                  if (dragOverIndex !== index) setDragOverIndex(index);
                                }}
                                onDrop={(event) => {
                                  if (!contentEditMode) return;
                                  event.preventDefault();
                                  void handleDropAt(index);
                                }}
                                onDragEnd={() => {
                                  setDragIndex(null);
                                  setDragOverIndex(null);
                                  dragPointerYRef.current = null;
                                }}
                              >
                                <div className="mb-1 flex items-center justify-center">
                                  {contentEditMode ? (
                                    <input
                                      type="number"
                                      min={1}
                                      max={selectedItems.length}
                                      inputMode="numeric"
                                      value={positionDrafts[item.id] ?? String(index + 1)}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setPositionDrafts((prev) => ({ ...prev, [item.id]: value }));
                                      }}
                                      onBlur={(event) => {
                                        void handleManualPositionCommit(item.id, event.target.value);
                                      }}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.currentTarget.blur();
                                        }
                                      if (event.key === "Escape") {
                                        setPositionDrafts((prev) => {
                                          const next = { ...prev };
                                          delete next[item.id];
                                          return next;
                                        });
                                        event.currentTarget.blur();
                                      }
                                    }}
                                    className="list-order-input h-7 min-w-[3.5rem] rounded-md border border-border bg-bg-2 text-center text-xs font-semibold text-text outline-none focus:border-accent-2 transition-colors"
                                    style={{ width: `${orderInputWidthRem}rem` }}
                                  />
                                ) : (
                                    <span className="h-7 min-w-8 inline-flex items-center justify-center px-2 text-xs font-semibold text-text">
                                      {index + 1}
                                    </span>
                                  )}
                                </div>
                                <div
                                  data-drag-preview-card="1"
                                  className={`relative rounded-xl pb-2 transition-colors ${
                                    contentEditMode && isDragging
                                        ? "opacity-60"
                                        : ""
                                  }`}
                                >
                                  {contentEditMode && isDragTarget && (
                                    <div className="pointer-events-none absolute -left-1 -right-1 -bottom-1 -top-[6px] z-20 rounded-[14px] border-2 border-accent/70" />
                                  )}
                                  {contentEditMode && (
                                    <button
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        void handleRemoveItem(item.media_type, item.tmdb_id);
                                      }}
                                      disabled={removeItemBusyKey === busyKey}
                                      className="absolute z-30 top-1 right-1 w-6 h-6 rounded-full border border-border bg-bg/85 text-xs text-text hover:border-accent-2 transition-colors disabled:opacity-45 disabled:cursor-not-allowed"
                                      title="Remove from list"
                                    >
                                      &times;
                                    </button>
                                  )}
                                  <MovieCard
                                    id={item.tmdb_id}
                                    title={item.title}
                                    posterPath={item.poster_path || undefined}
                                    releaseDate={item.release_date || undefined}
                                    mediaType={item.media_type}
                                    onClick={onSelectMovie}
                                    index={index}
                                    fill
                                    showWatchlistButton={false}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </main>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
