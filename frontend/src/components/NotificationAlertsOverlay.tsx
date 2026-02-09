import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  cancelNotificationSubscription,
  listNotificationSubscriptions,
  updateNotificationSubscription,
  type NotificationConditionType,
  type NotificationSubscription,
} from "../api/notifications";
import { ApiError } from "../api/client";
import { useNotifications } from "../hooks/useNotifications";
import Spinner from "./Spinner";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  open: boolean;
  onClose: () => void;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
}

const CONDITION_OPTIONS: Array<{ value: NotificationConditionType; label: string }> = [
  { value: "available_primary", label: "Available" },
  { value: "stream_primary", label: "Streamable" },
  { value: "stream_vpn", label: "Streamable with VPN" },
];

function subscriptionKey(item: NotificationSubscription): string {
  return `${item.media_type}:${item.tmdb_id}`;
}

export default function NotificationAlertsOverlay({ open, onClose, onSelectMovie }: Props) {
  const { refresh: refreshNotifications } = useNotifications();
  const [items, setItems] = useState<NotificationSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await listNotificationSubscriptions();
      setItems(
        (data.results || []).slice().sort((a, b) => {
          const at = Date.parse(a.created_at || "");
          const bt = Date.parse(b.created_at || "");
          const aTs = Number.isNaN(at) ? 0 : at;
          const bTs = Number.isNaN(bt) ? 0 : bt;
          return bTs - aTs;
        })
      );
    } catch (err) {
      const e = err as ApiError;
      setError(err instanceof ApiError ? e.message : "Could not load alert subscriptions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadItems();
  }, [open, loadItems]);

  const handleSwitch = async (item: NotificationSubscription, conditionType: NotificationConditionType) => {
    if (busyKey || item.condition_type === conditionType) return;
    const key = subscriptionKey(item);
    setBusyKey(key);
    setError("");
    try {
      const result = await updateNotificationSubscription(item.id, conditionType);
      setItems((prev) =>
        prev.map((row) =>
          subscriptionKey(row) === key ? { ...row, ...result.subscription } : row
        )
      );
      void refreshNotifications(false);
    } catch (err) {
      const e = err as ApiError;
      setError(err instanceof ApiError ? e.message : "Could not update alert type.");
    } finally {
      setBusyKey("");
    }
  };

  const handleRemove = async (item: NotificationSubscription) => {
    if (busyKey) return;
    const key = subscriptionKey(item);
    setBusyKey(key);
    setError("");
    try {
      await cancelNotificationSubscription(item.id);
      setItems((prev) => prev.filter((row) => subscriptionKey(row) !== key));
      void refreshNotifications(false);
    } catch (err) {
      const e = err as ApiError;
      setError(err instanceof ApiError ? e.message : "Could not remove alert.");
    } finally {
      setBusyKey("");
    }
  };

  const totalTitles = useMemo(() => {
    const keys = new Set(items.map((item) => subscriptionKey(item)));
    return keys.size;
  }, [items]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[305] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            className="relative w-[min(920px,94vw)] max-h-[90vh] flex flex-col bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 sm:top-8 sm:right-8 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors z-10"
            >
              &times;
            </button>

            <div className="p-6 sm:p-8 pb-3 sm:pb-4">
              <div className="pr-12">
                <h3 className="font-display text-2xl">Manage Alerts</h3>
                <p className="text-sm text-muted mt-1">
                  {totalTitles} title{totalTitles === 1 ? "" : "s"} with active notifications
                </p>
              </div>
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => void loadItems()}
                  className="h-9 px-3 rounded-full border border-border text-sm text-text hover:border-accent-2 transition-colors"
                >
                  Refresh
                </button>
              </div>
              {error && (
                <div className="mt-3 text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">
                  {error}
                </div>
              )}
            </div>

            <div className="flex-1 overflow-auto px-6 sm:px-8 pb-6 sm:pb-8">
              {loading ? (
                <div className="py-12 flex justify-center">
                  <Spinner />
                </div>
              ) : items.length === 0 ? (
                <div className="text-sm text-muted py-8">You do not have any active alerts yet.</div>
              ) : (
                <div className="space-y-2.5">
                  {items.map((item) => {
                    const key = subscriptionKey(item);
                    const posterUrl = item.poster_path ? `${TMDB_IMG}/w185${item.poster_path}` : "";
                    const busy = busyKey === key;
                    return (
                      <div key={item.id} className="rounded-xl border border-border/80 bg-panel-2/50 p-3">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onSelectMovie(item.tmdb_id, item.media_type);
                            }}
                            className="flex items-start gap-3 min-w-0 flex-1 text-left"
                          >
                            {posterUrl ? (
                              <img src={posterUrl} alt="" className="h-16 w-11 rounded object-cover border border-border/70 flex-shrink-0" />
                            ) : (
                              <div className="h-16 w-11 rounded border border-border/70 bg-panel-2 flex-shrink-0" />
                            )}
                            <span className="min-w-0">
                              <span className="block text-sm text-text truncate">{item.title}</span>
                              <span className="block text-xs text-muted mt-0.5">
                                {item.media_type === "tv" ? "TV Show" : "Movie"}
                              </span>
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRemove(item)}
                            disabled={busy}
                            className="h-8 px-2.5 rounded-full border border-red-500/60 text-xs text-red-200 hover:border-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-55 disabled:cursor-not-allowed"
                          >
                            {busy ? "..." : "Remove"}
                          </button>
                        </div>
                        <div className="mt-2.5 flex items-center rounded-full border border-border bg-panel overflow-hidden h-9">
                          {CONDITION_OPTIONS.map((option) => (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => void handleSwitch(item, option.value)}
                              disabled={busy}
                              className={`flex-1 h-full px-2 text-xs sm:text-sm transition-colors disabled:opacity-55 disabled:cursor-not-allowed ${
                                item.condition_type === option.value
                                  ? "bg-accent/15 text-text"
                                  : "text-muted hover:text-text"
                              }`}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
