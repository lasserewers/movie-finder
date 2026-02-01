export function SkeletonCard() {
  return (
    <div className="flex flex-col gap-2 animate-pulse w-[160px] sm:w-[180px] flex-shrink-0">
      <div className="w-full aspect-[2/3] rounded-xl bg-panel-2" />
      <div className="h-3 w-3/4 rounded bg-panel-2" />
      <div className="h-2.5 w-1/3 rounded bg-panel-2" />
    </div>
  );
}

export function SkeletonRow() {
  return (
    <div>
      <div className="h-5 w-40 rounded bg-panel-2 mb-4 animate-pulse" />
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 8 }).map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    </div>
  );
}
