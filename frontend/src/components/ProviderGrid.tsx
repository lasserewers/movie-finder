import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CountryProviders, ProviderInfo, StreamingLink } from "../api/movies";
import { useConfig } from "../hooks/useConfig";

const TMDB_IMG = "https://image.tmdb.org/t/p";
const QUALITY_LABELS: Record<string, string> = { uhd: "4K", qhd: "1440p", hd: "HD", sd: "SD" };

function countryFlag(code: string) {
  return String.fromCodePoint(
    ...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)
  );
}

interface DeepLink {
  link?: string;
  quality?: string | number;
  price?: string | number;
  audios?: string[];
  subtitles?: string[];
  expires_on?: number;
}

function normalizeLanguageCode(code: string): string {
  if (!code) return "";
  const normalized = code.trim().replace(/_/g, "-").toUpperCase();
  if (!normalized) return "";
  const [base] = normalized.split("-");
  return base || normalized;
}

function collectProviderMeta(
  name: string,
  countryCode: string,
  type: string,
  streamingLinks: Record<string, StreamingLink[]>
): DeepLink | null {
  const links = streamingLinks[countryCode.toLowerCase()];
  if (!links?.length) return null;
  const normalizeName = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const normName = normalizeName(name);
  const serviceMatches = links.filter((l) => {
    const service = normalizeName(l.service_name || "");
    if (!service || !normName) return false;
    return service === normName || service.includes(normName) || normName.includes(service);
  });

  let offerTypes: string[] = [];
  if (["flatrate", "free", "ads", "stream"].includes(type)) {
    offerTypes = ["subscription", "free", "addon"];
  } else if (type === "rent") {
    offerTypes = ["rent"];
  } else if (type === "buy") {
    offerTypes = ["buy"];
  } else if (type === "rent/buy") {
    offerTypes = ["rent", "buy"];
  } else if (type === "stream + rent/buy") {
    offerTypes = ["subscription", "free", "addon", "rent", "buy"];
  }

  const typedLinks = offerTypes.length
    ? links.filter((l) => offerTypes.includes(l.type))
    : links;
  const typedServiceMatches = offerTypes.length
    ? serviceMatches.filter((l) => offerTypes.includes(l.type))
    : serviceMatches;

  // Prefer same-service matches; fallback to country/type-level language data.
  const matches = typedServiceMatches.length
    ? typedServiceMatches
    : (serviceMatches.length ? serviceMatches : typedLinks);
  if (!matches.length) return null;

  const audios = Array.from(new Set(matches.flatMap((m) => m.audios || []).filter(Boolean)));
  const subtitles = Array.from(new Set(matches.flatMap((m) => m.subtitles || []).filter(Boolean)));
  const firstWithLink = matches.find((m) => m.link);
  const firstWithQuality = matches.find((m) => m.quality);

  return {
    link: firstWithLink?.link,
    quality: firstWithQuality?.quality,
    audios,
    subtitles,
    expires_on: matches.find((m) => m.expires_on)?.expires_on,
  };
}

interface CardProps {
  provider: ProviderInfo & { type: string; isMine: boolean; link?: string };
  countryCode: string;
  streamingLinks: Record<string, StreamingLink[]>;
  isGuest: boolean;
}

function LanguageDropdown({
  audios,
  subtitles,
  compact = false,
}: {
  audios: string[];
  subtitles: string[];
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [panelPos, setPanelPos] = useState({ left: 8, top: 8 });
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const positionPanel = () => {
    const trigger = rootRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;
    const triggerRect = trigger.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    const padding = 8;
    let left = triggerRect.left;
    const maxLeft = window.innerWidth - rect.width - padding;
    if (left > maxLeft) left = maxLeft;
    if (left < padding) left = padding;

    let top = triggerRect.bottom + 6;
    const maxTop = window.innerHeight - rect.height - padding;
    if (top > maxTop) {
      top = Math.max(padding, triggerRect.top - rect.height - 6);
    }
    setPanelPos({ left, top });
  };

  useLayoutEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(positionPanel);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const closeIfOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      const insideTrigger = !!rootRef.current?.contains(target);
      const insidePanel = !!panelRef.current?.contains(target);
      if (!insideTrigger && !insidePanel) {
        setOpen(false);
      }
    };
    const closeOnEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onReposition = () => {
      requestAnimationFrame(positionPanel);
    };
    document.addEventListener("mousedown", closeIfOutside);
    document.addEventListener("touchstart", closeIfOutside);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", closeIfOutside);
      document.removeEventListener("touchstart", closeIfOutside);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className="relative z-[5]"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className={`cursor-pointer select-none inline-flex items-center gap-1 text-muted border border-border rounded-full bg-panel-2 hover:text-text hover:border-accent/40 [&::-webkit-details-marker]:hidden ${
          compact ? "text-[0.62rem] px-1 py-0.5" : "text-[0.55rem] sm:text-[0.6rem] px-1.5 py-0.5"
        }`}
      >
        <span>Lang</span>
        <span aria-hidden="true">{open ? "▴" : "▾"}</span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={`fixed z-[999] rounded-md border border-border bg-panel p-2 shadow-lg ${
            compact ? "min-w-[170px]" : "min-w-[180px]"
          }`}
          style={{
            left: panelPos.left,
            top: panelPos.top,
            maxWidth: "min(240px, calc(100vw - 1rem))",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {audios.length > 0 && (
            <div className="text-[0.65rem] leading-snug">
              <span className="text-muted mr-1">Audio:</span>
              {audios.join(", ")}
            </div>
          )}
          {subtitles.length > 0 && (
            <div className="text-[0.65rem] leading-snug mt-1">
              <span className="text-muted mr-1">Subs:</span>
              {subtitles.join(", ")}
            </div>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

function ProviderCard({ provider, countryCode, streamingLinks, isGuest }: CardProps) {
  const deep = collectProviderMeta(provider.provider_name, countryCode, provider.type, streamingLinks);
  const href = deep?.link || provider.link || "";
  const typeLabel = provider.type === "flatrate" ? "stream" : provider.type;
  const audioFull = Array.from(new Set((deep?.audios || []).map(normalizeLanguageCode).filter(Boolean)));
  const subtitleFull = Array.from(new Set((deep?.subtitles || []).map(normalizeLanguageCode).filter(Boolean)));
  const hasLanguages = audioFull.length > 0 || subtitleFull.length > 0;

  let borderClass = "border-red-500/60 bg-red-500/10"; // other
  if (isGuest) {
    borderClass = "border-border bg-panel-2/60";
  } else if (provider.type === "buy") {
    borderClass = "border-amber-500/60 bg-amber-500/10";
  } else if (provider.type === "rent" || provider.type === "rent/buy") {
    borderClass = "border-yellow-500/60 bg-yellow-500/10";
  } else if (provider.isMine) {
    borderClass = "border-green-500/60 bg-green-500/10";
  }

  const content = (
    <>
      {provider.logo_path && (
        <img src={`${TMDB_IMG}/w92${provider.logo_path}`} alt="" className="w-9 h-9 sm:w-12 sm:h-12 rounded-[10px]" />
      )}
      <span className="text-[0.68rem] sm:text-[0.8rem] leading-tight text-center">{provider.provider_name}</span>
      <span className="text-[0.56rem] sm:text-[0.65rem] text-muted uppercase">{typeLabel}</span>
      {deep?.quality && typeof deep.quality === "string" && QUALITY_LABELS[deep.quality] && (
        <span className="text-[0.55rem] sm:text-[0.6rem] font-bold bg-panel-2 px-1.5 py-0.5 rounded">{QUALITY_LABELS[deep.quality]}</span>
      )}
      {hasLanguages && (
        <LanguageDropdown audios={audioFull} subtitles={subtitleFull} />
      )}
      {(() => {
        if (!deep?.expires_on) return null;
        const days = Math.ceil((deep.expires_on * 1000 - Date.now()) / 86400000);
        if (days <= 0 || days > 30) return null;
        return (
          <span className="text-[0.55rem] sm:text-[0.6rem] font-semibold bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">
            Leaving in {days}d
          </span>
        );
      })()}
    </>
  );

  const cls = `flex flex-col items-center gap-0.5 sm:gap-1 p-2 sm:p-2.5 rounded-lg border ${borderClass} text-center`;

  return (
    <div
      onClick={() => {
        if (!href) return;
        window.open(href, "_blank", "noopener");
      }}
      role={href ? "button" : undefined}
      tabIndex={href ? 0 : undefined}
      onKeyDown={(e) => {
        if (!href) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          window.open(href, "_blank", "noopener");
        }
      }}
      className={`${cls} ${href ? "cursor-pointer hover:opacity-85 transition-opacity" : ""}`}
    >
      {content}
    </div>
  );
}

interface Props {
  providers: Record<string, CountryProviders>;
  streamingLinks: Record<string, StreamingLink[]>;
  countryNameMap: Record<string, string>;
  guestCountry?: string;
}

export default function ProviderGrid({ providers, streamingLinks, countryNameMap, guestCountry }: Props) {
  const { countries: myCountries, providerIds: myProviderIds } = useConfig();

  if (!providers || !Object.keys(providers).length) {
    return <div className="text-center text-muted py-8">No streaming data available for this movie</div>;
  }

  // Guest mode: only show the selected country
  const displayCountries = guestCountry ? [guestCountry] : myCountries;
  const myCountrySet = new Set(displayCountries);

  const buildProviders = (data: CountryProviders, types: string[]) => {
    const result: (ProviderInfo & { type: string; isMine: boolean; link?: string })[] = [];
    for (const type of types) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (!list || !Array.isArray(list)) continue;
      for (const p of list) {
        result.push({ ...p, type, isMine: !guestCountry && myProviderIds.has(p.provider_id), link: data.link });
      }
    }
    return result;
  };

  const buildRentBuy = (data: CountryProviders) => {
    const map = new Map<number, ProviderInfo & { type: string; isMine: boolean; link?: string }>();
    for (const type of ["rent", "buy"]) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (!list || !Array.isArray(list)) continue;
      for (const p of list) {
        if (map.has(p.provider_id)) {
          map.get(p.provider_id)!.type = "rent/buy";
        } else {
          map.set(p.provider_id, { ...p, type, isMine: !guestCountry && myProviderIds.has(p.provider_id), link: data.link });
        }
      }
    }
    return Array.from(map.values());
  };

  const hasAnyAvailability = (data: CountryProviders) => {
    for (const type of ["flatrate", "free", "ads", "rent", "buy"]) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (Array.isArray(list) && list.length > 0) return true;
    }
    return false;
  };

  const buildAnyServiceProviders = (data: CountryProviders) => {
    const map = new Map<number, ProviderInfo & { stream: boolean; rent: boolean; buy: boolean }>();
    for (const type of ["flatrate", "free", "ads", "rent", "buy"]) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (!list || !Array.isArray(list)) continue;
      for (const p of list) {
        const existing = map.get(p.provider_id);
        const target = existing || { ...p, stream: false, rent: false, buy: false };
        if (type === "flatrate" || type === "free" || type === "ads") target.stream = true;
        if (type === "rent") target.rent = true;
        if (type === "buy") target.buy = true;
        map.set(p.provider_id, target);
      }
    }
    return Array.from(map.values()).map((p) => {
      let type = "stream";
      if (p.stream && (p.rent || p.buy)) type = "stream + rent/buy";
      else if (!p.stream && p.rent && p.buy) type = "rent/buy";
      else if (!p.stream && p.rent) type = "rent";
      else if (!p.stream && p.buy) type = "buy";
      return {
        provider_id: p.provider_id,
        provider_name: p.provider_name,
        logo_path: p.logo_path,
        type,
      };
    });
  };

  // Other countries where my services have it (skip in guest mode)
  const otherMyRows: { country: string; providers: (ProviderInfo & { type: string })[] }[] = [];
  if (!guestCountry) {
    for (const [country, data] of Object.entries(providers)) {
      if (myCountrySet.has(country)) continue;
      const myServicesMap = new Map<number, ProviderInfo & { type: string }>();
      for (const type of ["flatrate", "free", "ads"]) {
        const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
        if (!list || !Array.isArray(list)) continue;
        for (const p of list) {
          if (!myProviderIds.has(p.provider_id)) continue;
          if (!myServicesMap.has(p.provider_id)) {
            myServicesMap.set(p.provider_id, { ...p, type: "stream" });
          }
        }
      }
      const myServices = Array.from(myServicesMap.values());
      if (myServices.length) otherMyRows.push({ country, providers: myServices });
    }
  }

  // Other countries where this title is available on any service (stream/rent/buy)
  const otherAvailableCountries = Object.entries(providers)
    .filter(([country, data]) => !myCountrySet.has(country) && hasAnyAvailability(data))
    .map(([country]) => country)
    .sort((a, b) => a.localeCompare(b));

  const otherAvailableRows = otherAvailableCountries.map((country) => ({
    country,
    providers: buildAnyServiceProviders(providers[country]).sort((a, b) =>
      a.provider_name.localeCompare(b.provider_name)
    ),
  }));

  return (
    <div>
      {displayCountries.map((code) => {
        const data = providers[code];
        if (!data) {
          return (
            <div key={code} className="text-red-400 text-sm mb-3">
              Not available in {countryFlag(code)} {countryNameMap[code] || code}
            </div>
          );
        }
        const streaming = buildProviders(data, ["flatrate", "free", "ads"]);
        const rentBuy = buildRentBuy(data);
        streaming.sort((a, b) => (b.isMine ? 1 : 0) - (a.isMine ? 1 : 0));

        return (
          <div key={code} className="mb-4">
            <h3 className="text-sm sm:text-base font-semibold mb-2">
              Available in {countryFlag(code)} {countryNameMap[code] || code}
            </h3>
            {streaming.length > 0 && (
              <>
                <h4 className="text-xs text-muted uppercase tracking-wider mb-2 mt-3">Stream</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(102px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1.5 sm:gap-2 mb-3">
                  {streaming.map((p, i) => (
                    <ProviderCard key={`${p.provider_id}-${i}`} provider={p} countryCode={code} streamingLinks={streamingLinks} isGuest={!!guestCountry} />
                  ))}
                </div>
              </>
            )}
            {rentBuy.length > 0 && (
              <>
                <h4 className="text-xs text-muted uppercase tracking-wider mb-2 mt-3">Rent / Buy</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(102px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1.5 sm:gap-2 mb-3">
                  {rentBuy.map((p, i) => (
                    <ProviderCard key={`${p.provider_id}-${i}`} provider={p} countryCode={code} streamingLinks={streamingLinks} isGuest={!!guestCountry} />
                  ))}
                </div>
              </>
            )}
            {!streaming.length && !rentBuy.length && (
              <div className="text-sm text-muted">No streaming data for this country</div>
            )}
          </div>
        );
      })}

      {otherMyRows.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-muted mb-2">
            Streamable on my services in {otherMyRows.length} other{" "}
            {otherMyRows.length === 1 ? "country" : "countries"}
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-muted text-sm font-semibold px-3 py-2 border-b border-white/5">Country</th>
                  <th className="text-left text-muted text-sm font-semibold px-3 py-2 border-b border-white/5">Available On</th>
                </tr>
              </thead>
              <tbody>
                {otherMyRows.sort((a, b) => a.country.localeCompare(b.country)).map((row) => (
                  <tr key={row.country}>
                    <td className="px-3 py-2 text-sm border-b border-white/5">
                      {countryFlag(row.country)} {countryNameMap[row.country] || row.country}
                    </td>
                    <td className="px-3 py-2 border-b border-white/5">
                      <div className="flex flex-wrap gap-1">
                        {row.providers.map((p) => {
                          const deep = collectProviderMeta(p.provider_name, row.country, p.type, streamingLinks);
                          const audioFull = Array.from(new Set((deep?.audios || []).map(normalizeLanguageCode).filter(Boolean)));
                          const subtitleFull = Array.from(new Set((deep?.subtitles || []).map(normalizeLanguageCode).filter(Boolean)));
                          const hasLanguages = audioFull.length > 0 || subtitleFull.length > 0;
                          return (
                            <div
                              key={`${row.country}-${p.provider_id}`}
                              onClick={() => {
                                if (!deep?.link) return;
                                window.open(deep.link, "_blank", "noopener");
                              }}
                              role={deep?.link ? "button" : undefined}
                              tabIndex={deep?.link ? 0 : undefined}
                              onKeyDown={(e) => {
                                if (!deep?.link) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  window.open(deep.link, "_blank", "noopener");
                                }
                              }}
                              className={`inline-flex items-center gap-1 bg-green-500/10 border border-green-500/40 rounded px-2 py-0.5 text-xs ${
                                deep?.link ? "cursor-pointer hover:bg-green-500/15" : ""
                              }`}
                            >
                              {p.logo_path && (
                                <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="" className="w-5 h-5 rounded" />
                              )}
                              <span>{p.provider_name}</span>
                              {hasLanguages && (
                                <LanguageDropdown audios={audioFull} subtitles={subtitleFull} compact />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {otherAvailableRows.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm text-muted mb-2">
            Available in {otherAvailableRows.length} other{" "}
            {otherAvailableRows.length === 1 ? "country" : "countries"} (any service)
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-muted text-sm font-semibold px-3 py-2 border-b border-white/5">Country</th>
                  <th className="text-left text-muted text-sm font-semibold px-3 py-2 border-b border-white/5">Available On</th>
                </tr>
              </thead>
              <tbody>
                {otherAvailableRows.map((row) => (
                  <tr key={row.country}>
                    <td className="px-3 py-2 text-sm border-b border-white/5">
                      {countryFlag(row.country)} {countryNameMap[row.country] || row.country}
                    </td>
                    <td className="px-3 py-2 border-b border-white/5">
                      <div className="flex flex-wrap gap-1">
                        {row.providers.map((p) => {
                          const deep = collectProviderMeta(p.provider_name, row.country, p.type, streamingLinks);
                          const audioFull = Array.from(new Set((deep?.audios || []).map(normalizeLanguageCode).filter(Boolean)));
                          const subtitleFull = Array.from(new Set((deep?.subtitles || []).map(normalizeLanguageCode).filter(Boolean)));
                          const hasLanguages = audioFull.length > 0 || subtitleFull.length > 0;
                          return (
                            <div
                              key={`${row.country}-${p.provider_id}`}
                              onClick={() => {
                                if (!deep?.link) return;
                                window.open(deep.link, "_blank", "noopener");
                              }}
                              role={deep?.link ? "button" : undefined}
                              tabIndex={deep?.link ? 0 : undefined}
                              onKeyDown={(e) => {
                                if (!deep?.link) return;
                                if (e.key === "Enter" || e.key === " ") {
                                  e.preventDefault();
                                  window.open(deep.link, "_blank", "noopener");
                                }
                              }}
                              className={`inline-flex items-center gap-1.5 bg-panel-2 border border-border rounded px-2 py-0.5 text-xs ${
                                deep?.link ? "cursor-pointer hover:bg-white/5" : ""
                              }`}
                            >
                              {p.logo_path && (
                                <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="" className="w-5 h-5 rounded" />
                              )}
                              <span>{p.provider_name}</span>
                              <span className="text-[0.62rem] uppercase text-muted">{p.type}</span>
                              {hasLanguages && (
                                <LanguageDropdown audios={audioFull} subtitles={subtitleFull} compact />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}
