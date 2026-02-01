export default function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-7 h-7 rounded-full border-3 border-accent/20 border-t-accent animate-spin ${className}`}
    />
  );
}
