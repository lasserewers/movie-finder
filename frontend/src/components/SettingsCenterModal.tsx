import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ApiError } from "../api/client";
import { changeEmail, changePassword, deleteAccount } from "../api/auth";
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationDelivery,
} from "../api/notifications";
import {
  getLetterboxdSyncState,
  syncLetterboxdWatchlist,
  syncLetterboxdWatchedTitles,
  type LetterboxdSyncStatus,
} from "../api/linkedAccounts";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
import { useWatched } from "../hooks/useWatched";
import type { ProviderInfo, Region } from "../api/movies";

const TMDB_IMG = "https://image.tmdb.org/t/p";
const HOME_CONTENT_LABEL: Record<HomeContentMode, string> = {
  all: "All content",
  available: "Available",
  streamable: "Streamable",
};

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(1)} GB`;
}

function isLikelyZipFile(file: File): boolean {
  const lowerName = (file.name || "").toLowerCase();
  const lowerType = (file.type || "").toLowerCase();
  return (
    lowerName.endsWith(".zip") ||
    lowerType === "application/zip" ||
    lowerType === "application/x-zip-compressed" ||
    lowerType === "multipart/x-zip"
  );
}

export type SettingsCenterSection =
  | "account"
  | "notifications"
  | "countries"
  | "services"
  | "home"
  | "linked"
  | "subscription";
export type HomeContentMode = "all" | "available" | "streamable";
export interface HomeSectionOrderItem {
  id: string;
  label: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  regions: Region[];
  countryNameMap: Record<string, string>;
  initialSection?: SettingsCenterSection;
  homeContentMode: HomeContentMode;
  homeUsingVpn: boolean;
  homeShowWatchlist: boolean;
  homeSectionOrder: string[];
  homeSectionOrderItems: HomeSectionOrderItem[];
  onHomeContentModeChange: (next: HomeContentMode) => void;
  onHomeUsingVpnChange: (next: boolean) => void;
  onHomeShowWatchlistChange: (next: boolean) => void;
  onHomeRemoveSection: (sectionId: string) => void;
  onHomeSectionOrderChange: (next: string[]) => void;
  onOpenLists: () => void;
}

const SECTION_OPTIONS: Array<{ id: SettingsCenterSection; label: string }> = [
  { id: "account", label: "My account" },
  { id: "notifications", label: "Notifications" },
  { id: "countries", label: "Countries" },
  { id: "services", label: "Services" },
  { id: "home", label: "Home screen" },
  { id: "linked", label: "Linked accounts" },
  { id: "subscription", label: "Subscription" },
];

const DELIVERY_OPTIONS: Array<{ value: NotificationDelivery; label: string; description: string }> = [
  { value: "in_app", label: "In-app", description: "Only inside FullStreamer." },
  { value: "email", label: "Email", description: "Only by email." },
  { value: "both", label: "Both", description: "In-app and email notifications." },
];

export default function SettingsCenterModal({
  open,
  onClose,
  onSaved,
  regions,
  countryNameMap,
  initialSection = "account",
  homeContentMode,
  homeUsingVpn,
  homeShowWatchlist,
  homeSectionOrder,
  homeSectionOrderItems,
  onHomeContentModeChange,
  onHomeUsingVpnChange,
  onHomeShowWatchlistChange,
  onHomeRemoveSection,
  onHomeSectionOrderChange,
  onOpenLists,
}: Props) {
  const { user, logout } = useAuth();
  const { providerIds, countries, allProviders, saveConfig, loadProviders, expandIds, theme, setTheme } = useConfig();
  const { refresh: refreshWatched } = useWatched();

  const [activeSection, setActiveSection] = useState<SettingsCenterSection>(initialSection);

  const [emailPassword, setEmailPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailErr, setEmailErr] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwMsg, setPwMsg] = useState("");
  const [pwErr, setPwErr] = useState("");
  const [pwLoading, setPwLoading] = useState(false);

  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deletePw, setDeletePw] = useState("");
  const [deleteErr, setDeleteErr] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationDelivery, setNotificationDelivery] = useState<NotificationDelivery>("in_app");
  const [notificationErr, setNotificationErr] = useState("");
  const [linkedLoading, setLinkedLoading] = useState(false);
  const [linkedSyncing, setLinkedSyncing] = useState(false);
  const [linkedWatchlistSyncing, setLinkedWatchlistSyncing] = useState(false);
  const [linkedWatchedSyncing, setLinkedWatchedSyncing] = useState(false);
  const [linkedExportFile, setLinkedExportFile] = useState<File | null>(null);
  const [linkedDropActive, setLinkedDropActive] = useState(false);
  const [linkedStatus, setLinkedStatus] = useState<LetterboxdSyncStatus>(null);
  const [linkedMessage, setLinkedMessage] = useState("");
  const [linkedErr, setLinkedErr] = useState("");
  const [linkedLastSyncAt, setLinkedLastSyncAt] = useState<string | null>(null);
  const [linkedLastUsername, setLinkedLastUsername] = useState<string | null>(null);

  const [selectedCountries, setSelectedCountries] = useState<Set<string>>(new Set());
  const [countryQuery, setCountryQuery] = useState("");
  const [countriesSaving, setCountriesSaving] = useState(false);
  const [countriesErr, setCountriesErr] = useState("");

  const [selectedProviders, setSelectedProviders] = useState<Set<number>>(new Set());
  const [serviceSearch, setServiceSearch] = useState("");
  const [serviceProviders, setServiceProviders] = useState<ProviderInfo[]>([]);
  const [showAllServiceCountries, setShowAllServiceCountries] = useState(false);
  const [activeServiceCountries, setActiveServiceCountries] = useState<Set<string>>(new Set());
  const [servicesSaving, setServicesSaving] = useState(false);
  const [servicesErr, setServicesErr] = useState("");
  const [homeOrderDraft, setHomeOrderDraft] = useState<string[]>([]);
  const [homeOrderDragIndex, setHomeOrderDragIndex] = useState<number | null>(null);
  const [homeOrderDragOverIndex, setHomeOrderDragOverIndex] = useState<number | null>(null);
  const [homeOrderPositionDrafts, setHomeOrderPositionDrafts] = useState<Record<string, string>>({});
  const [mobileOrderMode, setMobileOrderMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 640;
  });
  const contentScrollRef = useRef<HTMLElement | null>(null);
  const homeOrderZoneRef = useRef<HTMLDivElement | null>(null);
  const homeOrderDragArmedIndexRef = useRef<number | null>(null);
  const homeOrderDragPointerYRef = useRef<number | null>(null);
  const linkedFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setActiveSection(initialSection);
    setEmailPassword("");
    setNewEmail("");
    setEmailMsg("");
    setEmailErr("");
    setCurrentPw("");
    setNewPw("");
    setConfirmPw("");
    setPwMsg("");
    setPwErr("");
    setDeleteConfirm(false);
    setDeletePw("");
    setDeleteErr("");

    const nextCountries = new Set(countries);
    setSelectedCountries(nextCountries);
    setCountryQuery("");
    setCountriesErr("");
    setSelectedProviders(new Set(providerIds));
    setServiceSearch("");
    setShowAllServiceCountries(false);
    setActiveServiceCountries(nextCountries.size ? nextCountries : new Set(countries));
    setServicesErr("");
    setLinkedErr("");
    setLinkedMessage("");
    setLinkedStatus(null);
    setLinkedLastSyncAt(null);
    setLinkedLastUsername(null);
    setLinkedExportFile(null);
    setLinkedDropActive(false);
  }, [open, initialSection, countries, providerIds]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      setMobileOrderMode(window.innerWidth < 640);
    };
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const validIds = new Set(homeSectionOrderItems.map((item) => item.id));
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const id of homeSectionOrder) {
      if (!validIds.has(id) || seen.has(id)) continue;
      seen.add(id);
      normalized.push(id);
    }
    for (const item of homeSectionOrderItems) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      normalized.push(item.id);
    }
    setHomeOrderDraft(normalized);
    setHomeOrderDragIndex(null);
    setHomeOrderDragOverIndex(null);
    setHomeOrderPositionDrafts({});
    homeOrderDragArmedIndexRef.current = null;
    homeOrderDragPointerYRef.current = null;
  }, [open, homeSectionOrder, homeSectionOrderItems]);

  useEffect(() => {
    if (!open || activeSection !== "home" || mobileOrderMode || homeOrderDragIndex == null) return;
    const container = contentScrollRef.current;
    if (!container) return;

    const topThreshold = window.innerWidth < 640 ? 54 : 64;
    const bottomThreshold = window.innerWidth < 640 ? 86 : 108;
    const maxUpSpeed = window.innerWidth < 640 ? 8 : 11;
    const maxDownSpeed = window.innerWidth < 640 ? 18 : 24;
    let frameId = 0;

    const tick = () => {
      const pointerY = homeOrderDragPointerYRef.current;
      if (pointerY != null && container.scrollHeight > container.clientHeight) {
        const rect = container.getBoundingClientRect();
        const upperEdge = rect.top + topThreshold;
        const lowerEdge = rect.bottom - bottomThreshold;
        let delta = 0;

        if (pointerY < upperEdge) {
          const strength = Math.min(1, (upperEdge - pointerY) / topThreshold);
          delta = -Math.max(1.2, strength * maxUpSpeed);
        } else if (pointerY > lowerEdge) {
          const strength = Math.min(1, (pointerY - lowerEdge) / bottomThreshold);
          delta = Math.max(1.8, strength * maxDownSpeed);
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
  }, [open, activeSection, mobileOrderMode, homeOrderDragIndex]);

  useEffect(() => {
    if (!open || activeSection !== "notifications") return;
    let cancelled = false;
    setNotificationLoading(true);
    setNotificationErr("");
    getNotificationSettings()
      .then((data) => {
        if (cancelled) return;
        setNotificationDelivery(data.delivery || "in_app");
      })
      .catch((err) => {
        if (cancelled) return;
        const e = err as ApiError;
        setNotificationErr(err instanceof ApiError ? e.message : "Could not load notification settings.");
      })
      .finally(() => {
        if (!cancelled) setNotificationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeSection]);

  useEffect(() => {
    if (!open || activeSection !== "linked") return;
    let cancelled = false;
    setLinkedLoading(true);
    setLinkedErr("");
    getLetterboxdSyncState()
      .then((state) => {
        if (cancelled) return;
        const savedUsername = (state.username || "").trim();
        setLinkedLastUsername(savedUsername || null);
        setLinkedStatus(state.status || null);
        setLinkedMessage(state.message || "");
        setLinkedLastSyncAt(state.last_sync_at || null);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          // Backward-compatible fallback for environments not yet exposing this endpoint.
          setLinkedStatus(null);
          setLinkedMessage("");
          setLinkedLastSyncAt(null);
          return;
        }
        setLinkedErr(err instanceof ApiError ? err.message : "Could not load linked account state.");
      })
      .finally(() => {
        if (!cancelled) setLinkedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, activeSection]);

  const loadServiceProviderList = useCallback(
    async (active: Set<string>, includeAllCountries: boolean) => {
      const selected = Array.from(active);
      if (selected.length && !includeAllCountries) {
        const lists = await Promise.all(selected.map((code) => loadProviders(code)));
        const seen = new Set<number>();
        const combined: ProviderInfo[] = [];
        for (const list of lists) {
          for (const provider of list) {
            if (seen.has(provider.provider_id)) continue;
            seen.add(provider.provider_id);
            combined.push(provider);
          }
        }
        setServiceProviders(combined);
      } else {
        const list = await loadProviders();
        setServiceProviders(list);
      }
    },
    [loadProviders]
  );

  useEffect(() => {
    if (!open || activeSection !== "services") return;
    void loadServiceProviderList(activeServiceCountries, showAllServiceCountries);
  }, [open, activeSection, activeServiceCountries, showAllServiceCountries, loadServiceProviderList]);

  const sortedProviders = useMemo(
    () => [...serviceProviders].sort((a, b) => a.provider_name.localeCompare(b.provider_name)),
    [serviceProviders]
  );

  const filteredProviders = useMemo(() => {
    if (!serviceSearch.trim()) return sortedProviders;
    const q = serviceSearch.trim().toLowerCase();
    return sortedProviders.filter((provider) => provider.provider_name.toLowerCase().includes(q));
  }, [serviceSearch, sortedProviders]);

  const selectedProvidersSorted = useMemo(
    () => sortedProviders.filter((provider) => selectedProviders.has(provider.provider_id)),
    [sortedProviders, selectedProviders]
  );

  const filteredRegions = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter(
      (region) =>
        region.english_name.toLowerCase().includes(q) ||
        region.iso_3166_1.toLowerCase().includes(q)
    );
  }, [regions, countryQuery]);

  const homeOrderLabelById = useMemo(
    () => new Map(homeSectionOrderItems.map((item) => [item.id, item.label])),
    [homeSectionOrderItems]
  );
  const homeOrderEntries = useMemo(
    () => homeOrderDraft.map((id) => ({ id, label: homeOrderLabelById.get(id) || "List" })),
    [homeOrderDraft, homeOrderLabelById]
  );
  const homeOrderInputWidthRem = useMemo(() => {
    const digits = Math.max(2, String(Math.max(1, homeOrderEntries.length)).length);
    return Math.max(2.8, 1.8 + digits * 0.7);
  }, [homeOrderEntries.length]);

  const inputClass =
    "w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors";
  const linkedCanSync = Boolean(linkedExportFile);
  const linkedUploadDisabled = linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing || linkedLoading;

  const setLinkedFile = useCallback((nextFile: File | null) => {
    setLinkedExportFile(nextFile);
    setLinkedErr("");
    if (!nextFile) {
      setLinkedMessage("");
    }
  }, []);

  const openLinkedFilePicker = useCallback(() => {
    const input = linkedFileInputRef.current;
    if (!input) return;
    input.value = "";
    input.click();
  }, []);

  const resetLinkedSelectedFile = useCallback(() => {
    const input = linkedFileInputRef.current;
    if (input) {
      input.value = "";
    }
    setLinkedDropActive(false);
    setLinkedFile(null);
  }, [setLinkedFile]);

  const handleLinkedFileChange = useCallback(
    (nextFile: File | null) => {
      setLinkedDropActive(false);
      if (!nextFile) {
        setLinkedFile(null);
        return;
      }
      if (!isLikelyZipFile(nextFile)) {
        setLinkedErr("Please upload a .zip export file from Letterboxd.");
        return;
      }
      setLinkedFile(nextFile);
    },
    [setLinkedFile]
  );

  const handleEmailSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailMsg("");
    setEmailErr("");
    setEmailLoading(true);
    try {
      const result = await changeEmail(emailPassword, newEmail);
      setEmailMsg(`Confirmation sent to ${result.pending_email}. Open that inbox and confirm the change.`);
      setEmailPassword("");
      setNewEmail("");
    } catch (err) {
      setEmailErr(err instanceof ApiError ? err.message : "Failed to update email");
    } finally {
      setEmailLoading(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setPwMsg("");
    setPwErr("");
    if (newPw !== confirmPw) {
      setPwErr("Passwords do not match");
      return;
    }
    setPwLoading(true);
    try {
      await changePassword(currentPw, newPw);
      setPwMsg("Password updated");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwErr(err instanceof ApiError ? err.message : "Failed to update password");
    } finally {
      setPwLoading(false);
    }
  };

  const handleDeleteAccount = async (event: React.FormEvent) => {
    event.preventDefault();
    setDeleteErr("");
    setDeleteLoading(true);
    try {
      await deleteAccount(deletePw);
      logout();
      onClose();
    } catch (err) {
      setDeleteErr(err instanceof ApiError ? err.message : "Failed to delete account");
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleNotificationDeliveryChange = async (nextDelivery: NotificationDelivery) => {
    if (notificationSaving || notificationDelivery === nextDelivery) return;
    setNotificationSaving(true);
    setNotificationErr("");
    try {
      const result = await updateNotificationSettings(nextDelivery);
      setNotificationDelivery(result.delivery || nextDelivery);
    } catch (err) {
      const e = err as ApiError;
      setNotificationErr(err instanceof ApiError ? e.message : "Could not update notification settings.");
    } finally {
      setNotificationSaving(false);
    }
  };

  const handleLetterboxdSync = async (event: React.FormEvent) => {
    event.preventDefault();
    if (linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing) return;
    if (!linkedExportFile) {
      setLinkedErr("Upload your Letterboxd export ZIP before syncing.");
      return;
    }
    setLinkedSyncing(true);
    setLinkedErr("");
    setLinkedMessage("");
    try {
      const watchlistResult = await syncLetterboxdWatchlist(linkedExportFile);
      const watchedResult = await syncLetterboxdWatchedTitles(linkedExportFile);
      const resolvedUsername = (watchlistResult.username || watchedResult.username || "").trim();
      if (resolvedUsername) {
        setLinkedLastUsername(resolvedUsername);
      }
      setLinkedStatus(watchedResult.status || watchlistResult.status);
      setLinkedMessage(
        `Watchlist: ${watchlistResult.message || "No update."} Watched: ${watchedResult.message || "No update."}`
      );
      setLinkedLastSyncAt(new Date().toISOString());
      if (watchedResult.ok) {
        await refreshWatched();
      }
      if (watchlistResult.ok || watchedResult.ok) {
        onSaved();
      }
    } catch (err) {
      setLinkedErr(err instanceof ApiError ? err.message : "Could not sync Letterboxd export.");
    } finally {
      setLinkedSyncing(false);
    }
  };

  const handleLetterboxdWatchlistSync = async () => {
    if (linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing) return;
    if (!linkedExportFile) {
      setLinkedErr("Upload your Letterboxd export ZIP before syncing.");
      return;
    }
    setLinkedWatchlistSyncing(true);
    setLinkedErr("");
    setLinkedMessage("");
    try {
      const result = await syncLetterboxdWatchlist(linkedExportFile);
      const normalizedUsername = (result.username || "").trim();
      setLinkedStatus(result.status);
      setLinkedMessage(result.message || "");
      setLinkedLastSyncAt(new Date().toISOString());
      if (normalizedUsername) {
        setLinkedLastUsername(normalizedUsername);
      }
      if (result.ok) {
        onSaved();
      }
    } catch (err) {
      setLinkedErr(err instanceof ApiError ? err.message : "Could not sync watchlist from Letterboxd export.");
    } finally {
      setLinkedWatchlistSyncing(false);
    }
  };

  const handleLetterboxdWatchedSync = async () => {
    if (linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing) return;
    if (!linkedExportFile) {
      setLinkedErr("Upload your Letterboxd export ZIP before syncing.");
      return;
    }
    setLinkedWatchedSyncing(true);
    setLinkedErr("");
    setLinkedMessage("");
    try {
      const result = await syncLetterboxdWatchedTitles(linkedExportFile);
      const normalizedUsername = (result.username || "").trim();
      setLinkedStatus(result.status);
      setLinkedMessage(result.message || "");
      setLinkedLastSyncAt(new Date().toISOString());
      if (normalizedUsername) {
        setLinkedLastUsername(normalizedUsername);
      }
      if (result.ok) {
        await refreshWatched();
        onSaved();
      }
    } catch (err) {
      setLinkedErr(err instanceof ApiError ? err.message : "Could not sync watched titles from Letterboxd export.");
    } finally {
      setLinkedWatchedSyncing(false);
    }
  };

  const handleToggleCountry = (code: string) => {
    setSelectedCountries((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        if (next.size <= 1) return prev;
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleSaveCountries = async () => {
    if (countriesSaving || selectedCountries.size === 0) return;
    setCountriesSaving(true);
    setCountriesErr("");
    try {
      const countryValues = Array.from(selectedCountries);
      await saveConfig(Array.from(selectedProviders), countryValues);
      setActiveServiceCountries(new Set(countryValues));
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setCountriesErr(err instanceof ApiError ? e.message : "Could not save countries.");
    } finally {
      setCountriesSaving(false);
    }
  };

  const handleToggleServiceCountry = (code: string) => {
    setActiveServiceCountries((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        if (next.size <= 1) return prev;
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const handleToggleProvider = (providerId: number) => {
    setSelectedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(providerId)) {
        next.delete(providerId);
        return next;
      }
      next.add(providerId);
      const providerList = allProviders.length > 0 ? allProviders : serviceProviders;
      return expandIds(next, providerList);
    });
  };

  const handleSaveServices = async () => {
    if (servicesSaving || selectedCountries.size === 0) return;
    setServicesSaving(true);
    setServicesErr("");
    try {
      await saveConfig(Array.from(selectedProviders), Array.from(selectedCountries));
      onSaved();
    } catch (err) {
      const e = err as ApiError;
      setServicesErr(err instanceof ApiError ? e.message : "Could not save services.");
    } finally {
      setServicesSaving(false);
    }
  };

  const applyHomeOrder = useCallback(
    (nextOrder: string[]) => {
      const normalized = Array.from(new Set(nextOrder.map((value) => String(value).trim()).filter(Boolean)));
      setHomeOrderDraft(normalized);
      setHomeOrderPositionDrafts({});
      onHomeSectionOrderChange(normalized);
    },
    [onHomeSectionOrderChange]
  );

  const moveHomeOrderItem = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      if (!homeOrderEntries.length) return;
      const clampedTo = Math.max(0, Math.min(homeOrderEntries.length - 1, toIndex));
      if (fromIndex === clampedTo) return;
      const next = [...homeOrderDraft];
      const [moved] = next.splice(fromIndex, 1);
      if (!moved) return;
      next.splice(clampedTo, 0, moved);
      applyHomeOrder(next);
    },
    [homeOrderDraft, homeOrderEntries.length, applyHomeOrder]
  );

  const handleHomeOrderPositionCommit = useCallback(
    (itemId: string, rawValue: string) => {
      const currentIndex = homeOrderDraft.indexOf(itemId);
      if (currentIndex < 0) return;
      const parsed = Number.parseInt(rawValue, 10);
      if (!Number.isFinite(parsed)) {
        setHomeOrderPositionDrafts((prev) => {
          const next = { ...prev };
          delete next[itemId];
          return next;
        });
        return;
      }
      const targetIndex = Math.max(0, Math.min(homeOrderDraft.length - 1, parsed - 1));
      setHomeOrderPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      moveHomeOrderItem(currentIndex, targetIndex);
    },
    [homeOrderDraft, moveHomeOrderItem]
  );

  const handleRemoveHomeSection = useCallback(
    (sectionId: string) => {
      setHomeOrderPositionDrafts((prev) => {
        const next = { ...prev };
        delete next[sectionId];
        return next;
      });
      setHomeOrderDraft((prev) => prev.filter((entry) => entry !== sectionId));
      setHomeOrderDragIndex(null);
      setHomeOrderDragOverIndex(null);
      homeOrderDragArmedIndexRef.current = null;
      homeOrderDragPointerYRef.current = null;
      onHomeRemoveSection(sectionId);
    },
    [onHomeRemoveSection]
  );

  const renderSection = () => {
    if (activeSection === "account") {
      return (
        <div className="space-y-8">
          <div>
            <h4 className="text-sm font-semibold text-text">Account</h4>
            <p className="text-sm text-muted mt-1">{user?.email}</p>
          </div>

          <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-text">Change email</h4>
            <input
              type="password"
              required
              placeholder="Current password"
              value={emailPassword}
              onChange={(e) => setEmailPassword(e.target.value)}
              autoComplete="current-password"
              className={inputClass}
            />
            <input
              type="email"
              required
              placeholder="New email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="email"
              className={inputClass}
            />
            {emailErr && (
              <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{emailErr}</div>
            )}
            {emailMsg && (
              <div className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">{emailMsg}</div>
            )}
            <button
              type="submit"
              disabled={emailLoading}
              className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 text-sm"
            >
              {emailLoading ? "..." : "Update email"}
            </button>
          </form>

          <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-3">
            <h4 className="text-sm font-semibold text-text">Change password</h4>
            <input
              type="password"
              required
              placeholder="Current password"
              value={currentPw}
              onChange={(e) => setCurrentPw(e.target.value)}
              autoComplete="current-password"
              className={inputClass}
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="New password"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
            <input
              type="password"
              required
              minLength={8}
              placeholder="Confirm new password"
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
              autoComplete="new-password"
              className={inputClass}
            />
            {pwErr && (
              <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{pwErr}</div>
            )}
            {pwMsg && (
              <div className="text-sm text-green-400 bg-green-400/10 rounded-lg px-3 py-2">{pwMsg}</div>
            )}
            <button
              type="submit"
              disabled={pwLoading}
              className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 text-sm"
            >
              {pwLoading ? "..." : "Update password"}
            </button>
          </form>

          <div className="pt-4 border-t border-border">
            <h4 className="text-sm font-semibold text-red-400 mb-2">Delete account</h4>
            {!deleteConfirm ? (
              <button
                onClick={() => setDeleteConfirm(true)}
                className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg border border-red-500/50 text-red-400 hover:bg-red-500/10 transition-colors text-sm"
              >
                Delete my account
              </button>
            ) : (
              <form onSubmit={handleDeleteAccount} className="flex flex-col gap-3">
                <p className="text-sm text-muted">
                  This will permanently delete your account and all your data. This action cannot be undone.
                </p>
                <input
                  type="password"
                  required
                  placeholder="Enter your password to confirm"
                  value={deletePw}
                  onChange={(e) => setDeletePw(e.target.value)}
                  autoComplete="current-password"
                  className={inputClass}
                />
                {deleteErr && (
                  <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{deleteErr}</div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirm(false);
                      setDeletePw("");
                      setDeleteErr("");
                    }}
                    className="flex-1 py-2.5 font-semibold rounded-lg border border-border text-muted hover:text-text hover:border-accent-2 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={deleteLoading}
                    className="flex-1 py-2.5 font-semibold rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50 text-sm"
                  >
                    {deleteLoading ? "..." : "Delete permanently"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      );
    }

    if (activeSection === "notifications") {
      return (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text">Notification delivery</h4>
          <p className="text-sm text-muted">This applies to all your availability alerts.</p>
          {notificationLoading ? (
            <div className="text-sm text-muted">Loading notification settings...</div>
          ) : (
            <>
              {DELIVERY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => void handleNotificationDeliveryChange(option.value)}
                  disabled={notificationSaving}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                    notificationDelivery === option.value
                      ? "border-accent/70 bg-accent/10"
                      : "border-border/80 bg-panel-2/50 hover:border-accent-2/50"
                  }`}
                >
                  <div className="text-sm text-text">{option.label}</div>
                  <div className="text-xs text-muted mt-0.5">{option.description}</div>
                </button>
              ))}
              {notificationSaving && (
                <div className="text-xs text-muted pt-1">Saving...</div>
              )}
              {notificationErr && (
                <div className="text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">
                  {notificationErr}
                </div>
              )}
            </>
          )}
        </div>
      );
    }

    if (activeSection === "countries") {
      return (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text">Primary countries</h4>
          <p className="text-sm text-muted">Select the countries where you primarily watch content.</p>

          {selectedCountries.size > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedCountries).map((code) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/40 text-sm"
                >
                  {countryFlag(code)} {countryNameMap[code] || code}
                  <button
                    onClick={() => handleToggleCountry(code)}
                    className="text-muted hover:text-accent-2 text-base leading-none"
                  >
                    &times;
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            type="text"
            value={countryQuery}
            onChange={(e) => setCountryQuery(e.target.value)}
            placeholder="Search countries..."
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-2 text-text outline-none focus:border-accent-2"
          />

          <div className="max-h-[46vh] overflow-y-auto border border-border rounded-lg">
            {filteredRegions.map((region) => (
              <button
                key={region.iso_3166_1}
                onClick={() => handleToggleCountry(region.iso_3166_1)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors border-b border-white/5 last:border-0 ${
                  selectedCountries.has(region.iso_3166_1)
                    ? "bg-white/10 text-text"
                    : "text-muted hover:bg-white/5 hover:text-text"
                }`}
              >
                <span>{countryFlag(region.iso_3166_1)}</span>
                <span>{region.english_name}</span>
                {selectedCountries.has(region.iso_3166_1) && (
                  <span className="ml-auto text-accent">&#10003;</span>
                )}
              </button>
            ))}
          </div>

          {countriesErr && (
            <div className="text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">{countriesErr}</div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveCountries}
              disabled={countriesSaving || selectedCountries.size === 0}
              className="px-4 py-2.5 rounded-lg border border-accent/60 bg-accent/15 text-sm font-semibold text-text hover:bg-accent/25 transition-colors disabled:opacity-50"
            >
              {countriesSaving ? "Saving..." : "Save countries"}
            </button>
          </div>
        </div>
      );
    }

    if (activeSection === "services") {
      return (
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-text">Streaming services</h4>
          <p className="text-sm text-muted">Select the services you subscribe to.</p>

          <div className="bg-panel-2 border border-border rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted uppercase tracking-widest">Selected services</span>
              <button
                onClick={() => setSelectedProviders(new Set())}
                className="text-xs text-muted border border-border rounded-full px-2 py-0.5 hover:border-accent-2 hover:text-text transition-colors"
              >
                Deselect all
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {selectedProvidersSorted.length === 0 ? (
                <span className="text-sm text-muted">None selected</span>
              ) : (
                selectedProvidersSorted.map((provider) => (
                  <span
                    key={provider.provider_id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/40 text-sm"
                  >
                    {provider.provider_name}
                    <button
                      onClick={() => handleToggleProvider(provider.provider_id)}
                      className="text-muted hover:text-accent-2 text-base leading-none"
                    >
                      &times;
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {Array.from(selectedCountries).length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {Array.from(selectedCountries).map((code) => (
                <button
                  key={code}
                  onClick={() => handleToggleServiceCountry(code)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-colors ${
                    activeServiceCountries.has(code)
                      ? "bg-accent/10 border-accent/50 text-text"
                      : "bg-panel-2 border-border text-muted"
                  }`}
                >
                  {countryFlag(code)} {countryNameMap[code] || code}
                </button>
              ))}
            </div>
          )}

          {selectedCountries.size > 0 && (
            <button
              onClick={() => setShowAllServiceCountries((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors ${
                showAllServiceCountries
                  ? "bg-accent/10 border-accent/50 text-text"
                  : "bg-panel-2 border-border text-muted"
              }`}
            >
              Show additional services from other countries
            </button>
          )}

          <input
            type="text"
            value={serviceSearch}
            onChange={(e) => setServiceSearch(e.target.value)}
            placeholder="Search services..."
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-2 text-text outline-none focus:border-accent-2"
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 pr-1 max-h-[42vh] overflow-y-auto">
            {filteredProviders.map((provider) => (
              <button
                key={provider.provider_id}
                onClick={() => handleToggleProvider(provider.provider_id)}
                className={`flex items-center gap-2 text-sm p-1.5 rounded-lg border-2 transition-colors text-left ${
                  selectedProviders.has(provider.provider_id)
                    ? "bg-accent/15 border-accent text-text"
                    : "bg-panel-2 border-transparent text-muted hover:border-border"
                }`}
              >
                {provider.logo_path && (
                  <img src={`${TMDB_IMG}/w45${provider.logo_path}`} alt="" className="w-7 h-7 rounded-md flex-shrink-0" />
                )}
                <span className="truncate">{provider.provider_name}</span>
              </button>
            ))}
          </div>

          {servicesErr && (
            <div className="text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">{servicesErr}</div>
          )}

          <div className="flex justify-end">
            <button
              onClick={handleSaveServices}
              disabled={servicesSaving || selectedCountries.size === 0}
              className="px-4 py-2.5 rounded-lg border border-accent/60 bg-accent/15 text-sm font-semibold text-text hover:bg-accent/25 transition-colors disabled:opacity-50"
            >
              {servicesSaving ? "Saving..." : "Save services"}
            </button>
          </div>
        </div>
      );
    }

    if (activeSection === "home") {
      const isLight = theme === "light";
      return (
        <div className="space-y-5">
          <h4 className="text-sm font-semibold text-text">Home screen preferences</h4>
          <p className="text-sm text-muted">Choose your default interface appearance and content behavior.</p>
          <div className="flex gap-2">
            <button
              onClick={() => void setTheme("dark")}
              className={`h-10 px-4 rounded-lg border text-sm transition-colors ${
                !isLight
                  ? "border-accent/70 bg-accent/15 text-text"
                  : "border-border text-muted hover:text-text hover:border-accent-2"
              }`}
            >
              Dark
            </button>
            <button
              onClick={() => void setTheme("light")}
              className={`h-10 px-4 rounded-lg border text-sm transition-colors ${
                isLight
                  ? "border-accent/70 bg-accent/15 text-text"
                  : "border-border text-muted hover:text-text hover:border-accent-2"
              }`}
            >
              Light
            </button>
          </div>

          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wider">Default content mode</h5>
            <div className="grid grid-cols-3 gap-2">
              {(["all", "available", "streamable"] as HomeContentMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onHomeContentModeChange(mode)}
                  className={`h-10 rounded-lg border text-sm transition-colors ${
                    homeContentMode === mode
                      ? "border-accent/70 bg-accent/15 text-text"
                      : "border-border text-muted hover:text-text hover:border-accent-2"
                  }`}
                >
                  {HOME_CONTENT_LABEL[mode]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wider">VPN mode</h5>
            <button
              type="button"
              onClick={() => onHomeUsingVpnChange(!homeUsingVpn)}
              aria-pressed={homeUsingVpn}
              className={`w-full h-11 px-3 border rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                homeUsingVpn
                  ? "border-accent/60 bg-accent/10 text-text"
                  : "border-border bg-panel text-muted"
              }`}
            >
              <span>{homeUsingVpn ? "Using VPN" : "Not using VPN"}</span>
              <span
                className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                  homeUsingVpn
                    ? "bg-accent border-accent"
                    : "bg-panel-2 border-border"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                    homeUsingVpn ? "translate-x-4" : ""
                  }`}
                />
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <h5 className="text-xs font-semibold text-muted uppercase tracking-wider">Watchlist on home</h5>
            <button
              type="button"
              onClick={() => onHomeShowWatchlistChange(!homeShowWatchlist)}
              aria-pressed={homeShowWatchlist}
              className={`w-full h-11 px-3 border rounded-xl text-sm font-medium transition-colors flex items-center justify-between gap-2 ${
                homeShowWatchlist
                  ? "border-accent/60 bg-accent/10 text-text"
                  : "border-border bg-panel text-muted"
              }`}
            >
              <span>{homeShowWatchlist ? "Show watchlist section" : "Hide watchlist section"}</span>
              <span
                className={`relative h-5 w-9 flex-shrink-0 rounded-full border transition-colors ${
                  homeShowWatchlist
                    ? "bg-accent border-accent"
                    : "bg-panel-2 border-border"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-white transition-transform ${
                    homeShowWatchlist ? "translate-x-4" : ""
                  }`}
                />
              </span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h5 className="text-xs font-semibold text-muted uppercase tracking-wider">Home screen lists order</h5>
              <button
                type="button"
                onClick={onOpenLists}
                className="h-8 px-3 rounded-md border border-accent/55 bg-accent/10 text-[0.72rem] font-semibold text-text hover:bg-accent/16 hover:border-accent transition-colors"
              >
                Add lists
              </button>
            </div>
            <p className="text-xs text-muted">
              {mobileOrderMode
                ? "Set the order number on the left for each row."
                : "Drag rows by the handle on the right to reorder."}
            </p>
            <div
              ref={homeOrderZoneRef}
              className="rounded-xl border border-border/80 bg-panel-2/45 overflow-hidden divide-y divide-white/5"
              onDragOver={(event) => {
                if (mobileOrderMode || homeOrderDragIndex == null) return;
                event.preventDefault();
                homeOrderDragPointerYRef.current = event.clientY;
              }}
            >
              {homeOrderEntries.map((entry, index) => {
                const isDragTarget = homeOrderDragOverIndex === index && homeOrderDragIndex !== null;
                const isDragging = homeOrderDragIndex === index;
                return (
                  <div
                    key={entry.id}
                    draggable={!mobileOrderMode}
                    onDragStart={(event) => {
                      if (mobileOrderMode) {
                        event.preventDefault();
                        return;
                      }
                      if (homeOrderDragArmedIndexRef.current !== index) {
                        event.preventDefault();
                        return;
                      }
                      event.dataTransfer.effectAllowed = "move";
                      setHomeOrderDragIndex(index);
                      setHomeOrderDragOverIndex(index);
                      homeOrderDragPointerYRef.current = event.clientY || null;
                      homeOrderDragArmedIndexRef.current = null;
                    }}
                    onDragOver={(event) => {
                      if (mobileOrderMode || homeOrderDragIndex == null) return;
                      event.preventDefault();
                      homeOrderDragPointerYRef.current = event.clientY;
                      if (homeOrderDragOverIndex !== index) setHomeOrderDragOverIndex(index);
                    }}
                    onDrop={(event) => {
                      if (mobileOrderMode || homeOrderDragIndex == null) return;
                      event.preventDefault();
                      const from = homeOrderDragIndex;
                      setHomeOrderDragIndex(null);
                      setHomeOrderDragOverIndex(null);
                      homeOrderDragArmedIndexRef.current = null;
                      homeOrderDragPointerYRef.current = null;
                      moveHomeOrderItem(from, index);
                    }}
                    onDragEnd={() => {
                      setHomeOrderDragIndex(null);
                      setHomeOrderDragOverIndex(null);
                      homeOrderDragArmedIndexRef.current = null;
                      homeOrderDragPointerYRef.current = null;
                    }}
                    className={`flex items-center gap-2 px-3 py-2.5 transition-all ${
                      isDragging
                        ? "bg-accent/18 ring-2 ring-accent/70 shadow-[0_8px_20px_rgba(229,9,20,0.28)]"
                        : isDragTarget
                          ? "bg-accent/10"
                          : "bg-transparent"
                    }`}
                  >
                    <div className="sm:hidden">
                      <input
                        type="number"
                        min={1}
                        max={homeOrderEntries.length}
                        inputMode="numeric"
                        value={homeOrderPositionDrafts[entry.id] ?? String(index + 1)}
                        onChange={(event) => {
                          const value = event.target.value;
                          setHomeOrderPositionDrafts((prev) => ({ ...prev, [entry.id]: value }));
                        }}
                        onBlur={(event) => {
                          handleHomeOrderPositionCommit(entry.id, event.target.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.currentTarget.blur();
                            return;
                          }
                          if (event.key === "Escape") {
                            setHomeOrderPositionDrafts((prev) => {
                              const next = { ...prev };
                              delete next[entry.id];
                              return next;
                            });
                            event.currentTarget.blur();
                          }
                        }}
                        className="list-order-input h-8 rounded-md border border-border bg-bg-2 text-center text-sm font-semibold text-text outline-none focus:border-accent-2 transition-colors"
                        style={{ width: `${homeOrderInputWidthRem}rem` }}
                      />
                    </div>

                    <div className="min-w-0 flex-1 text-sm text-text truncate">{entry.label}</div>

                    <button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleRemoveHomeSection(entry.id);
                      }}
                      className="h-8 px-2.5 rounded-md border border-border/70 bg-panel text-[0.7rem] font-semibold text-muted hover:text-text hover:border-accent-2 transition-colors"
                    >
                      Remove
                    </button>

                    <div
                      data-home-order-handle="1"
                      role="presentation"
                      onMouseDown={() => {
                        homeOrderDragArmedIndexRef.current = index;
                      }}
                      className="hidden sm:flex items-center justify-center w-9 h-8 cursor-grab active:cursor-grabbing text-muted/85 hover:text-text transition-colors select-none"
                    >
                      <span className="flex flex-col gap-1 pointer-events-none">
                        <span className="block h-[2px] w-4 rounded-full bg-muted/80" />
                        <span className="block h-[2px] w-4 rounded-full bg-muted/80" />
                        <span className="block h-[2px] w-4 rounded-full bg-muted/80" />
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      );
    }

    if (activeSection === "linked") {
      return (
        <div className="space-y-4">
          <div>
            <h4 className="text-sm font-semibold text-text">Linked accounts</h4>
            <p className="text-sm text-muted mt-1">
              Upload your Letterboxd data export ZIP to sync watchlist and watched titles.
            </p>
          </div>

          <form onSubmit={handleLetterboxdSync} className="space-y-3">
            <div className="rounded-lg border border-border/80 bg-bg/40 px-3 py-2.5 text-xs text-muted space-y-1">
              <div>1. Log into Letterboxd.</div>
              <div>2. Go to `Settings`.</div>
              <div>3. Open `Data` and click `Export your data`.</div>
              <div>4. Upload the downloaded ZIP file below.</div>
            </div>

            <input
              ref={linkedFileInputRef}
              id="letterboxd-export-zip"
              type="file"
              accept=".zip,application/zip,application/x-zip-compressed"
              onChange={(event) => {
                const nextFile = event.target.files && event.target.files.length > 0 ? event.target.files[0] : null;
                handleLinkedFileChange(nextFile);
              }}
              className="sr-only"
              disabled={linkedUploadDisabled}
            />

            {!linkedExportFile && (
              <div
                role="button"
                tabIndex={linkedUploadDisabled ? -1 : 0}
                onClick={() => {
                  if (linkedUploadDisabled) return;
                  openLinkedFilePicker();
                }}
                onKeyDown={(event) => {
                  if (linkedUploadDisabled) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  openLinkedFilePicker();
                }}
                onDragEnter={(event) => {
                  if (linkedUploadDisabled) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkedDropActive(true);
                }}
                onDragOver={(event) => {
                  if (linkedUploadDisabled) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkedDropActive(true);
                }}
                onDragLeave={(event) => {
                  if (linkedUploadDisabled) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const related = event.relatedTarget as Node | null;
                  if (related && event.currentTarget.contains(related)) return;
                  setLinkedDropActive(false);
                }}
                onDrop={(event) => {
                  if (linkedUploadDisabled) return;
                  event.preventDefault();
                  event.stopPropagation();
                  setLinkedDropActive(false);
                  const droppedFile = event.dataTransfer.files && event.dataTransfer.files.length > 0
                    ? event.dataTransfer.files[0]
                    : null;
                  handleLinkedFileChange(droppedFile);
                }}
                className={`rounded-2xl border-[2.5px] border-dashed px-4 py-6 sm:px-5 sm:py-7 transition-colors ${
                  linkedUploadDisabled
                    ? "border-border/50 bg-bg/30 opacity-70 cursor-not-allowed"
                    : linkedDropActive
                      ? "border-accent-2 bg-accent/10 cursor-pointer"
                      : "border-border/80 bg-panel/35 hover:border-accent/65 cursor-pointer"
                }`}
              >
                <div className="flex flex-col items-center justify-center text-center gap-3">
                  <div className="w-11 h-11 rounded-full border border-border/70 bg-bg/70 flex items-center justify-center text-muted">
                    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                      <path d="M12 3v10" strokeLinecap="round" />
                      <path d="m8 9 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M4 16.5v1A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5v-1" strokeLinecap="round" />
                    </svg>
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-text">
                      {linkedDropActive ? "Drop your ZIP file here" : "Drag and drop your Letterboxd ZIP file"}
                    </div>
                    <div className="text-xs text-muted">or choose a file manually</div>
                  </div>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (linkedUploadDisabled) return;
                      openLinkedFilePicker();
                    }}
                    disabled={linkedUploadDisabled}
                    className="px-4 py-2 rounded-lg border border-border/80 bg-bg/60 text-sm font-semibold text-text hover:border-accent-2 transition-colors disabled:opacity-50"
                  >
                    Upload ZIP file
                  </button>
                </div>
              </div>
            )}

            {linkedExportFile && (
              <div className="rounded-xl border border-border/70 bg-panel/35 px-4 py-3">
                <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-11 h-11 rounded-lg border border-border/70 bg-bg/70 flex items-center justify-center text-text/90 shrink-0">
                      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M14 2v5h5" strokeLinecap="round" strokeLinejoin="round" />
                        <path d="M9 13h6M9 17h6" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm sm:text-[0.95rem] font-semibold text-text truncate">{linkedExportFile.name}</div>
                      <div className="text-xs sm:text-sm text-muted">{formatFileSize(linkedExportFile.size)}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={resetLinkedSelectedFile}
                    disabled={linkedUploadDisabled}
                    className="w-full sm:w-auto px-3.5 py-2 rounded-lg border border-border/80 bg-bg/60 text-xs sm:text-sm font-semibold text-text hover:border-accent-2 transition-colors disabled:opacity-50"
                  >
                    Choose a different ZIP file
                  </button>
                </div>
              </div>
            )}

            <div className="text-xs text-muted">
              Syncing from ZIP adds and merges titles. Anything already in your FullStreamer watchlist stays there.
            </div>
            {(linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing) && (
              <div className="text-xs rounded-md border border-accent/35 bg-accent/10 px-3 py-2 text-accent-2">
                Please wait. Syncing can take some time for large Letterboxd libraries.
              </div>
            )}
            {linkedCanSync ? (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing || linkedLoading}
                  className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 text-sm"
                >
                  {linkedSyncing ? "Syncing all..." : "Sync all"}
                </button>
                <button
                  type="button"
                  onClick={handleLetterboxdWatchlistSync}
                  disabled={linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing || linkedLoading}
                  className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg border border-border/80 bg-bg/60 text-text hover:border-accent-2 transition-colors disabled:opacity-50 text-sm"
                >
                  {linkedWatchlistSyncing ? "Syncing watchlist..." : "Sync watchlist"}
                </button>
                <button
                  type="button"
                  onClick={handleLetterboxdWatchedSync}
                  disabled={linkedSyncing || linkedWatchlistSyncing || linkedWatchedSyncing || linkedLoading}
                  className="w-full sm:w-auto px-4 py-2.5 font-semibold rounded-lg border border-border/80 bg-bg/60 text-text hover:border-accent-2 transition-colors disabled:opacity-50 text-sm"
                >
                  {linkedWatchedSyncing ? "Syncing watched..." : "Sync watched titles"}
                </button>
              </div>
            ) : (
              <div className="text-xs text-muted">Upload a ZIP file to show sync buttons.</div>
            )}
          </form>

          {linkedLoading && (
            <div className="text-sm text-muted">Loading linked account status...</div>
          )}

          {linkedErr && (
            <div className="text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">{linkedErr}</div>
          )}

          {linkedMessage && (
            <div
              className={`text-sm rounded-md px-3 py-2 ${
                linkedStatus === "private" ||
                linkedStatus === "not_found" ||
                linkedStatus === "blocked" ||
                linkedStatus === "unreachable" ||
                linkedStatus === "empty" ||
                linkedStatus === "no_matches"
                  ? "text-red-300 bg-red-500/10"
                  : "text-green-300 bg-green-500/10"
              }`}
            >
              {linkedMessage}
            </div>
          )}

          {(linkedStatus || linkedLastSyncAt) && (
            <div className="text-xs text-muted border border-border/70 rounded-lg px-3 py-2 space-y-1">
              {linkedLastUsername && <div>Last export username: {linkedLastUsername}</div>}
              <div>Status: {linkedStatus || "unknown"}</div>
              <div>Last sync: {linkedLastSyncAt ? new Date(linkedLastSyncAt).toLocaleString() : "Never"}</div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-text">Subscription</h4>
        <p className="text-sm text-muted">Coming soon.</p>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[340] flex items-center justify-center p-3 sm:p-5 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(event) => event.target === event.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl w-full max-w-[1120px] h-[calc(100dvh-1.5rem)] sm:h-[92dvh] flex flex-col overflow-hidden"
            initial={{ scale: 0.97, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.97, y: 20 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between p-6 pb-0 flex-shrink-0">
              <div>
                <h3 className="font-display text-xl">Settings</h3>
                <p className="text-sm text-muted mt-1">{user?.email}</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 min-h-0 p-4 sm:p-6 pt-3 sm:pt-4 overflow-hidden">
              <div className="h-full min-h-0 rounded-xl border border-border/80 bg-bg/40 overflow-hidden grid grid-cols-[16rem_minmax(0,1fr)] max-sm:grid-cols-1 max-sm:grid-rows-[auto_minmax(0,1fr)]">
                <aside className="max-sm:w-full border-r border-border/80 max-sm:border-r-0 max-sm:border-b max-sm:border-border/80 bg-panel-2/60 overflow-hidden max-sm:overflow-x-auto max-sm:overflow-y-hidden">
                  <nav className="p-2 flex flex-col gap-1 max-sm:flex-row max-sm:min-w-max">
                    {SECTION_OPTIONS.map((section) => (
                      <button
                        key={section.id}
                        onClick={() => setActiveSection(section.id)}
                        className={`text-left px-3 py-2.5 rounded-lg text-sm transition-colors whitespace-nowrap ${
                          activeSection === section.id
                            ? "bg-accent/15 border border-accent/50 text-text"
                            : "text-muted border border-transparent hover:text-text hover:bg-white/5"
                        }`}
                      >
                        {section.label}
                      </button>
                    ))}
                  </nav>
                </aside>
                <main
                  ref={contentScrollRef}
                  className="min-h-0 overflow-y-scroll overscroll-contain p-4 sm:p-6 pb-8"
                  style={{ WebkitOverflowScrolling: "touch" }}
                  onDragOver={(event) => {
                    if (activeSection !== "home" || mobileOrderMode || homeOrderDragIndex == null) return;
                    event.preventDefault();
                    homeOrderDragPointerYRef.current = event.clientY;
                  }}
                >
                  {renderSection()}
                </main>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
