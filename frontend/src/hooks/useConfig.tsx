import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import * as configApi from "../api/config";
import { getProviders, type ProviderInfo } from "../api/movies";

interface ConfigContextValue {
  providerIds: Set<number>;
  countries: string[];
  providerMap: Record<number, string>;
  allProviders: ProviderInfo[];
  loadConfig: () => Promise<void>;
  saveConfig: (ids: number[], countries: string[]) => Promise<void>;
  loadProviders: (country?: string) => Promise<ProviderInfo[]>;
  expandedProviderIds: () => Set<number>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

// Provider name matching logic (ported from old app.js)
const SUFFIX_TOKENS = new Set([
  "kids", "family", "basic", "standard", "premium", "ultimate", "ultra",
  "max", "plus", "with", "ads", "ad", "free", "no", "4k", "uhd", "hd",
  "plan", "tier", "bundle", "student", "annual", "monthly",
]);
const PREFIX_TOKENS = new Set(["the", "amazon"]);

function tokenize(name: string): string[] {
  const tokens = (name || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (tokens.length && PREFIX_TOKENS.has(tokens[0])) tokens.shift();
  return tokens;
}

function isVariant(base: string[], other: string[]): boolean {
  if (!base.length || other.length <= base.length) return false;
  for (let i = 0; i < base.length; i++) if (base[i] !== other[i]) return false;
  return other.slice(base.length).every((t) => SUFFIX_TOKENS.has(t));
}

function isMatch(a: string[], b: string[]): boolean {
  return isVariant(a, b) || isVariant(b, a);
}

function expandProviders(ids: Set<number>, providers: ProviderInfo[]): Set<number> {
  const expanded = new Set(ids);
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of Array.from(expanded)) {
      const base = providers.find((p) => p.provider_id === id);
      if (!base) continue;
      const baseTok = tokenize(base.provider_name);
      for (const p of providers) {
        if (expanded.has(p.provider_id)) continue;
        if (isMatch(baseTok, tokenize(p.provider_name))) {
          expanded.add(p.provider_id);
          changed = true;
        }
      }
    }
  }
  return expanded;
}

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [providerIds, setProviderIds] = useState<Set<number>>(new Set());
  const [countries, setCountries] = useState<string[]>([]);
  const [providerMap, setProviderMap] = useState<Record<number, string>>({});
  const [allProviders, setAllProviders] = useState<ProviderInfo[]>([]);

  const loadConfig = useCallback(async () => {
    const cfg = await configApi.getConfig();
    const providers = await getProviders();
    setAllProviders(providers);
    const map: Record<number, string> = {};
    for (const p of providers) map[p.provider_id] = p.provider_name;
    setProviderMap(map);

    const ids = new Set(cfg.provider_ids || []);
    setProviderIds(expandProviders(ids, providers));
    setCountries(cfg.countries || []);
  }, []);

  const saveConfigFn = useCallback(
    async (ids: number[], ctries: string[]) => {
      await configApi.saveConfig({ provider_ids: ids, countries: ctries });
      const expanded = expandProviders(new Set(ids), allProviders);
      setProviderIds(expanded);
      setCountries(ctries);
    },
    [allProviders]
  );

  const loadProviders = useCallback(async (country?: string) => {
    return getProviders(country);
  }, []);

  const expandedProviderIds = useCallback(() => {
    return expandProviders(providerIds, allProviders);
  }, [providerIds, allProviders]);

  return (
    <ConfigContext.Provider
      value={{
        providerIds,
        countries,
        providerMap,
        allProviders,
        loadConfig,
        saveConfig: saveConfigFn,
        loadProviders,
        expandedProviderIds,
      }}
    >
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error("useConfig must be used within ConfigProvider");
  return ctx;
}
