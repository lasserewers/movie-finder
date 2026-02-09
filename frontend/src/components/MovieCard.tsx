import { memo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { IOS_BRAVE } from "../utils/platform";
import { useAuth } from "../hooks/useAuth";
import { useWatchlist } from "../hooks/useWatchlist";
import { ApiError } from "../api/client";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  id: number;
  title: string;
  posterPath?: string;
  posterUrl?: string;
  releaseDate?: string;
  onClick: (id: number, mediaType?: "movie" | "tv") => void;
  index?: number;
  fill?: boolean;
  mediaType?: "movie" | "tv";
}

function MovieCard({
  id,
  title,
  posterPath,
  posterUrl,
  releaseDate,
  onClick,
  index = 0,
  fill = false,
  mediaType,
}: Props) {
  const { user } = useAuth();
  const { isInWatchlist, toggle } = useWatchlist();
  const [watchlistBusy, setWatchlistBusy] = useState(false);
  const [watchlistErr, setWatchlistErr] = useState("");
  const mediaTypeSafe = mediaType === "tv" ? "tv" : "movie";
  const watchlisted = user ? isInWatchlist(mediaTypeSafe, id) : false;
  const src = posterUrl || (posterPath ? `${TMDB_IMG}/w185${posterPath}` : "");
  const year = releaseDate?.slice(0, 4) || "";
  const className = `flex flex-col gap-1.5 cursor-pointer snap-start ${fill ? "w-full" : "w-[112px] min-[430px]:w-[126px] sm:w-[180px] flex-shrink-0"}`;

  useEffect(() => {
    if (!watchlistErr) return;
    const timeoutId = window.setTimeout(() => setWatchlistErr(""), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [watchlistErr]);

  const toggleWatchlist = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (!user || watchlistBusy) return;
    setWatchlistBusy(true);
    setWatchlistErr("");
    try {
      await toggle({
        tmdb_id: id,
        media_type: mediaTypeSafe,
        title,
        poster_path: posterPath,
        release_date: releaseDate,
      });
    } catch (err) {
      const e = err as ApiError;
      console.error("Watchlist toggle failed", e.message || err);
      setWatchlistErr(
        err instanceof ApiError
          ? e.status === 401
            ? "Please log in again."
            : e.message || "Could not update watchlist."
          : "Could not update watchlist."
      );
    } finally {
      setWatchlistBusy(false);
    }
  };
  const content = (
    <>
      <div className="relative">
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
        {mediaType === "tv" && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[0.6rem] font-semibold uppercase bg-accent/90 text-white rounded">
            TV
          </span>
        )}
        {user && (
          <button
            type="button"
            onClick={toggleWatchlist}
            disabled={watchlistBusy}
            aria-label={watchlisted ? "Remove from watchlist" : "Add to watchlist"}
            title={watchlisted ? "Remove from watchlist" : "Add to watchlist"}
            className={`absolute top-1.5 right-1.5 w-7 h-7 rounded-full border flex items-center justify-center backdrop-blur-md transition-colors ${
              watchlisted
                ? "border-accent/70 bg-accent/85 text-white"
                : "border-white/35 bg-black/45 text-white/90 hover:border-accent-2"
            } disabled:opacity-55 disabled:cursor-not-allowed`}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill={watchlisted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2.1"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        )}
      </div>
      <span className="text-[0.78rem] sm:text-[0.85rem] text-text leading-tight line-clamp-2">{title}</span>
      <span className="text-[0.68rem] sm:text-xs text-muted">{year}</span>
      {watchlistErr && <span className="text-[0.64rem] text-red-300 leading-tight line-clamp-2">{watchlistErr}</span>}
    </>
  );

  if (IOS_BRAVE) {
    return (
      <div className={className} onClick={() => onClick(id, mediaType)}>
        {content}
      </div>
    );
  }

  return (
    <motion.div
      className={className}
      whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.15 } }}
      onClick={() => onClick(id, mediaType)}
    >
      {content}
    </motion.div>
  );
}

export default memo(MovieCard);
