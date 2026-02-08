import { useEffect, useMemo, useState } from "react";
import { ApiError } from "./api/client";
import { confirmEmailChange } from "./api/auth";

function readTokenFromQuery(): string {
  try {
    return new URLSearchParams(window.location.search).get("token")?.trim() || "";
  } catch {
    return "";
  }
}

type Status = "idle" | "loading" | "success" | "error";

export default function ConfirmEmailApp() {
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
    confirmEmailChange(token)
      .then((result) => {
        if (cancelled) return;
        setStatus("success");
        setMessage(`Email updated to ${result.email}.`);
      })
      .catch((err) => {
        if (cancelled) return;
        const apiError = err as ApiError;
        setStatus("error");
        setMessage(apiError.message || "Could not confirm this email change link.");
      });
    return () => {
      cancelled = true;
    };
  }, [token, hasToken]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel/95 p-6 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="font-display text-2xl">Confirm Email Change</h1>
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

        {status === "loading" && <p className="text-sm text-muted">Confirming your new email...</p>}
        {status === "success" && <p className="text-sm text-green-300">{message}</p>}
        {status === "error" && <p className="text-sm text-red-300">{message}</p>}

        <button
          type="button"
          onClick={() => {
            window.location.href = "/";
          }}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white hover:bg-accent/90"
        >
          Go to FullStreamer
        </button>
      </div>
    </div>
  );
}
