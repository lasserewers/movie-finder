import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Region } from "../api/movies";

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

interface Props {
  open: boolean;
  regions: Region[];
  countryNameMap: Record<string, string>;
  initialCountries?: string[];
  singleSelect?: boolean;
  onDone: (countries: string[]) => void;
  onClose?: () => void;
}

export default function OnboardingModal({
  open,
  regions,
  countryNameMap,
  initialCountries,
  singleSelect = false,
  onDone,
  onClose,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const isEdit = !!(initialCountries && initialCountries.length > 0);
  const canSubmit = isEdit ? selected.size > 0 : true;

  useEffect(() => {
    if (open) {
      setSelected(new Set((singleSelect ? (initialCountries || []).slice(0, 1) : (initialCountries || []))));
      setQuery("");
    }
  }, [open, initialCountries, singleSelect]);

  const toggle = (code: string) => {
    setSelected((prev) => {
      if (singleSelect) {
        if (prev.has(code) && prev.size === 1) return prev;
        return new Set([code]);
      }
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const filtered = regions.filter(
    (r) =>
      r.english_name.toLowerCase().includes(query.toLowerCase()) ||
      r.iso_3166_1.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[350] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => onClose?.()} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl p-8 w-[min(92vw,500px)] max-h-[86vh] flex flex-col"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            {onClose && (
              <button
                onClick={onClose}
                className="absolute top-4 right-4 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors"
              >
                &times;
              </button>
            )}

            <div className="flex justify-center mb-4">
              <img src="/logo.svg" alt="FullStreamer" className="h-12" />
            </div>
            <h3 className="font-display text-xl mb-1 text-center">
              {isEdit ? "Manage Countries" : "Welcome to FullStreamer"}
            </h3>
            <p className="text-sm text-muted mb-4 text-center">
              {singleSelect
                ? "Select your primary country"
                : "Select the countries where you primarily watch content"}
            </p>
            {singleSelect && (
              <div className="mb-3 rounded-lg border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100/90">
                Premium unlocks multiple countries, VPN mode, and deeper discovery across more services.
              </div>
            )}

            {/* Selected countries */}
            {selected.size > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {Array.from(selected).map((code) => (
                  <span
                    key={code}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-accent/10 border border-accent/40 text-sm"
                  >
                    {countryFlag(code)} {countryNameMap[code] || code}
                    {!singleSelect && (
                      <button
                        onClick={() => toggle(code)}
                        className="text-muted hover:text-accent-2 text-base leading-none"
                      >
                        &times;
                      </button>
                    )}
                  </span>
                ))}
              </div>
            )}

            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search countries..."
              className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-2 text-text outline-none focus:border-accent-2 mb-3"
            />

            <div className="flex-1 overflow-y-auto max-h-[40vh] border border-border rounded-lg">
              {filtered.map((r) => (
                <button
                  key={r.iso_3166_1}
                  onClick={() => toggle(r.iso_3166_1)}
                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors border-b border-white/5 last:border-0 ${
                    selected.has(r.iso_3166_1)
                      ? "bg-white/10 text-text"
                      : "text-muted hover:bg-white/5 hover:text-text"
                  }`}
                >
                  <span>{countryFlag(r.iso_3166_1)}</span>
                  <span>{r.english_name}</span>
                  {selected.has(r.iso_3166_1) && (
                    <span className="ml-auto text-accent">&#10003;</span>
                  )}
                </button>
              ))}
            </div>

            <button
              onClick={() => onDone(Array.from(selected))}
              disabled={!canSubmit}
              className="w-full mt-4 py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isEdit ? (selected.size === 0 ? "Select at least one country" : "Save") : (selected.size === 0 ? "Skip for now" : "Next")}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
