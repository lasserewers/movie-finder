import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api/client";
import { confirmSignupEmail } from "./api/auth";

const SIGNUP_ONBOARDING_STORAGE_KEY = "signup_onboarding_pending";

function readTokenFromQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get("token")?.trim() || "";
  } catch {
    return "";
  }
}

type Status = "idle" | "loading" | "success" | "error";

export default function ConfirmSignupEmailApp() {
  const [token] = useState(readTokenFromQuery);
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState("");

  const hasToken = useMemo(() => token.length >= 16, [token]);

  useEffect(() => {
    if (!hasToken) {
      setStatus("error");
      setMessage("Missing or invalid confirmation token.");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setMessage("");
    confirmSignupEmail(token)
      .then((user) => {
        if (cancelled) return;
        setStatus("success");
        if (user.is_active === false) {
          setMessage("Your email is confirmed, but this account is currently disabled.");
          return;
        }
        try {
          localStorage.setItem(SIGNUP_ONBOARDING_STORAGE_KEY, "1");
        } catch {
          // Ignore localStorage write failures.
        }
        setMessage("Thanks for confirming your email. Your account is ready to continue setup.");
      })
      .catch((err) => {
        if (cancelled) return;
        const apiError = err as ApiError;
        setStatus("error");
        setMessage(apiError.message || "Could not confirm this signup email link.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, hasToken]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel/95 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl">Email Confirmation</h1>
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

        {status === "loading" && <p className="text-sm text-muted">Confirming your email...</p>}
        {status === "success" && (
          <div className="space-y-3">
            <p className="text-sm text-green-300">{message}</p>
            <p className="text-sm text-muted">
              You can return to the page where you started signing up and continue from there.
            </p>
          </div>
        )}
        {status === "error" && <p className="text-sm text-red-300">{message}</p>}

        <button
          type="button"
          onClick={() => {
            window.location.href = "/";
          }}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90"
        >
          Continue setting up your account
        </button>
      </div>
    </div>
  );
}
