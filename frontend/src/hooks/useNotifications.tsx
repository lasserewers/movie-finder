import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  deleteNotification,
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type UserNotification,
} from "../api/notifications";
import { useAuth } from "./useAuth";

interface NotificationsContextValue {
  notifications: UserNotification[];
  unreadCount: number;
  activeAlerts: number;
  hasUnreadIndicator: boolean;
  loading: boolean;
  refresh: (forceRefresh?: boolean) => Promise<void>;
  clearUnreadIndicator: () => void;
  markRead: (notificationId: string) => Promise<void>;
  markLatestUnreadForTitle: (tmdbId: number, mediaType: "movie" | "tv") => Promise<void>;
  removeNotification: (notificationId: string) => Promise<void>;
  markAllRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);
const POLL_INTERVAL_MS = 60_000;
const NOTIFICATION_SEEN_STORAGE_PREFIX = "notification_seen_marker:";

function seenMarkerStorageKey(email: string): string {
  return `${NOTIFICATION_SEEN_STORAGE_PREFIX}${email.trim().toLowerCase()}`;
}

function latestUnreadMarker(rows: UserNotification[]): string {
  const latest = rows.find((row) => !row.is_read);
  if (!latest) return "";
  return `${latest.id}:${latest.created_at || ""}`;
}

function markerTimestamp(marker: string): number {
  if (!marker) return 0;
  const idx = marker.indexOf(":");
  if (idx < 0) return 0;
  const iso = marker.slice(idx + 1);
  const ts = Date.parse(iso);
  return Number.isNaN(ts) ? 0 : ts;
}

function hasNewerUnreadMarker(currentMarker: string, seenMarker: string): boolean {
  if (!currentMarker) return false;
  if (!seenMarker) return true;
  const currentTs = markerTimestamp(currentMarker);
  const seenTs = markerTimestamp(seenMarker);
  if (currentTs && seenTs) {
    return currentTs > seenTs;
  }
  return currentMarker !== seenMarker;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<UserNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeAlerts, setActiveAlerts] = useState(0);
  const [hasUnreadIndicator, setHasUnreadIndicator] = useState(false);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);
  const latestUnreadMarkerRef = useRef("");
  const seenMarkerRef = useRef("");
  const seenMarkerLoadedEmailRef = useRef("");

  const loadSeenMarkerForUser = useCallback((email: string | null | undefined) => {
    const normalizedEmail = (email || "").trim().toLowerCase();
    if (!normalizedEmail) {
      seenMarkerRef.current = "";
      seenMarkerLoadedEmailRef.current = "";
      return;
    }
    if (seenMarkerLoadedEmailRef.current === normalizedEmail) return;
    try {
      seenMarkerRef.current = localStorage.getItem(seenMarkerStorageKey(normalizedEmail)) || "";
    } catch {
      seenMarkerRef.current = "";
    }
    seenMarkerLoadedEmailRef.current = normalizedEmail;
  }, []);

  const persistSeenMarkerForUser = useCallback((email: string | null | undefined, marker: string) => {
    const normalizedEmail = (email || "").trim().toLowerCase();
    if (!normalizedEmail) return;
    try {
      if (marker) {
        localStorage.setItem(seenMarkerStorageKey(normalizedEmail), marker);
      } else {
        localStorage.removeItem(seenMarkerStorageKey(normalizedEmail));
      }
    } catch {
      // Ignore localStorage write failures.
    }
  }, []);

  const clearState = useCallback(() => {
    setNotifications([]);
    setUnreadCount(0);
    setActiveAlerts(0);
    setHasUnreadIndicator(false);
    setLoading(false);
    latestUnreadMarkerRef.current = "";
    seenMarkerRef.current = "";
    seenMarkerLoadedEmailRef.current = "";
  }, []);

  const clearUnreadIndicator = useCallback(() => {
    if (!user?.email) {
      setHasUnreadIndicator(false);
      return;
    }
    const marker = latestUnreadMarkerRef.current || "";
    seenMarkerRef.current = marker;
    persistSeenMarkerForUser(user.email, marker);
    setHasUnreadIndicator(false);
  }, [persistSeenMarkerForUser, user?.email]);

  const refresh = useCallback(
    async (forceRefresh = true) => {
      if (!user) {
        clearState();
        return;
      }
      loadSeenMarkerForUser(user.email);
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setLoading(true);
      try {
        const data = await getNotifications({ limit: 40, refresh: forceRefresh });
        const results = data.results || [];
        const unread = Math.max(0, data.unread_count || 0);
        const active = Math.max(0, data.active_alerts || 0);
        const marker = latestUnreadMarker(results);
        latestUnreadMarkerRef.current = marker;
        if (!marker) {
          seenMarkerRef.current = "";
          persistSeenMarkerForUser(user.email, "");
        }

        setNotifications(results);
        setUnreadCount(unread);
        setActiveAlerts(active);
        setHasUnreadIndicator(hasNewerUnreadMarker(marker, seenMarkerRef.current));
      } catch {
        // Keep prior state when refresh fails.
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [clearState, loadSeenMarkerForUser, persistSeenMarkerForUser, user]
  );

  const markRead = useCallback(
    async (notificationId: string) => {
      const target = notifications.find((row) => row.id === notificationId);
      if (!target) {
        try {
          await markNotificationRead(notificationId);
          await refresh(false);
        } catch {
          // Ignore direct mark failures (e.g. invalid link/user mismatch).
        }
        return;
      }
      if (target.is_read) return;
      let nextRows: UserNotification[] = [];
      setNotifications((prev) => {
        nextRows = prev.map((row) =>
          row.id === notificationId
            ? { ...row, is_read: true, read_at: row.read_at || new Date().toISOString() }
            : row
        );
        return nextRows;
      });
      setUnreadCount((prevUnread) => Math.max(0, prevUnread - 1));
      const marker = latestUnreadMarker(nextRows);
      latestUnreadMarkerRef.current = marker;
      if (!marker) {
        setHasUnreadIndicator(false);
        seenMarkerRef.current = "";
        persistSeenMarkerForUser(user?.email, "");
      } else {
        setHasUnreadIndicator(hasNewerUnreadMarker(marker, seenMarkerRef.current));
      }
      try {
        await markNotificationRead(notificationId);
      } catch {
        await refresh(false);
      }
    },
    [notifications, persistSeenMarkerForUser, refresh, user?.email]
  );

  const markLatestUnreadForTitle = useCallback(
    async (tmdbId: number, mediaType: "movie" | "tv") => {
      let candidate = notifications.find(
        (row) => !row.is_read && row.tmdb_id === tmdbId && row.media_type === mediaType
      );
      if (!candidate) {
        try {
          const data = await getNotifications({ limit: 200, unreadOnly: true, refresh: false });
          const rows = data.results || [];
          candidate = rows.find(
            (row) => !row.is_read && row.tmdb_id === tmdbId && row.media_type === mediaType
          );
        } catch {
          return;
        }
      }
      if (!candidate) return;
      await markRead(candidate.id);
    },
    [markRead, notifications]
  );

  const removeNotification = useCallback(
    async (notificationId: string) => {
      const target = notifications.find((row) => row.id === notificationId);
      if (!target) return;
      let nextRows: UserNotification[] = [];
      setNotifications((prev) => {
        nextRows = prev.filter((row) => row.id !== notificationId);
        return nextRows;
      });
      if (!target.is_read) {
        setUnreadCount((prevUnread) => Math.max(0, prevUnread - 1));
      }
      const marker = latestUnreadMarker(nextRows);
      latestUnreadMarkerRef.current = marker;
      if (!marker) {
        setHasUnreadIndicator(false);
        seenMarkerRef.current = "";
        persistSeenMarkerForUser(user?.email, "");
      } else {
        setHasUnreadIndicator(hasNewerUnreadMarker(marker, seenMarkerRef.current));
      }
      try {
        await deleteNotification(notificationId);
      } catch {
        await refresh(false);
      }
    },
    [notifications, persistSeenMarkerForUser, refresh, user?.email]
  );

  const markAllRead = useCallback(async () => {
    const hadUnread = unreadCount > 0;
    if (!hadUnread) return;
    const nowIso = new Date().toISOString();
    setNotifications((prev) => prev.map((row) => ({ ...row, is_read: true, read_at: row.read_at || nowIso })));
    setUnreadCount(0);
    setHasUnreadIndicator(false);
    latestUnreadMarkerRef.current = "";
    seenMarkerRef.current = "";
    persistSeenMarkerForUser(user?.email, "");
    try {
      await markAllNotificationsRead();
    } catch {
      await refresh(false);
    }
  }, [persistSeenMarkerForUser, refresh, unreadCount, user?.email]);

  useEffect(() => {
    if (!user) {
      clearState();
      return;
    }
    loadSeenMarkerForUser(user.email);
    void refresh(true);
  }, [clearState, loadSeenMarkerForUser, refresh, user]);

  useEffect(() => {
    if (!user) return;
    const id = window.setInterval(() => {
      void refresh(true);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [refresh, user]);

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      activeAlerts,
      hasUnreadIndicator,
      loading,
      refresh,
      clearUnreadIndicator,
      markRead,
      markLatestUnreadForTitle,
      removeNotification,
      markAllRead,
    }),
    [
      activeAlerts,
      clearUnreadIndicator,
      hasUnreadIndicator,
      loading,
      markAllRead,
      markLatestUnreadForTitle,
      markRead,
      removeNotification,
      notifications,
      refresh,
      unreadCount,
    ]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
