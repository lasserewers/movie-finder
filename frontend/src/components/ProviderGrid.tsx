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
  quality?: string;
  price?: string;
  audios?: string[];
  expires_on?: number;
}

function findDeepLink(
  name: string,
  countryCode: string,
  type: string,
  streamingLinks: Record<string, StreamingLink[]>
): DeepLink | null {
  const links = streamingLinks[countryCode.toLowerCase()];
  if (!links) return null;
  const norm = name.toLowerCase();
  for (const l of links) {
    if (l.service_name.toLowerCase() !== norm) continue;
    if (["flatrate", "free", "ads"].includes(type) && ["subscription", "free", "addon"].includes(l.type))
      return l;
    if ((type === "rent" || type === "buy" || type === "rent/buy") && (l.type === "rent" || l.type === "buy"))
      return l;
  }
  for (const l of links) {
    if (l.service_name.toLowerCase() === norm) return l;
  }
  return null;
}

interface CardProps {
  provider: ProviderInfo & { type: string; isMine: boolean; link?: string };
  countryCode: string;
  streamingLinks: Record<string, StreamingLink[]>;
}

function ProviderCard({ provider, countryCode, streamingLinks }: CardProps) {
  const deep = findDeepLink(provider.provider_name, countryCode, provider.type, streamingLinks);
  const href = deep?.link || provider.link || "";
  const typeLabel = provider.type === "flatrate" ? "stream" : provider.type;

  let borderClass = "border-red-500/60 bg-red-500/10"; // other
  if (provider.type === "buy") borderClass = "border-amber-500/60 bg-amber-500/10";
  else if (provider.type === "rent" || provider.type === "rent/buy") borderClass = "border-yellow-500/60 bg-yellow-500/10";
  else if (provider.isMine) borderClass = "border-green-500/60 bg-green-500/10";

  const content = (
    <>
      {provider.logo_path && (
        <img src={`${TMDB_IMG}/w92${provider.logo_path}`} alt="" className="w-12 h-12 rounded-[10px]" />
      )}
      <span className="text-[0.8rem] leading-tight text-center">{provider.provider_name}</span>
      <span className="text-[0.65rem] text-muted uppercase">{typeLabel}</span>
      {deep?.quality && QUALITY_LABELS[deep.quality] && (
        <span className="text-[0.6rem] font-bold bg-panel-2 px-1.5 py-0.5 rounded">{QUALITY_LABELS[deep.quality]}</span>
      )}
      {deep?.price && <span className="text-[0.7rem] font-semibold text-yellow-400">{deep.price}</span>}
      {deep?.expires_on && (() => {
        const days = Math.ceil((deep.expires_on * 1000 - Date.now()) / 86400000);
        return days > 0 && days <= 30 ? (
          <span className="text-[0.6rem] font-semibold bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded">
            Leaving in {days}d
          </span>
        ) : null;
      })()}
    </>
  );

  const cls = `flex flex-col items-center gap-1 p-2.5 rounded-lg border ${borderClass} text-center`;

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener" className={`${cls} no-underline text-inherit hover:opacity-85 transition-opacity`}>
        {content}
      </a>
    );
  }
  return <div className={cls}>{content}</div>;
}

interface Props {
  providers: Record<string, CountryProviders>;
  streamingLinks: Record<string, StreamingLink[]>;
  countryNameMap: Record<string, string>;
}

export default function ProviderGrid({ providers, streamingLinks, countryNameMap }: Props) {
  const { countries: myCountries, providerIds: myProviderIds } = useConfig();

  if (!providers || !Object.keys(providers).length) {
    return <div className="text-center text-muted py-8">No streaming data available for this movie</div>;
  }

  const myCountrySet = new Set(myCountries);

  const buildProviders = (data: CountryProviders, types: string[]) => {
    const result: (ProviderInfo & { type: string; isMine: boolean; link?: string })[] = [];
    for (const type of types) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (!list || !Array.isArray(list)) continue;
      for (const p of list) {
        result.push({ ...p, type, isMine: myProviderIds.has(p.provider_id), link: data.link });
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
          map.set(p.provider_id, { ...p, type, isMine: myProviderIds.has(p.provider_id), link: data.link });
        }
      }
    }
    return Array.from(map.values());
  };

  // Other countries where my services have it
  const otherMyRows: { country: string; providers: ProviderInfo[] }[] = [];
  for (const [country, data] of Object.entries(providers)) {
    if (myCountrySet.has(country)) continue;
    const myServices: ProviderInfo[] = [];
    for (const type of ["flatrate", "free", "ads"]) {
      const list = data[type as keyof CountryProviders] as ProviderInfo[] | undefined;
      if (!list || !Array.isArray(list)) continue;
      for (const p of list) {
        if (myProviderIds.has(p.provider_id)) myServices.push({ ...p });
      }
    }
    if (myServices.length) otherMyRows.push({ country, providers: myServices });
  }

  return (
    <div>
      {myCountries.map((code) => {
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
            <h3 className="text-base font-semibold mb-2">
              Available in {countryFlag(code)} {countryNameMap[code] || code}
            </h3>
            {streaming.length > 0 && (
              <>
                <h4 className="text-xs text-muted uppercase tracking-wider mb-2 mt-3">Stream</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 mb-3">
                  {streaming.map((p, i) => (
                    <ProviderCard key={`${p.provider_id}-${i}`} provider={p} countryCode={code} streamingLinks={streamingLinks} />
                  ))}
                </div>
              </>
            )}
            {rentBuy.length > 0 && (
              <>
                <h4 className="text-xs text-muted uppercase tracking-wider mb-2 mt-3">Rent / Buy</h4>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2 mb-3">
                  {rentBuy.map((p, i) => (
                    <ProviderCard key={`${p.provider_id}-${i}`} provider={p} countryCode={code} streamingLinks={streamingLinks} />
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
            Available on your services in {otherMyRows.length} other{" "}
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
                        {row.providers.map((p, i) => (
                          <span
                            key={i}
                            className="inline-flex items-center gap-1 bg-green-500/10 border border-green-500/40 rounded px-2 py-0.5 text-xs"
                          >
                            {p.logo_path && (
                              <img src={`${TMDB_IMG}/w45${p.logo_path}`} alt="" className="w-5 h-5 rounded" />
                            )}
                            {p.provider_name}
                          </span>
                        ))}
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
