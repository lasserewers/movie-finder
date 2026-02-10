import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ApiError } from "../api/client";
import { changeEmail, changePassword, deleteAccount } from "../api/auth";
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationDelivery,
} from "../api/notifications";
import { useAuth } from "../hooks/useAuth";
import { useConfig } from "../hooks/useConfig";
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

export type SettingsCenterSection =
  | "account"
  | "notifications"
  | "countries"
  | "services"
  | "home"
  | "linked"
  | "subscription";
export type HomeContentMode = "all" | "available" | "streamable";

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
  onHomeContentModeChange: (next: HomeContentMode) => void;
  onHomeUsingVpnChange: (next: boolean) => void;
  onHomeShowWatchlistChange: (next: boolean) => void;
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
  onHomeContentModeChange,
  onHomeUsingVpnChange,
  onHomeShowWatchlistChange,
}: Props) {
  const { user, logout } = useAuth();
  const { providerIds, countries, allProviders, saveConfig, loadProviders, expandIds, theme, setTheme } = useConfig();

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
  }, [open, initialSection, countries, providerIds]);

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

  const inputClass =
    "w-full px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors";

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
        </div>
      );
    }

    if (activeSection === "linked") {
      return (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-text">Linked accounts</h4>
          <p className="text-sm text-muted">Coming soon.</p>
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
                  className="min-h-0 overflow-y-scroll overscroll-contain p-4 sm:p-6 pb-8"
                  style={{ WebkitOverflowScrolling: "touch" }}
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
