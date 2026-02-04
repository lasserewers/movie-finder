import { memo } from "react";
import { motion } from "framer-motion";

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
  const src = posterUrl || (posterPath ? `${TMDB_IMG}/w185${posterPath}` : "");
  const year = releaseDate?.slice(0, 4) || "";

  return (
    <motion.div
      className={`flex flex-col gap-1.5 cursor-pointer snap-start ${fill ? "w-full" : "w-[112px] min-[430px]:w-[126px] sm:w-[180px] flex-shrink-0"}`}
      whileHover={{ y: -4, scale: 1.02, transition: { duration: 0.15 } }}
      onClick={() => onClick(id, mediaType)}
    >
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
      </div>
      <span className="text-[0.78rem] sm:text-[0.85rem] text-text leading-tight line-clamp-2">{title}</span>
      <span className="text-[0.68rem] sm:text-xs text-muted">{year}</span>
    </motion.div>
  );
}

export default memo(MovieCard);
