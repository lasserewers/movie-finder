import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  getNotificationSettings,
  updateNotificationSettings,
  type NotificationDelivery,
} from "../api/notifications";
import { ApiError } from "../api/client";
import Spinner from "./Spinner";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DELIVERY_OPTIONS: Array<{ value: NotificationDelivery; label: string; description: string }> = [
  { value: "in_app", label: "In-app", description: "Only inside FullStreamer." },
  { value: "email", label: "Email", description: "Only by email." },
  { value: "both", label: "Both", description: "In-app and email notifications." },
];

export default function NotificationSettingsOverlay({ open, onClose }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [delivery, setDelivery] = useState<NotificationDelivery>("in_app");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    getNotificationSettings()
      .then((data) => {
        if (cancelled) return;
        setDelivery(data.delivery || "in_app");
      })
      .catch((err) => {
        if (cancelled) return;
        const e = err as ApiError;
        setError(err instanceof ApiError ? e.message : "Could not load notification settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleChange = async (nextDelivery: NotificationDelivery) => {
    if (saving || delivery === nextDelivery) return;
    setSaving(true);
    setError("");
    try {
      const result = await updateNotificationSettings(nextDelivery);
      setDelivery(result.delivery || nextDelivery);
    } catch (err) {
      const e = err as ApiError;
      setError(err instanceof ApiError ? e.message : "Could not update notification settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[306] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="absolute inset-0 bg-[rgba(6,7,10,0.7)] backdrop-blur-md" onClick={onClose} />
          <motion.div
            className="relative w-[min(580px,94vw)] max-h-[90vh] flex flex-col bg-gradient-to-b from-panel/[0.98] to-bg/[0.98] border border-border rounded-2xl z-10 shadow-[0_40px_80px_rgba(0,0,0,0.45)]"
            initial={{ y: 40, scale: 0.97 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 40, scale: 0.97 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <button
              onClick={onClose}
              className="absolute top-6 right-6 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors z-10"
            >
              &times;
            </button>

            <div className="p-6 sm:p-8 pb-4">
              <div className="pr-12">
                <h3 className="font-display text-2xl">Notification Settings</h3>
                <p className="text-sm text-muted mt-1">
                  This applies to all your availability alerts.
                </p>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-6 sm:px-8 pb-6 sm:pb-8">
              {loading ? (
                <div className="py-12 flex justify-center">
                  <Spinner />
                </div>
              ) : (
                <div className="space-y-2">
                  {DELIVERY_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => void handleChange(option.value)}
                      disabled={saving}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                        delivery === option.value
                          ? "border-accent/70 bg-accent/10"
                          : "border-border/80 bg-panel-2/50 hover:border-accent-2/50"
                      }`}
                    >
                      <div className="text-sm text-text">{option.label}</div>
                      <div className="text-xs text-muted mt-0.5">{option.description}</div>
                    </button>
                  ))}
                  {saving && (
                    <div className="text-xs text-muted pt-1">Saving...</div>
                  )}
                  {error && (
                    <div className="text-sm text-red-300 bg-red-500/10 rounded-md px-3 py-2">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
