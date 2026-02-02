import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useConfig } from "../hooks/useConfig";
import type { ProviderInfo } from "../api/movies";

const TMDB_IMG = "https://image.tmdb.org/t/p";

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  countryNameMap: Record<string, string>;
}

export default function SettingsModal({ open, onClose, onSaved, countryNameMap }: Props) {
  const { providerIds, countries, allProviders, saveConfig, loadProviders } = useConfig();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [activeCountries, setActiveCountries] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setSelected(new Set(providerIds));
    setSearch("");
    setShowAll(false);
    setActiveCountries(new Set(countries));
    loadProviderList(new Set(countries), false);
  }, [open]);

  const loadProviderList = useCallback(async (active?: Set<string>, all?: boolean) => {
    const ac = active ?? activeCountries;
    const sa = all ?? showAll;
    const filteredCountries = countries.filter((c) => ac.has(c));
    if (filteredCountries.length && !sa) {
      const lists = await Promise.all(filteredCountries.map((c) => loadProviders(c)));
      const seen = new Set<number>();
      const combined: ProviderInfo[] = [];
      for (const list of lists) {
        for (const p of list) {
          if (!seen.has(p.provider_id)) {
            seen.add(p.provider_id);
            combined.push(p);
          }
        }
      }
      setProviders(combined);
    } else {
      const list = await loadProviders();
      setProviders(list);
    }
  }, [countries, activeCountries, showAll, loadProviders]);

  useEffect(() => {
    if (open) loadProviderList(activeCountries, showAll);
  }, [showAll, activeCountries]);

  const toggleCountry = (code: string) => {
    setActiveCountries((prev) => {
      const next = new Set(prev);
      if (next.has(code)) {
        if (next.size <= 1) return prev; // keep at least one
        next.delete(code);
      } else {
        next.add(code);
      }
      return next;
    });
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Auto-save
      saveConfig(Array.from(next), countries).then(() => onSaved());
      return next;
    });
  };

  const sorted = [...providers].sort((a, b) => a.provider_name.localeCompare(b.provider_name));
  const filtered = search
    ? sorted.filter((p) => p.provider_name.toLowerCase().includes(search.toLowerCase()))
    : sorted;

  const selectedProviders = sorted
    .filter((p) => selected.has(p.provider_id))
    .sort((a, b) => a.provider_name.localeCompare(b.provider_name));

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[340] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl w-[min(92vw,620px)] max-h-[86vh] flex flex-col"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
          >
            <div className="flex items-start justify-between p-6 pb-0">
              <div>
                <h3 className="font-display text-xl mb-1">My Streaming Services</h3>
                <p className="text-sm text-muted">Select the services you subscribe to:</p>
              </div>
              <button
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pt-4">
            {/* Selected services */}
            <div className="bg-panel-2 border border-border rounded-xl p-3 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted uppercase tracking-widest">Selected services</span>
                <button
                  onClick={() => {
                    setSelected(new Set());
                    saveConfig([], countries).then(() => onSaved());
                  }}
                  className="text-xs text-muted border border-border rounded-full px-2 py-0.5 hover:border-accent-2 hover:text-text transition-colors"
                >
                  Deselect all
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {selectedProviders.length === 0 ? (
                  <span className="text-sm text-muted">None selected</span>
                ) : (
                  selectedProviders.map((p) => (
                    <span
                      key={p.provider_id}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 border border-accent/40 text-sm"
                    >
                      {p.provider_name}
                      <button
                        onClick={() => toggle(p.provider_id)}
                        className="text-muted hover:text-accent-2 text-base leading-none"
                      >
                        &times;
                      </button>
                    </span>
                  ))
                )}
              </div>
            </div>

            {countries.length > 1 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {countries.map((code) => (
                  <button
                    key={code}
                    onClick={() => toggleCountry(code)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm border transition-colors ${
                      activeCountries.has(code)
                        ? "bg-accent/10 border-accent/50 text-text"
                        : "bg-panel-2 border-border text-muted"
                    }`}
                  >
                    {countryFlag(code)} {countryNameMap[code] || code}
                  </button>
                ))}
              </div>
            )}

            {countries.length > 0 && (
              <button
                onClick={() => setShowAll(!showAll)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm border transition-colors mb-3 ${
                  showAll
                    ? "bg-accent/10 border-accent/50 text-text"
                    : "bg-panel-2 border-border text-muted"
                }`}
              >
                Show additional services from other countries
              </button>
            )}

            <div>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search services..."
                className="w-full px-3 py-2 text-sm border border-border rounded-md bg-bg-2 text-text outline-none focus:border-accent-2 mb-3"
              />

              <div className="grid grid-cols-2 gap-1.5 pr-1">
                {filtered.map((p) => (
                  <button
                    key={p.provider_id}
                    onClick={() => toggle(p.provider_id)}
                    className={`flex items-center gap-2 text-sm p-1.5 rounded-lg border-2 transition-colors text-left ${
                      selected.has(p.provider_id)
                        ? "bg-accent/15 border-accent text-text"
                        : "bg-panel-2 border-transparent text-muted hover:border-border"
                    }`}
                  >
                    {p.logo_path && (
                      <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="" className="w-7 h-7 rounded-md flex-shrink-0" />
                    )}
                    <span className="truncate">{p.provider_name}</span>
                  </button>
                ))}
              </div>
            </div>
            </div>

          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
