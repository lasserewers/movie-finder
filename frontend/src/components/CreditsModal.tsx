import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Person, CrewMember } from "../api/movies";

const TMDB_IMG = "https://image.tmdb.org/t/p";

function PersonCircle({ person, role }: { person: { name: string; profile_path?: string }; role?: string }) {
  return (
    <div className="flex flex-col items-center w-[70px] text-center">
      {person.profile_path ? (
        <img
          src={`${TMDB_IMG}/w185${person.profile_path}`}
          alt=""
          className="w-14 h-14 rounded-full object-cover border-2 border-border"
        />
      ) : (
        <div className="w-14 h-14 rounded-full bg-panel-2 border-2 border-border" />
      )}
      <span className="text-[0.7rem] text-text mt-1 leading-tight">{person.name}</span>
      {role && <span className="text-[0.6rem] text-muted leading-tight">{role}</span>}
    </div>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  cast: Person[];
  crew: CrewMember[];
}

export default function CreditsModal({ open, onClose, cast, crew }: Props) {
  const [tab, setTab] = useState<"cast" | "filmmakers" | "crew">("cast");

  const directors = crew.filter((c) => c.job === "Director");
  const writers = crew.filter((c) => ["Writer", "Screenplay", "Story"].includes(c.job));
  const producers = crew.filter((c) => c.job === "Producer" || c.job === "Executive Producer");
  const otherCrew = crew.filter(
    (c) => !["Director", "Writer", "Screenplay", "Story", "Producer", "Executive Producer"].includes(c.job)
  );

  // Deduplicate by id+job
  const dedup = (arr: CrewMember[]) => {
    const seen = new Set<string>();
    return arr.filter((c) => {
      const k = `${c.id}:${c.job}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const tabs: { id: string; label: string }[] = [];
  if (cast.length) tabs.push({ id: "cast", label: "Cast" });
  if (directors.length || writers.length || producers.length) tabs.push({ id: "filmmakers", label: "Filmmakers" });
  if (otherCrew.length) tabs.push({ id: "crew", label: "Additional Crew" });

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[350] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl p-6 w-[min(95vw,700px)] max-h-[86vh] overflow-y-auto"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
          >
            <button
              onClick={onClose}
              className="absolute top-3 right-4 text-muted text-2xl hover:text-text transition-colors"
            >
              &times;
            </button>

            <div className="flex gap-1 border-b border-border pb-2 mb-4 flex-wrap">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as typeof tab)}
                  className={`px-3 py-1.5 text-sm rounded-t-md border border-transparent ${
                    tab === t.id
                      ? "text-text bg-panel-2 border-border"
                      : "text-muted hover:text-text"
                  } transition-colors`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "cast" && (
              <div className="flex flex-wrap gap-3">
                {cast.map((p) => (
                  <PersonCircle key={p.id} person={p} role={p.character} />
                ))}
              </div>
            )}

            {tab === "filmmakers" && (
              <div className="flex flex-col gap-4">
                {directors.length > 0 && (
                  <div>
                    <h4 className="text-xs text-muted uppercase tracking-wider mb-2">
                      Director{directors.length > 1 ? "s" : ""}
                    </h4>
                    <div className="flex flex-wrap gap-3">
                      {directors.map((p) => (
                        <PersonCircle key={p.id} person={p} />
                      ))}
                    </div>
                  </div>
                )}
                {writers.length > 0 && (
                  <div>
                    <h4 className="text-xs text-muted uppercase tracking-wider mb-2">Writers</h4>
                    <div className="flex flex-wrap gap-3">
                      {dedup(writers).map((p) => (
                        <PersonCircle key={`${p.id}-${p.job}`} person={p} role={p.job} />
                      ))}
                    </div>
                  </div>
                )}
                {producers.length > 0 && (
                  <div>
                    <h4 className="text-xs text-muted uppercase tracking-wider mb-2">Producers</h4>
                    <div className="flex flex-wrap gap-3">
                      {dedup(producers).map((p) => (
                        <PersonCircle key={`${p.id}-${p.job}`} person={p} role={p.job} />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === "crew" && (
              <div className="flex flex-wrap gap-3">
                {dedup(otherCrew).map((p) => (
                  <PersonCircle key={`${p.id}-${p.job}`} person={p} role={p.job} />
                ))}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
