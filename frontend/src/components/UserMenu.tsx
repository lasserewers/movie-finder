import { useState, useRef, useEffect } from "react";
import { useAuth } from "../hooks/useAuth";

export default function UserMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  if (!user) return null;

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="px-4 py-2 border border-border rounded-full font-semibold text-sm text-text hover:border-accent-2 transition-colors truncate max-w-[200px]"
      >
        {user.email}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-2 bg-panel border border-border rounded-xl shadow-2xl py-1 min-w-[160px] z-50">
          <button
            onClick={async () => {
              await logout();
              window.location.reload();
            }}
            className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/5 transition-colors text-muted hover:text-text"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
