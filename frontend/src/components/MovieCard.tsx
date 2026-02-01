import { motion } from "framer-motion";

const TMDB_IMG = "https://image.tmdb.org/t/p";

interface Props {
  id: number;
  title: string;
  posterPath?: string;
  posterUrl?: string;
  releaseDate?: string;
  onClick: (id: number) => void;
  index?: number;
  fill?: boolean;
}

export default function MovieCard({
  id,
  title,
  posterPath,
  posterUrl,
  releaseDate,
  onClick,
  index = 0,
  fill = false,
}: Props) {
  const src = posterUrl || (posterPath ? `${TMDB_IMG}/w300${posterPath}` : "");
  const year = releaseDate?.slice(0, 4) || "";

  return (
    <motion.div
      className={`flex flex-col gap-1.5 cursor-pointer snap-start ${fill ? "w-full" : "w-[160px] sm:w-[180px] flex-shrink-0"}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03, duration: 0.3 }}
      whileHover={{ y: -4, scale: 1.02 }}
      onClick={() => onClick(id)}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          className="w-full aspect-[2/3] rounded-xl object-cover bg-panel-2 border border-white/5"
        />
      ) : (
        <div className="w-full aspect-[2/3] rounded-xl bg-panel-2 border border-white/5" />
      )}
      <span className="text-[0.85rem] text-text leading-tight line-clamp-2">{title}</span>
      <span className="text-xs text-muted">{year}</span>
    </motion.div>
  );
}
