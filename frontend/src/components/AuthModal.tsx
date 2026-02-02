import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../hooks/useAuth";
import { ApiError } from "../api/client";

interface Props {
  open: boolean;
  onClose?: () => void;
  onSignupComplete?: () => void;
}

export default function AuthModal({ open, onClose, onSignupComplete }: Props) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (mode === "signup" && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      if (mode === "signup") {
        await signup(email, password);
        onClose?.();
        onSignupComplete?.();
      } else {
        await login(email, password);
        onClose?.();
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === "login" ? "signup" : "login");
    setError("");
    setConfirmPassword("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[340] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => e.target === e.currentTarget && onClose?.()}
        >
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => onClose?.()} />
          <motion.div
            className="relative bg-panel border border-border rounded-2xl p-8 w-[min(92vw,400px)]"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => onClose?.()}
              className="absolute top-4 right-4 w-9 h-9 rounded-full border border-border text-text text-xl flex items-center justify-center hover:border-accent-2 transition-colors"
            >
              &times;
            </button>
            <div className="flex justify-center mb-4">
              <img src="/logo.svg" alt="FullStreamer" className="h-12" />
            </div>
            <h3 className="font-display text-2xl mb-5 text-center">
              {mode === "login" ? "Log in" : "Sign up"}
            </h3>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  className="px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted">Password</label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  className="px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors"
                />
              </div>
              {mode === "signup" && (
                <div className="flex flex-col gap-1">
                  <label className="text-sm text-muted">Confirm password</label>
                  <input
                    type="password"
                    required
                    minLength={8}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="px-3 py-2.5 text-sm border border-border rounded-lg bg-bg-2 text-text outline-none focus:border-accent-2 transition-colors"
                  />
                </div>
              )}
              {error && (
                <div className="text-sm text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 font-semibold rounded-lg bg-accent text-white hover:bg-accent/85 transition-colors disabled:opacity-50"
              >
                {loading ? "..." : mode === "login" ? "Log in" : "Sign up"}
              </button>
            </form>
            <p className="text-center mt-4 text-sm text-muted">
              {mode === "login" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button onClick={switchMode} className="text-accent-2 underline cursor-pointer">
                {mode === "login" ? "Sign up" : "Log in"}
              </button>
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
