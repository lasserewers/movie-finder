import { FormEvent, useMemo, useState } from "react";
import { ApiError } from "./api/client";
import { forgotPassword, resetPassword } from "./api/auth";

function readTokenFromQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get("token")?.trim() || "";
  } catch {
    return "";
  }
}

export default function ResetPasswordApp() {
  const [token] = useState(readTokenFromQuery);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const mode = useMemo(() => (token ? "reset" : "request"), [token]);

  const onRequestSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      await forgotPassword(email);
      setSuccess("If that email exists, a reset link has been sent.");
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to send reset email.");
    } finally {
      setLoading(false);
    }
  };

  const onResetSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await resetPassword(token, password);
      setSuccess("Password updated. You can now log in with your new password.");
      setPassword("");
      setConfirmPassword("");
    } catch (err) {
      const apiError = err as ApiError;
      setError(apiError.message || "Failed to reset password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel/95 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl">
            {mode === "reset" ? "Set New Password" : "Forgot Password"}
          </h1>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            className="text-sm text-muted hover:text-text"
          >
            Back
          </button>
        </div>

        {mode === "request" ? (
          <form onSubmit={onRequestSubmit} className="space-y-3">
            <p className="text-sm text-muted">
              Enter your account email and we will send you a password reset link.
            </p>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              placeholder="Email"
              className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
            {error && <p className="text-sm text-red-300">{error}</p>}
            {success && <p className="text-sm text-green-300">{success}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </form>
        ) : success ? (
          <div className="space-y-3">
            <p className="text-sm text-green-300">{success}</p>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90"
            >
              Take me to log in
            </button>
          </div>
        ) : (
          <form onSubmit={onResetSubmit} className="space-y-3">
            <p className="text-sm text-muted">
              Enter your new password below.
            </p>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="New password"
              className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
            <input
              type="password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              placeholder="Confirm new password"
              className="w-full rounded-lg border border-border bg-panel-2 px-3 py-2.5 text-sm outline-none focus:border-accent"
            />
            {error && <p className="text-sm text-red-300">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90 disabled:opacity-60"
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
