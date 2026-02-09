import { motion, AnimatePresence } from "framer-motion";
import type { UserNotification } from "../api/notifications";
import Spinner from "./Spinner";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  open: boolean;
  onClose: () => void;
  notifications: UserNotification[];
  loading: boolean;
  activeAlerts: number;
  onMarkRead: (notificationId: string) => Promise<void>;
  onRemoveNotification: (notificationId: string) => Promise<void>;
  onSelectMovie: (id: number, mediaType?: "movie" | "tv") => void;
  onOpenAlerts: () => void;
  onOpenSettings: () => void;
}

function formatNotificationTime(value?: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const diffMs = Date.now() - at.getTime();
  if (diffMs < 60_000) return "Just now";
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m ago`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h ago`;
  if (diffMs < 604_800_000) return `${Math.max(1, Math.floor(diffMs / 86_400_000))}d ago`;
  return at.toLocaleDateString();
}

function conditionLabel(value: string): string {
  if (value === "available_primary") return "Available";
  if (value === "stream_primary") return "Streamable";
  if (value === "stream_vpn") return "Streamable with VPN";
  return "Availability";
}

export default function NotificationsOverlay({
  open,
  onClose,
  notifications,
  loading,
  activeAlerts,
  onMarkRead,
  onRemoveNotification,
  onSelectMovie,
  onOpenAlerts,
  onOpenSettings,
}: Props) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[300] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            className="relative w-[min(840px,94vw)] max-h-[90vh] flex flex-col bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
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
                <h3 className="font-display text-2xl">Notifications</h3>
                <p className="text-sm text-muted mt-1">
                  {activeAlerts} active alert{activeAlerts === 1 ? "" : "s"}
                </p>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={onOpenAlerts}
                  className="h-9 px-3 rounded-full border border-border text-sm text-text hover:border-accent-2 transition-colors"
                >
                  Manage alerts
                </button>
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="h-9 px-3 rounded-full border border-border text-sm text-text hover:border-accent-2 transition-colors"
                >
                  Notification settings
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 sm:px-8 pb-6 sm:pb-8">
              {loading && notifications.length === 0 ? (
                <div className="py-12 flex justify-center">
                  <Spinner />
                </div>
              ) : notifications.length === 0 ? (
                <div className="text-sm text-muted py-8">No notifications yet.</div>
              ) : (
                <div className="space-y-2">
                  {notifications.map((notification) => {
                    const posterUrl = notification.poster_path ? `${TMDB_IMG}/w185${notification.poster_path}` : "";
                    return (
                      <div
                        key={notification.id}
                        className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
                          notification.is_read
                            ? "border-border/70 bg-panel-2/45 hover:bg-panel-2/65"
                            : "border-accent/40 bg-accent/10 hover:bg-accent/15"
                        }`}
                      >
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              void onMarkRead(notification.id);
                              onClose();
                              onSelectMovie(notification.tmdb_id, notification.media_type);
                            }}
                            className="min-w-0 flex-1 text-left hover:opacity-95 transition-opacity"
                          >
                            <div className="flex items-center gap-3">
                              {posterUrl ? (
                                <img src={posterUrl} alt="" className="h-16 w-11 rounded object-cover border border-border/70 flex-shrink-0" />
                              ) : (
                                <div className="h-16 w-11 rounded border border-border/70 bg-panel-2 flex-shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex h-6 items-center rounded-full border border-border/70 px-2 text-[0.68rem] uppercase tracking-wide text-muted">
                                    {conditionLabel(notification.condition_type)}
                                  </span>
                                  <span className="text-[0.7rem] text-muted">{formatNotificationTime(notification.created_at)}</span>
                                </div>
                                <div className="mt-1 text-sm text-text leading-tight">{notification.message}</div>
                              </div>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={() => void onRemoveNotification(notification.id)}
                            className="h-7 px-2.5 rounded-full border border-border text-[0.68rem] text-muted hover:text-text hover:border-accent-2 transition-colors"
                          >
                            Remove
                          </button>
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
