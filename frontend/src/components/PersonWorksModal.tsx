import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getPersonWorks, type PersonSummary, type PersonWork } from "../api/movies";
import Spinner from "./Spinner";

const TMDB_IMG = "https://image.tmdb.org/t/p";

type WorkTab = "all" | "movie" | "tv";
const ALL_ROLES_TAB_ID = "__all_roles__";

const ROLE_PRIORITY: Record<string, number> = {
  Actor: 0,
  Director: 1,
  Producer: 2,
  Writer: 3,
  Creator: 4,
  Composer: 5,
  Cinematographer: 6,
  Editor: 7,
  Self: 8,
  Other: 9,
};

function roleSort(a: string, b: string) {
  const pa = ROLE_PRIORITY[a] ?? 50;
  const pb = ROLE_PRIORITY[b] ?? 50;
  if (pa !== pb) return pa - pb;
  return a.localeCompare(b);
}

interface Props {
  open: boolean;
  personId: number | null;
  onClose: () => void;
  onSelectWork?: (id: number, mediaType: "movie" | "tv") => void;
}

function WorkCard({
  work,
  onSelect,
}: {
  work: PersonWork;
  onSelect?: (id: number, mediaType: "movie" | "tv") => void;
}) {
  const src = work.poster_path ? `${TMDB_IMG}/w185${work.poster_path}` : "";
  const year = work.release_date?.slice(0, 4) || "";
  const clickable = !!onSelect;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(work.id, work.media_type)}
      disabled={!clickable}
      className={`flex flex-col items-start gap-1.5 text-left ${clickable ? "cursor-pointer group" : "cursor-default"}`}
    >
      <div className="relative w-full">
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            className="w-full aspect-[2/3] rounded-xl object-cover bg-panel-2 border border-white/5"
          />
        ) : (
          <div className="w-full aspect-[2/3] rounded-xl bg-panel-2 border border-white/5" />
        )}
        {work.media_type === "tv" && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase bg-accent/90 text-white rounded">
            TV
          </span>
        )}
      </div>
      <span className="text-[0.78rem] sm:text-[0.85rem] text-text leading-tight line-clamp-2">
        {work.title}
      </span>
      <span className="text-[0.68rem] sm:text-xs text-muted">
        {year}
        {work.role_summary ? ` • ${work.role_summary}` : ""}
      </span>
    </button>
  );
}

export default function PersonWorksModal({ open, personId, onClose, onSelectWork }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [person, setPerson] = useState<PersonSummary | null>(null);
  const [works, setWorks] = useState<PersonWork[]>([]);
  const [tab, setTab] = useState<WorkTab>("all");
  const [roleTab, setRoleTab] = useState<string>(ALL_ROLES_TAB_ID);

  useEffect(() => {
    if (!open || !personId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    setPerson(null);
    setWorks([]);
    setTab("all");
    setRoleTab(ALL_ROLES_TAB_ID);

    getPersonWorks(personId)
      .then((data) => {
        if (cancelled) return;
        setPerson(data.person || null);
        setWorks(data.works || []);
      })
      .catch(() => {
        if (cancelled) return;
        setError("Could not load this person's credits.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, personId]);

  const filteredWorks = useMemo(() => {
    if (tab === "all") return works;
    return works.filter((w) => w.media_type === tab);
  }, [works, tab]);

  const mediaTabs: { id: WorkTab; label: string }[] = [
    { id: "all", label: "All" },
    { id: "movie", label: "Movies" },
    { id: "tv", label: "TV" },
  ];

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const work of filteredWorks) {
      const categories = work.role_categories || [];
      const unique = new Set(categories);
      for (const category of unique) {
        counts.set(category, (counts.get(category) || 0) + 1);
      }
    }
    return counts;
  }, [filteredWorks]);

  const roleTabs = useMemo(() => {
    const entries = Array.from(roleCounts.entries())
      .filter(([, count]) => count > 0)
      .sort((a, b) => roleSort(a[0], b[0]));
    return [
      { id: ALL_ROLES_TAB_ID, label: "All Roles" },
      ...entries.map(([role]) => ({ id: role, label: role })),
    ];
  }, [roleCounts]);

  useEffect(() => {
    if (!roleTabs.some((t) => t.id === roleTab)) {
      setRoleTab(ALL_ROLES_TAB_ID);
    }
  }, [roleTabs, roleTab]);

  const roleFilteredWorks = useMemo(() => {
    if (roleTab === ALL_ROLES_TAB_ID) return filteredWorks;
    return filteredWorks.filter((work) => (work.role_categories || []).includes(roleTab));
  }, [filteredWorks, roleTab]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[380] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl w-[min(95vw,900px)] max-h-[86vh] flex flex-col"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
          >
            <div className="flex items-start justify-between p-6 pb-4 border-b border-white/5">
              <div className="min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  {person?.profile_path ? (
                    <img
                      src={`${TMDB_IMG}/w185${person.profile_path}`}
                      alt=""
                      className="w-12 h-12 rounded-full object-cover border-2 border-border"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-panel-2 border-2 border-border" />
                  )}
                  <div className="min-w-0">
                    <h3 className="font-display text-xl leading-tight truncate">
                      {person?.name || "Filmography"}
                    </h3>
                    {person?.known_for_department && (
                      <p className="text-xs text-muted">{person.known_for_department}</p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {mediaTabs.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTab(t.id)}
                      className={`px-3 py-1.5 text-sm rounded-t-md border ${
                        tab === t.id
                          ? "text-text bg-panel-2 border-border border-b-transparent"
                          : "text-muted border-transparent hover:text-text"
                      } transition-colors`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                {roleTabs.length > 1 && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <div className="flex gap-1 flex-wrap">
                      {roleTabs.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setRoleTab(t.id)}
                          className={`px-3 py-1.5 text-sm rounded-t-md border ${
                            roleTab === t.id
                              ? "text-text bg-panel-2 border-border border-b-transparent"
                              : "text-muted border-transparent hover:text-text"
                          } transition-colors`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors flex-shrink-0"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 pt-5">
              {loading && (
                <div className="flex justify-center py-16">
                  <Spinner />
                </div>
              )}
              {!loading && error && (
                <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              {!loading && !error && roleFilteredWorks.length === 0 && (
                <div className="text-sm text-muted py-8">No titles found for this person.</div>
              )}
              {!loading && !error && roleFilteredWorks.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(100px,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 sm:gap-4">
                  {roleFilteredWorks.map((work) => (
                    <WorkCard
                      key={`${work.media_type}:${work.id}`}
                      work={work}
                      onSelect={onSelectWork}
                    />
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
