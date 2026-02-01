import { useState, useRef, useEffect } from "react";
import type { Region } from "../api/movies";

function countryFlag(code: string) {
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

interface Props {
  countries: string[];
  regions: Region[];
  countryNameMap: Record<string, string>;
  onAdd: (code: string) => void;
  onRemove: (code: string) => void;
}

export default function CountryPicker({ countries, regions, countryNameMap, onAdd, onRemove }: Props) {
  const [query, setQuery] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node))
        setDropdownOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const filtered = regions.filter(
    (r) =>
      !countries.includes(r.iso_3166_1) &&
      (r.english_name.toLowerCase().includes(query.toLowerCase()) ||
        r.iso_3166_1.toLowerCase().includes(query.toLowerCase()))
  );

  return (
    <div className="flex items-center flex-wrap gap-1.5">
      {countries.map((code) => (
        <span
          key={code}
          className="inline-flex items-center gap-1 bg-panel border border-border rounded-2xl px-2 py-0.5 text-sm"
        >
          {countryFlag(code)} {countryNameMap[code] || code}
          <button
            onClick={() => onRemove(code)}
            className="text-muted hover:text-accent text-base leading-none ml-0.5"
          >
            &times;
          </button>
        </span>
      ))}
      <div ref={wrapperRef} className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setDropdownOpen(true);
          }}
          onFocus={() => setDropdownOpen(true)}
          placeholder="Add country..."
          className="px-2.5 py-1.5 text-sm border border-border rounded-md bg-panel text-text outline-none focus:border-accent-2 w-40"
        />
        {dropdownOpen && filtered.length > 0 && (
          <div className="absolute top-full left-0 right-0 bg-panel border border-border rounded-b-md max-h-[200px] overflow-y-auto z-[200] shadow-xl">
            {filtered.map((r) => (
              <div
                key={r.iso_3166_1}
                onClick={() => {
                  onAdd(r.iso_3166_1);
                  setQuery("");
                  setDropdownOpen(false);
                }}
                className="px-2.5 py-1.5 text-sm cursor-pointer hover:bg-white/5"
              >
                {countryFlag(r.iso_3166_1)} {r.english_name}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
